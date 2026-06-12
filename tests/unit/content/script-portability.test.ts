import { readFile } from 'node:fs/promises';

import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';

/**
 * Portability guard for the shipped shell scripts (issue context: Debian's
 * default awk is mawk, which silently fails to match `{n,m}` interval
 * expressions — `match($0, /x{1,80}/)` returns 0 instead of erroring, so a
 * script "works" on gawk/BSD awk CI runners and drops output on Debian).
 *
 * Interval expressions are fine in `grep -E` (GNU and BSD grep both support
 * them); the guard targets awk `match()` calls, where the mawk gap bit twice
 * (copy-and-ia-review extract-user-strings.sh and check-action-verbs.sh).
 * Enforce a length() check instead — see those scripts for the pattern.
 */
describe('runtime shell script portability', () => {
  it('no awk match() call uses {n,m} interval expressions (mawk does not support them)', async () => {
    const files = (
      await fg('runtime/**/scripts/*.sh', { cwd: process.cwd(), absolute: true })
    ).sort();
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const lines = (await readFile(file, 'utf8')).split('\n');
      lines.forEach((line, index) => {
        if (/match\s*\(.*\{[0-9]+,[0-9]*\}/.test(line)) {
          offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
