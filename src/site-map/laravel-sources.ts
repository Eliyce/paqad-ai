import type { ProjectCommands } from '@/core/types/project-profile.js';

import type { LaravelArtisanRouteRecord, LaravelRouteRecord } from './extraction.js';

export interface Psr4Entry {
  prefix: string;
  dirs: string[];
}

export interface SourcePointer {
  file: string;
  line?: number;
}

export type ReadProjectFile = (path: string) => string | null;

function lineAt(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeDir(dir: string): string {
  const posix = dir.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (posix === '' || posix === '.') return '';
  return posix.endsWith('/') ? posix : `${posix}/`;
}

function normalizePrefix(prefix: string): string {
  const trimmed = prefix.replace(/^\\+/, '').replace(/\\+$/, '');
  return trimmed.length === 0 ? '' : `${trimmed}\\`;
}

function psr4EntriesFrom(section: unknown): Psr4Entry[] {
  if (typeof section !== 'object' || section === null || Array.isArray(section)) return [];
  const entries: Psr4Entry[] = [];
  for (const [prefix, value] of Object.entries(section as Record<string, unknown>)) {
    const dirs = (Array.isArray(value) ? value : [value])
      .filter((dir): dir is string => typeof dir === 'string')
      .map(normalizeDir);
    if (dirs.length > 0) entries.push({ prefix: normalizePrefix(prefix), dirs });
  }
  return entries;
}

export function parseComposerPsr4(json: string): Psr4Entry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const composer = parsed as Record<string, { 'psr-4'?: unknown } | undefined>;
  return [
    ...psr4EntriesFrom(composer.autoload?.['psr-4']),
    ...psr4EntriesFrom(composer['autoload-dev']?.['psr-4']),
  ];
}

const VENDOR_PSR4_ENTRY_RE = /'((?:[^'\\]|\\.)*)'\s*=>\s*array\s*\(([^)]*)\)/g;
const VENDOR_PSR4_DIR_RE = /\$(vendorDir|baseDir)\s*\.\s*'([^']*)'/g;

export function parseVendorPsr4(php: string): Psr4Entry[] {
  const entries: Psr4Entry[] = [];
  VENDOR_PSR4_ENTRY_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = VENDOR_PSR4_ENTRY_RE.exec(php)) !== null) {
    const prefix = normalizePrefix(match[1]!.replace(/\\\\/g, '\\'));
    const dirs: string[] = [];
    VENDOR_PSR4_DIR_RE.lastIndex = 0;
    let dir: RegExpExecArray | null;
    while ((dir = VENDOR_PSR4_DIR_RE.exec(match[2]!)) !== null) {
      dirs.push(normalizeDir(dir[1] === 'vendorDir' ? `vendor${dir[2]}` : dir[2]!));
    }
    if (dirs.length > 0) entries.push({ prefix, dirs });
  }
  return entries;
}

export function classToCandidatePaths(fqcn: string, entries: Psr4Entry[]): string[] {
  const className = fqcn.replace(/^\\+/, '');
  const candidates: string[] = [];
  const matching = entries
    .filter((entry) => className.startsWith(entry.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  for (const entry of matching) {
    const relative = `${className.slice(entry.prefix.length).replace(/\\/g, '/')}.php`;
    for (const dir of entry.dirs) {
      const candidate = `${dir}${relative}`;
      if (!candidates.includes(candidate)) candidates.push(candidate);
    }
  }
  return candidates;
}

export interface RouteAction {
  className: string;
  method: string;
}

export function parseRouteAction(action: string | undefined): RouteAction | null {
  const trimmed = action?.trim() ?? '';
  if (trimmed.length === 0 || trimmed === 'Closure') return null;
  const at = trimmed.lastIndexOf('@');
  if (at === -1) return { className: trimmed, method: '__invoke' };
  const className = trimmed.slice(0, at);
  const method = trimmed.slice(at + 1);
  if (className.length === 0) return null;
  return { className, method: method.length > 0 ? method : '__invoke' };
}

export function findPhpMethodLine(content: string, method: string): number | undefined {
  const match = new RegExp(`\\bfunction\\s+&?${escapeRegExp(method)}\\s*\\(`).exec(content);
  return match ? lineAt(content, match.index) : undefined;
}

export interface ConsoleCommandDeclaration {
  name: string;
  line: number;
}

const CONSOLE_DECLARATION_RES = [
  /\$signature\s*=\s*(['"])([\s\S]*?)\1/g,
  /protected\s+\$name\s*=\s*(['"])([\s\S]*?)\1/g,
  /#\[AsCommand\(\s*(?:name\s*:\s*)?(['"])([\s\S]*?)\1/g,
  /Artisan::command\(\s*(['"])([\s\S]*?)\1/g,
];

export function extractConsoleCommandNames(content: string): ConsoleCommandDeclaration[] {
  const declarations: ConsoleCommandDeclaration[] = [];
  for (const re of CONSOLE_DECLARATION_RES) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      const name = match[2]!.trim().split(/\s+/)[0]!;
      if (name.length === 0) continue;
      declarations.push({ name, line: lineAt(content, match.index) });
    }
  }
  return declarations.sort((a, b) => a.line - b.line);
}

function isArtisanToken(token: string): boolean {
  return token === 'artisan' || token.endsWith('/artisan');
}

function scheduleToken(command: string): string {
  const tokens = command
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/^['"]|['"]$/g, ''));
  const artisan = tokens.findIndex(isArtisanToken);
  const token = artisan >= 0 && artisan + 1 < tokens.length ? tokens[artisan + 1]! : tokens[0]!;
  return token.split('\\').pop()!;
}

export function scheduledCommandName(command: string): string {
  return scheduleToken(command);
}

const SCHEDULE_CALL_RE = /Schedule::|\$schedule\s*->|->\s*(?:command|job|call|exec)\s*\(/;

export function findScheduleLine(
  content: string,
  command: string,
  commandClass?: string,
): number | undefined {
  const token = scheduleToken(command);
  if (token.length === 0) return undefined;
  const escaped = escapeRegExp(token);
  const alternatives = [`(['"])${escaped}(?=[\\s'"])`, `\\b${escaped}::class\\b`];
  if (commandClass) alternatives.push(`\\b${escapeRegExp(commandClass)}::class\\b`);
  const lines = content.split('\n');
  let first: number | undefined;
  for (const match of content.matchAll(new RegExp(alternatives.join('|'), 'g'))) {
    const line = lineAt(content, match.index);
    if (SCHEDULE_CALL_RE.test(lines[line - 1]!)) return line;
    first ??= line;
  }
  return first;
}

export type ArtisanInvocation = { argv: string[] } | { blocked: string };

const PLACEHOLDER_RE = /<[^>]+>/;

const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

const SHELL_OPERATOR_RE = /&&|\|\||;|\|/;

export function resolveArtisanInvocation(
  commands: Partial<ProjectCommands> | null | undefined,
): ArtisanInvocation {
  for (const key of ['migrate', 'test', 'dev'] as const) {
    const command = commands?.[key];
    if (typeof command !== 'string') continue;
    const tokens = command.trim().split(/\s+/);
    const artisan = tokens.findIndex(isArtisanToken);
    if (artisan === -1) continue;
    let prefix = tokens.slice(0, artisan + 1);
    while (prefix.length > 1 && ENV_ASSIGNMENT_RE.test(prefix[0]!)) prefix = prefix.slice(1);
    if (prefix.some((token) => PLACEHOLDER_RE.test(token))) {
      return {
        blocked:
          `your project's ${key} command still holds a placeholder: "${command}". ` +
          `Put the real service name in commands.${key} in .paqad/project-profile.yaml, then run the map again.`,
      };
    }
    if (prefix.some((token) => SHELL_OPERATOR_RE.test(token))) {
      return {
        blocked:
          `your project's ${key} command chains shell commands before artisan: "${command}". ` +
          `paqad runs artisan without a shell, so set commands.${key} in .paqad/project-profile.yaml ` +
          `to a single command that ends in artisan (for example "vendor/bin/sail artisan migrate"), then run the map again.`,
      };
    }
    if (prefix[0] === 'sail') prefix = ['vendor/bin/sail', ...prefix.slice(1)];
    return { argv: withComposeNoTty(prefix) };
  }
  return { argv: ['php', 'artisan'] };
}

function withComposeNoTty(argv: string[]): string[] {
  const composeAt =
    argv[0] === 'docker-compose' ? 0 : argv[0] === 'docker' && argv[1] === 'compose' ? 1 : -1;
  if (composeAt === -1 || argv.includes('-T')) return argv;
  const sub = argv.findIndex(
    (token, index) => index > composeAt && (token === 'exec' || token === 'run'),
  );
  if (sub === -1) return argv;
  return [...argv.slice(0, sub + 1), '-T', ...argv.slice(sub + 1)];
}

export type ArtisanRunner = 'sail' | 'docker' | 'php';

export function artisanRunner(argv: string[]): ArtisanRunner {
  const first = argv[0] ?? '';
  if (first.endsWith('sail')) return 'sail';
  if (first === 'docker' || first === 'docker-compose') return 'docker';
  return 'php';
}

function routeKey(uri: string): string {
  return uri.replace(/^\/+/, '').replace(/\/+$/, '');
}

function methodMatches(staticMethod: string, artisanMethods: string[]): boolean {
  return (
    staticMethod === 'ANY' || staticMethod === 'MATCH' || artisanMethods.includes(staticMethod)
  );
}

const PRIMARY_ROUTE_FILES = new Set(['routes/web.php', 'routes/api.php']);

function uniqueDeclaration(matches: LaravelRouteRecord[]): LaravelRouteRecord | undefined {
  if (matches.length === 1) return matches[0];
  const primary = matches.filter((route) => PRIMARY_ROUTE_FILES.has(route.file));
  return primary.length === 1 ? primary[0] : undefined;
}

export interface ArtisanRouteResolverInput {
  psr4: Psr4Entry[];
  staticRoutes: LaravelRouteRecord[];
  readFile: ReadProjectFile;
}

export function createArtisanRouteResolver(
  input: ArtisanRouteResolverInput,
): (record: LaravelArtisanRouteRecord) => SourcePointer[] {
  const fileCache = new Map<string, string | null>();
  const read = (path: string): string | null => {
    if (!fileCache.has(path)) fileCache.set(path, input.readFile(path));
    return fileCache.get(path)!;
  };

  return (record) => {
    const pointers: SourcePointer[] = [];
    const methods = record.method.toUpperCase().split(/[|,]/);
    const key = routeKey(record.uri);
    const declared = uniqueDeclaration(
      input.staticRoutes.filter(
        (route) => routeKey(route.uri) === key && methodMatches(route.method, methods),
      ),
    );
    if (declared) {
      pointers.push(
        declared.line === undefined
          ? { file: declared.file }
          : { file: declared.file, line: declared.line },
      );
    }

    const action = parseRouteAction(record.action);
    if (action) {
      for (const candidate of classToCandidatePaths(action.className, input.psr4)) {
        const content = read(candidate);
        if (content === null) continue;
        const line = findPhpMethodLine(content, action.method);
        pointers.push(line === undefined ? { file: candidate } : { file: candidate, line });
        break;
      }
    }
    return pointers;
  };
}
