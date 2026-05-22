import { execa } from 'execa';
import { join } from 'node:path';

describe('pre-commit-check.sh', () => {
  const script = join(process.cwd(), 'runtime/hooks/pre-commit-check.sh');

  it('passes when all exit codes are zero', async () => {
    const result = await execa(script, {
      reject: false,
      input: JSON.stringify({ test_exit_code: 0, lint_exit_code: 0, typecheck_exit_code: 0 }),
    });
    expect(result.exitCode).toBe(0);
  });

  it('passes when exit codes are omitted (defaults to zero)', async () => {
    const result = await execa(script, {
      reject: false,
      input: JSON.stringify({}),
    });
    expect(result.exitCode).toBe(0);
  });

  it('fails when tests fail', async () => {
    const result = await execa(script, {
      reject: false,
      input: JSON.stringify({ test_exit_code: 1, lint_exit_code: 0 }),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('tests');
  });

  it('fails when lint fails', async () => {
    const result = await execa(script, {
      reject: false,
      input: JSON.stringify({ test_exit_code: 0, lint_exit_code: 1 }),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('lint');
  });

  it('fails when typecheck fails', async () => {
    const result = await execa(script, {
      reject: false,
      input: JSON.stringify({ test_exit_code: 0, lint_exit_code: 0, typecheck_exit_code: 1 }),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('typecheck');
  });

  it('reports all failures when multiple checks fail', async () => {
    const result = await execa(script, {
      reject: false,
      input: JSON.stringify({ test_exit_code: 1, lint_exit_code: 1, typecheck_exit_code: 0 }),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('tests');
    expect(result.stderr).toContain('lint');
  });
});
