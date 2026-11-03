import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { mockRun, mockNpm, mockDetect, mockHint } = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockNpm: vi.fn(),
  mockDetect: vi.fn(),
  mockHint: vi.fn(),
}));

vi.mock('@/onboarding/orchestrator.js', () => ({
  OnboardingOrchestrator: class {
    run = mockRun;
  },
}));
vi.mock('@/core/npm-available.js', () => ({ isNpmAvailable: mockNpm }));
vi.mock('@/detection/detector.js', () => ({
  Detector: class {
    detect = mockDetect;
  },
}));
vi.mock('@/cli/ui/banner.js', () => ({
  printBanner: vi.fn(),
  printNextSteps: vi.fn(),
  codexTrustHint: mockHint,
}));

import { createOnboardCommand } from '@/cli/commands/onboard.js';

let root: string;
let out: string;
let err: string;
let logs: string[];
let warns: string[];
let savedTTY: boolean | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-onboard-sel-'));
  out = '';
  err = '';
  logs = [];
  warns = [];
  savedTTY = process.stdin.isTTY;
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => void logs.push(String(line)));
  vi.spyOn(console, 'warn').mockImplementation((line: unknown) => void warns.push(String(line)));
  mockNpm.mockReturnValue(true);
  mockHint.mockReturnValue(null);
  mockRun.mockResolvedValue({ reverted_framework_values: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  Object.defineProperty(process.stdin, 'isTTY', { value: savedTTY, configurable: true });
  process.exitCode = undefined;
  rmSync(root, { recursive: true, force: true });
});

async function onboard(...args: string[]): Promise<void> {
  await createOnboardCommand().parseAsync([...args, '--project-root', root], { from: 'user' });
}

describe('paqad-ai onboard selections', () => {
  it('--detect prints a readable line with unknown and none fallbacks', async () => {
    mockDetect.mockResolvedValue({
      detected_domain: null,
      detected_stack: null,
      detected_capabilities: [],
      confidence: 'low',
    });
    await onboard('--detect');
    expect(out).toContain('Detected: unknown / none (low confidence)');
    expect(out).toContain('Suggested capabilities: none');
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('--detect names the domain, stack and capabilities it found', async () => {
    mockDetect.mockResolvedValue({
      detected_domain: 'coding',
      detected_stack: 'node-cli',
      detected_capabilities: ['coding', 'testing'],
      recommended_capabilities: ['testing'],
      confidence: 'high',
    });
    await onboard('--detect');
    expect(out).toContain('Detected: coding / node-cli (high confidence)');
    expect(out).toContain('Suggested capabilities: coding, testing');
  });

  it('--non-interactive asks for --stack, then --capability, once providers are given', async () => {
    await onboard('--non-interactive', '--providers', 'claude-code');
    expect(err).toContain('missing --stack');
    err = '';
    await onboard('--non-interactive', '--providers', 'claude-code', '--stack', 'node-cli');
    expect(err).toContain('missing --capability');
    expect(process.exitCode).toBe(2);
  });

  it('refuses other providers when npm is not available', async () => {
    mockNpm.mockReturnValue(false);
    await onboard('--providers', 'cursor');
    expect(err).toContain('npm is not available');
    expect(process.exitCode).toBe(2);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('wires claude-code alone when npm is not available, and turns RAG off non-interactively', async () => {
    mockNpm.mockReturnValue(false);
    await onboard('--non-interactive', '--stack', 'node-cli', '--capability', 'coding');
    expect(mockRun.mock.calls[0][0].selections).toEqual({
      stack: 'node-cli',
      capabilities: ['coding'],
      providers: ['claude-code'],
      rag: { enabled: false },
    });
  });

  it('passes --rag off, and no selections at all when nothing was chosen', async () => {
    await onboard('--rag', 'off');
    expect(mockRun.mock.calls[0][0].selections.rag).toEqual({ enabled: false });
    await onboard();
    expect(mockRun.mock.calls[1][0].selections).toBeUndefined();
  });

  it('warns about framework values that were not migrated and prints the Codex hint', async () => {
    mockRun.mockResolvedValue({ reverted_framework_values: ['rag_top_n'] });
    mockHint.mockReturnValue('Trust this folder in Codex.');
    await onboard('--rag', 'on');
    expect(warns.join('\n')).toContain('Framework settings now live in the .config layer');
    expect(warns.join('\n')).toContain('rag_top_n');
    expect(logs).toContain('\nTrust this folder in Codex.');
  });

  it('copes with onboarding returning nothing', async () => {
    mockRun.mockResolvedValue(undefined);
    await onboard('--rag', 'on');
    expect(warns).toEqual([]);
  });
});
