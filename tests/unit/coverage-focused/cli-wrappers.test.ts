import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockListAvailableActiveCapabilities,
  mockAssertActiveCapability,
  mockAddActiveCapability,
  mockRemoveActiveCapability,
  mockReadProjectProfile,
  mockWriteProjectProfile,
  mockHealthRun,
  mockBootstrapFramework,
  mockPatternList,
  mockPatternPrune,
  mockPatternExport,
  mockUpdaterRun,
  mockAppendAuditLog,
  mockAppendAuditLogFailure,
  mockResumePlanExecution,
  mockConfirm,
  mockSelect,
  mockCheckbox,
} = vi.hoisted(() => ({
  mockListAvailableActiveCapabilities: vi.fn(() => ['rag', 'review']),
  mockAssertActiveCapability: vi.fn((value: string) => value),
  mockAddActiveCapability: vi.fn((profile, capability) => ({
    ...profile,
    active_capabilities: [...profile.active_capabilities, capability],
  })),
  mockRemoveActiveCapability: vi.fn((profile, capability) => ({
    ...profile,
    active_capabilities: profile.active_capabilities.filter((item: string) => item !== capability),
  })),
  mockReadProjectProfile: vi.fn(),
  mockWriteProjectProfile: vi.fn(),
  mockHealthRun: vi.fn(),
  mockBootstrapFramework: vi.fn(),
  mockPatternList: vi.fn(),
  mockPatternPrune: vi.fn(),
  mockPatternExport: vi.fn(),
  mockUpdaterRun: vi.fn(),
  mockAppendAuditLog: vi.fn(),
  mockAppendAuditLogFailure: vi.fn(),
  mockResumePlanExecution: vi.fn(),
  mockConfirm: vi.fn(),
  mockSelect: vi.fn(),
  mockCheckbox: vi.fn(),
}));

vi.mock('@/core/capabilities.js', () => ({
  listAvailableActiveCapabilities: mockListAvailableActiveCapabilities,
  assertActiveCapability: mockAssertActiveCapability,
  addActiveCapability: mockAddActiveCapability,
  removeActiveCapability: mockRemoveActiveCapability,
}));

vi.mock('@/core/project-profile.js', () => ({
  readProjectProfile: mockReadProjectProfile,
  writeProjectProfile: mockWriteProjectProfile,
}));

vi.mock('@/health/index.js', () => ({
  HealthChecker: class {
    run = mockHealthRun;
  },
}));

vi.mock('@/install/index.js', () => ({
  bootstrapFramework: mockBootstrapFramework,
}));

vi.mock('@/patterns/index.js', () => ({
  PatternStore: class {},
  PatternCli: class {
    list = mockPatternList;
    prune = mockPatternPrune;
    exportPatterns = mockPatternExport;
  },
}));

vi.mock('@/update/index.js', () => ({
  FrameworkUpdater: class {
    run = mockUpdaterRun;
  },
}));

vi.mock('@/update/audit.js', () => ({
  appendAuditLog: mockAppendAuditLog,
  appendAuditLogFailure: mockAppendAuditLogFailure,
}));

vi.mock('@/cli/plan-resume.js', () => ({
  resumePlanExecution: mockResumePlanExecution,
}));

vi.mock('@inquirer/prompts', () => ({
  confirm: mockConfirm,
  select: mockSelect,
  checkbox: mockCheckbox,
}));

import { createCapabilitiesCommand } from '@/cli/commands/capabilities.js';
import { createDoctorCommand } from '@/cli/commands/doctor.js';
import { createInstallCommand } from '@/cli/commands/install.js';
import { createPlanCommand } from '@/cli/commands/plan.js';
import { createPatternsCommand } from '@/cli/commands/patterns.js';
import { createUpdateCommand } from '@/cli/commands/update.js';
import { checkboxPrompt, confirmPrompt, selectPrompt } from '@/cli/ui/prompts.js';

describe('coverage cli wrappers', () => {
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
    mockReadProjectProfile.mockReturnValue({
      active_capabilities: ['rag'],
    });
    mockHealthRun.mockResolvedValue({ overall_status: 'pass' });
    mockBootstrapFramework.mockReturnValue({ installed: true });
    mockUpdaterRun.mockResolvedValue({
      previous_version: '0.1.0',
      target_version: '0.2.2',
    });
    mockResumePlanExecution.mockResolvedValue({
      trackerPath: '/repo/.paqad/specs/demo.execution.json',
      resetSliceIds: ['SL-2'],
      currentSliceId: 'SL-2',
      warnings: [],
    });
    mockConfirm.mockResolvedValue(true);
    mockSelect.mockResolvedValue('codex-cli');
    mockCheckbox.mockResolvedValue(['rag']);
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('lists, shows available capabilities, adds capabilities, removes capabilities, and throws when the profile is missing', async () => {
    const command = createCapabilitiesCommand();

    await command.parseAsync(['node', 'capabilities', 'list', '--project-root', '/repo']);
    expect(stdoutSpy).toHaveBeenLastCalledWith('rag\n');

    await command.parseAsync(['node', 'capabilities', 'available']);
    expect(stdoutSpy).toHaveBeenLastCalledWith('rag\nreview\n');

    await command.parseAsync(['node', 'capabilities', 'add', 'review', '--project-root', '/repo']);
    expect(mockWriteProjectProfile).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({ active_capabilities: ['rag', 'review'] }),
    );

    await command.parseAsync(['node', 'capabilities', 'remove', 'rag', '--project-root', '/repo']);
    expect(mockWriteProjectProfile).toHaveBeenLastCalledWith(
      '/repo',
      expect.objectContaining({ active_capabilities: [] }),
    );

    mockReadProjectProfile.mockReturnValueOnce(null);
    await expect(
      command.parseAsync(['node', 'capabilities', 'list', '--project-root', '/missing']),
    ).rejects.toThrow('Project profile not found');
  });

  it('runs doctor and sets exit code based on health status', async () => {
    const command = createDoctorCommand();

    mockHealthRun.mockResolvedValueOnce({ overall_status: 'pass' });
    await command.parseAsync(['node', 'doctor', '--project-root', '/repo']);
    expect(logSpy).toHaveBeenLastCalledWith('{\n  "overall_status": "pass"\n}');
    expect(process.exitCode).toBe(0);

    mockHealthRun.mockResolvedValueOnce({ overall_status: 'fail' });
    await command.parseAsync(['node', 'doctor', '--project-root', '/repo']);
    expect(process.exitCode).toBe(1);
  });

  it('runs install and logs the bootstrap result', async () => {
    const command = createInstallCommand();

    await command.parseAsync(['node', 'install', '--project-root', '/repo']);
    expect(mockBootstrapFramework).toHaveBeenCalledWith('/repo');
    expect(logSpy).toHaveBeenLastCalledWith('{\n  "installed": true\n}');
  });

  it('routes patterns list, prune, and export options through the pattern cli', async () => {
    const command = createPatternsCommand();

    await command.parseAsync([
      'node',
      'patterns',
      'list',
      '--domain',
      'coding',
      '--category',
      'security',
      '--frameworks',
      'laravel, react',
      '--keywords',
      'auth, cache',
    ]);
    expect(mockPatternList).toHaveBeenCalledWith({
      domain: 'coding',
      category: 'security',
      frameworks: ['laravel', 'react'],
      keywords: ['auth', 'cache'],
    });

    await command.parseAsync(['node', 'patterns', 'prune', '--older-than', '365']);
    expect(mockPatternPrune).toHaveBeenCalledWith(365);

    await command.parseAsync([
      'node',
      'patterns',
      'export',
      '/tmp/patterns.json',
      '--format',
      'markdown',
    ]);
    expect(mockPatternExport).toHaveBeenCalledWith('/tmp/patterns.json', 'markdown');

    await command.parseAsync([
      'node',
      'patterns',
      'export',
      '/tmp/patterns.json',
      '--format',
      'yaml',
    ]);
    expect(mockPatternExport).toHaveBeenLastCalledWith('/tmp/patterns.json', 'json');
  });

  it('routes plan resume through the slice-resume helper', async () => {
    const command = createPlanCommand();

    await command.parseAsync(['node', 'plan', 'resume', 'demo', '--project-root', '/repo']);
    expect(mockResumePlanExecution).toHaveBeenCalledWith('/repo', 'demo');
    expect(logSpy).toHaveBeenLastCalledWith(
      '{\n  "trackerPath": "/repo/.paqad/specs/demo.execution.json",\n  "resetSliceIds": [\n    "SL-2"\n  ],\n  "currentSliceId": "SL-2",\n  "warnings": []\n}',
    );
  });

  it('handles update silent and error branches without leaking output', async () => {
    const command = createUpdateCommand();

    await command.parseAsync(['node', 'update', '--project-root', '/repo', '--silent']);
    expect(logSpy).not.toHaveBeenCalled();
    expect(mockAppendAuditLog).toHaveBeenCalledWith('/repo', '0.1.0', '0.2.2');

    mockUpdaterRun.mockRejectedValueOnce('plain failure');
    await command.parseAsync(['node', 'update', '--project-root', '/repo', '--silent']);
    expect(mockAppendAuditLogFailure).toHaveBeenCalledWith(
      '/repo',
      null,
      expect.any(String),
      'plain failure',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    mockUpdaterRun.mockRejectedValueOnce(new Error('boom'));
    await expect(command.parseAsync(['node', 'update', '--project-root', '/repo'])).rejects.toThrow(
      'boom',
    );
  });

  it('updates normally, suppresses output in silent mode, and logs silent failures before exiting non-zero', async () => {
    const command = createUpdateCommand();

    await command.parseAsync(['node', 'update', '--project-root', '/repo']);
    expect(logSpy).toHaveBeenLastCalledWith(
      '{\n  "previous_version": "0.1.0",\n  "target_version": "0.2.2"\n}',
    );
    expect(mockAppendAuditLog).toHaveBeenCalledWith('/repo', '0.1.0', '0.2.2');

    await command.parseAsync(['node', 'update', '--project-root', '/repo', '--silent']);
    expect(logSpy).toHaveBeenCalledTimes(1);

    mockUpdaterRun.mockRejectedValueOnce(new Error('boom'));
    await expect(command.parseAsync(['node', 'update', '--project-root', '/repo'])).rejects.toThrow(
      'boom',
    );

    mockUpdaterRun.mockRejectedValueOnce(new Error('silent boom'));
    await command.parseAsync(['node', 'update', '--project-root', '/repo', '--silent']);
    expect(mockAppendAuditLogFailure).toHaveBeenCalledWith(
      '/repo',
      null,
      expect.any(String),
      'silent boom',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('proxies prompt helpers to inquirer', async () => {
    await expect(confirmPrompt('Continue?')).resolves.toBe(true);
    await expect(
      selectPrompt('Pick one', [
        { name: 'Codex', value: 'codex-cli' },
        { name: 'Claude', value: 'claude-code' },
      ]),
    ).resolves.toBe('codex-cli');
    await expect(
      checkboxPrompt('Pick many', [
        { name: 'RAG', value: 'rag', checked: true },
        { name: 'Review', value: 'review' },
      ]),
    ).resolves.toEqual(['rag']);

    expect(mockConfirm).toHaveBeenCalledWith({ message: 'Continue?' });
    expect(mockSelect).toHaveBeenCalledWith({
      message: 'Pick one',
      choices: [
        { name: 'Codex', value: 'codex-cli' },
        { name: 'Claude', value: 'claude-code' },
      ],
    });
    expect(mockCheckbox).toHaveBeenCalledWith({
      message: 'Pick many',
      choices: [
        { name: 'RAG', value: 'rag', checked: true },
        { name: 'Review', value: 'review' },
      ],
    });
  });
});
