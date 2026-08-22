<?php
/**
 * Meta Conversions API relay endpoint
 * Receives event payloads from the browser, enriches with server-side data,
 * hashes PII with SHA-256 per Meta's requirements, and forwards to Meta.
 */

define('CAPI_INTERNAL', true);
require __DIR__ . '/config.php';

// --- CORS ---
$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
if ($origin === CAPI_ALLOWED_ORIGIN) {
    header('Access-Control-Allow-Origin: ' . CAPI_ALLOWED_ORIGIN);
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST')   { http_response_code(405); exit; }

header('Content-Type: application/json');

// --- Read payload ---
$raw = file_get_contents('php://input');
$in  = json_decode($raw, true);
if (!is_array($in) || empty($in['event_name'])) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'invalid payload']);
    exit;
}

// --- Helpers ---
function hash_norm($v) {
    if ($v === null || $v === '') return null;
    return hash('sha256', strtolower(trim($v)));
}
function norm_phone($v) {
    if (!$v) return null;
    // Meta expects digits only, no +, no spaces, no dashes
    return hash('sha256', preg_replace('/\D+/', '', $v));
}

// --- Build user_data ---
$ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? '';
if (strpos($ip, ',') !== false) { $ip = trim(explode(',', $ip)[0]); }
$ua = $_SERVER['HTTP_USER_AGENT'] ?? '';

$user_data = [
    'client_ip_address' => $ip,
    'client_user_agent' => $ua,
];

// Cookies for fbp / fbc (browser sends them in the payload since we can't read cross-cookies here)
if (!empty($in['fbp'])) $user_data['fbp'] = $in['fbp'];
if (!empty($in['fbc'])) $user_data['fbc'] = $in['fbc'];

// Hashed PII (if provided)
if (!empty($in['email']))  { $h = hash_norm($in['email']); if ($h) $user_data['em'] = $h; }
if (!empty($in['phone']))  { $h = norm_phone($in['phone']); if ($h) $user_data['ph'] = $h; }
if (!empty($in['fn']))     { $h = hash_norm($in['fn']);    if ($h) $user_data['fn'] = $h; }
if (!empty($in['ln']))     { $h = hash_norm($in['ln']);    if ($h) $user_data['ln'] = $h; }
if (!empty($in['country'])){ $h = hash_norm($in['country']); if ($h) $user_data['country'] = $h; }

// external_id: stable pseudonymous ID hashed (Meta accepts as user_data identity signal)
if (!empty($in['external_id'])) {
    $user_data['external_id'] = hash('sha256', trim($in['external_id']));
}

// --- Build event ---
$event = [
    'event_name'       => $in['event_name'],
    'event_time'       => isset($in['event_time']) ? (int)$in['event_time'] : time(),
    'event_id'         => $in['event_id'] ?? bin2hex(random_bytes(16)),
    'event_source_url' => $in['event_source_url'] ?? ($_SERVER['HTTP_REFERER'] ?? ''),
    'action_source'    => 'website',
    'user_data'        => $user_data,
];

if (!empty($in['custom_data']) && is_array($in['custom_data'])) {
    $event['custom_data'] = $in['custom_data'];
}

$payload = ['data' => [$event]];
if (defined('META_TEST_EVENT_CODE') && META_TEST_EVENT_CODE !== '') {
    $payload['test_event_code'] = META_TEST_EVENT_CODE;
}

// --- Send to Meta ---
$url = 'https://graph.facebook.com/' . META_API_VERSION . '/' . META_PIXEL_ID . '/events?access_token=' . urlencode(META_ACCESS_TOKEN);

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode($payload),
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 8,
]);
$resp = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err  = curl_error($ch);
curl_close($ch);

// Return minimal info to browser (never leak token, response details)
if ($code >= 200 && $code < 300) {
    echo json_encode(['ok' => true, 'event_id' => $event['event_id']]);
} else {
    // Log server-side for debugging; return generic error
    error_log('[meta-capi] HTTP ' . $code . ' ' . $err . ' resp=' . substr((string)$resp, 0, 500));
    http_response_code(502);
    echo json_encode(['ok' => false]);
}
