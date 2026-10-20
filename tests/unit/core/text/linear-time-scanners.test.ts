import { describe, expect, it } from 'vitest';

import { detectBoundariesInSource } from '@/compliance/boundary/detector';
import { slugifySpec } from '@/compliance/constants';
import { applyMetadataFilters } from '@/context/metadata-filter';
import { findTouchedFilePaths } from '@/context/turn-summarizer';
import type { Chunk } from '@/context/types';
import { slugifyAscii, trimChar, trimLeadingChar, trimTrailingChar } from '@/core/text/trim-char';
import { extractModuleNamesFromRequest, findBracePlaceholders } from '@/document/workflow';
import { slugify as pentestSlugify } from '@/pentest/shared';
import { deriveSlug } from '@/planning/slug-utils';
import { ConditionalSectionProcessor } from '@/skills/conditional-processor';
import { findPathSegmentsInRun } from '@/token-efficiency/service';
import { validateErrorCatalogMarkdown } from '@/validators/markdown-validators/error-catalog-md';
import { containsInOrder, validateAcStatements } from '@/validators/markdown-validators/shared';
import { extractSourceReportPath } from '@/workflows/pentest-retest';

const LONG = 50_000;
const FAST_MS = 1_000;

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function randomStrings(alphabet: string[], count: number, maxLength: number, seed: number) {
  const next = seededRandom(seed);
  const out: string[] = [];
  for (let n = 0; n < count; n += 1) {
    const length = Math.floor(next() * (maxLength + 1));
    let text = '';
    for (let i = 0; i < length; i += 1) text += alphabet[Math.floor(next() * alphabet.length)];
    out.push(text);
  }
  return out;
}

function timed<T>(run: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = run();
  return { value, ms: performance.now() - start };
}

describe('trim helpers', () => {
  it('trim the given character from either end only', () => {
    expect(trimChar('--a-b--', '-')).toBe('a-b');
    expect(trimChar('----', '-')).toBe('');
    expect(trimChar('', '-')).toBe('');
    expect(trimChar('abc', '-')).toBe('abc');
    expect(trimLeadingChar('//a/', '/')).toBe('a/');
    expect(trimTrailingChar('//a//', '/')).toBe('//a');
  });

  it('match the old anchored dash-trim regex on random inputs', () => {
    for (const text of randomStrings(['-', 'a', '-', ' '], 2_000, 12, 7)) {
      expect(trimChar(text, '-')).toBe(text.replace(/^-+|-+$/g, ''));
      expect(trimTrailingChar(text, '-')).toBe(text.replace(/-+$/g, ''));
    }
  });

  it('slugifyAscii matches the old slug chain and stays fast on long dash runs', () => {
    for (const text of randomStrings(['-', 'A', 'z', '9', ' ', '_', '/'], 2_000, 14, 11)) {
      expect(slugifyAscii(text)).toBe(
        text
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, ''),
      );
    }
    const adversarial = `${'-'.repeat(LONG)}a${' '.repeat(LONG)}!`;
    const { value, ms } = timed(() => slugifyAscii(adversarial));
    expect(value).toBe('a');
    expect(ms).toBeLessThan(FAST_MS);
  });

  it('slug callers keep their outputs', () => {
    expect(slugifySpec('docs/specs/Login Flow.md')).toBe('login-flow');
    expect(pentestSlugify('  Auth -- Review!! ')).toBe('auth-review');
    expect(deriveSlug('F-1', 'Add  login -- page')).toBe('f-1-add-login-page');
    expect(deriveSlug('---', null)).toBe('planning-manifest');
    expect(deriveSlug('a'.repeat(79), '-b')).toBe('a'.repeat(79));
    const { ms } = timed(() => deriveSlug('x', `${'-'.repeat(LONG)}!`));
    expect(ms).toBeLessThan(FAST_MS);
  });
});

describe('boundary union detection', () => {
  it('reads union members after the equals sign', () => {
    const source = [
      '// @boundary Status producer:a.md consumer:b.md',
      "type Status =   'open' | 'closed'  ;",
    ].join('\n');
    expect(detectBoundariesInSource('x.ts', source)[0]!.output_states).toEqual(['open', 'closed']);
  });

  it('finishes fast on a long run of spaces with no terminator', () => {
    const source = `// @boundary Status\ntype Status =${' '.repeat(LONG)}x`;
    const { value, ms } = timed(() => detectBoundariesInSource('x.ts', source));
    expect(value[0]!.output_states).toEqual([]);
    expect(ms).toBeLessThan(FAST_MS);
  });
});

describe('module path prefix filter', () => {
  const chunk = (source_file: string): Chunk => ({ id: source_file, source_file }) as Chunk;

  it('strips trailing slashes from the prefix', () => {
    const chunks = ['src/a/x.ts', 'src/a/y.ts', 'src/a/z.ts', 'lib/q.ts'].map(chunk);
    const result = applyMetadataFilters(
      chunks,
      [{ type: 'module_path_prefix', value: './src/a///' }],
      { minFilteredSize: 1 },
    );
    expect(result.chunks.map((c) => c.source_file)).toEqual([
      'src/a/x.ts',
      'src/a/y.ts',
      'src/a/z.ts',
    ]);
  });

  it('finishes fast on a long slash run', () => {
    const { ms } = timed(() =>
      applyMetadataFilters(
        [chunk('src/a.ts')],
        [{ type: 'module_path_prefix', value: `${'/'.repeat(LONG)}x` }],
        { minFilteredSize: 1 },
      ),
    );
    expect(ms).toBeLessThan(FAST_MS);
  });
});

describe('touched file paths', () => {
  const OLD = /(?:src|app|lib|tests?|routes?|config|docs?)\/[\w/.-]+\.\w{1,6}/g;

  it('matches the old pattern on random inputs', () => {
    const alphabet = ['src/', 'app/', 'tests/', 'doc', 'a', '.', 'ts', '/', '-', ' ', 'x'];
    for (const text of randomStrings(alphabet, 3_000, 10, 3)) {
      expect(findTouchedFilePaths(text)).toEqual(text.match(OLD) ?? []);
    }
  });

  it('keeps the expected paths', () => {
    expect(findTouchedFilePaths('edited src/a/b.ts and tests/x.test.ts, docs/readme')).toEqual([
      'src/a/b.ts',
      'tests/x.test.ts',
    ]);
    expect(findTouchedFilePaths('src/a.typescript')).toEqual(['src/a.typesc']);
  });

  it('finishes fast on many repeated path segments without an extension', () => {
    const { value, ms } = timed(() => findTouchedFilePaths(`src/${'app/'.repeat(LONG / 4)}`));
    expect(value).toEqual([]);
    expect(ms).toBeLessThan(FAST_MS);
  });
});

describe('file-like segments', () => {
  const OLD = /(?:\.?\/?[\w@.-]+\/)+[\w.-]+(?:\.[a-zA-Z0-9]+)?/g;
  const RUN = /[\w@./-]+/g;
  const segments = (line: string) =>
    (line.match(RUN) ?? []).flatMap((run) => findPathSegmentsInRun(run));

  it('matches the old pattern on random inputs', () => {
    const alphabet = ['a', '-', '.', '/', '@', ' ', 'b', '/'];
    for (const text of randomStrings(alphabet, 5_000, 12, 5)) {
      expect(segments(text)).toEqual(text.match(OLD) ?? []);
    }
  });

  it('keeps ordinary paths', () => {
    expect(segments('see ./src/a.ts and @scope/pkg/index.js or /abs/x')).toEqual([
      './src/a.ts',
      '@scope/pkg/index.js',
      '/abs/x',
    ]);
  });

  it('finishes fast on long dash runs', () => {
    const first = timed(() => segments(`${'-'.repeat(LONG)}/`));
    expect(first.ms).toBeLessThan(FAST_MS);
    const second = timed(() => segments(`${'-/'.repeat(LONG / 2)}@`));
    expect(second.ms).toBeLessThan(FAST_MS);
  });
});

describe('brace placeholders', () => {
  const OLD = /\{[^}]+\}/g;

  it('matches the old pattern on random inputs', () => {
    for (const text of randomStrings(['{', '}', 'a', ' '], 3_000, 12, 9)) {
      expect(findBracePlaceholders(text)).toEqual(text.match(OLD) ?? []);
    }
  });

  it('finishes fast on many open braces', () => {
    const { value, ms } = timed(() => findBracePlaceholders('{{'.repeat(LONG)));
    expect(value).toEqual([]);
    expect(ms).toBeLessThan(FAST_MS);
  });
});

describe('module names from a request', () => {
  const OLD = (requestText: string): string[] => {
    const match = /\bmodules?\s*(?:are|is|:)\s*([\w][\w\s,]*)/i.exec(requestText);
    if (!match?.[1]) return [];
    return match[1]
      .split(/,|\s+and\s+/i)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);
  };

  it('matches the old split on random inputs', () => {
    const alphabet = ['and', 'AND', ' ', '  ', ',', 'ab', 'x', '\t'];
    for (const tail of randomStrings(alphabet, 3_000, 10, 13)) {
      const text = `modules: a${tail}`;
      expect(extractModuleNamesFromRequest(text)).toEqual(OLD(text));
    }
  });

  it('keeps the expected names', () => {
    expect(extractModuleNamesFromRequest('the modules are auth, billing and api')).toEqual([
      'auth',
      'billing',
      'api',
    ]);
    expect(extractModuleNamesFromRequest(undefined)).toEqual([]);
    expect(extractModuleNamesFromRequest('no list here')).toEqual([]);
  });

  it('finishes fast on a long run of spaces', () => {
    const { ms } = timed(() => extractModuleNamesFromRequest(`modules: a${' '.repeat(LONG)}b`));
    expect(ms).toBeLessThan(FAST_MS);
  });
});

describe('source report path', () => {
  const OLD = (text: string) => text.match(/docs\/pentest\/[^\s)]+(?:\.md|\.json)/)?.[0] ?? null;

  it('matches the old pattern on random inputs', () => {
    const alphabet = ['docs/pentest/', 'a', '.md', '.json', '.', ' ', ')', 'x'];
    for (const text of randomStrings(alphabet, 3_000, 8, 17)) {
      expect(extractSourceReportPath(text)).toBe(OLD(text));
    }
  });

  it('keeps the expected path', () => {
    expect(extractSourceReportPath('retest docs/pentest/2026-01-01.md please')).toBe(
      'docs/pentest/2026-01-01.md',
    );
    expect(extractSourceReportPath('(docs/pentest/r.json)')).toBe('docs/pentest/r.json');
    expect(extractSourceReportPath('nothing')).toBeNull();
  });

  it('finishes fast on many repeated prefixes', () => {
    const { value, ms } = timed(() => extractSourceReportPath('docs/pentest/'.repeat(LONG / 10)));
    expect(value).toBeNull();
    expect(ms).toBeLessThan(FAST_MS);
  });
});

describe('conditional sections', () => {
  const processor = new ConditionalSectionProcessor();
  const OLD = (body: string, frameworks: string[]) => {
    const set = new Set(frameworks.map((f) => f.toLowerCase()));
    return body.replace(
      /<!-- if:(\w+) -->([\s\S]*?)<!-- endif -->/g,
      (_m, framework: string, content: string) => (set.has(framework.toLowerCase()) ? content : ''),
    );
  };

  it('matches the old replacement on random inputs', () => {
    const alphabet = [
      '<!-- if:react -->',
      '<!-- if:vue -->',
      '<!-- endif -->',
      'x',
      '<!-- if: -->',
    ];
    for (const body of randomStrings(alphabet, 3_000, 8, 19)) {
      expect(processor.process(body, ['React'])).toBe(OLD(body, ['React']));
    }
  });

  it('keeps matching sections and drops others', () => {
    const body = 'a<!-- if:react -->R<!-- endif -->b<!-- if:vue -->V<!-- endif -->c';
    expect(processor.process(body, ['react'])).toBe('aRbc');
    expect(processor.process('<!-- if:react -->$&<!-- endif -->', ['react'])).toBe('$&');
  });

  it('finishes fast on many unclosed openers', () => {
    const body = `<!-- if:0 -->${'<!-- if:0 -->a'.repeat(LONG / 10)}`;
    const { value, ms } = timed(() => processor.process(body, ['0']));
    expect(value).toBe(body);
    expect(ms).toBeLessThan(FAST_MS);
  });
});

describe('markdown validators', () => {
  it('containsInOrder matches the old Given/When/Then test', () => {
    const alphabet = ['Given', 'When', 'Then', ' ', 'x'];
    for (const text of randomStrings(alphabet, 2_000, 6, 23)) {
      expect(containsInOrder(text, ['Given', 'When', 'Then'])).toBe(
        /Given[\s\S]*When[\s\S]*Then/m.test(text),
      );
    }
  });

  it('accepts Given/When/Then and finishes fast on repeated words', () => {
    expect(validateAcStatements('Given a user When they log in Then it works').valid).toBe(true);
    const { value, ms } = timed(() => validateAcStatements(`Given${'When'.repeat(LONG / 4)}`));
    expect(value.valid).toBe(false);
    expect(ms).toBeLessThan(FAST_MS);
  });

  it('still recognises the error heading and finishes fast on long spaces', () => {
    const base =
      '## Error Code Format\n## Errors\n**Code** **User-Facing Message** **Trigger** **Recovery Path**\n';
    expect(validateErrorCatalogMarkdown(`${base}### AUTH-001: Token expired\n`).valid).toBe(true);
    expect(validateErrorCatalogMarkdown(`${base}### AUTH-001:\n`).valid).toBe(false);
    const { value, ms } = timed(() =>
      validateErrorCatalogMarkdown(
        `${base}### AUTH-001:${' '.repeat(LONG)}${String.fromCharCode(0x2028)}`,
      ),
    );
    expect(value.valid).toBe(false);
    expect(ms).toBeLessThan(FAST_MS);
  });
});
