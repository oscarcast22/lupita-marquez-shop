<?php
/**
 * Minimal Envia.com API client.
 *
 * @package LMCommerce
 */

declare(strict_types=1);

if (! defined('ABSPATH')) {
    exit;
}

final class LM_Envia_Client
{
    private string $token;
    private string $base_url;

    public function __construct(?string $token = null, ?string $environment = null)
    {
        $this->token = trim((string) ($token ?? ''));
        $mode = $environment ?? 'sandbox';
        $this->base_url = 'production' === $mode ? 'https://api.envia.com' : 'https://api-test.envia.com';
    }

    public function configured(): bool
    {
        return '' !== trim($this->token);
    }

    /**
     * @return array<int, array<string, mixed>>|WP_Error
     */
    public function rates(array $payload)
    {
        $result = $this->request('/ship/rate/', $payload);
        if (is_wp_error($result)) {
            return $result;
        }

        $rows = $result['data'] ?? array();
        if (isset($rows['rates']) && is_array($rows['rates'])) {
            $rows = $rows['rates'];
        }
        if (! is_array($rows)) {
            return new WP_Error('lm_envia_invalid_rates', __('Envia.com devolvió una cotización inválida.', 'lm-commerce'));
        }

        $normalized = array();
        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }
            $price = $row['totalPrice'] ?? $row['total_price'] ?? $row['price'] ?? null;
            $service = $row['service'] ?? $row['serviceName'] ?? $row['service_name'] ?? '';
            $service_code = is_array($service) ? ($service['name'] ?? $service['code'] ?? '') : $service;
            if (! is_numeric($price) || '' === (string) $service_code) {
                continue;
            }
            $normalized[] = array(
                'service' => sanitize_key((string) $service_code),
                'label' => sanitize_text_field((string) ($row['serviceDescription'] ?? $row['service_description'] ?? $service_code)),
                'price' => (float) $price,
                'currency' => sanitize_text_field((string) ($row['currency'] ?? 'MXN')),
                'delivery' => sanitize_text_field((string) ($row['deliveryEstimate'] ?? $row['delivery_estimate'] ?? '')),
                'raw' => $row,
            );
        }

        usort($normalized, static fn(array $a, array $b): int => $a['price'] <=> $b['price']);
        if (empty($normalized)) {
            $this->log_empty_rates($result, $payload);
        }
        return $normalized;
    }

    /**
     * @return array<string, mixed>|WP_Error
     */
    public function generate_label(array $payload)
    {
        return $this->request('/ship/generate/', $payload);
    }

    /**
     * @return array<string, mixed>|WP_Error
     */
    public function cancel(string $shipment_id)
    {
        return $this->request('/ship/cancel/', array('shipmentId' => $shipment_id));
    }

    /**
     * @return array<string, mixed>|WP_Error
     */
    public function track(string $tracking_number)
    {
        return $this->request('/ship/generaltrack/', array('trackingNumbers' => array($tracking_number)));
    }

    /**
     * @return array<string, mixed>|WP_Error
     */
    private function request(string $path, array $payload)
    {
        if (! $this->configured()) {
            return new WP_Error('lm_envia_not_configured', __('Falta configurar el token de Envia.com.', 'lm-commerce'));
        }

        $response = wp_remote_post(
            $this->base_url . $path,
            array(
                // A sandbox/API outage must not consume a shared-hosting PHP
                // worker long enough to make the storefront unavailable.
                'timeout' => 5,
                'headers' => array(
                    'Authorization' => 'Bearer ' . $this->token,
                    'Content-Type' => 'application/json',
                    'Accept' => 'application/json',
                    'User-Agent' => 'LM-Commerce/' . LM_COMMERCE_VERSION . '; ' . home_url('/'),
                ),
                'body' => wp_json_encode($payload),
                'data_format' => 'body',
            )
        );

        if (is_wp_error($response)) {
            $this->log_failure($path, 0, $response->get_error_message(), $payload);
            return $response;
        }

        $status = wp_remote_retrieve_response_code($response);
        $data = json_decode(wp_remote_retrieve_body($response), true);
        if (! is_array($data)) {
            $this->log_failure($path, $status, 'Respuesta JSON inválida.', $payload);
            return new WP_Error('lm_envia_invalid_json', __('Envia.com devolvió una respuesta ilegible.', 'lm-commerce'));
        }

        // Envia may report API errors inside an HTTP 200 response.
        if ($status >= 400 || 'error' === ($data['meta'] ?? null) || isset($data['error']) || (isset($data['code'], $data['message']) && ! isset($data['data']))) {
            $error = $data['error'] ?? null;
            $message = is_array($error)
                ? ($error['message'] ?? $error['description'] ?? $data['message'] ?? __('Error desconocido de Envia.com.', 'lm-commerce'))
                : (string) ($data['message'] ?? $error ?? __('Error desconocido de Envia.com.', 'lm-commerce'));
            $this->log_failure($path, $status, (string) $message, $payload, $data);
            return new WP_Error('lm_envia_api_error', sanitize_text_field((string) $message), $data);
        }

        return $data;
    }

    /**
     * Record sandbox integration failures without storing credentials or customer data.
     */
    private function log_failure(string $path, int $status, string $message, array $payload, array $response = array()): void
    {
        if (! $this->sandbox_diagnostics_enabled() || ! function_exists('wc_get_logger')) {
            return;
        }

        wc_get_logger()->error(
            'Envia API request failed.',
            array(
                'source' => 'lm-envia',
                'endpoint' => $path,
                'environment' => str_contains($this->base_url, 'api-test.') ? 'sandbox' : 'production',
                'http_status' => $status,
                'message' => sanitize_text_field($message),
                'request_shape' => $this->request_shape($payload),
                'api_reference' => sanitize_text_field((string) ($response['reference'] ?? '')),
                'api_description' => sanitize_text_field((string) ($response['description'] ?? '')),
                'api_code' => sanitize_text_field((string) ($response['code'] ?? '')),
            )
        );
    }

    /**
     * Capture only the response envelope when Envia accepts a quote but returns no usable rate.
     * This deliberately omits raw address, customer, and credential data.
     *
     * @param array<string, mixed> $response
     */
    private function log_empty_rates(array $response, array $payload): void
    {
        if (! $this->sandbox_diagnostics_enabled() || ! function_exists('wc_get_logger')) {
            return;
        }

        $data = $response['data'] ?? null;
        wc_get_logger()->warning(
            'Envia API returned no usable rates.',
            array(
                'source' => 'lm-envia',
                'environment' => str_contains($this->base_url, 'api-test.') ? 'sandbox' : 'production',
                'response_keys' => implode(',', array_keys($response)),
                'data_type' => gettype($data),
                'data_keys' => is_array($data) ? implode(',', array_keys($data)) : '',
                'data_count' => is_array($data) ? count($data) : 0,
                'api_message' => sanitize_text_field((string) ($response['message'] ?? '')),
                'request_shape' => $this->request_shape($payload),
            )
        );
    }

    private function sandbox_diagnostics_enabled(): bool
    {
        return str_contains($this->base_url, 'api-test.');
    }

    /**
     * Summarize a request for staging diagnostics without logging personal data or credentials.
     *
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    private function request_shape(array $payload): array
    {
        $first_package = $payload['packages'][0] ?? array();
        $dimensions = is_array($first_package) ? ($first_package['dimensions'] ?? array()) : array();

        return array(
            'top_level_keys' => implode(',', array_keys($payload)),
            'origin_keys' => is_array($payload['origin'] ?? null) ? implode(',', array_keys($payload['origin'])) : '',
            'destination_keys' => is_array($payload['destination'] ?? null) ? implode(',', array_keys($payload['destination'])) : '',
            'package_count' => is_array($payload['packages'] ?? null) ? count($payload['packages']) : 0,
            'package_keys' => is_array($first_package) ? implode(',', array_keys($first_package)) : '',
            'shipment' => $this->shipment_shape($payload['shipment'] ?? array()),
            'has_positive_weight' => is_array($first_package) && isset($first_package['weight']) && (float) $first_package['weight'] > 0,
            'has_complete_dimensions' => is_array($dimensions)
                && isset($dimensions['length'], $dimensions['width'], $dimensions['height'])
                && (float) $dimensions['length'] > 0
                && (float) $dimensions['width'] > 0
                && (float) $dimensions['height'] > 0,
        );
    }

    /**
     * Keep service diagnostics useful without including customer information.
     *
     * @param mixed $shipment
     * @return array<string, int|string>
     */
    private function shipment_shape($shipment): array
    {
        if (! is_array($shipment)) {
            return array();
        }

        return array_filter(array(
            'carrier' => sanitize_text_field((string) ($shipment['carrier'] ?? '')),
            'service' => sanitize_key((string) ($shipment['service'] ?? '')),
            'type' => isset($shipment['type']) ? (int) $shipment['type'] : 0,
        ), static fn($value): bool => '' !== $value && 0 !== $value);
    }
}
