export const PAQAD_CLI_TIMEOUT_MS = 15_000;

export interface PaqadRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}
