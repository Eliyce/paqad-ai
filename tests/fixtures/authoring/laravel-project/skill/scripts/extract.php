<?php

const EXTRACT_HELP = "Usage: extract.php --input <invoice.json> [--dry-run]\nRun it: prints one ledger line as JSON. Packages: none.";

function extract_invoice(array $argv): array
{
    if (in_array('--help', $argv, true)) {
        return [0, EXTRACT_HELP, ''];
    }
    $index = array_search('--input', $argv, true);
    if ($index === false || ! isset($argv[$index + 1])) {
        return [2, '', 'expected --input <invoice.json>'];
    }
    $invoice = json_decode(file_get_contents($argv[$index + 1]), true);
    $line = ['account' => 'payables', 'supplier' => $invoice['supplier'], 'amount' => $invoice['total']];

    return [0, json_encode($line), ''];
}

if (PHP_SAPI === 'cli' && realpath($argv[0] ?? '') === __FILE__) {
    [$code, $out, $err] = extract_invoice(array_slice($argv, 1));
    fwrite(STDOUT, $out);
    fwrite(STDERR, $err);
    exit($code);
}
