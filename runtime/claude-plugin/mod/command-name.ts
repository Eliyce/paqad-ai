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

const REFUSED = 'refused: ';

export function refusalReason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const at = text.lastIndexOf(REFUSED);
  return (at === -1 ? text : text.slice(at + REFUSED.length)).trim();
}

export function takenLine(refusals: readonly string[]): string {
  const [first, fallback] = COMMAND_NAMES;
  const taken = `paqad: /${first} is taken (${refusals[0] ?? ''})`;
  return refusals.length > 1
    ? `${taken} and /${fallback} is taken (${refusals[1]}); the HUD has no command`
    : `${taken}; the HUD command is /${fallback}`;
}
