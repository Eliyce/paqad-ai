// When the paqad HUD mod stands down (issue #639, Part 8, decision 5).
//
// A pure function of what `register.tsx` read through `$`: no Claude Code import, so vitest
// tests it without the host. The mod registers nothing when the project was never onboarded,
// when the session runs in the cloud, when paqad is off, when the person turned the view off,
// or when Claude Code is older than 2.1.301.
//
// The enable switch resolves exactly as the hooks resolve it
// (`runtime/hooks/lib/paqad-disabled.mjs` and AGENT-BOOTSTRAP.md): PAQAD_DISABLED wins, then
// PAQAD_ENABLE, then `.paqad/.config`, then `.paqad/configs/.config.*` (sorted, last wins),
// then on.

import type { PaqadStandDown, PaqadStatus } from './types';

/** The lowest Claude Code release the mod runs on (#639 Q6). */
export const MIN_ENGINE = '2.1.301';

/** PAQAD_DISABLED values that turn paqad off. */
const ENV_TRUTHY = new Set(['1', 'true', 'yes', 'on']);
/** `paqad_enable` values that turn paqad off. */
const FALSY = new Set(['false', '0', 'no', 'off']);

export interface StandDownInput {
  /** The `view` field of the plugin's `userConfig` (on by default). */
  view: boolean;
  /** True when `.paqad/framework-path.txt` exists at the project root. */
  onboarded: boolean;
  env: {
    CLAUDE_CODE_REMOTE?: string;
    PAQAD_DISABLED?: string;
    PAQAD_ENABLE?: string;
  };
  /** The text of `.paqad/.config`, or `null` when it is missing. */
  localConfig: string | null;
  /** Each `.paqad/configs/.config.*` file by name, with its text. */
  teamConfigs: ReadonlyArray<{ name: string; text: string }>;
  /** `$.session.version()`: the release `base` when the engine spells one, else `version`. */
  engine: { version: string; base?: string } | null;
}

/** The last uncommented `key=` value in a flat config file, as the hooks read it. */
export function readConfigKey(text: string | null, key: string): string | undefined {
  if (text === null) return undefined;
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=(.*)$`);
  let value: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(pattern);
    if (match) value = match[1];
  }
  if (value === undefined) return undefined;
  let v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  const hash = v.search(/\s#/);
  if (hash !== -1) v = v.slice(0, hash).trim();
  return v;
}

/** True when paqad is off for this project, resolved as the hooks resolve it. */
export function isPaqadOff(input: Pick<StandDownInput, 'env' | 'localConfig' | 'teamConfigs'>) {
  const disabled = input.env.PAQAD_DISABLED;
  if (typeof disabled === 'string' && ENV_TRUTHY.has(disabled.trim().toLowerCase())) return true;
  let value: string | undefined;
  const team = input.teamConfigs
    .filter((file) => /^\.config\..+/.test(file.name) && file.name !== '.config.example')
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const file of team) {
    const fromFile = readConfigKey(file.text, 'paqad_enable');
    if (fromFile !== undefined) value = fromFile;
  }
  const local = readConfigKey(input.localConfig, 'paqad_enable');
  if (local !== undefined) value = local;
  const fromEnv = input.env.PAQAD_ENABLE;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') value = fromEnv.trim();
  return value !== undefined && FALSY.has(value.trim().toLowerCase());
}

/** `[major, minor, patch]` from a release like `2.1.302` or `2.1.302-dev`, or `null`. */
function releaseParts(text: string | undefined): number[] | null {
  const match = typeof text === 'string' ? text.match(/^(\d+)\.(\d+)\.(\d+)/) : null;
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** True when the engine is `MIN_ENGINE` or newer. An engine we cannot read counts as too old. */
export function isEngineNewEnough(engine: StandDownInput['engine']): boolean {
  const have = releaseParts(engine?.base) ?? releaseParts(engine?.version);
  const need = releaseParts(MIN_ENGINE)!;
  if (!have) return false;
  for (let i = 0; i < 3; i += 1) {
    if (have[i]! !== need[i]!) return have[i]! > need[i]!;
  }
  return true;
}

/** The first reason the mod stands down, in decision 5's order, or `null` to run. */
export function standDownReason(input: StandDownInput): PaqadStandDown | null {
  if (!input.view) return 'view-off';
  if (!input.onboarded) return 'not-onboarded';
  if (input.env.CLAUDE_CODE_REMOTE?.trim().toLowerCase() === 'true') return 'remote';
  if (isPaqadOff(input)) return 'disabled';
  if (!isEngineNewEnough(input.engine)) return 'old-engine';
  return null;
}

export function decideStatus(input: StandDownInput): PaqadStatus {
  const reason = standDownReason(input);
  return { on: reason === null, reason };
}

/**
 * True when the `/paqad` command is registered. On, it answers from the snapshot. In a project
 * never onboarded it stays, alone, so `/paqad status` can say paqad is not active here (#639
 * Part 8): no band, no snapshot read and no timer go with it. Every other stand-down registers
 * no command at all.
 */
export function registersCommand(status: PaqadStatus): boolean {
  return status.on || status.reason === 'not-onboarded';
}

/**
 * The session root and each folder above it, nearest first: where the mod looks for the
 * project's `.paqad/` folder, as the hooks walk up from the working directory to find it.
 */
export function ancestorDirs(root: string): string[] {
  const dirs: string[] = [];
  let dir = root;
  for (;;) {
    dirs.push(dir);
    const cut = Math.max(dir.lastIndexOf('/'), dir.lastIndexOf('\\'));
    if (cut < 0) return dirs;
    // `/a` -> `/`, `C:\a` -> `C:\`; a root keeps its separator and ends the walk.
    const parent = cut === 0 || dir[cut - 1] === ':' ? dir.slice(0, cut + 1) : dir.slice(0, cut);
    if (parent === dir) return dirs;
    dir = parent;
  }
}
