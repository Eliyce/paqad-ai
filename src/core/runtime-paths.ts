import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function getPackageRoot(): string {
  return PACKAGE_ROOT;
}

export function getRuntimeRoot(): string {
  return join(PACKAGE_ROOT, 'runtime');
}

export function getRuntimeTemplatesRoot(): string {
  return join(getRuntimeRoot(), 'templates');
}
