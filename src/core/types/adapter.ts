export const ADAPTER_TYPES = [
  'claude-code',
  'codex-cli',
  'antigravity',
  'gemini-cli',
  'junie',
  'cursor',
  'github-copilot',
  'windsurf',
  'continue',
  'aider',
  'aiassistant',
] as const;
export type AdapterType = (typeof ADAPTER_TYPES)[number];

export interface AdapterConfig {
  adapter: AdapterType;
  config_path: string;
  skills_root: string;
  agents_root: string;
  hooks_supported: boolean;
  mcp_supported: boolean;
}
