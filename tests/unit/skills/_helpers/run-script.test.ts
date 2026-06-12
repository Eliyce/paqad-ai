import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './run-script.js';
import { withTempDir } from './temp-fs.js';

function writeScript(dir: string, name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
  return path;
}

describe('runScript helper', () => {
  it('delivers stdin input intact, including input without a trailing newline', () => {
    withTempDir((dir) => {
      const script = writeScript(dir, 'echo-stdin.sh', 'body=$(cat); printf "%s" "$body"');
      const input = '## Findings\n- one finding with an em dash — kept verbatim';
      const r = runScript(script, [], { input });
      expect(r.status).toBe(0);
      // $(cat) strips trailing newlines, so compare against the same.
      expect(r.stdout).toBe(input.replace(/\n+$/, ''));
    });
  });

  it('returns a non-zero result immediately when the script produced output', () => {
    withTempDir((dir) => {
      const counter = join(dir, 'count');
      const script = writeScript(
        dir,
        'usage.sh',
        `printf 'x' >> '${counter}'; printf 'usage: nope\\n'; exit 2`,
      );
      const r = runScript(script);
      expect(r.status).toBe(2);
      expect(r.stdout).toContain('usage:');
      // Output on stdout means the script really ran — exactly one invocation,
      // no retry backoff burned on an expected non-zero exit.
      expect(readFileSync(counter, 'utf8')).toBe('x');
    });
  });

  it('retries a silent non-zero exit across the escalating backoff', () => {
    withTempDir((dir) => {
      const counter = join(dir, 'count');
      const script = writeScript(dir, 'silent-fail.sh', `printf 'x' >> '${counter}'; exit 1`);
      const r = runScript(script);
      expect(r.status).toBe(1);
      // Initial attempt + three retries.
      expect(readFileSync(counter, 'utf8')).toBe('xxxx');
    });
  });

  it('a silent failure that recovers returns the successful attempt', () => {
    withTempDir((dir) => {
      const counter = join(dir, 'count');
      const script = writeScript(
        dir,
        'recovers.sh',
        `printf 'x' >> '${counter}'
if [ "$(wc -c < '${counter}')" -ge 2 ]; then printf 'ok\\n'; exit 0; fi
exit 1`,
      );
      const r = runScript(script);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('ok\n');
      expect(readFileSync(counter, 'utf8')).toBe('xx');
    });
  });
});
