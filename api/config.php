<?php
// Prevent direct browser access
if (!defined('CAPI_INTERNAL')) {
    http_response_code(403);
    die('Forbidden');
}

// Meta / Facebook Pixel + Conversion API credentials
define('META_PIXEL_ID',     '1383922460505005');
define('META_ACCESS_TOKEN', 'EAAOZAXxZAHkHIBSItG9ndsXOYBxY9zuDZCViCwDiwVSy6iJcDJL2kjAJtV1iQEOx4G8s27jqpMT47CPymltButOtfWCFzs0SybFq4eh6VlZCTCnjpIK8CpL06CNz2XfjQYs6kFGD75IFr4DcvCzYNGta4FYTFw4jabNXiWKgWflwMajQikgQ1VM2SIZCJdqDW7wZDZD');
define('META_API_VERSION',  'v19.0');

// Optional: leave empty for production; set to a code from Meta Events Manager > Test Events for debugging
define('META_TEST_EVENT_CODE', '');

// Allowed origin(s) for CORS (browser -> this endpoint)
define('CAPI_ALLOWED_ORIGIN', 'https://blissfulsenja.com');
