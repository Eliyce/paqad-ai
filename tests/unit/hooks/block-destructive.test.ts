import { execa } from 'execa';
import { join } from 'node:path';

describe('block-destructive.sh', () => {
  const script = join(process.cwd(), 'runtime/hooks/block-destructive.sh');

  it('blocks rm -rf', async () => {
    const result = await execa(script, {
      reject: false,
      input: JSON.stringify({ command: 'rm -rf node_modules' }),
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks rm -fr (alternate flag order)', async () => {
    const result = await execa(script, {
      reject: false,
      input: JSON.stringify({ command: 'rm -fr /' }),
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks DROP TABLE case-insensitively', async () => {
    const result = await execa(script, {
      reject: false,
      input: JSON.stringify({ command: 'drop table users;' }),
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks DROP DATABASE', async () => {
    const result = await execa(script, {
      reject: false,
      input: JSON.stringify({ command: 'DROP DATABASE production' }),
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks TRUNCATE TABLE', async () => {
    const result = await execa(script, {
      reject: false,
      input: JSON.stringify({ command: 'TRUNCATE TABLE orders;' }),
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks git push -f (short flag)', async () => {
    const result = await execa(script, {
      reject: false,
      input: JSON.stringify({ command: 'git push -f origin main' }),
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks git reset --hard', async () => {
    const result = await execa(script, {
      reject: false,
      input: JSON.stringify({ command: 'git reset --hard HEAD~3' }),
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks git clean -f', async () => {
    const result = await execa(script, {
      reject: false,
      input: JSON.stringify({ command: 'git clean -fd' }),
    });
    expect(result.exitCode).toBe(2);
  });

  it('includes reason in error message', async () => {
    const result = await execa(script, {
      reject: false,
      input: JSON.stringify({ command: 'git push --force origin main' }),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('git push --force');
  });

  it('allows safe commands', async () => {
    const result = await execa(script, {
      reject: false,
      input: JSON.stringify({ command: 'pnpm test' }),
    });
    expect(result.exitCode).toBe(0);
  });
});
