import { logger } from '@/cli/ui/logger';
import { printBanner, printNextSteps } from '@/cli/ui/banner';
import { createSpinner } from '@/cli/ui/spinner';

vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(async () => true),
  select: vi.fn(async () => 'coding'),
}));

describe('cli ui helpers', () => {
  it('formats logger output', () => {
    expect(logger.info('info')).toContain('info');
    expect(logger.success('ok')).toContain('ok');
    expect(logger.warning('warn')).toContain('warn');
    expect(logger.error('error')).toContain('error');
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
