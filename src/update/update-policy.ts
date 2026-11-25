import { readDotConfig } from '@/core/framework-config.js';
import { readTeamConfig } from '@/core/team-config.js';
import { VERSION } from '@/index.js';

export interface UpdatePolicy {
  automatic: boolean;
  pin: string | null;
  teamAutomatic: boolean;
  teamPin: string | null;
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
    const teamAutomatic = flag(team.merged.get('auto_update')) ?? true;
    const teamPin = pinOf(team.merged.get('minimum_version'));
    if (teamPin === 'malformed') {
      return offAndPinned('updates.minimum_version is not an exact version', installed);
    }
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

export function pluginAutoUpdate(policy: UpdatePolicy): boolean {
  return policy.error === null && policy.teamAutomatic && policy.teamPin === null;
}

export function teamVersion(policy: UpdatePolicy, lastRunVersion: string = VERSION): string {
  return policy.teamPin ?? lastRunVersion;
}

export function cloudSetupCommand(version: string): string {
  return `npm i -g paqad-ai@${version} && paqad-ai install && paqad-ai join --no-rag --non-interactive`;
}
