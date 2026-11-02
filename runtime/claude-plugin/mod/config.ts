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
    PAQAD_HUD_CHIME?: string;
  };
  localConfig: string | null;
  teamConfigs: ReadonlyArray<{ name: string; text: string }>;
  paqadYaml?: string | null;
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

function indentOf(line: string): number {
  return /^[ \t]*/.exec(line)?.[0].length ?? 0;
}

function isContent(line: string): boolean {
  const trimmed = line.trim();
  return trimmed !== '' && !trimmed.startsWith('#');
}

function keyValue(line: string, key: string): string | null {
  const body = line.replace(/^[ \t]+/, '');
  if (!body.startsWith(`${key}:`)) return null;
  const rest = body.slice(key.length + 1);
  if (rest !== '' && !/^[ \t]/.test(rest)) return null;
  return rest;
}

function cleanScalar(rest: string): string | undefined {
  let value = ` ${rest}`;
  const hash = value.search(/[ \t]#/);
  if (hash !== -1) value = value.slice(0, hash);
  value = value.trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }
  return value === '' ? undefined : value;
}

export function readYamlScalar(text: string | null | undefined, path: readonly string[]) {
  if (typeof text !== 'string' || path.length < 1 || path.length > 2) return undefined;
  const lines = text.split(/\r?\n/);
  const [top, child] = path as [string, string | undefined];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!isContent(line) || indentOf(line) !== 0) continue;
    const rest = keyValue(line, top);
    if (rest === null) continue;
    if (child === undefined) return cleanScalar(rest);
    let childIndent = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      const inner = lines[j]!;
      if (!isContent(inner)) continue;
      const indent = indentOf(inner);
      if (indent === 0) return undefined;
      if (childIndent === -1) childIndent = indent;
      if (indent !== childIndent) continue;
      const value = keyValue(inner, child);
      if (value !== null) return cleanScalar(value);
    }
    return undefined;
  }
  return undefined;
}

const PAQAD_YAML_PATHS: Readonly<Record<string, readonly string[]>> = {
  paqad_enable: ['enabled'],
  hud_view: ['hud', 'band'],
  hud_chime: ['hud', 'chime'],
};

const BOOLEAN_WORDS = new Set([...ENV_TRUTHY, ...FALSY]);

type LayeredInput = Pick<StandDownInput, 'localConfig' | 'teamConfigs' | 'paqadYaml'>;

function yamlTeamValue(input: LayeredInput, key: string): string | undefined {
  const path = PAQAD_YAML_PATHS[key];
  if (path === undefined) return undefined;
  const raw = readYamlScalar(input.paqadYaml, path);
  return raw !== undefined && BOOLEAN_WORDS.has(raw.trim().toLowerCase()) ? raw : undefined;
}

export function teamSwitchProblems(input: LayeredInput): string[] {
  const problems: string[] = [];
  for (const path of Object.values(PAQAD_YAML_PATHS)) {
    const raw = readYamlScalar(input.paqadYaml, path);
    if (raw !== undefined && !BOOLEAN_WORDS.has(raw.trim().toLowerCase())) {
      problems.push(
        `.paqad/configs/paqad.yaml: ${path.join('.')} has a value paqad cannot read (${raw}), so paqad uses its default.`,
      );
    }
  }
  return problems;
}

function layeredValue(input: LayeredInput, key: string, fromEnv: string | undefined) {
  let value: string | undefined = yamlTeamValue(input, key);
  const team = input.teamConfigs
    .filter((file) => /^\.config\..+/.test(file.name) && file.name !== '.config.example')
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (value === undefined) {
    for (const file of team) {
      const fromFile = readConfigKey(file.text, key);
      if (fromFile !== undefined) value = fromFile;
    }
  }
  const local = readConfigKey(input.localConfig, key);
  if (local !== undefined) value = local;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') value = fromEnv.trim();
  return value;
}

function isFalsy(value: string | undefined): boolean {
  return value !== undefined && FALSY.has(value.trim().toLowerCase());
}

export function isPaqadOff(
  input: Pick<StandDownInput, 'env' | 'localConfig' | 'teamConfigs' | 'paqadYaml'>,
) {
  const disabled = input.env.PAQAD_DISABLED;
  if (typeof disabled === 'string' && ENV_TRUTHY.has(disabled.trim().toLowerCase())) return true;
  return isFalsy(layeredValue(input, 'paqad_enable', input.env.PAQAD_ENABLE));
}

export function isHudViewOff(
  input: Pick<StandDownInput, 'env' | 'localConfig' | 'teamConfigs' | 'paqadYaml'>,
) {
  return isFalsy(layeredValue(input, 'hud_view', input.env.PAQAD_HUD_VIEW));
}

export function isChimeOn(
  input: Pick<StandDownInput, 'env' | 'localConfig' | 'teamConfigs' | 'paqadYaml'>,
) {
  const value = layeredValue(input, 'hud_chime', input.env.PAQAD_HUD_CHIME);
  return value !== undefined && ENV_TRUTHY.has(value.trim().toLowerCase());
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
