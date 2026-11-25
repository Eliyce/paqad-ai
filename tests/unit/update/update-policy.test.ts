import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveFrameworkConfig } from '@/core/framework-config.js';
import {
  cloudSetupCommand,
  pluginAutoUpdate,
  resolveUpdatePolicy,
  teamVersion,
} from '@/update/update-policy.js';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function project(yaml: string | null = null, dotConfig: string | null = null): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-update-policy-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad/configs'), { recursive: true });
  if (yaml !== null) writeFileSync(join(root, '.paqad/configs/paqad.yaml'), yaml);
  if (dotConfig !== null) writeFileSync(join(root, '.paqad/.config'), dotConfig);
  return root;
}

describe('the one update resolver (FR-24 to FR-30)', () => {
  it('AC-23: layering of PAQAD_AUTO_UPDATE, .paqad/.config, paqad.yaml and no setting', () => {
    expect(resolveUpdatePolicy(project(), {}).automatic).toBe(true);
    expect(resolveUpdatePolicy(project('updates:\n  automatic: false\n'), {}).automatic).toBe(
      false,
    );
    expect(resolveUpdatePolicy(project(null, 'auto_update=false\n'), {}).automatic).toBe(false);
    expect(resolveUpdatePolicy(project(), { PAQAD_AUTO_UPDATE: 'false' }).automatic).toBe(false);
    expect(resolveUpdatePolicy(project(), { PAQAD_SKIP_VERSION_CHECK: 'true' }).automatic).toBe(
      false,
    );
  });

  it('AC-24: a personal switch never turns updates on against the team', () => {
    const root = project('updates:\n  automatic: false\n', 'auto_update=true\n');
    const policy = resolveUpdatePolicy(root, { PAQAD_AUTO_UPDATE: '1' });
    expect(policy.automatic).toBe(false);
    expect(pluginAutoUpdate(policy)).toBe(false);
  });

  it('AC-25: a personal off keeps the team value for the committed settings', () => {
    const policy = resolveUpdatePolicy(project(), { PAQAD_AUTO_UPDATE: '0' });
    expect(policy.automatic).toBe(false);
    expect(pluginAutoUpdate(policy)).toBe(true);
  });

  it('AC-26: an unparseable paqad.yaml means off and pinned to the installed version', () => {
    const policy = resolveUpdatePolicy(project('updates: [oops\n'), {}, '1.0.0');
    expect(policy).toMatchObject({ automatic: false, pin: '1.0.0', teamAutomatic: false });
    expect(policy.error).not.toBeNull();
    expect(pluginAutoUpdate(policy)).toBe(false);
  });

  it('AC-27, AC-28: unset, latest, an exact pin and a malformed pin', () => {
    expect(resolveUpdatePolicy(project(), {}).pin).toBeNull();
    expect(
      resolveUpdatePolicy(project('updates:\n  minimum_version: latest\n'), {}).pin,
    ).toBeNull();
    const pinned = resolveUpdatePolicy(project('updates:\n  minimum_version: 1.2.3\n'), {});
    expect(pinned.pin).toBe('1.2.3');
    expect(pluginAutoUpdate(pinned)).toBe(false);
    expect(teamVersion(pinned, '9.9.9')).toBe('1.2.3');
    expect(cloudSetupCommand(teamVersion(pinned))).toBe(
      'npm i -g paqad-ai@1.2.3 && paqad-ai install && paqad-ai join --no-rag --non-interactive',
    );
    const malformed = resolveUpdatePolicy(project('updates:\n  minimum_version: "1.2"\n'), {});
    expect(malformed.automatic).toBe(false);
    expect(malformed.error).not.toBeNull();
  });

  it('FR-25: agrees with resolveFrameworkConfig on auto_update when no personal switch is set', () => {
    for (const yaml of [null, 'updates:\n  automatic: false\n', 'updates:\n  automatic: true\n']) {
      const root = project(yaml);
      expect(resolveUpdatePolicy(root, {}).automatic).toBe(
        resolveFrameworkConfig(root, {}).efficiency.auto_update,
      );
    }
  });
});
