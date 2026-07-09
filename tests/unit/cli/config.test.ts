import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createConfigCommand } from '@/cli/commands/config.js';
import { resolveEffectiveConfig } from '@/cli/commands/config.js';

describe('paqad-ai config effective (#326)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-config-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  function knob(key: string, env: NodeJS.ProcessEnv = {}) {
    return resolveEffectiveConfig(root, env).find((k) => k.key === key);
  }

  it('reports the default surface when nothing overrides a knob', () => {
    const k = knob('auto_update');
    expect(k?.surface).toBe('default');
    expect(k?.value).toBe('true');
  });

  it('resolves the local .paqad/.config surface over the default', () => {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, '.paqad/.config'), 'rag_top_n=9\n');
    const k = knob('rag_top_n');
    expect(k?.surface).toBe('local .paqad/.config');
    expect(k?.value).toBe('9');
  });

  it('resolves the tracked team surface when only it sets a knob', () => {
    mkdirSync(join(root, '.paqad/configs'), { recursive: true });
    writeFileSync(join(root, '.paqad/configs/.config.rag'), 'rag_max_file_size=1234\n');
    const k = knob('rag_max_file_size');
    expect(k?.surface).toBe('team configs/.config.*');
    expect(k?.value).toBe('1234');
  });

  it('lets an env PAQAD_* override win', () => {
    const k = knob('auto_update', { PAQAD_AUTO_UPDATE: 'false' });
    expect(k?.surface).toBe('env:PAQAD_AUTO_UPDATE');
    expect(k?.value).toBe('false');
  });

  it('shows the floored resolver value + consumer for rule_compliance and stages_mode', () => {
    const rc = knob('rule_compliance');
    expect(rc?.surface).toContain('floored');
    expect(rc?.consumed_by).toContain('rule-scripts');
    const sm = knob('stages_mode');
    expect(sm?.surface).toContain('floored');
    expect(sm?.consumed_by).toContain('stages');
  });

  it('flags a verified placebo knob as consumed by NOTHING', () => {
    expect(knob('escalate_security_findings')?.consumed_by).toBe('NOTHING');
    expect(knob('full_lane_default')?.consumed_by).toBe('NOTHING');
    expect(knob('research_depth')?.consumed_by).toBe('NOTHING');
  });

  it('maps a genuinely-consumed knob to its consumer', () => {
    expect(knob('rag_enabled')?.consumed_by).toContain('context seam');
    expect(knob('model_default')?.consumed_by).toContain('model');
  });

  it('does not mutate or create any config file (read-only)', () => {
    resolveEffectiveConfig(root);
    // A read-only resolve writes nothing — no .paqad dir is conjured in a bare project.
    expect(existsSync(join(root, '.paqad'))).toBe(false);
    expect(existsSync(join(root, '.paqad/.config'))).toBe(false);
  });

  it('prints a table and a placebo count via the command', async () => {
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => void out.push(String(line)));
    await createConfigCommand().parseAsync(['effective', '--project-root', root], { from: 'user' });
    const text = out.join('\n');
    expect(text).toContain('paqad_enable');
    expect(text).toContain('consumed by: NOTHING');
    expect(text).toMatch(/with no consumer \(placebo/);
  });

  it('emits machine-readable JSON with --json', async () => {
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => void out.push(String(line)));
    await createConfigCommand().parseAsync(['effective', '--project-root', root, '--json'], {
      from: 'user',
    });
    const parsed = JSON.parse(out.join('\n')) as { knobs: { key: string }[] };
    expect(parsed.knobs.length).toBeGreaterThan(30);
  });
});
