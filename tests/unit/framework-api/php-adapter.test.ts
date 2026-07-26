import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  classRecords,
  normalizeComposerVersion,
  phpFrameworkApiAdapter,
} from '@/framework-api/adapters/php.js';
import {
  phpDeprecationTags,
  scanPhpFile,
  stripDocComment,
} from '@/framework-api/adapters/php-scan.js';
import { queryFrameworkApi } from '@/framework-api/query.js';
import type { FrameworkApiAdapterInput, FrameworkApiIndex } from '@/framework-api/types.js';

let root: string;

/** Install a composer package with the given source files, composer-2 style. */
function install(
  name: string,
  version: string,
  files: Record<string, string>,
  options: { reference?: string; installPath?: string; lockOnly?: boolean } = {},
): FrameworkApiAdapterInput {
  const composerDir = join(root, 'vendor', 'composer');
  mkdirSync(composerDir, { recursive: true });
  const entry = {
    name,
    version,
    'install-path': options.installPath ?? `../${name}`,
    dist: options.reference === undefined ? undefined : { reference: options.reference },
  };
  if (options.lockOnly === true) {
    writeFileSync(join(root, 'composer.lock'), JSON.stringify({ packages: [{ name, version }] }));
  } else {
    writeFileSync(join(composerDir, 'installed.json'), JSON.stringify({ packages: [entry] }));
  }
  const dir = join(root, 'vendor', name);
  for (const [relative, contents] of Object.entries(files)) {
    const target = join(dir, relative);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, contents);
  }
  return {
    projectRoot: root,
    searchRoot: root,
    package: name,
    version: normalizeComposerVersion(version),
    packageDir: dir,
  };
}

/** Wrap an adapter result's symbols in a minimal index, so the query path can be used. */
function asIndex(input: FrameworkApiAdapterInput): FrameworkApiIndex {
  const result = phpFrameworkApiAdapter.index(input);
  if (!result.indexed) {
    throw new Error(`expected an indexed result, got ${result.reason}: ${result.detail}`);
  }
  return {
    schema_version: 1,
    header: { generated_at: '2026-07-26T00:00:00.000Z', schema_version: 1 },
    packages: [
      {
        package: input.package,
        version: input.version,
        ecosystem: 'php',
        root: '.',
        content_hash: 'sha256:test',
        sources: result.sources,
        symbols: result.symbols,
      },
    ],
    blocked: [],
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-framework-api-php-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('normalizeComposerVersion', () => {
  it("drops composer's leading v so the stored version reads like a plan writes it", () => {
    expect(normalizeComposerVersion('v13.18.0')).toBe('13.18.0');
    expect(normalizeComposerVersion('13.18.0')).toBe('13.18.0');
  });
});

describe('stripDocComment', () => {
  it('removes the comment decoration and keeps the text', () => {
    expect(stripDocComment('/**\n * Line one.\n * @deprecated use other()\n */')).toBe(
      'Line one.\n@deprecated use other()',
    );
  });
});

describe('scanPhpFile', () => {
  it('reads the namespace, the class and its methods', () => {
    const scan = scanPhpFile(`<?php

namespace Acme\\Support;

class Str
{
    public static function random(int $length = 16): string
    {
        return '';
    }

    protected function hidden(): void
    {
    }
}
`);
    expect(scan.namespace).toBe('Acme\\Support');
    expect(scan.classes).toHaveLength(1);
    expect(scan.classes[0]?.name).toBe('Str');
    expect(scan.classes[0]?.methods.map((method) => method.name)).toEqual(['random', 'hidden']);
  });

  it('classifies interfaces, traits and enums', () => {
    const scan = scanPhpFile(
      `<?php\ninterface Contract {}\ntrait Helper {}\nenum Status {}\nfinal readonly class Value {}\n`,
    );
    expect(scan.classes.map((entry) => [entry.name, entry.kind])).toEqual([
      ['Contract', 'interface'],
      ['Helper', 'type'],
      ['Status', 'enum'],
      ['Value', 'class'],
    ]);
  });

  it('marks a Macroable or magic-method class dynamic', () => {
    const macroable = scanPhpFile(`<?php\nclass Str\n{\n    use Macroable;\n}\n`);
    const magic = scanPhpFile(`<?php\nclass Bag\n{\n    public function __get($key) {}\n}\n`);
    const plain = scanPhpFile(`<?php\nclass Plain\n{\n    public function go() {}\n}\n`);
    expect(macroable.classes[0]?.dynamic).toBe(true);
    expect(magic.classes[0]?.dynamic).toBe(true);
    expect(plain.classes[0]?.dynamic).toBe(false);
  });

  it("reads a facade's @method static promises (AC-3)", () => {
    const scan = scanPhpFile(`<?php

namespace Acme\\Facades;

/**
 * @method static mixed get(string $key, mixed $default = null)
 * @method static bool put(string $key, mixed $value)
 */
class Cache extends Facade
{
    protected static function getFacadeAccessor() { return 'cache'; }
}
`);
    expect(scan.classes[0]?.documentedMethods).toEqual(['get', 'put']);
    expect(scan.classes[0]?.dynamic).toBe(true);
  });

  it('attributes a method with no class before it to nothing', () => {
    const scan = scanPhpFile(`<?php\nfunction helper() {}\nclass Late {}\n`);
    expect(scan.classes[0]?.methods).toEqual([]);
  });

  it('reads a truncated class declaration that never opens a body', () => {
    const scan = scanPhpFile('<?php\n\nnamespace Acme;\n\nclass Trailing');
    expect(scan.classes[0]?.name).toBe('Trailing');
    expect(scan.classes[0]?.dynamic).toBe(false);
  });

  it('reads an abstract method that has no body', () => {
    const scan = scanPhpFile(
      `<?php\nabstract class Base\n{\n    abstract public function go(): void;\n}\n`,
    );
    expect(scan.classes[0]?.methods.map((method) => method.name)).toEqual(['go']);
    expect(scan.classes[0]?.methods[0]?.body).toBe('');
  });

  it('reads an unterminated body to the end of the file rather than dropping the method', () => {
    const scan = scanPhpFile(`<?php\nclass Broken\n{\n    public function go() { if (true) {\n`);
    expect(scan.classes[0]?.methods[0]?.body).toContain('if (true)');
  });
});

describe('phpDeprecationTags', () => {
  it('reads the #[\\Deprecated] attribute first, with its message and since (AC-2)', () => {
    const tags = phpDeprecationTags({
      doc: null,
      attributes: '#[\\Deprecated(message: "use random() instead", since: "13.1")]',
    });
    expect(tags).toEqual([
      { name: 'deprecated', text: [{ text: 'use random() instead' }] },
      { name: 'since', text: [{ text: '13.1' }] },
    ]);
  });

  it('reads a bare attribute with no arguments', () => {
    expect(phpDeprecationTags({ doc: null, attributes: '#[Deprecated]' })).toEqual([
      { name: 'deprecated', text: [{ text: '' }] },
    ]);
  });

  it('falls back to the @deprecated docblock', () => {
    expect(
      phpDeprecationTags({ doc: 'Does a thing.\n@deprecated 12.4 use other()', attributes: '' }),
    ).toEqual([{ name: 'deprecated', text: [{ text: '12.4 use other()' }] }]);
  });

  it('ignores a docblock with no deprecation and falls through to trigger_error', () => {
    expect(
      phpDeprecationTags({
        doc: 'Just a description.',
        attributes: '',
        body: "{ trigger_error('go() is gone', E_USER_DEPRECATED); }",
      }),
    ).toEqual([{ name: 'deprecated', text: [{ text: 'go() is gone' }] }]);
  });

  it('returns nothing when no marker is present at all', () => {
    expect(phpDeprecationTags({ doc: 'Fine.', attributes: '', body: '{}' })).toEqual([]);
  });
});

describe('classRecords', () => {
  it('stores the class, its deprecated members, the facade promises and a wildcard', () => {
    const scan = scanPhpFile(`<?php

namespace Acme;

/**
 * @method static void promised()
 */
class Thing
{
    /** @deprecated 2.0 use fresh() */
    public function stale(): void {}

    public function fine(): void {}
}
`);
    const records = classRecords(scan.namespace, scan.classes[0]!);
    const names = records.map((record) => record.name);
    expect(names).toContain('Acme\\Thing');
    expect(names).toContain('Acme\\Thing::stale');
    expect(names).toContain('Acme\\Thing::promised');
    expect(names).toContain('Acme\\Thing.*');
    // A member with no deprecation is not stored: the wildcard already answers for it.
    expect(names).not.toContain('Acme\\Thing::fine');
  });

  it('names an unnamespaced class by itself', () => {
    const scan = scanPhpFile(`<?php\nclass Loose {}\n`);
    expect(classRecords(null, scan.classes[0]!)[0]?.name).toBe('Loose');
  });
});

describe('phpFrameworkApiAdapter.resolveInstalled', () => {
  it('reads the version composer installed, not a manifest range (FR-2)', () => {
    install('acme/pkg', 'v3.4.5', { 'src/Thing.php': '<?php\nclass Thing {}\n' });
    expect(phpFrameworkApiAdapter.resolveInstalled(root, 'acme/pkg')).toEqual({
      dir: join(root, 'vendor', 'acme/pkg'),
      version: '3.4.5',
    });
  });

  it('falls back to composer.lock when installed.json is absent', () => {
    install(
      'acme/pkg',
      '1.0.0',
      { 'src/Thing.php': '<?php\nclass Thing {}\n' },
      { lockOnly: true },
    );
    expect(phpFrameworkApiAdapter.resolveInstalled(root, 'acme/pkg')?.version).toBe('1.0.0');
  });

  it('returns null for a package that is not installed at all', () => {
    expect(phpFrameworkApiAdapter.resolveInstalled(root, 'ghost/pkg')).toBeNull();
  });

  it('returns null when the manifest names a package that vendor/ does not hold', () => {
    const composerDir = join(root, 'vendor', 'composer');
    mkdirSync(composerDir, { recursive: true });
    writeFileSync(
      join(composerDir, 'installed.json'),
      JSON.stringify({ packages: [{ name: 'acme/pkg', version: '1.0.0' }] }),
    );
    expect(phpFrameworkApiAdapter.resolveInstalled(root, 'acme/pkg')).toBeNull();
  });

  it('reads a composer-1 bare-array installed.json', () => {
    const composerDir = join(root, 'vendor', 'composer');
    mkdirSync(composerDir, { recursive: true });
    const dir = join(root, 'vendor', 'acme/pkg');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(composerDir, 'installed.json'),
      JSON.stringify([{ name: 'acme/pkg', version: '2.0.0' }]),
    );
    expect(phpFrameworkApiAdapter.resolveInstalled(root, 'acme/pkg')?.version).toBe('2.0.0');
  });

  it('returns null when the vendor path is a file rather than a package directory', () => {
    const composerDir = join(root, 'vendor', 'composer');
    mkdirSync(composerDir, { recursive: true });
    writeFileSync(
      join(composerDir, 'installed.json'),
      JSON.stringify({ packages: [{ name: 'acme', version: '1.0.0', 'install-path': '../acme' }] }),
    );
    writeFileSync(join(root, 'vendor', 'acme'), 'not a directory');
    expect(phpFrameworkApiAdapter.resolveInstalled(root, 'acme')).toBeNull();
  });
});

describe('phpFrameworkApiAdapter.contentHash', () => {
  it('is stable for an unchanged install (FR-13)', () => {
    const input = install(
      'acme/pkg',
      '1.0.0',
      { 'src/A.php': '<?php\nclass A {}\n' },
      {
        reference: 'abc123',
      },
    );
    expect(phpFrameworkApiAdapter.contentHash(input)).toBe(
      phpFrameworkApiAdapter.contentHash(input),
    );
  });

  it('changes when the installed reference changes', () => {
    const input = install(
      'acme/pkg',
      '1.0.0',
      { 'src/A.php': '<?php\nclass A {}\n' },
      {
        reference: 'abc123',
      },
    );
    const before = phpFrameworkApiAdapter.contentHash(input);
    install('acme/pkg', '1.0.0', { 'src/A.php': '<?php\nclass A {}\n' }, { reference: 'def456' });
    expect(phpFrameworkApiAdapter.contentHash(input)).not.toBe(before);
  });

  it('still hashes a package with no recorded reference', () => {
    const input = install('acme/pkg', '1.0.0', { 'src/A.php': '<?php\nclass A {}\n' });
    expect(phpFrameworkApiAdapter.contentHash(input)).toMatch(/^sha256:/);
  });
});

describe('phpFrameworkApiAdapter.index', () => {
  it('records classes and their deprecated members (AC-1, AC-2)', () => {
    const input = install('acme/pkg', 'v2.1.0', {
      'src/Support/Str.php': `<?php

namespace Acme\\Support;

class Str
{
    #[\\Deprecated(message: "use random() instead", since: "2.0")]
    public static function rand(int $length): string { return ''; }

    public static function random(int $length): string { return ''; }
}
`,
    });
    const result = phpFrameworkApiAdapter.index(input);
    expect(result.indexed).toBe(true);
    if (!result.indexed) {
      return;
    }
    const deprecated = result.symbols.find((record) => record.name === 'Acme\\Support\\Str::rand');
    expect(deprecated).toMatchObject({
      deprecated: true,
      message: 'use random() instead.',
      since: '2.0',
      provenance: 'asserted',
    });
    expect(result.sources).toEqual(['vendor/acme/pkg']);
  });

  it('blocks a package with no readable PHP sources', () => {
    const input = install('acme/pkg', '1.0.0', { 'README.md': '# nothing here' });
    const result = phpFrameworkApiAdapter.index(input);
    expect(result).toMatchObject({ indexed: false, reason: 'no-types' });
  });

  it('skips vendored and test directories', () => {
    const input = install('acme/pkg', '1.0.0', {
      'src/Real.php': '<?php\nclass Real {}\n',
      'tests/Fake.php': '<?php\nclass Fake {}\n',
      'vendor/other/Nested.php': '<?php\nclass Nested {}\n',
    });
    const result = phpFrameworkApiAdapter.index(input);
    expect(result.indexed).toBe(true);
    if (!result.indexed) {
      return;
    }
    const names = result.symbols.map((record) => record.name);
    expect(names).toContain('Real');
    expect(names).not.toContain('Fake');
    expect(names).not.toContain('Nested');
  });
});

describe('the PHP entry answered through the query (AC-3)', () => {
  it('resolves a facade member from its @method docblock rather than __callStatic', () => {
    const input = install('acme/pkg', '1.0.0', {
      'src/Facades/Cache.php': `<?php

namespace Acme\\Facades;

/**
 * @method static mixed get(string $key)
 */
class Cache extends Facade
{
    public static function __callStatic($method, $args) {}
}
`,
    });
    const index = asIndex(input);
    expect(queryFrameworkApi(index, 'acme/pkg', 'Cache::get').verdict).toBe('live');
    expect(queryFrameworkApi(index, 'acme/pkg', 'Acme\\Facades\\Cache::get').verdict).toBe('live');
  });

  it('answers unknown-dynamic — never absent — for a Macroable member', () => {
    const input = install('acme/pkg', '1.0.0', {
      'src/Str.php': `<?php\n\nnamespace Acme;\n\nclass Str\n{\n    use Macroable;\n}\n`,
    });
    const index = asIndex(input);
    expect(queryFrameworkApi(index, 'acme/pkg', 'Str::somethingAMacroAdded').verdict).toBe(
      'unknown-dynamic',
    );
  });

  it('still asserts a class that genuinely is not there', () => {
    const input = install('acme/pkg', '1.0.0', {
      'src/Str.php': '<?php\n\nnamespace Acme;\n\nclass Str {}\n',
    });
    const index = asIndex(input);
    const result = queryFrameworkApi(index, 'acme/pkg', 'Strr');
    expect(result.verdict).toBe('absent');
    expect(result.nearest).toBe('Acme\\Str');
  });
});
