type ToolInput = Record<string, unknown>;

const EDIT_KEYS = new Set(['file_path', 'old_string', 'new_string', 'replace_all']);
const WRITE_KEYS = new Set(['file_path', 'content']);
const PATCH_BEGIN = '*** Begin Patch';
const PATCH_END = '*** End Patch';
const PATCH_UPDATE = '*** Update File: ';

interface PatchChunk {
  before: string[];
  after: string[];
}

function asObject(input: unknown): ToolInput | null {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? (input as ToolInput)
    : null;
}

function onlyKeys(input: ToolInput, allowed: ReadonlySet<string>): boolean {
  return Object.keys(input).every((key) => allowed.has(key));
}

function applyEdit(input: ToolInput, current: string): string | null {
  const { old_string: before, new_string: after, replace_all: replaceAll } = input;
  if (!onlyKeys(input, EDIT_KEYS)) return null;
  if (typeof before !== 'string' || typeof after !== 'string') return null;
  if (before === '' || before === after) return null;
  if (replaceAll !== undefined && typeof replaceAll !== 'boolean') return null;
  const parts = current.split(before);
  if (parts.length < 2) return null;
  if (parts.length > 2 && replaceAll !== true) return null;
  return parts.join(after);
}

function applyWrite(input: ToolInput): string | null {
  if (!onlyKeys(input, WRITE_KEYS)) return null;
  return typeof input.content === 'string' ? input.content : null;
}

function patchText(input: unknown): string | null {
  const object = asObject(input);
  const values = object === null ? [input] : Object.values(object);
  const patches = values.filter(
    (value): value is string => typeof value === 'string' && value.includes(PATCH_BEGIN),
  );
  return patches.length === 1 ? patches[0]! : null;
}

function readChunks(body: readonly string[]): PatchChunk[] | null {
  const chunks: PatchChunk[] = [];
  let open: PatchChunk | null = null;
  for (const line of body) {
    if (line === '@@') {
      open = { before: [], after: [] };
      chunks.push(open);
      continue;
    }
    const mark = line[0];
    if (mark !== ' ' && mark !== '-' && mark !== '+') return null;
    if (open === null) {
      open = { before: [], after: [] };
      chunks.push(open);
    }
    const text = line.slice(1);
    if (mark !== '+') open.before.push(text);
    if (mark !== '-') open.after.push(text);
  }
  return chunks.length > 0 && chunks.every((chunk) => chunk.before.length > 0) ? chunks : null;
}

function parsePatch(text: string): PatchChunk[] | null {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines[0] !== PATCH_BEGIN || lines.at(-1) !== PATCH_END) return null;
  if (!lines[1]?.startsWith(PATCH_UPDATE)) return null;
  return readChunks(lines.slice(2, -1));
}

function matchesAt(lines: readonly string[], wanted: readonly string[], at: number): boolean {
  return wanted.every((line, offset) => lines[at + offset] === line);
}

function onlyMatch(lines: readonly string[], wanted: readonly string[]): number | null {
  const found: number[] = [];
  for (let at = 0; at + wanted.length <= lines.length; at += 1) {
    if (matchesAt(lines, wanted, at)) found.push(at);
  }
  return found.length === 1 ? found[0]! : null;
}

function applyPatch(input: unknown, current: string): string | null {
  const text = patchText(input);
  const chunks = text === null ? null : parsePatch(text);
  if (chunks === null) return null;
  const lines = current.split('\n');
  if (lines.at(-1) === '') lines.pop();
  let cursor = 0;
  for (const chunk of chunks) {
    const at = onlyMatch(lines, chunk.before);
    if (at === null || at < cursor) return null;
    lines.splice(at, chunk.before.length, ...chunk.after);
    cursor = at + chunk.after.length;
  }
  return `${lines.join('\n')}\n`;
}

export function editedContent(
  toolName: string | undefined,
  toolInput: unknown,
  current: string,
): string | null {
  if (toolName === 'apply_patch') return applyPatch(toolInput, current);
  const input = asObject(toolInput);
  if (input === null) return null;
  if (toolName === 'Edit') return applyEdit(input, current);
  if (toolName === 'Write') return applyWrite(input);
  return null;
}
