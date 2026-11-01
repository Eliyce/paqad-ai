<?php

const BLOCK_EDITS_MESSAGE = 'migration-reviewer may not edit files.';

function block_edits_decide(string $raw): array
{
    $input = json_decode($raw, true);
    if (! is_array($input)) {
        return [2, 'BlockEdits could not read the hook input.'];
    }
    $tool = $input['tool_name'] ?? null;
    if ($tool === 'Edit' || $tool === 'Write') {
        return [2, BLOCK_EDITS_MESSAGE];
    }

    return [0, ''];
}

if (PHP_SAPI === 'cli' && realpath($_SERVER['argv'][0] ?? '') === __FILE__) {
    [$code, $message] = block_edits_decide((string) stream_get_contents(STDIN));
    if ($message !== '') {
        fwrite(STDERR, $message.PHP_EOL);
    }
    exit($code);
}
