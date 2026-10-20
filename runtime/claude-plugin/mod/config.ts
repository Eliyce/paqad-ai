import type { PaqadStandDown, PaqadStatus } from './types';

export const MIN_ENGINE = '2.1.301';

const ENV_TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['false', '0', 'no', 'off']);

export interface StandDownInput {
  onboarded: boolean;
  env: {
    CLAUDE_CODE_REMOTE?: string;
    PAQAD_DISABLED?: string;
    PAQAD_ENABLE?: string;
    PAQAD_HUD_VIEW?: string;
  };
  localConfig: string | null;
  teamConfigs: ReadonlyArray<{ name: string; text: string }>;
  engine: { version: string; base?: string } | null;
}

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

type LayeredInput = Pick<StandDownInput, 'localConfig' | 'teamConfigs'>;

function layeredValue(input: LayeredInput, key: string, fromEnv: string | undefined) {
  let value: string | undefined;
  const team = input.teamConfigs
    .filter((file) => /^\.config\..+/.test(file.name) && file.name !== '.config.example')
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const file of team) {
    const fromFile = readConfigKey(file.text, key);
    if (fromFile !== undefined) value = fromFile;
  }
  const local = readConfigKey(input.localConfig, key);
  if (local !== undefined) value = local;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') value = fromEnv.trim();
  return value;
}

function isFalsy(value: string | undefined): boolean {
  return value !== undefined && FALSY.has(value.trim().toLowerCase());
}

export function isPaqadOff(input: Pick<StandDownInput, 'env' | 'localConfig' | 'teamConfigs'>) {
  const disabled = input.env.PAQAD_DISABLED;
  if (typeof disabled === 'string' && ENV_TRUTHY.has(disabled.trim().toLowerCase())) return true;
  return isFalsy(layeredValue(input, 'paqad_enable', input.env.PAQAD_ENABLE));
}

export function isHudViewOff(input: Pick<StandDownInput, 'env' | 'localConfig' | 'teamConfigs'>) {
  return isFalsy(layeredValue(input, 'hud_view', input.env.PAQAD_HUD_VIEW));
}

function releaseParts(text: string | undefined): number[] | null {
  const match = typeof text === 'string' ? text.match(/^(\d+)\.(\d+)\.(\d+)/) : null;
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function isEngineNewEnough(engine: StandDownInput['engine']): boolean {
  const have = releaseParts(engine?.base) ?? releaseParts(engine?.version);
  const need = releaseParts(MIN_ENGINE)!;
  if (!have) return false;
  for (let i = 0; i < 3; i += 1) {
    if (have[i]! !== need[i]!) return have[i]! > need[i]!;
  }
  return true;
}

export function standDownReason(input: StandDownInput): PaqadStandDown | null {
  if (isHudViewOff(input)) return 'view-off';
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

export function registersCommand(status: PaqadStatus): boolean {
  return status.on || status.reason === 'not-onboarded';
}

export function ancestorDirs(root: string): string[] {
  const dirs: string[] = [];
  let dir = root;
  for (;;) {
    dirs.push(dir);
    const cut = Math.max(dir.lastIndexOf('/'), dir.lastIndexOf('\\'));
    if (cut < 0) return dirs;
    const parent = cut === 0 || dir[cut - 1] === ':' ? dir.slice(0, cut + 1) : dir.slice(0, cut);
    if (parent === dir) return dirs;
    dir = parent;
  }
}
