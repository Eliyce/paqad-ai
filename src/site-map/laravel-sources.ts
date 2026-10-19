// Laravel source resolution for the site-map extractors (issue #500). Artisan introspection tells
// us WHAT a project registers (routes, commands, schedules) but not WHERE in the source each one
// lives, and a map can only be verified against real `file:line` pointers. These helpers turn the
// artisan records into project-relative source pointers: PSR-4 class-to-file mapping from
// composer, the controller method's line, console command names, schedule lines, and the artisan
// invocation the onboarded project really uses (Sail, docker compose, or host PHP).
//
// Everything here is pure: no fs, no shell. The coverage-excluded gatherer reads the files and
// hands their text in (or injects a `readFile`), so every branch is unit-tested with fixtures.

import type { ProjectCommands } from '@/core/types/project-profile.js';

import type { LaravelArtisanRouteRecord, LaravelRouteRecord } from './extraction.js';

/** One PSR-4 namespace prefix and the project-relative directories it maps to, in order. */
export interface Psr4Entry {
  /** Namespace prefix with a trailing backslash, e.g. `App\`. Empty string is the root mapping. */
  prefix: string;
  /** Directories with a trailing slash, e.g. `app/`. Empty string is the project root. */
  dirs: string[];
}

/** A source pointer without a note: the file is project-relative and the line is 1-indexed. */
export interface SourcePointer {
  file: string;
  line?: number;
}

/** Reads a project-relative file, or returns null when it does not exist or cannot be read. */
export type ReadProjectFile = (path: string) => string | null;

/** 1-indexed line number of a character offset in `content`. */
function lineAt(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

/** Escape a literal for use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Normalize a composer directory value to a project-relative posix dir with a trailing slash. */
function normalizeDir(dir: string): string {
  const posix = dir.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (posix === '' || posix === '.') return '';
  return posix.endsWith('/') ? posix : `${posix}/`;
}

/** Normalize a namespace prefix to carry exactly one trailing backslash (root stays empty). */
function normalizePrefix(prefix: string): string {
  const trimmed = prefix.replace(/^\\+/, '').replace(/\\+$/, '');
  return trimmed.length === 0 ? '' : `${trimmed}\\`;
}

/** Read one `psr-4` object (string or array dir values) into entries, skipping malformed ones. */
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

/**
 * Parse `composer.json` text into PSR-4 entries from `autoload.psr-4` then `autoload-dev.psr-4`.
 * Malformed JSON or a missing section yields no entries, never a throw.
 */
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

/**
 * Parse `vendor/composer/autoload_psr4.php` (the class map composer generates) into PSR-4
 * entries. `$vendorDir . '/x'` maps to `vendor/x` and `$baseDir . '/app'` to `app`, both relative
 * to the project root. Package routes resolve through these entries.
 */
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

/**
 * Every candidate file for a fully-qualified class name, longest PSR-4 prefix first and each
 * prefix's directories in declared order. The caller keeps the first candidate that exists.
 */
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

/** A route action resolved to the class and method that handle it. */
export interface RouteAction {
  className: string;
  method: string;
}

/**
 * Split an artisan route action into class and method: `Ns\Class@method`, or a bare `Ns\Class`
 * read as an invokable (`__invoke`). A closure or an empty action has no class, so it is null.
 */
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

/** The 1-indexed line of `function <method>(` in PHP source, or undefined when absent. */
export function findPhpMethodLine(content: string, method: string): number | undefined {
  const match = new RegExp(`\\bfunction\\s+&?${escapeRegExp(method)}\\s*\\(`).exec(content);
  return match ? lineAt(content, match.index) : undefined;
}

/** A console command name declared in project source, with the line that declares it. */
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

/**
 * Console command names declared in one PHP file: a `$signature`, a `protected $name`, an
 * `#[AsCommand(name: ...)]` attribute, or an `Artisan::command(...)` closure. The name is the
 * signature's first word, so `emails:send {user}` reads as `emails:send`.
 */
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

/** True for the `artisan` word in a command, bare or as a path such as `./artisan`. */
function isArtisanToken(token: string): boolean {
  return token === 'artisan' || token.endsWith('/artisan');
}

/**
 * The token that identifies a scheduled task in source. `schedule:list` prints commands like
 * `php artisan emails:send --force` or `'/usr/bin/php' 'artisan' emails:send`, so the name is the
 * word after `artisan`; anything else (a job class, a shell command) is read from its first word.
 */
function scheduleToken(command: string): string {
  const tokens = command
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/^['"]|['"]$/g, ''));
  const artisan = tokens.findIndex(isArtisanToken);
  const token = artisan >= 0 && artisan + 1 < tokens.length ? tokens[artisan + 1]! : tokens[0]!;
  // A job class prints as its FQCN; the source names it by its short class name.
  return token.split('\\').pop()!;
}

/** The command name (or job class short name) a `schedule:list` command identifies. */
export function scheduledCommandName(command: string): string {
  return scheduleToken(command);
}

/** A line that schedules something, as opposed to one that only declares a command. */
const SCHEDULE_CALL_RE = /Schedule::|\$schedule\s*->|->\s*(?:command|job|call|exec)\s*\(/;

/**
 * The 1-indexed line in a schedule definition file (`routes/console.php`, `bootstrap/app.php`,
 * `app/Console/Kernel.php`) that schedules `command`: the command name as the start of a quoted
 * string, a job class as `<Class>::class`, or, when `commandClass` (the short class name that
 * declares the command) is given, `<commandClass>::class`, as in
 * `Schedule::command(SendReports::class)`. A line with a schedule call wins over one that only
 * declares the command (`Artisan::command(...)`); with none, the first mention is used.
 * Undefined when the file does not mention it.
 */
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

/** How to run artisan in the onboarded project, or why it cannot be run. */
export type ArtisanInvocation = { argv: string[] } | { blocked: string };

/** A `<php-service>`-style placeholder onboarding wrote and the developer never filled in. */
const PLACEHOLDER_RE = /<[^>]+>/;

/** A leading `NAME=value` environment assignment, as in `APP_ENV=testing php artisan test`. */
const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** A shell operator paqad cannot run without a shell: `&&`, `||`, `;` or `|`. */
const SHELL_OPERATOR_RE = /&&|\|\||;|\|/;

/**
 * The artisan invocation the project itself uses, read from its profile commands (issue #500):
 * the words up to and including `artisan` in `commands.migrate`, else `test`, else `dev`. So
 * `vendor/bin/sail artisan migrate` gives `vendor/bin/sail artisan`, a bare `sail` becomes
 * `vendor/bin/sail`, leading `NAME=value` assignments are dropped, and a docker compose `exec`
 * or `run` gets `-T` (no TTY) because paqad runs it without a terminal. A placeholder such as
 * `<php-service>` that was never replaced, or a shell operator (`&&`, `||`, `;`, `|`) before
 * `artisan`, blocks the run, naming the command to fix. No profile, or no command that runs
 * artisan, falls back to host `php artisan`.
 */
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

/**
 * Insert `-T` after a docker compose `exec` or `run` that lacks it (`docker compose` or
 * `docker-compose`), so the command runs with no TTY.
 */
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

/** The way an artisan invocation reaches PHP, which decides what the preflight probe checks. */
export type ArtisanRunner = 'sail' | 'docker' | 'php';

/** Classify an artisan argv: Sail, a docker command, or host PHP. */
export function artisanRunner(argv: string[]): ArtisanRunner {
  const first = argv[0] ?? '';
  if (first.endsWith('sail')) return 'sail';
  if (first === 'docker' || first === 'docker-compose') return 'docker';
  return 'php';
}

/** Normalize a route uri for matching: no leading or trailing slashes, root is the empty string. */
function routeKey(uri: string): string {
  return uri.replace(/^\/+/, '').replace(/\/+$/, '');
}

/** True when a static `Route::<method>` declaration covers one of artisan's `GET|HEAD` methods. */
function methodMatches(staticMethod: string, artisanMethods: string[]): boolean {
  return (
    staticMethod === 'ANY' || staticMethod === 'MATCH' || artisanMethods.includes(staticMethod)
  );
}

/** The app's own route files, preferred when several static declarations match one route. */
const PRIMARY_ROUTE_FILES = new Set(['routes/web.php', 'routes/api.php']);

/**
 * The one static declaration a route-file pointer may cite: the only match, else the only match
 * in `routes/web.php` or `routes/api.php`. Several candidates with no single winner (a prefix
 * group repeating the uri, a package route) cite none, because a wrong pointer is worse than none.
 */
function uniqueDeclaration(matches: LaravelRouteRecord[]): LaravelRouteRecord | undefined {
  if (matches.length === 1) return matches[0];
  const primary = matches.filter((route) => PRIMARY_ROUTE_FILES.has(route.file));
  return primary.length === 1 ? primary[0] : undefined;
}

export interface ArtisanRouteResolverInput {
  /** PSR-4 entries from composer.json, then the vendor class map. */
  psr4: Psr4Entry[];
  /** The static `Route::` scan of the project's route files. */
  staticRoutes: LaravelRouteRecord[];
  readFile: ReadProjectFile;
}

/**
 * Build the resolver `extractLaravelArtisanRoutes` takes: for one artisan route it returns the
 * route-file pointer (the one static `Route::` declaration with the same method and uri) and the
 * controller pointer (the action's class file via PSR-4, at the method's line when found). Either
 * may be missing; a route with neither is untraceable and the extractor reports it.
 */
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
