import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

import { OnboardingOrchestrator } from '@/onboarding';
import { SchemaValidator } from '@/validators/validator.js';

import { useOrchestratorSandbox } from './orchestrator-harness.js';

const { join } = posix;

describe('OnboardingOrchestrator providers in the manifest', () => {
  let projectRoot: string;

  useOrchestratorSandbox((sandbox) => {
    ({ projectRoot } = sandbox);
  });

  it('saves every selected provider in a valid manifest, with the first as the adapter', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
        providers: ['codex-cli', 'claude-code', 'gemini-cli', 'junie'],
      },
    });

    const manifest = JSON.parse(
      readFileSync(join(projectRoot, '.paqad/onboarding-manifest.json'), 'utf8'),
    );
    expect(manifest.adapter).toBe('codex-cli');
    expect(manifest.providers).toEqual(['codex-cli', 'claude-code', 'gemini-cli', 'junie']);
    expect(new SchemaValidator().validate('onboarding-manifest', manifest).errors).toEqual([]);
  });

  it('rejects a provider the framework does not know', () => {
    const result = new SchemaValidator().validate('onboarding-manifest', {
      adapter: 'claude-code',
      providers: ['claude-code', 'not-a-host'],
      project_root: '.',
      profile: {},
      detected: null,
      repository: null,
      generated_at: '2026-01-01T00:00:00.000Z',
      generated_artifacts: [],
    });
    expect(result.errors.some((error) => error.path.includes('providers'))).toBe(true);
  });
});
