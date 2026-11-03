import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDeliveryCommand } from '@/cli/commands/delivery.js';

let root: string;
let errors: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-deliver-cmd-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  errors = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation((line: unknown) => void errors.push(String(line)));
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  rmSync(root, { recursive: true, force: true });
});

async function deliver(...args: string[]): Promise<void> {
  await createDeliveryCommand().parseAsync([...args, '--project-root', root], { from: 'user' });
}

describe('paqad-ai deliver: the real command', () => {
  it('pauses for the open-PR decision with repeated labels and reviewers and no remote', async () => {
    await deliver(
      '--title',
      'Add login',
      '--summary',
      'let people sign in with email',
      '--label',
      'a',
      '--label',
      'b',
      '--reviewer',
      'alice',
    );
    expect(process.exitCode).toBe(2);
    expect(errors.join('\n')).toContain('delivery.open_pr');
  });

  it('treats a remote on another host as not connected', async () => {
    execFileSync('git', ['remote', 'add', 'origin', 'https://gitlab.example/acme/shop.git'], {
      cwd: root,
    });
    await deliver('--title', 'Add login', '--summary', 'let people sign in with email');
    expect(process.exitCode).toBe(2);
  });

  it('ticket-done stops when there is no ticket move to record', async () => {
    await deliver('ticket-done', 'on_pr_open', '--session', 'no-such-session');
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('**▸ paqad** · delivery stopped');
  });
});
