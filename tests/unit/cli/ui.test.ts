import { logger } from '@/cli/ui/logger';
import { printBanner, printNextSteps } from '@/cli/ui/banner';
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
      // The optional rules-as-scripts guidance moved here from next-steps.md.
      expect(output).toContain('analyze rules');
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
