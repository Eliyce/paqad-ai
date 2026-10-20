export const PAQAD_BIN = 'paqad-ai';

export const PAQAD_CLI_TIMEOUT_MS = 15_000;

export const PAQAD_VERBS = ['rules override'] as const;

export type PaqadVerb = (typeof PAQAD_VERBS)[number];

export interface PaqadProcessHost {
  process: {
    run: (
      argv: readonly string[],
      init?: { cwd?: string; timeoutMs?: number },
    ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  };
}

export interface PaqadRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export function paqadArgv(verb: PaqadVerb, args: readonly string[]): string[] | null {
  if (!PAQAD_VERBS.includes(verb)) return null;
  return [PAQAD_BIN, ...verb.split(' '), ...args];
}

export async function runPaqad(
  $: PaqadProcessHost,
  verb: PaqadVerb,
  args: readonly string[],
  cwd: string,
): Promise<PaqadRunResult> {
  const argv = paqadArgv(verb, args);
  if (!argv) return { ok: false, stdout: '', stderr: `paqad-ai ${verb} is not allowed here` };
  try {
    const result = await $.process.run(argv, { cwd, timeoutMs: PAQAD_CLI_TIMEOUT_MS });
    return { ok: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      ok: false,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}
