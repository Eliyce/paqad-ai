import { describe, expect, it, vi } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(async () => ({
    stdout: '',
    stderr: '',
    exitCode: 1,
    timedOut: false,
    failed: true,
  })),
}));

const { runProofCommand } = await import('@/fix-protocol/fix-prove.js');
const { execaCommandRunner } = await import('@/delivery/delivery-check.js');

describe('a command that exits 1 without a not-found code', () => {
  it('reads as missing when the binary is not on PATH', async () => {
    const proof = await runProofCommand('paqad-no-such-binary-xyz', process.cwd(), 30_000);
    expect(proof).toMatchObject({ exit_code: 127, spawn_failed: true });
    const delivery = await execaCommandRunner('paqad-no-such-binary-xyz', []);
    expect(delivery.missing).toBe(true);
  });

  it('reads as a plain failure when the binary is on PATH', async () => {
    const proof = await runProofCommand('node --version', process.cwd(), 30_000);
    expect(proof).toMatchObject({ exit_code: 1, spawn_failed: false });
    const delivery = await execaCommandRunner('node', ['--version']);
    expect(delivery.missing).toBe(false);
  });
});
