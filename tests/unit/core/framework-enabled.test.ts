import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isEnvDisabled,
  isFrameworkDisabledForRoot,
  isFrameworkEnabled,
  isFrameworkEnabledForRoot,
  setFrameworkEnabled,
} from '@/core/framework-enabled.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';

const NO_ENV = {} as NodeJS.ProcessEnv;

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-enabled-'));
}

function writeProfile(root: string, yaml: string): void {
  writeFileSync(join(root, '.paqad', 'project-profile.yaml'), yaml);
}

function writeConfig(root: string, contents: string): void {
  writeFileSync(join(root, '.paqad', '.config'), contents);
}

function seedDir(root: string): void {
  mkdirSync(join(root, '.paqad'), { recursive: true });
}

const MINIMAL_PROFILE = `project:
  name: demo
  id: demo
  description: test
active_capabilities:
  - content
`;

describe('isEnvDisabled', () => {
  it('recognizes the truthy set case-insensitively and ignores everything else', () => {
    for (const value of ['1', 'true', 'TRUE', 'Yes', 'on', '  on  ']) {
      expect(isEnvDisabled({ PAQAD_DISABLED: value } as NodeJS.ProcessEnv)).toBe(true);
    }
    for (const value of ['0', 'false', 'no', 'off', '', 'disabled']) {
      expect(isEnvDisabled({ PAQAD_DISABLED: value } as NodeJS.ProcessEnv)).toBe(false);
    }
    expect(isEnvDisabled(NO_ENV)).toBe(false);
  });
});

describe('isFrameworkEnabled (profile-aware)', () => {
  it('defaults ON when absent, paqad block missing, enabled true, or malformed', () => {
    expect(isFrameworkEnabled(null, NO_ENV)).toBe(true);
    expect(isFrameworkEnabled(undefined, NO_ENV)).toBe(true);
    expect(isFrameworkEnabled({} as ProjectProfile, NO_ENV)).toBe(true);
    expect(isFrameworkEnabled({ paqad: {} } as ProjectProfile, NO_ENV)).toBe(true);
    expect(isFrameworkEnabled({ paqad: { enabled: true } } as ProjectProfile, NO_ENV)).toBe(true);
  });

  it('is OFF only when paqad.enabled === false', () => {
    expect(isFrameworkEnabled({ paqad: { enabled: false } } as ProjectProfile, NO_ENV)).toBe(false);
  });

  it('lets the env override win over an enabled profile', () => {
    const enabledProfile = { paqad: { enabled: true } } as ProjectProfile;
    expect(isFrameworkEnabled(enabledProfile, { PAQAD_DISABLED: '1' } as NodeJS.ProcessEnv)).toBe(
      false,
    );
  });
});

describe('isFrameworkEnabledForRoot (dist-less raw read)', () => {
  let root: string;

  beforeEach(() => {
    root = makeRoot();
    seedDir(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('defaults ON when the .config is absent', () => {
    rmSync(join(root, '.paqad', '.config'), { force: true });
    expect(isFrameworkEnabledForRoot(root, NO_ENV)).toBe(true);
  });

  it('reads PAQAD_ENABLED=false from .paqad/.config', () => {
    writeConfig(root, 'PAQAD_ENABLED=false\nENTERPRISE_ENABLED=true\n');
    expect(isFrameworkEnabledForRoot(root, NO_ENV)).toBe(false);
    expect(isFrameworkDisabledForRoot(root, NO_ENV)).toBe(true);
  });

  it('does NOT trip on a falsy value under a different key (ENTERPRISE_ENABLED)', () => {
    writeConfig(root, 'ENTERPRISE_ENABLED=false\n');
    expect(isFrameworkEnabledForRoot(root, NO_ENV)).toBe(true);
  });

  it('stays ON for PAQAD_ENABLED=true', () => {
    writeConfig(root, 'PAQAD_ENABLED=true\n');
    expect(isFrameworkEnabledForRoot(root, NO_ENV)).toBe(true);
  });

  it('honors the env override even when .config says enabled', () => {
    writeConfig(root, 'PAQAD_ENABLED=true\n');
    expect(isFrameworkEnabledForRoot(root, { PAQAD_DISABLED: '1' } as NodeJS.ProcessEnv)).toBe(
      false,
    );
  });

  it('is side-effect-free — reading the off-signal writes nothing', () => {
    writeConfig(root, 'PAQAD_ENABLED=false\n');
    const before = readdirSync(join(root, '.paqad')).sort();
    isFrameworkEnabledForRoot(root, NO_ENV);
    isFrameworkDisabledForRoot(root, NO_ENV);
    const after = readdirSync(join(root, '.paqad')).sort();
    expect(after).toEqual(before);
  });
});

describe('setFrameworkEnabled', () => {
  let root: string;

  beforeEach(() => {
    root = makeRoot();
    seedDir(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('throws when the project is not onboarded', () => {
    expect(() => setFrameworkEnabled(root, false)).toThrow(/not onboarded/);
  });

  it('flips PAQAD_ENABLED to false then back to true', () => {
    writeProfile(root, MINIMAL_PROFILE);

    const disabled = setFrameworkEnabled(root, false);
    expect(disabled.enabled).toBe(false);
    expect(isFrameworkEnabledForRoot(root, NO_ENV)).toBe(false);
    expect(readFileSync(disabled.config_path, 'utf8')).toMatch(/^PAQAD_ENABLED=false$/m);

    const enabled = setFrameworkEnabled(root, true);
    expect(enabled.enabled).toBe(true);
    expect(isFrameworkEnabledForRoot(root, NO_ENV)).toBe(true);
  });
});
