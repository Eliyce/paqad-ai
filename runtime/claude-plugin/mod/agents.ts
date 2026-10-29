export const ACTIVITY_LINES = 1;
export const SUBAGENT_PREFIX = 'Subagent: ';

const WORKING_STATUSES: ReadonlySet<string> = new Set(['pending', 'running', 'waiting']);
const INPUT_FIELDS = [
  'description',
  'command',
  'file_path',
  'notebook_path',
  'pattern',
  'path',
  'url',
];
const UNNAMED_TASK = 'background task';
const SYSTEM_REMINDER = '<system-reminder>';

export interface ListedAgent {
  id: string;
  description: string;
  status: string;
}

function firstLine(text: string): string {
  const line = text.split('\n').find((part) => part.trim() !== '') ?? '';
  return line.replace(/\s+/g, ' ').trim();
}

export function runningAgents<A extends ListedAgent>(list: readonly A[]): A[] {
  return list.filter((agent) => WORKING_STATUSES.has(agent.status));
}

export function subagentTitle(running: readonly ListedAgent[]): string | null {
  const newest = running.at(-1);
  if (!newest) return null;
  return `${SUBAGENT_PREFIX}${firstLine(newest.description) || UNNAMED_TASK}`;
}

export function finishedSince(seen: readonly string[], list: readonly ListedAgent[]): string[] {
  const working = new Set(runningAgents(list).map((agent) => agent.id));
  return seen.filter((id) => !working.has(id));
}

export function toolLine(tool: string, input: unknown): string {
  const fields =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  for (const field of INPUT_FIELDS) {
    const value = fields[field];
    if (typeof value === 'string' && firstLine(value) !== '') return `${tool}: ${firstLine(value)}`;
  }
  return tool;
}

export function activityLine(message: { content?: unknown }): string | null {
  if (!Array.isArray(message.content)) return null;
  for (const block of message.content as Array<Record<string, unknown>>) {
    if (block.type === 'text' && typeof block.text === 'string') {
      const line = firstLine(block.text);
      if (line !== '' && !line.startsWith(SYSTEM_REMINDER)) return line;
    }
    if (block.type === 'tool_use' && typeof block.name === 'string') {
      return toolLine(block.name, block.input);
    }
  }
  return null;
}

export function pushActivity(lines: readonly string[], line: string | null): string[] {
  if (line === null || line === lines[0]) return [...lines];
  return [line, ...lines].slice(0, ACTIVITY_LINES);
}
