import { logger } from '@/cli/ui/logger';
import { printBanner, printNewProjectNextSteps, printNextSteps } from '@/cli/ui/banner';
import { createSpinner } from '@/cli/ui/spinner';

vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(async () => true),
  select: vi.fn(async () => 'coding'),
}));

describe('cli ui helpers', () => {
  it('emits structured logger output', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      logger.info('info');
      logger.success('ok');
      logger.warning('warn');
      logger.error('error');

      const records = writeSpy.mock.calls.map(([line]) => JSON.parse(String(line)));
      expect(records).toHaveLength(4);
      expect(records[0]).toMatchObject({ level: 'info', event: 'info', runtime: 'engine' });
      expect(records[1]).toMatchObject({ level: 'info', event: 'success', message: 'ok' });
      expect(records[2]).toMatchObject({ level: 'warn', event: 'warn' });
      expect(records[3]).toMatchObject({ level: 'error', event: 'error' });
      for (const record of records) {
        expect(typeof record.timestamp).toBe('string');
      }
    } finally {
      writeSpy.mockRestore();
    }
  });

  it('creates a spinner wrapper', () => {
    const spinner = createSpinner('loading');
    expect(spinner.text).toBe('loading');
  });

  it('prints branded onboarding guidance', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      printBanner();
      printNextSteps();

      const output = logSpy.mock.calls.flat().join('\n');
      expect(output).toContain('AI Framework');
      expect(output).toContain('ONBOARDING COMPLETE');
      expect(output).toContain('create documentation');
      expect(output).toContain('create module documentation');
      expect(output).toContain('analyze rules');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('keeps the onboarding panel byte-identical', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      printNextSteps();
      const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toBe(
        [
          '',
          '╔════════════════════════════════════════════════════════════════════╗',
          '║   ONBOARDING COMPLETE                                              ║',
          '╠════════════════════════════════════════════════════════════════════╣',
          '║                                                                    ║',
          '║   NEXT STEP: prompt your AI agent with:                            ║',
          '║                                                                    ║',
          '║     create documentation                                           ║',
          '║                                                                    ║',
          '║   Generates docs/instructions/** and a reviewable module map.      ║',
          '║   Review the map, then prompt: create module documentation         ║',
          '║                                                                    ║',
          '║   Optional: prompt "analyze rules" then "generate rule scripts"    ║',
          '║   to enforce docs/instructions/rules/** as real checks.            ║',
          '╚════════════════════════════════════════════════════════════════════╝',
          '',
        ].join('\n'),
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  it('prints the new-project panel with one next step and no onboarding steps', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      printNewProjectNextSteps({ projectRoot: '/tmp/demo/my-thing', gitInitialized: true });
      const lines = logSpy.mock.calls.map((call) => call.join(' '));
      const output = lines.join('\n');
      expect(output).toContain('WORKSPACE CREATED');
      expect(output).toContain('/tmp/demo/my-thing (git initialized)');
      expect(output).toContain('Application stack: UNDECIDED');
      expect(output.match(/NEXT STEP/g)).toHaveLength(1);
      expect(output).toContain('NEXT STEP: choose your application stack');
      expect(output).toContain('Run discovery to shape it, or run `paqad-ai onboard`');
      expect(output).toContain('once the stack exists.');
      expect(output).not.toContain('create documentation');
      expect(output).not.toContain('create module documentation');
      expect(output).not.toContain('analyze rules');
      expect(output).not.toContain('printed below');
      const framed = lines.filter((line) => line.startsWith('║') || line.startsWith('╔'));
      expect(new Set(framed.map((line) => line.length)).size).toBe(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('omits the git note when git was not initialized', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      printNewProjectNextSteps({ projectRoot: '/tmp/demo/plain', gitInitialized: false });
      const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toContain('/tmp/demo/plain');
      expect(output).not.toContain('git initialized');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('prints a long workspace path under the frame without breaking the border', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const longRoot = `/Users/someone/${'very-long-directory-name/'.repeat(4)}my-thing`;

    try {
      printNewProjectNextSteps({ projectRoot: longRoot, gitInitialized: true });
      const lines = logSpy.mock.calls.map((call) => call.join(' '));
      const framed = lines.filter((line) => /^[║╔╠╚]/.test(line));
      expect(new Set(framed.map((line) => line.length)).size).toBe(1);
      expect(framed.some((line) => line.includes(longRoot))).toBe(false);
      const bottom = lines.findIndex((line) => line.startsWith('╚'));
      expect(lines[bottom + 1]).toBe(`${longRoot} (git initialized)`);
      expect(lines.join('\n')).toContain('Location: printed below this panel');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('delegates prompt helpers', async () => {
    const { confirmPrompt, selectPrompt } = await import('@/cli/ui/prompts');

    await expect(confirmPrompt('Proceed?')).resolves.toBe(true);
    await expect(selectPrompt('Choose', [{ name: 'Coding', value: 'coding' }])).resolves.toBe(
      'coding',
    );
  });
});
