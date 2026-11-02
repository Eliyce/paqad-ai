export const AGENT_ENV_VARS = [
  'CLAUDECODE',
  'SE_SESSION',
  'CODEX_SANDBOX',
  'CODEX_SANDBOX_NETWORK_DISABLED',
] as const;

function isSet(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

export function runningUnderAgent(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CLAUDECODE === '1') return true;
  if (isSet(env.SE_SESSION)) return true;
  if (isSet(env.CODEX_SANDBOX)) return true;
  return env.CODEX_SANDBOX_NETWORK_DISABLED === '1';
}
