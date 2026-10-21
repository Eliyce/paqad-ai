export const COMMAND_NAMES = ['paqad', 'paqad-hud'] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];

let current: CommandName = COMMAND_NAMES[0];

export function setCommandName(name: CommandName): void {
  current = name;
}

export function commandName(): CommandName {
  return current;
}

export function slash(sub?: string): string {
  return sub ? `/${current} ${sub}` : `/${current}`;
}

export function isCommandName(command: string): boolean {
  return (COMMAND_NAMES as readonly string[]).includes(command);
}
