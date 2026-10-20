import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function isDirectEntry(importMetaUrl, argv1 = process.argv[1]) {
  if (!argv1) {
    return false;
  }
  try {
    return importMetaUrl === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}
