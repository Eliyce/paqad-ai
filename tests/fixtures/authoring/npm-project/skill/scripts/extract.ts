import { readFileSync } from 'node:fs';

export const HELP =
  'Usage: extract --input <invoice.json> [--dry-run]\nRun it: prints one ledger line as JSON. Packages: none.';

export interface ExtractResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function extract(argv: readonly string[]): ExtractResult {
  if (argv.includes('--help')) return { code: 0, stdout: HELP, stderr: '' };
  const index = argv.indexOf('--input');
  const path = index === -1 ? undefined : argv[index + 1];
  if (path === undefined) {
    return { code: 2, stdout: '', stderr: 'expected --input <invoice.json>' };
  }
  const invoice = JSON.parse(readFileSync(path, 'utf8')) as { supplier: string; total: number };
  const line = { account: 'payables', supplier: invoice.supplier, amount: invoice.total };
  return { code: 0, stdout: JSON.stringify(line), stderr: '' };
}
