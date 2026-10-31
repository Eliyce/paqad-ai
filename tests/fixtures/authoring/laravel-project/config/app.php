<?php

return [
    'name' => 'skill-fixture',
    'env' => 'testing',
    'debug' => false,
    'key' => 'base64:'.base64_encode(str_repeat('k', 32)),
    'cipher' => 'AES-256-CBC',
];
