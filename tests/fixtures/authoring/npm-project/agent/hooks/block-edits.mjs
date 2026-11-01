import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const BLOCKED = 'migration-reviewer may not edit files.';

export function decide(raw) {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return { code: 2, stderr: 'block-edits could not read the hook input.' };
  }
  const tool = input && typeof input === 'object' ? input.tool_name : undefined;
  if (tool === 'Edit' || tool === 'Write') return { code: 2, stderr: BLOCKED };
  return { code: 0, stderr: '' };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = decide(readFileSync(0, 'utf8'));
  if (result.stderr !== '') process.stderr.write(`${result.stderr}\n`);
  process.exit(result.code);
}
