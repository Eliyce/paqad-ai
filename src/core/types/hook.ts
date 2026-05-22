export const HOOK_TRIGGERS = [
  'user-prompt-submit',
  'pre-tool-use',
  'post-tool-use',
  'stop',
  'subagent-stop',
  'pre-compact',
] as const;
export type HookTrigger = (typeof HOOK_TRIGGERS)[number];

export type ExitCode = 0 | 1 | 2;

export interface HookDefinition {
  name: string;
  trigger: HookTrigger;
  command: string;
  blocking: boolean;
}

export interface HookResult {
  hook: string;
  trigger: HookTrigger;
  exit_code: ExitCode;
  message?: string;
}
