import { readFile } from 'node:fs/promises';

import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';

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

  it('no pipeline feeds grep -q (early-exit SIGPIPE + pipefail turns matches into failures)', async () => {
    const files = (
      await fg(['runtime/**/scripts/*.sh', 'runtime/hooks/*.sh'], {
        cwd: process.cwd(),
        absolute: true,
      })
    ).sort();
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const lines = (await readFile(file, 'utf8')).split('\n');
      lines.forEach((line, index) => {
        if (/\|\s*grep\s+-[a-zA-Z]*q/.test(line)) {
          offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
