import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  buildChangeAuthorship,
  readOnboardedAgent,
  resolveChangeAuthorship,
} from '@/evidence/receipt/authorship.js';

describe('buildChangeAuthorship', () => {
  it('returns undefined when nothing meaningful resolves', () => {
    expect(buildChangeAuthorship({ env: {}, gitIdentity: null })).toBeUndefined();
  });

  it('records the agent as a known fact with unknown provenance when no model declared', () => {
    const authorship = buildChangeAuthorship({ agent: 'cursor', env: {}, gitIdentity: null });
    expect(authorship).toEqual({ agent: 'cursor', provenance: 'unknown' });
  });

  it('parses the agent-trace model_id (provider/model) and derives the canonical id', () => {
    const authorship = buildChangeAuthorship({
      agent: 'claude-code',
      env: { PAQAD_MODEL_ID: 'anthropic/claude-opus-4-8' },
      gitIdentity: null,
    });
    expect(authorship).toMatchObject({
      agent: 'claude-code',
      model: 'claude-opus-4-8',
      provider: 'anthropic',
      model_id: 'anthropic/claude-opus-4-8',
      provenance: 'declared',
    });
  });

  it('lets explicit model/provider env override model_id parts', () => {
    const authorship = buildChangeAuthorship({
      env: {
        PAQAD_MODEL_ID: 'anthropic/claude-opus-4-8',
        PAQAD_AGENT_PROVIDER: 'openai',
        PAQAD_AGENT_MODEL: 'gpt-5',
      },
      gitIdentity: null,
    });
    expect(authorship).toMatchObject({
      model: 'gpt-5',
      provider: 'openai',
      model_id: 'openai/gpt-5',
      provenance: 'declared',
    });
  });

  it('treats a bare model_id with no slash as a model with no provider', () => {
    const authorship = buildChangeAuthorship({
      env: { PAQAD_MODEL_ID: 'some-model' },
      gitIdentity: null,
    });
    expect(authorship).toMatchObject({ model: 'some-model', provenance: 'declared' });
    expect(authorship?.provider).toBeUndefined();
    expect(authorship?.model_id).toBeUndefined();
  });

  it('records the accepting human from git identity', () => {
    const authorship = buildChangeAuthorship({
      agent: 'aider',
      env: {},
      gitIdentity: { name: 'Jane Dev', email: 'jane@example.com' },
    });
    expect(authorship?.accepting_human).toEqual({ name: 'Jane Dev', email: 'jane@example.com' });
  });

  it('omits the accepting human when the PII opt-out is set', () => {
    const authorship = buildChangeAuthorship({
      agent: 'aider',
      env: { PAQAD_NO_HUMAN_ATTESTATION: '1' },
      gitIdentity: { name: 'Jane Dev', email: 'jane@example.com' },
    });
    expect(authorship?.accepting_human).toBeUndefined();
    expect(authorship?.agent).toBe('aider');
  });

  it('omits empty identity fields', () => {
    const authorship = buildChangeAuthorship({
      agent: 'windsurf',
      env: {},
      gitIdentity: { name: '  ', email: 'x@y.z' },
    });
    expect(authorship?.accepting_human).toEqual({ email: 'x@y.z' });
  });
});

describe('readOnboardedAgent / resolveChangeAuthorship', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-authorship-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeManifest(adapter: unknown): void {
    const path = join(root, PATHS.ONBOARDING_MANIFEST);
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(path, JSON.stringify({ adapter }), 'utf8');
  }

  it('reads a valid adapter from the manifest', () => {
    writeManifest('codex-cli');
    expect(readOnboardedAgent(root)).toBe('codex-cli');
  });

  it('returns undefined for an unknown adapter value', () => {
    writeManifest('not-a-real-adapter');
    expect(readOnboardedAgent(root)).toBeUndefined();
  });

  it('returns undefined when no manifest exists', () => {
    expect(readOnboardedAgent(root)).toBeUndefined();
  });

  it('resolves authorship from manifest + injected git identity', async () => {
    writeManifest('github-copilot');
    const authorship = await resolveChangeAuthorship({
      projectRoot: root,
      env: { PAQAD_MODEL_ID: 'openai/gpt-5' },
      gitIdentity: { name: 'CI Bot', email: 'ci@example.com' },
    });
    expect(authorship).toMatchObject({
      agent: 'github-copilot',
      provider: 'openai',
      model: 'gpt-5',
      accepting_human: { name: 'CI Bot', email: 'ci@example.com' },
      provenance: 'declared',
    });
  });
});
