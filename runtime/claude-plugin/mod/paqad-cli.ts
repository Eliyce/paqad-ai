export const PAQAD_CLI_TIMEOUT_MS = 15_000;

export function overrideRecorded(stdout: string): boolean {
  return stdout.includes('recorded a one-time override') || stdout.includes('"overridden":true');
}

export interface PaqadRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}
