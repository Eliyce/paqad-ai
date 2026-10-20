import { describe, expect, it, vi } from 'vitest';

import {
  artisanRunner,
  classToCandidatePaths,
  createArtisanRouteResolver,
  extractConsoleCommandNames,
  findPhpMethodLine,
  findScheduleLine,
  parseComposerPsr4,
  parseRouteAction,
  parseVendorPsr4,
  resolveArtisanInvocation,
  scheduledCommandName,
  type Psr4Entry,
} from '@/site-map/laravel-sources.js';

describe('laravel-sources', () => {
  describe('parseComposerPsr4', () => {
    it('reads autoload then autoload-dev, string and array dirs, normalizing both sides', () => {
      const entries = parseComposerPsr4(
        JSON.stringify({
          autoload: {
            'psr-4': {
              'App\\': 'app/',
              'Modules\\': ['Modules', './modules/'],
              'Database\\Seeders\\': 'database/seeders',
              '': 'src/',
              'Bad\\': 42,
            },
          },
          'autoload-dev': { 'psr-4': { 'Tests\\': 'tests/' } },
        }),
      );
      expect(entries).toEqual([
        { prefix: 'App\\', dirs: ['app/'] },
        { prefix: 'Modules\\', dirs: ['Modules/', 'modules/'] },
        { prefix: 'Database\\Seeders\\', dirs: ['database/seeders/'] },
        { prefix: '', dirs: ['src/'] },
        { prefix: 'Tests\\', dirs: ['tests/'] },
      ]);
    });

    it('maps a dot or empty dir to the project root', () => {
      expect(parseComposerPsr4(JSON.stringify({ autoload: { 'psr-4': { 'X\\': '.' } } }))).toEqual([
        { prefix: 'X\\', dirs: [''] },
      ]);
    });

    it('yields nothing for malformed JSON, a non-object, or a missing or array section', () => {
      expect(parseComposerPsr4('not json')).toEqual([]);
      expect(parseComposerPsr4('null')).toEqual([]);
      expect(parseComposerPsr4('{}')).toEqual([]);
      expect(parseComposerPsr4(JSON.stringify({ autoload: { 'psr-4': ['x'] } }))).toEqual([]);
    });
  });

  describe('parseVendorPsr4', () => {
    it('maps $vendorDir and $baseDir entries to project-relative dirs', () => {
      const php = [
        '<?php',
        '$vendorDir = dirname(__DIR__);',
        '$baseDir = dirname($vendorDir);',
        'return array(',
        "    'Laravel\\\\Horizon\\\\' => array($vendorDir . '/laravel/horizon/src'),",
        "    'App\\\\' => array($baseDir . '/app'),",
        "    'Illuminate\\\\Support\\\\' => array($vendorDir . '/laravel/framework/src/Illuminate/Macroable', $vendorDir . '/laravel/framework/src/Illuminate/Collections'),",
        "    'Empty\\\\' => array(),",
        ');',
      ].join('\n');
      expect(parseVendorPsr4(php)).toEqual([
        { prefix: 'Laravel\\Horizon\\', dirs: ['vendor/laravel/horizon/src/'] },
        { prefix: 'App\\', dirs: ['app/'] },
        {
          prefix: 'Illuminate\\Support\\',
          dirs: [
            'vendor/laravel/framework/src/Illuminate/Macroable/',
            'vendor/laravel/framework/src/Illuminate/Collections/',
          ],
        },
      ]);
    });

    it('yields nothing for empty input', () => {
      expect(parseVendorPsr4('')).toEqual([]);
    });
  });

  describe('classToCandidatePaths (AC-19)', () => {
    const entries: Psr4Entry[] = [
      { prefix: 'App\\', dirs: ['app/'] },
      { prefix: 'App\\Http\\', dirs: ['custom/http/', 'app/Http/'] },
      { prefix: 'Modules\\', dirs: ['Modules/'] },
      { prefix: 'Laravel\\Horizon\\', dirs: ['vendor/laravel/horizon/src/'] },
    ];

    it('orders candidates longest prefix first, dirs in declared order, without duplicates', () => {
      expect(classToCandidatePaths('\\App\\Http\\Controllers\\BasketController', entries)).toEqual([
        'custom/http/Controllers/BasketController.php',
        'app/Http/Controllers/BasketController.php',
      ]);
    });

    it('maps module namespaces and vendor package classes', () => {
      expect(
        classToCandidatePaths('Modules\\Blog\\Http\\Controllers\\PostController', entries),
      ).toEqual(['Modules/Blog/Http/Controllers/PostController.php']);
      expect(
        classToCandidatePaths('Laravel\\Horizon\\Http\\Controllers\\HomeController', entries),
      ).toEqual(['vendor/laravel/horizon/src/Http/Controllers/HomeController.php']);
    });

    it('returns nothing for a class no prefix covers', () => {
      expect(classToCandidatePaths('Other\\Thing', entries)).toEqual([]);
    });
  });

  describe('parseRouteAction', () => {
    it('splits Class@method and reads a bare class as invokable', () => {
      expect(parseRouteAction('App\\Http\\Controllers\\BasketController@store')).toEqual({
        className: 'App\\Http\\Controllers\\BasketController',
        method: 'store',
      });
      expect(parseRouteAction(' App\\Http\\Controllers\\ShowHome ')).toEqual({
        className: 'App\\Http\\Controllers\\ShowHome',
        method: '__invoke',
      });
      expect(parseRouteAction('App\\X@')).toEqual({ className: 'App\\X', method: '__invoke' });
    });

    it('has no class for a closure, an empty action, or a missing class', () => {
      expect(parseRouteAction('Closure')).toBeNull();
      expect(parseRouteAction('')).toBeNull();
      expect(parseRouteAction(undefined)).toBeNull();
      expect(parseRouteAction('@store')).toBeNull();
    });
  });

  describe('findPhpMethodLine (AC-19)', () => {
    const php = [
      '<?php',
      'class BasketController',
      '{',
      '    public function store(Request $request)',
      '    {',
      '    }',
      '    public function &__invoke()',
      '    {',
      '    }',
      '}',
    ].join('\n');

    it('finds the function line, including by-reference methods', () => {
      expect(findPhpMethodLine(php, 'store')).toBe(4);
      expect(findPhpMethodLine(php, '__invoke')).toBe(7);
    });

    it('is undefined when the method is absent', () => {
      expect(findPhpMethodLine(php, 'destroy')).toBeUndefined();
    });
  });

  describe('extractConsoleCommandNames (AC-20)', () => {
    it('reads $signature, protected $name, #[AsCommand] and Artisan::command', () => {
      const php = [
        '<?php',
        '#[AsCommand(name: "app:attr")]',
        'class A {',
        "    protected $signature = 'emails:send {user} {--queue}';",
        "    protected $name = 'legacy:name';",
        '}',
        "#[AsCommand('app:positional')]",
        "Artisan::command('inspire {--quiet}', function () {});",
        "protected $signature = '   ';",
      ].join('\n');
      expect(extractConsoleCommandNames(php)).toEqual([
        { name: 'app:attr', line: 2 },
        { name: 'emails:send', line: 4 },
        { name: 'legacy:name', line: 5 },
        { name: 'app:positional', line: 7 },
        { name: 'inspire', line: 8 },
      ]);
    });

    it('returns nothing for a file with no declarations', () => {
      expect(extractConsoleCommandNames('<?php echo 1;')).toEqual([]);
    });
  });

  describe('findScheduleLine (AC-20)', () => {
    const consolePhp = [
      '<?php',
      "Schedule::command('backup:run --only-db')->daily();",
      'Schedule::job(new App\\Jobs\\PruneUsers)->hourly();',
      'Schedule::job(PruneLogs::class)->hourly();',
    ].join('\n');

    it('finds the command after artisan, quoted or not', () => {
      expect(findScheduleLine(consolePhp, 'php artisan backup:run')).toBe(2);
      expect(findScheduleLine(consolePhp, "'/usr/bin/php' 'artisan' backup:run")).toBe(2);
    });

    it('finds a job class by its short name', () => {
      expect(findScheduleLine(consolePhp, 'App\\Jobs\\PruneLogs')).toBe(4);
    });

    it('finds a command scheduled by its declaring class', () => {
      const content = [
        '<?php',
        'use App\\Console\\Commands\\SendReports;',
        'Schedule::command(SendReports::class)->daily();',
      ].join('\n');
      expect(findScheduleLine(content, 'php artisan reports:send')).toBeUndefined();
      expect(findScheduleLine(content, 'php artisan reports:send', 'SendReports')).toBe(3);
      const kernel = '<?php\n\n$schedule->command(SendReports::class)->hourly();';
      expect(findScheduleLine(kernel, 'php artisan reports:send', 'SendReports')).toBe(3);
    });

    it('prefers the schedule call over the Artisan::command declaration', () => {
      const content = [
        '<?php',
        "Artisan::command('inspire', function () {});",
        "Artisan::command('other', fn () => 'inspire ');",
        "Schedule::command('inspire')->hourly();",
      ].join('\n');
      expect(findScheduleLine(content, 'php artisan inspire')).toBe(4);
      const declaredOnly = content.split('\n').slice(0, 3).join('\n');
      expect(findScheduleLine(declaredOnly, 'php artisan inspire')).toBe(2);
      expect(scheduledCommandName("'/usr/bin/php' 'artisan' inspire")).toBe('inspire');
    });

    it('is undefined for a task the file does not schedule, or an empty command', () => {
      expect(findScheduleLine(consolePhp, 'php artisan report:send')).toBeUndefined();
      expect(findScheduleLine(consolePhp, '')).toBeUndefined();
      expect(findScheduleLine(consolePhp, 'php artisan')).toBeUndefined();
    });
  });

  describe('resolveArtisanInvocation (AC-16, AC-17)', () => {
    const commands = (migrate: string, extra: Record<string, string> = {}) => ({
      migrate,
      ...extra,
    });

    it('derives the invocation from the migrate command', () => {
      expect(resolveArtisanInvocation(commands('vendor/bin/sail artisan migrate'))).toEqual({
        argv: ['vendor/bin/sail', 'artisan'],
      });
      expect(
        resolveArtisanInvocation(commands('docker compose exec app php artisan migrate')),
      ).toEqual({ argv: ['docker', 'compose', 'exec', '-T', 'app', 'php', 'artisan'] });
      expect(resolveArtisanInvocation(commands('php artisan migrate'))).toEqual({
        argv: ['php', 'artisan'],
      });
      expect(resolveArtisanInvocation(null)).toEqual({ argv: ['php', 'artisan'] });
      expect(resolveArtisanInvocation(undefined)).toEqual({ argv: ['php', 'artisan'] });
    });

    it('keeps an existing -T and handles docker-compose and ./artisan', () => {
      expect(
        resolveArtisanInvocation(commands('docker compose exec -T app php artisan migrate')),
      ).toEqual({ argv: ['docker', 'compose', 'exec', '-T', 'app', 'php', 'artisan'] });
      expect(resolveArtisanInvocation(commands('docker-compose exec app php artisan m'))).toEqual({
        argv: ['docker-compose', 'exec', '-T', 'app', 'php', 'artisan'],
      });
      expect(resolveArtisanInvocation(commands('docker exec app php artisan migrate'))).toEqual({
        argv: ['docker', 'exec', 'app', 'php', 'artisan'],
      });
      expect(resolveArtisanInvocation(commands('./artisan migrate'))).toEqual({
        argv: ['./artisan'],
      });
    });

    it('falls back to test, then dev, then host php artisan', () => {
      expect(
        resolveArtisanInvocation({
          migrate: 'pnpm migrate',
          test: 'vendor/bin/sail artisan test',
        }),
      ).toEqual({ argv: ['vendor/bin/sail', 'artisan'] });
      expect(
        resolveArtisanInvocation({
          migrate: 'make migrate',
          test: 'phpunit',
          dev: 'php artisan serve',
        }),
      ).toEqual({ argv: ['php', 'artisan'] });
      expect(resolveArtisanInvocation({ migrate: 'make migrate' })).toEqual({
        argv: ['php', 'artisan'],
      });
    });

    it('blocks on a placeholder service name and says how to fix it (AC-17)', () => {
      const result = resolveArtisanInvocation(
        commands('docker compose exec <php-service> php artisan migrate'),
      );
      expect('blocked' in result).toBe(true);
      const reason = (result as { blocked: string }).blocked;
      expect(reason).toContain('docker compose exec <php-service> php artisan migrate');
      expect(reason).toContain('migrate command');
      expect(reason).toContain('real service name');
    });

    it('adds -T to docker compose run and docker-compose run', () => {
      expect(
        resolveArtisanInvocation(commands('docker compose run --rm app php artisan migrate')),
      ).toEqual({ argv: ['docker', 'compose', 'run', '-T', '--rm', 'app', 'php', 'artisan'] });
      expect(resolveArtisanInvocation(commands('docker-compose run app php artisan m'))).toEqual({
        argv: ['docker-compose', 'run', '-T', 'app', 'php', 'artisan'],
      });
      expect(
        resolveArtisanInvocation(commands('docker-compose -f ci.yml exec app php artisan m')),
      ).toEqual({
        argv: ['docker-compose', '-f', 'ci.yml', 'exec', '-T', 'app', 'php', 'artisan'],
      });
      expect(resolveArtisanInvocation(commands('docker compose artisan'))).toEqual({
        argv: ['docker', 'compose', 'artisan'],
      });
    });

    it('drops leading NAME=value assignments', () => {
      expect(
        resolveArtisanInvocation(commands('APP_ENV=testing DB_HOST=db php artisan migrate')),
      ).toEqual({ argv: ['php', 'artisan'] });
      expect(resolveArtisanInvocation(commands('X=1 vendor/bin/sail artisan migrate'))).toEqual({
        argv: ['vendor/bin/sail', 'artisan'],
      });
    });

    it.each([
      'cd app && php artisan migrate',
      'true || php artisan migrate',
      'cd app; php artisan migrate',
      'echo | php artisan migrate',
    ])('blocks a shell operator before artisan: %s', (command) => {
      const result = resolveArtisanInvocation(commands(command));
      expect(result).toEqual({ blocked: expect.stringContaining(command) });
      expect((result as { blocked: string }).blocked).toContain('without a shell');
      expect((result as { blocked: string }).blocked).toContain('commands.migrate');
    });

    it('ignores a shell operator after artisan', () => {
      expect(
        resolveArtisanInvocation(commands('php artisan migrate && php artisan db:seed')),
      ).toEqual({
        argv: ['php', 'artisan'],
      });
    });

    it('maps a bare sail to vendor/bin/sail', () => {
      const invocation = resolveArtisanInvocation(commands('sail artisan migrate'));
      expect(invocation).toEqual({ argv: ['vendor/bin/sail', 'artisan'] });
      expect(artisanRunner((invocation as { argv: string[] }).argv)).toBe('sail');
    });

    it('ignores a placeholder after artisan, such as a test filter', () => {
      expect(
        resolveArtisanInvocation({ migrate: 'x', test: 'php artisan test --filter="<pattern>"' }),
      ).toEqual({ argv: ['php', 'artisan'] });
    });
  });

  describe('artisanRunner', () => {
    it('classifies sail, docker and host php', () => {
      expect(artisanRunner(['vendor/bin/sail', 'artisan'])).toBe('sail');
      expect(artisanRunner(['docker', 'compose', 'exec'])).toBe('docker');
      expect(artisanRunner(['docker-compose', 'exec'])).toBe('docker');
      expect(artisanRunner(['php', 'artisan'])).toBe('php');
      expect(artisanRunner([])).toBe('php');
    });
  });

  describe('createArtisanRouteResolver (AC-19)', () => {
    const files: Record<string, string> = {
      'app/Http/Controllers/BasketController.php':
        '<?php\nclass BasketController\n{\n    public function store() {}\n}\n',
      'app/Http/Controllers/ShowHome.php': '<?php\nclass ShowHome\n{\n}\n',
    };
    const psr4: Psr4Entry[] = [
      { prefix: 'App\\Http\\', dirs: ['missing/'] },
      { prefix: 'App\\', dirs: ['app/'] },
    ];

    it('returns the route-file and controller pointers, reading each file once', () => {
      const readFile = vi.fn((path: string) => files[path] ?? null);
      const resolve = createArtisanRouteResolver({
        psr4,
        staticRoutes: [
          { method: 'POST', uri: '/basket', file: 'routes/web.php', line: 7 },
          { method: 'GET', uri: 'basket', file: 'routes/web.php', line: 3 },
        ],
        readFile,
      });
      const record = {
        method: 'GET|HEAD',
        uri: 'basket',
        action: 'App\\Http\\Controllers\\BasketController@store',
      };
      expect(resolve(record)).toEqual([
        { file: 'routes/web.php', line: 3 },
        { file: 'app/Http/Controllers/BasketController.php', line: 4 },
      ]);
      resolve(record);
      expect(
        readFile.mock.calls.filter(([path]) => path.endsWith('BasketController.php')),
      ).toHaveLength(2);
    });

    it('cites the controller file with no line when the method is missing', () => {
      const resolve = createArtisanRouteResolver({
        psr4,
        staticRoutes: [],
        readFile: (path) => files[path] ?? null,
      });
      expect(
        resolve({ method: 'GET', uri: '/', action: 'App\\Http\\Controllers\\ShowHome' }),
      ).toEqual([{ file: 'app/Http/Controllers/ShowHome.php' }]);
    });

    it('matches the root uri and an Any or Match declaration, with or without a line', () => {
      const resolve = createArtisanRouteResolver({
        psr4,
        staticRoutes: [
          { method: 'ANY', uri: '/', file: 'routes/web.php' },
          { method: 'MATCH', uri: 'form/', file: 'routes/web.php', line: 9 },
        ],
        readFile: () => null,
      });
      expect(resolve({ method: 'GET|HEAD', uri: '/', action: 'Closure' })).toEqual([
        { file: 'routes/web.php' },
      ]);
      expect(resolve({ method: 'post', uri: '/form' })).toEqual([
        { file: 'routes/web.php', line: 9 },
      ]);
    });

    it('cites a route file only when one declaration matches, preferring web.php and api.php', () => {
      const route = (file: string, line: number) => ({ method: 'GET', uri: 'home', file, line });
      const resolveWith = (staticRoutes: ReturnType<typeof route>[]) =>
        createArtisanRouteResolver({ psr4, staticRoutes, readFile: () => null })({
          method: 'GET|HEAD',
          uri: 'home',
          action: 'Closure',
        });

      expect(resolveWith([route('routes/admin.php', 2), route('routes/web.php', 5)])).toEqual([
        { file: 'routes/web.php', line: 5 },
      ]);
      expect(resolveWith([route('routes/web.php', 1), route('routes/api.php', 4)])).toEqual([]);
      expect(resolveWith([route('routes/a.php', 1), route('routes/b.php', 2)])).toEqual([]);
    });

    it('returns nothing for a closure the static scan cannot see', () => {
      const resolve = createArtisanRouteResolver({
        psr4,
        staticRoutes: [{ method: 'GET', uri: 'other', file: 'routes/web.php', line: 1 }],
        readFile: () => null,
      });
      expect(resolve({ method: 'GET', uri: 'telescope', action: 'Closure' })).toEqual([]);
      expect(
        resolve({ method: 'GET', uri: 'gone', action: 'App\\Http\\Controllers\\Gone@x' }),
      ).toEqual([]);
    });
  });
});
