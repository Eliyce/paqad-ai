import { execa } from 'execa';
import { join } from 'node:path';

describe('pre-migrate-check.sh', () => {
  const script = join(process.cwd(), 'runtime/hooks/pre-migrate-check.sh');

  it('passes when db review passed', async () => {
    const result = await execa(script, {
      reject: false,
      input: JSON.stringify({ db_review_passed: true }),
    });
    expect(result.exitCode).toBe(0);
  });

  it('blocks when db review failed', async () => {
    const result = await execa(script, {
      reject: false,
      input: JSON.stringify({ db_review_passed: false }),
    });
    expect(result.exitCode).toBe(2);
  });
});
