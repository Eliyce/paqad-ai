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
  type ExtractedSurface,
  type ExtractorOutput,
} from '@/site-map/extraction.js';

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
    it('maps a modular route to api/page by uri, with guards + module attribution', () => {
      const [api, page] = extractLaravelArtisanRoutes([
        {
          method: 'GET|HEAD',
          uri: '/api/users',
          action: 'Modules\\Blog\\Http\\Controllers\\UserController@index',
          middleware: ['api', 'auth:api'],
        },
        { method: 'POST', uri: 'posts', action: 'Closure' },
      ]);
      expect(api).toMatchObject({
        kind: 'api',
        source: 'laravel-artisan-routes',
        label: 'Modules\\Blog\\Http\\Controllers\\UserController@index',
        guards: ['api', 'auth:api'],
        module: 'Blog',
        entry: { kind: 'url', value: '/api/users' },
        confidence: 'high',
      });
      expect(api!.evidence).toEqual([{ file: 'php artisan route:list', note: 'GET /api/users' }]);
      // action === 'Closure' falls back to the method+uri label; no module/guards.
      expect(page).toMatchObject({ kind: 'page', label: 'POST /posts' });
      expect(page!.module).toBeUndefined();
      expect(page!.guards).toBeUndefined();
    });

    it('labels a route with no action and tolerates an empty leading method token', () => {
      const [noAction, weird] = extractLaravelArtisanRoutes([
        { method: 'GET', uri: 'health' },
        { method: ',GET', uri: 'x' },
      ]);
      expect(noAction!.label).toBe('GET /health');
      // ',GET'.split -> first token '' is falsy, so the whole method string is used.
      expect(weird!.label).toBe(',GET /x');
    });
  });

  describe('extractLaravelConsoleCommands', () => {
    it('maps non-hidden commands to cli-command surfaces and skips hidden ones', () => {
      const surfaces = extractLaravelConsoleCommands([
        { name: 'migrate', description: 'Run the migrations' },
        { name: 'app:sync' },
        { name: '_complete', hidden: true },
      ]);
      expect(surfaces).toHaveLength(2);
      expect(surfaces[0]).toMatchObject({
        kind: 'cli-command',
        label: 'Run the migrations',
        entry: { kind: 'artisan', value: 'migrate' },
        source: 'laravel-console',
      });
      // no description -> the command name is the label.
      expect(surfaces[1]!.label).toBe('app:sync');
    });
  });

  describe('extractLaravelScheduledJobs', () => {
    it('maps scheduled tasks to job surfaces entered by cron expression', () => {
      const [only] = extractLaravelScheduledJobs([
        { expression: '0 2 * * *', command: 'php artisan backup:run' },
      ]);
      expect(only).toMatchObject({
        kind: 'job',
        label: 'php artisan backup:run',
        entry: { kind: 'schedule', value: '0 2 * * *' },
        source: 'laravel-schedule',
      });
      expect(only!.evidence).toEqual([{ file: 'php artisan schedule:list', note: '0 2 * * *' }]);
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
