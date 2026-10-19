import { describe, expect, it } from 'vitest';

import {
  SITE_MAP_EXTRACTION_SCHEMA_VERSION,
  assembleExtraction,
  blockedExtractor,
  extractGenericSurfaces,
  extractLaravelArtisanRoutes,
  extractLaravelConsoleCommands,
  extractLaravelJobs,
  extractLaravelMailables,
  extractLaravelRouteSurfaces,
  extractLaravelScheduledJobs,
  extractNodeCliSurfaces,
  extractReactRouteSurfaces,
  extractionFingerprint,
  parseArtisanCommandList,
  parseArtisanRouteList,
  parseArtisanScheduleList,
  sortExtractedSurfaces,
  unresolvedBlockedCheck,
  type ExtractedSurface,
  type ExtractorOutput,
} from '@/site-map/extraction.js';
import { detectUnmappedSurfaces } from '@/site-map/assemble.js';
import {
  createArtisanRouteResolver,
  extractConsoleCommandNames,
  findScheduleLine,
  parseComposerPsr4,
} from '@/site-map/laravel-sources.js';

function surface(overrides: Partial<ExtractedSurface> = {}): ExtractedSurface {
  return {
    raw_id: 'node-cli-x',
    kind: 'cli-command',
    label: 'X',
    evidence: [{ file: 'src/cli/x.ts', line: 1 }],
    derivation: 'static',
    confidence: 'high',
    source: 'node-cli',
    ...overrides,
  };
}

describe('site-map extraction', () => {
  describe('extractNodeCliSurfaces', () => {
    it('maps each non-hidden command to a cli-command surface with a bin entry', () => {
      const [only] = extractNodeCliSurfaces([
        {
          name: 'plan compile',
          description: 'Compile the plan',
          file: 'src/cli/plan.ts',
          line: 42,
        },
      ]);
      expect(only).toEqual({
        raw_id: 'node-cli-plan-compile',
        kind: 'cli-command',
        label: 'Compile the plan',
        evidence: [{ file: 'src/cli/plan.ts', line: 42 }],
        entry: { kind: 'bin', value: 'plan compile' },
        derivation: 'static',
        confidence: 'high',
        source: 'node-cli',
      });
    });

    it('skips hidden commands', () => {
      expect(
        extractNodeCliSurfaces([{ name: 'internal', file: 'src/cli/x.ts', hidden: true }]),
      ).toEqual([]);
    });

    it('falls back to the command name when the description is missing or blank', () => {
      const [noDesc] = extractNodeCliSurfaces([{ name: 'sitemap', file: 'src/cli/x.ts' }]);
      const [blankDesc] = extractNodeCliSurfaces([
        { name: 'health', description: '   ', file: 'src/cli/x.ts' },
      ]);
      expect(noDesc!.label).toBe('sitemap');
      expect(blankDesc!.label).toBe('health');
    });

    it('omits the line from evidence when the gatherer could not pin one', () => {
      const [only] = extractNodeCliSurfaces([{ name: 'audit', file: 'src/cli/audit.ts' }]);
      expect(only!.evidence).toEqual([{ file: 'src/cli/audit.ts' }]);
    });
  });

  describe('extractReactRouteSurfaces', () => {
    it('maps a declared route to a high-confidence page surface with the component label', () => {
      const [only] = extractReactRouteSurfaces([
        { path: '/checkout', component: 'CheckoutPage', file: 'src/routes.tsx', line: 12 },
      ]);
      expect(only).toEqual({
        raw_id: 'react-routes-checkout',
        kind: 'page',
        label: 'CheckoutPage',
        evidence: [{ file: 'src/routes.tsx', line: 12 }],
        entry: { kind: 'url', value: '/checkout' },
        derivation: 'static',
        confidence: 'high',
        source: 'react-routes',
      });
    });

    it('falls back to the path as label when the component is absent or blank', () => {
      const [noComp] = extractReactRouteSurfaces([{ path: '/users/:id', file: 'src/routes.tsx' }]);
      expect(noComp!.label).toBe('/users/:id');
      const [blank] = extractReactRouteSurfaces([
        { path: '/', component: '   ', file: 'src/routes.tsx' },
      ]);
      expect(blank!.label).toBe('/');
      expect(blank!.evidence).toEqual([{ file: 'src/routes.tsx' }]);
    });
  });

  describe('extractLaravelRouteSurfaces', () => {
    it('maps an api-prefixed uri to an api surface with the action label', () => {
      const [api] = extractLaravelRouteSurfaces([
        {
          method: 'POST',
          uri: 'api/orders',
          action: 'OrderController@store',
          file: 'routes/api.php',
          line: 8,
        },
      ]);
      expect(api).toEqual({
        raw_id: 'laravel-routes-post-api-orders',
        kind: 'api',
        label: 'OrderController@store',
        evidence: [{ file: 'routes/api.php', line: 8 }],
        entry: { kind: 'url', value: '/api/orders' },
        derivation: 'static',
        confidence: 'high',
        source: 'laravel-routes',
      });
    });

    it('maps a web uri to a page surface, strips a leading slash, and labels method+uri', () => {
      const [page] = extractLaravelRouteSurfaces([
        { method: 'GET', uri: '/dashboard', file: 'routes/web.php' },
      ]);
      expect(page!.kind).toBe('page');
      expect(page!.label).toBe('GET /dashboard');
      expect(page!.entry).toEqual({ kind: 'url', value: '/dashboard' });
      // A bare `api` segment is also an api surface.
      const [bare] = extractLaravelRouteSurfaces([
        { method: 'GET', uri: 'api', file: 'routes/api.php' },
      ]);
      expect(bare!.kind).toBe('api');
    });
  });

  describe('extractGenericSurfaces', () => {
    it('trusts the record kind, carries the entry, and flags medium confidence', () => {
      const [only] = extractGenericSurfaces([
        {
          kind: 'page',
          identifier: '/users/:id',
          label: 'User detail',
          file: 'app/routes/users.tsx',
          line: 7,
          entry: { kind: 'route', value: '/users/:id' },
        },
      ]);
      expect(only).toEqual({
        raw_id: 'generic-users-id',
        kind: 'page',
        label: 'User detail',
        evidence: [{ file: 'app/routes/users.tsx', line: 7 }],
        entry: { kind: 'route', value: '/users/:id' },
        derivation: 'static',
        confidence: 'medium',
        source: 'generic',
      });
    });

    it('falls back to the identifier as label and omits entry when absent', () => {
      const [blankLabel] = extractGenericSurfaces([
        { kind: 'api', identifier: 'GET /health', label: '  ', file: 'src/api.ts' },
      ]);
      expect(blankLabel!.label).toBe('GET /health');
      expect(blankLabel!.entry).toBeUndefined();
    });

    it('collapses to the bare source when the identifier has no word characters', () => {
      const [root] = extractGenericSurfaces([
        { kind: 'page', identifier: '/', file: 'app/root.tsx' },
      ]);
      expect(root!.raw_id).toBe('generic');
    });
  });

  describe('sortExtractedSurfaces', () => {
    it('orders by raw_id without mutating the input', () => {
      const input = [surface({ raw_id: 'node-cli-b' }), surface({ raw_id: 'node-cli-a' })];
      const sorted = sortExtractedSurfaces(input);
      expect(sorted.map((s) => s.raw_id)).toEqual(['node-cli-a', 'node-cli-b']);
      expect(input.map((s) => s.raw_id)).toEqual(['node-cli-b', 'node-cli-a']);
    });
  });

  describe('extractionFingerprint', () => {
    it('is order-independent over the surface set', () => {
      const a = surface({ raw_id: 'node-cli-a' });
      const b = surface({ raw_id: 'node-cli-b' });
      expect(extractionFingerprint([a, b])).toBe(extractionFingerprint([b, a]));
    });

    it('changes when the surface set changes', () => {
      const a = surface({ raw_id: 'node-cli-a' });
      const b = surface({ raw_id: 'node-cli-b' });
      expect(extractionFingerprint([a])).not.toBe(extractionFingerprint([a, b]));
    });
  });

  describe('blockedExtractor', () => {
    it('builds an unavailable output carrying the reason and install hint', () => {
      expect(blockedExtractor('rails-routes', 'ruby not installed', 'Install Ruby 3.x')).toEqual({
        extractor: 'rails-routes',
        available: false,
        surfaces: [],
        blocked: {
          check: 'rails-routes surface extraction',
          reason: 'ruby not installed',
          install_hint: 'Install Ruby 3.x',
        },
      });
    });
  });

  describe('assembleExtraction', () => {
    it('merges available surfaces, records blocked checks, and fingerprints the set', () => {
      const outputs: ExtractorOutput[] = [
        {
          extractor: 'node-cli',
          available: true,
          surfaces: [surface({ raw_id: 'node-cli-b' }), surface({ raw_id: 'node-cli-a' })],
        },
        blockedExtractor('rails-routes', 'ruby missing', 'Install Ruby'),
      ];
      const result = assembleExtraction(outputs, 'cli');
      expect(result.schema_version).toBe(SITE_MAP_EXTRACTION_SCHEMA_VERSION);
      expect(result.app_kind).toBe('cli');
      expect(result.surfaces.map((s) => s.raw_id)).toEqual(['node-cli-a', 'node-cli-b']);
      expect(result.blocked_checks).toHaveLength(1);
      expect(result.extractors_ran).toBe(1);
      expect(result.low_confidence_fallback).toBe(false);
      expect(result.fingerprint).toMatch(/^[0-9a-f]{12}$/);
    });

    it('unions evidence for surfaces sharing a raw_id, dropping exact duplicates', () => {
      const shared = 'node-cli-x';
      const outputs: ExtractorOutput[] = [
        {
          extractor: 'a',
          available: true,
          surfaces: [surface({ raw_id: shared, evidence: [{ file: 'a.ts', line: 1 }] })],
        },
        {
          extractor: 'b',
          available: true,
          surfaces: [
            surface({
              raw_id: shared,
              evidence: [
                { file: 'a.ts', line: 1 },
                { file: 'b.ts', note: 'via nav' },
              ],
            }),
          ],
        },
      ];
      const result = assembleExtraction(outputs, 'web');
      expect(result.surfaces).toHaveLength(1);
      expect(result.surfaces[0]!.evidence).toEqual([
        { file: 'a.ts', line: 1 },
        { file: 'b.ts', note: 'via nav' },
      ]);
    });

    it('ignores an unavailable extractor that carries no blocked check', () => {
      const outputs: ExtractorOutput[] = [
        { extractor: 'stub', available: false, surfaces: [], blocked: null },
      ];
      const result = assembleExtraction(outputs, 'service');
      expect(result.blocked_checks).toEqual([]);
      expect(result.surfaces).toEqual([]);
    });

    it('flags a low-confidence fallback when no extractor ran', () => {
      const result = assembleExtraction([blockedExtractor('x', 'r', 'h')], 'api');
      expect(result.extractors_ran).toBe(0);
      expect(result.low_confidence_fallback).toBe(true);
      expect(result.surfaces).toEqual([]);
    });
  });

  describe('parseArtisanRouteList', () => {
    it('normalizes well-formed route:list JSON, coercing middleware to a token list', () => {
      const records = parseArtisanRouteList(
        JSON.stringify([
          {
            domain: 'admin.example.com',
            method: 'GET|HEAD',
            uri: 'api/users',
            name: 'users.index',
            action: 'App\\Http\\Controllers\\UserController@index',
            middleware: ['api', 'auth:api'],
          },
          {
            method: 'POST',
            uri: 'posts',
            action: 'Modules\\Blog\\Http\\Controllers\\PostController@store',
            // middleware as a newline/comma string (older artisan)
            middleware: 'web\nauth,can:create,posts',
          },
        ]),
      );
      expect(records).toHaveLength(2);
      expect(records[0]).toEqual({
        domain: 'admin.example.com',
        method: 'GET|HEAD',
        uri: 'api/users',
        name: 'users.index',
        action: 'App\\Http\\Controllers\\UserController@index',
        middleware: ['api', 'auth:api'],
      });
      expect(records[1]!.middleware).toEqual(['web', 'auth', 'can:create', 'posts']);
      expect(records[1]!.name).toBeUndefined();
      expect(records[1]!.domain).toBeUndefined();
    });

    it('drops a non-string middleware element and omits an empty middleware list', () => {
      const [only] = parseArtisanRouteList(
        JSON.stringify([{ method: 'GET', uri: '/', middleware: ['web', 42, '  '] }]),
      );
      expect(only!.middleware).toEqual(['web']);
      const [bare] = parseArtisanRouteList(JSON.stringify([{ method: 'GET', uri: '/' }]));
      expect(bare!.middleware).toBeUndefined();
    });

    it('skips entries that are not objects or lack a method/uri', () => {
      const records = parseArtisanRouteList(
        JSON.stringify([
          null,
          'nope',
          { method: 'GET' },
          { uri: 'x' },
          { method: 'GET', uri: 'ok' },
        ]),
      );
      expect(records).toEqual([{ method: 'GET', uri: 'ok' }]);
    });

    it('returns [] for malformed or non-array output', () => {
      expect(parseArtisanRouteList('not json')).toEqual([]);
      expect(parseArtisanRouteList('{"not":"an array"}')).toEqual([]);
    });
  });

  describe('parseArtisanCommandList', () => {
    it('reads commands from the Symfony envelope, preserving hidden + description', () => {
      const records = parseArtisanCommandList(
        JSON.stringify({
          application: { name: 'Laravel' },
          commands: [
            { name: 'migrate', description: 'Run the migrations', hidden: false },
            { name: '_complete', hidden: true },
            { name: '  ' },
            'nope',
          ],
        }),
      );
      expect(records).toEqual([
        { name: 'migrate', description: 'Run the migrations' },
        { name: '_complete', hidden: true },
      ]);
    });

    it('accepts a bare command array and skips an object with a non-string name', () => {
      expect(
        parseArtisanCommandList(JSON.stringify([{ name: 'inspire' }, { description: 'no name' }])),
      ).toEqual([{ name: 'inspire' }]);
    });

    it('returns [] for a non-array, non-envelope shape or malformed output', () => {
      expect(parseArtisanCommandList('{}')).toEqual([]);
      expect(parseArtisanCommandList('not json')).toEqual([]);
    });
  });

  describe('parseArtisanScheduleList', () => {
    it('parses cron lines (stripping ANSI + dotted filler) and skips non-task lines', () => {
      const stdout = [
        '[32m0 2 * * *[39m  php artisan backup:run ......... Next Due: 5 hours from now',
        '  @daily  php artisan report:send',
        'Scheduled tasks:',
        '* * * * * * php artisan pulse:check   Next Due: 1 second from now',
      ].join('\n');
      const records = parseArtisanScheduleList(stdout);
      expect(records).toEqual([
        { expression: '0 2 * * *', command: 'php artisan backup:run' },
        { expression: '@daily', command: 'php artisan report:send' },
        { expression: '* * * * * *', command: 'php artisan pulse:check' },
      ]);
    });

    it('returns [] when nothing looks like a scheduled task', () => {
      expect(parseArtisanScheduleList('No scheduled tasks have been defined.')).toEqual([]);
    });
  });

  describe('extractLaravelArtisanRoutes', () => {
    const controller = { file: 'Modules/Blog/Http/Controllers/UserController.php', line: 14 };
    const routeFile = { file: 'routes/api.php', line: 3 };

    it('maps a modular route to api/page by uri, with guards, module and real source pointers', () => {
      const { surfaces, unresolved } = extractLaravelArtisanRoutes(
        [
          {
            method: 'GET|HEAD',
            uri: '/api/users',
            action: 'Modules\\Blog\\Http\\Controllers\\UserController@index',
            middleware: ['api', 'auth:api'],
          },
          { method: 'POST', uri: 'posts', action: 'Closure' },
        ],
        (record) =>
          record.uri === '/api/users'
            ? [routeFile, controller]
            : [{ file: 'routes/web.php', line: 9 }],
      );
      const [api, page] = surfaces;
      expect(unresolved).toEqual([]);
      expect(api).toMatchObject({
        kind: 'api',
        source: 'laravel-artisan-routes',
        label: 'Modules\\Blog\\Http\\Controllers\\UserController@index',
        guards: ['api', 'auth:api'],
        module: 'Blog',
        entry: { kind: 'url', value: '/api/users' },
        confidence: 'high',
      });
      // Both pointers are kept; the artisan command lives only in the note (issue #500).
      expect(api!.evidence).toEqual([
        { ...routeFile, note: 'php artisan route:list (GET /api/users)' },
        { ...controller, note: 'php artisan route:list (GET /api/users)' },
      ]);
      // action === 'Closure' falls back to the method+uri label; no module/guards.
      expect(page).toMatchObject({ kind: 'page', label: 'POST /posts' });
      expect(page!.module).toBeUndefined();
      expect(page!.guards).toBeUndefined();
    });

    it('labels a route with no action and tolerates an empty leading method token', () => {
      const { surfaces } = extractLaravelArtisanRoutes(
        [
          { method: 'GET', uri: 'health' },
          { method: ',GET', uri: 'x' },
        ],
        () => [routeFile],
      );
      const [noAction, weird] = surfaces;
      expect(noAction!.label).toBe('GET /health');
      // ',GET'.split -> first token '' is falsy, so the whole method string is used.
      expect(weird!.label).toBe(',GET /x');
    });

    it('leaves out a route with no source pointer and reports it (FR-13)', () => {
      const { surfaces, unresolved } = extractLaravelArtisanRoutes(
        [
          { method: 'GET|HEAD', uri: 'telescope/{view?}', action: 'Closure' },
          { method: 'GET', uri: '/', action: 'App\\Http\\Controllers\\HomeController' },
        ],
        (record) => (record.uri === '/' ? [{ file: 'routes/web.php', line: 5 }] : []),
      );
      expect(surfaces.map((s) => s.label)).toEqual(['App\\Http\\Controllers\\HomeController']);
      expect(unresolved).toEqual(['GET /telescope/{view?}']);
    });
  });

  describe('extractLaravelConsoleCommands', () => {
    it('maps project-declared commands to surfaces and skips built-ins and hidden ones (AC-20)', () => {
      const declared = new Map([
        ['app:sync', { file: 'app/Console/Commands/SyncCommand.php', line: 12 }],
        ['_complete', { file: 'app/Console/Commands/Hidden.php', line: 3 }],
        ['report:send', { file: 'routes/console.php', line: 8 }],
      ]);
      const surfaces = extractLaravelConsoleCommands(
        [
          { name: 'migrate', description: 'Run the migrations' },
          { name: 'app:sync', description: 'Sync the catalogue' },
          { name: 'report:send' },
          { name: '_complete', hidden: true },
        ],
        (name) => declared.get(name),
      );
      expect(surfaces).toHaveLength(2);
      expect(surfaces[0]).toMatchObject({
        kind: 'cli-command',
        label: 'Sync the catalogue',
        entry: { kind: 'artisan', value: 'app:sync' },
        source: 'laravel-console',
      });
      expect(surfaces[0]!.evidence).toEqual([
        {
          file: 'app/Console/Commands/SyncCommand.php',
          line: 12,
          note: 'php artisan list (app:sync)',
        },
      ]);
      // no description -> the command name is the label.
      expect(surfaces[1]!.label).toBe('report:send');
    });
  });

  describe('extractLaravelScheduledJobs', () => {
    it('points each scheduled task at the line that schedules it and reports the rest (AC-20)', () => {
      const { surfaces, unresolved } = extractLaravelScheduledJobs(
        [
          { expression: '0 2 * * *', command: 'php artisan backup:run' },
          { expression: '@daily', command: 'Closure at: vendor/x.php:3' },
        ],
        (command) =>
          command.includes('backup:run') ? { file: 'routes/console.php', line: 7 } : undefined,
      );
      expect(surfaces).toHaveLength(1);
      expect(surfaces[0]).toMatchObject({
        kind: 'job',
        label: 'php artisan backup:run',
        entry: { kind: 'schedule', value: '0 2 * * *' },
        source: 'laravel-schedule',
      });
      expect(surfaces[0]!.evidence).toEqual([
        { file: 'routes/console.php', line: 7, note: 'php artisan schedule:list (0 2 * * *)' },
      ]);
      expect(unresolved).toEqual(['@daily Closure at: vendor/x.php:3']);
    });
  });

  describe('unresolvedBlockedCheck', () => {
    it('is null when everything resolved', () => {
      expect(unresolvedBlockedCheck('laravel-artisan-routes', 'routes', [])).toBeNull();
    });

    it('lists ten untraceable routes then says how many more (AC-15)', () => {
      const routes = Array.from({ length: 12 }, (_, i) => `GET /r${i + 1}`);
      const check = unresolvedBlockedCheck(
        'laravel-artisan-routes',
        'routes',
        routes,
        ' (closures or package routes)',
      )!;
      expect(check.check).toBe('laravel-artisan-routes source tracing');
      expect(check.reason).toBe(
        '12 routes could not be traced to a source file (closures or package routes): ' +
          `${routes.slice(0, 10).join(', ')}, and 2 more`,
      );
      expect(check.reason).not.toContain('GET /r11');
      expect(check.install_hint).toContain('app-map.yaml');
    });

    it('lists every item when there are ten or fewer', () => {
      const check = unresolvedBlockedCheck('laravel-schedule', 'scheduled tasks', ['a', 'b'])!;
      expect(check.reason).toBe('2 scheduled tasks could not be traced to a source file: a, b');
    });
  });

  describe('twelve untraceable artisan routes end to end (AC-15)', () => {
    it('emits no surface and one capped blocked check that assembly collects', () => {
      const records = Array.from({ length: 12 }, (_, i) => ({
        method: 'GET|HEAD',
        uri: `closure-${i + 1}`,
        action: 'Closure',
      }));
      const traced = extractLaravelArtisanRoutes(records, () => []);
      const output: ExtractorOutput = {
        extractor: 'laravel-artisan-routes',
        available: true,
        surfaces: traced.surfaces,
        blocked: unresolvedBlockedCheck(
          'laravel-artisan-routes',
          'routes',
          traced.unresolved,
          ' (closures or package routes)',
        ),
      };
      const result = assembleExtraction([output], 'web');
      expect(result.surfaces).toEqual([]);
      expect(result.blocked_checks).toHaveLength(1);
      expect(result.blocked_checks[0]!.reason).toMatch(/^12 routes could not be traced/);
      expect(result.blocked_checks[0]!.reason).toMatch(/GET \/closure-10, and 2 more$/);
      expect(result.extractors_ran).toBe(1);
    });
  });

  describe('evidence contract: every evidence.file is a real project path (issue #500, AC-13)', () => {
    // The fixture project's files. Every pointer any extractor emits must be one of these.
    const files: Record<string, string> = {
      'composer.json': JSON.stringify({ autoload: { 'psr-4': { 'App\\': 'app/' } } }),
      'routes/web.php': "<?php\nRoute::get('/basket', [BasketController::class, 'show']);\n",
      'app/Http/Controllers/BasketController.php':
        '<?php\nclass BasketController\n{\n    public function show()\n    {\n    }\n}\n',
      'app/Console/Commands/SyncCommand.php':
        "<?php\nclass SyncCommand\n{\n    protected $signature = 'app:sync {--force}';\n}\n",
      'routes/console.php': "<?php\nSchedule::command('app:sync')->daily();\n",
      'src/cli.ts': "program.command('serve')",
      'src/routes.tsx': '<Route path="/home" element={<Home />} />',
      'app/Jobs/SendWelcome.php': '<?php class SendWelcome implements ShouldQueue {}',
      'app/Mail/OrderShipped.php': '<?php class OrderShipped extends Mailable {}',
      'app/pages/about.tsx': 'export default function About() {}',
    };
    const read = (path: string): string | null => files[path] ?? null;

    it('holds for the output of every extractor', () => {
      const staticRoutes = [{ method: 'GET', uri: '/basket', file: 'routes/web.php', line: 2 }];
      const resolver = createArtisanRouteResolver({
        psr4: parseComposerPsr4(files['composer.json']!),
        staticRoutes,
        readFile: read,
      });
      const consoleNames = new Map(
        extractConsoleCommandNames(files['app/Console/Commands/SyncCommand.php']!).map((d) => [
          d.name,
          { file: 'app/Console/Commands/SyncCommand.php', line: d.line },
        ]),
      );
      const surfaces: ExtractedSurface[] = [
        ...extractNodeCliSurfaces([{ name: 'serve', file: 'src/cli.ts', line: 1 }]),
        ...extractReactRouteSurfaces([{ path: '/home', file: 'src/routes.tsx', line: 1 }]),
        ...extractGenericSurfaces([
          { kind: 'page', identifier: 'about', file: 'app/pages/about.tsx' },
        ]),
        ...extractLaravelRouteSurfaces(staticRoutes),
        ...extractLaravelArtisanRoutes(
          [
            {
              method: 'GET|HEAD',
              uri: 'basket',
              action: 'App\\Http\\Controllers\\BasketController@show',
            },
            { method: 'GET|HEAD', uri: 'closure', action: 'Closure' },
          ],
          resolver,
        ).surfaces,
        ...extractLaravelConsoleCommands([{ name: 'app:sync' }, { name: 'migrate' }], (name) =>
          consoleNames.get(name),
        ),
        ...extractLaravelScheduledJobs(
          [{ expression: '@daily', command: 'php artisan app:sync' }],
          (command) => {
            const line = findScheduleLine(files['routes/console.php']!, command);
            return line === undefined ? undefined : { file: 'routes/console.php', line };
          },
        ).surfaces,
        ...extractLaravelJobs([
          { className: 'SendWelcome', file: 'app/Jobs/SendWelcome.php', line: 1 },
        ]),
        ...extractLaravelMailables([
          { className: 'OrderShipped', file: 'app/Mail/OrderShipped.php' },
        ]),
      ];

      expect(surfaces.length).toBeGreaterThanOrEqual(9);
      for (const surface of surfaces) {
        expect(surface.evidence.length, surface.raw_id).toBeGreaterThan(0);
        for (const evidence of surface.evidence) {
          expect(evidence.file, surface.raw_id).not.toMatch(/\s/);
          expect(evidence.file.startsWith('/'), surface.raw_id).toBe(false);
          expect(Object.keys(files), surface.raw_id).toContain(evidence.file);
        }
      }
    });
  });

  describe('the #500 bind: a map citing the route file reconciles with artisan extraction (AC-14)', () => {
    it('raises no SM-ADD for a route the map cites at routes/web.php:<line>', () => {
      const resolver = createArtisanRouteResolver({
        psr4: [{ prefix: 'App\\', dirs: ['app/'] }],
        staticRoutes: [{ method: 'GET', uri: 'basket', file: 'routes/web.php', line: 12 }],
        readFile: (path) =>
          path === 'app/Http/Controllers/BasketController.php'
            ? '<?php\nclass BasketController {\n  public function show() {}\n}\n'
            : null,
      });
      const traced = extractLaravelArtisanRoutes(
        [
          {
            method: 'GET|HEAD',
            uri: 'basket',
            action: 'App\\Http\\Controllers\\BasketController@show',
          },
        ],
        resolver,
      );
      const extraction = assembleExtraction(
        [{ extractor: 'laravel-artisan-routes', available: true, surfaces: traced.surfaces }],
        'web',
      );
      const map = {
        schema_version: 1,
        app: { name: 'shop', kind: 'web' as const },
        surfaces: [
          {
            id: 'basket',
            kind: 'page' as const,
            label: 'Basket',
            evidence: { file: 'routes/web.php', line: 12 },
          },
        ],
      };
      expect(detectUnmappedSurfaces(map, extraction)).toEqual([]);
      // The controller is cited too, so a map that names the controller reconciles as well.
      const byController = {
        ...map,
        surfaces: [
          {
            ...map.surfaces[0]!,
            evidence: { file: 'app/Http/Controllers/BasketController.php', line: 3 },
          },
        ],
      };
      expect(detectUnmappedSurfaces(byController, extraction)).toEqual([]);
    });
  });

  describe('extractLaravelJobs / extractLaravelMailables', () => {
    it('maps queued-job classes to job surfaces with resolving evidence + module', () => {
      const [only] = extractLaravelJobs([
        {
          className: 'SendWelcomeEmail',
          file: 'Modules/Blog/Jobs/SendWelcomeEmail.php',
          line: 12,
          module: 'Blog',
        },
      ]);
      expect(only).toMatchObject({
        kind: 'job',
        label: 'SendWelcomeEmail',
        source: 'laravel-jobs',
        module: 'Blog',
      });
      expect(only!.evidence).toEqual([
        { file: 'Modules/Blog/Jobs/SendWelcomeEmail.php', line: 12 },
      ]);
    });

    it('maps mailable classes to email surfaces, omitting module + line when absent', () => {
      const [only] = extractLaravelMailables([
        { className: 'OrderShipped', file: 'app/Mail/OrderShipped.php' },
      ]);
      expect(only).toMatchObject({ kind: 'email', label: 'OrderShipped', source: 'laravel-mail' });
      expect(only!.module).toBeUndefined();
      expect(only!.evidence).toEqual([{ file: 'app/Mail/OrderShipped.php' }]);
    });
  });
});
