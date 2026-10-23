export const PAQAD_BIN = 'paqad-ai';

export const PAQAD_CLI_TIMEOUT_MS = 15_000;

export const PAQAD_VERBS = ['rules override'] as const;

export type PaqadVerb = (typeof PAQAD_VERBS)[number];

export interface PaqadRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export function paqadArgv(verb: PaqadVerb, args: readonly string[]): string[] | null {
  if (!PAQAD_VERBS.includes(verb)) return null;
  return [PAQAD_BIN, ...verb.split(' '), ...args];
}
