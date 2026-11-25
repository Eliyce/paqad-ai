import { readDotConfig } from '@/core/framework-config.js';
import { readTeamConfig } from '@/core/team-config.js';
import { VERSION } from '@/index.js';

// FR-24 to FR-30: the one place that turns updates.automatic and
// updates.minimum_version into a decision for every route (npm silent
// update, plugin settings keys, cloud setup command). No route keeps its own default.
export interface UpdatePolicy {
  // Whether this machine may replace its paqad version in the background.
  automatic: boolean;
  // The exact version every route must run, or null for no pin.
  pin: string | null;
  // The committed team values alone, for files the team commits (FR-28).
  teamAutomatic: boolean;
  teamPin: string | null;
  // Set when the setting could not be read; every route is then off and pinned (FR-29).
  error: string | null;
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const TRUE = /^(true|1|yes|on)$/iu;
const FALSE = /^(false|0|no|off)$/iu;

function flag(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (TRUE.test(value)) return true;
  if (FALSE.test(value)) return false;
  return undefined;
}

function pinOf(raw: string | undefined): string | null | 'malformed' {
  if (raw === undefined) return null;
  const value = raw.trim().replace(/^v/u, '');
  if (value === '' || value.toLowerCase() === 'latest') return null;
  return EXACT_VERSION.test(value) ? value : 'malformed';
}

function nonEmpty(raw: string | undefined): string | undefined {
  return typeof raw === 'string' && raw.trim() !== '' ? raw : undefined;
}

export function offAndPinned(error: string, installed: string = VERSION): UpdatePolicy {
  return { automatic: false, pin: installed, teamAutomatic: false, teamPin: installed, error };
}

export function resolveUpdatePolicy(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  installed: string = VERSION,
): UpdatePolicy {
  try {
    const team = readTeamConfig(projectRoot);
    const invalid = team.issues.find((issue) => issue.kind === 'invalid');
    if (invalid !== undefined) return offAndPinned(invalid.message, installed);
    const local = readDotConfig(projectRoot);
    // The code default: automatic on, no pin (FR-26).
    const teamAutomatic = flag(team.merged.get('auto_update')) ?? true;
    const teamPin = pinOf(team.merged.get('minimum_version'));
    if (teamPin === 'malformed') {
      return offAndPinned('updates.minimum_version is not an exact version', installed);
    }
    // A personal switch may turn updates off on one machine, never on (FR-27).
    const personalOff =
      flag(local.get('auto_update')) === false ||
      flag(nonEmpty(env.PAQAD_AUTO_UPDATE)) === false ||
      flag(nonEmpty(env.PAQAD_SKIP_VERSION_CHECK) ?? local.get('skip_version_check')) === true;
    let pin: string | null = teamPin;
    if (pin === null) {
      const personal = pinOf(nonEmpty(env.PAQAD_MINIMUM_VERSION) ?? local.get('minimum_version'));
      if (personal === 'malformed') {
        return offAndPinned('minimum_version is not an exact version', installed);
      }
      pin = personal;
    }
    return { automatic: teamAutomatic && !personalOff, pin, teamAutomatic, teamPin, error: null };
  } catch (error) {
    return offAndPinned(error instanceof Error ? error.message : String(error), installed);
  }
}

// FR-28, FR-33: the committed settings follow the team value only; a pin stops background updates.
export function pluginAutoUpdate(policy: UpdatePolicy): boolean {
  return policy.error === null && policy.teamAutomatic && policy.teamPin === null;
}

// FR-39: the version a cloud session installs.
export function teamVersion(policy: UpdatePolicy, lastRunVersion: string = VERSION): string {
  return policy.teamPin ?? lastRunVersion;
}

export function cloudSetupCommand(version: string): string {
  return `npm i -g paqad-ai@${version} && paqad-ai install && paqad-ai join --no-rag --non-interactive`;
}
