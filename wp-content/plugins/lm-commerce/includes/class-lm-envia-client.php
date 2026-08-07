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
        $this->token = $token ?? (defined('LM_ENVIA_TOKEN') ? (string) LM_ENVIA_TOKEN : '');
        $mode = $environment ?? (defined('LM_ENVIA_ENV') ? (string) LM_ENVIA_ENV : 'sandbox');
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
                'timeout' => 12,
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
            return $response;
        }

        $status = wp_remote_retrieve_response_code($response);
        $data = json_decode(wp_remote_retrieve_body($response), true);
        if (! is_array($data)) {
            return new WP_Error('lm_envia_invalid_json', __('Envia.com devolvió una respuesta ilegible.', 'lm-commerce'));
        }

        // Envia may report API errors inside an HTTP 200 response.
        if ($status >= 400 || 'error' === ($data['meta'] ?? null) || isset($data['error'])) {
            $error = $data['error'] ?? array();
            $message = is_array($error)
                ? ($error['message'] ?? $error['description'] ?? __('Error desconocido de Envia.com.', 'lm-commerce'))
                : (string) $error;
            return new WP_Error('lm_envia_api_error', sanitize_text_field((string) $message), $data);
        }

        return $data;
    }
}

