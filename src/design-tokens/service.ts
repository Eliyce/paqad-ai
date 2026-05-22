import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type {
  DesignTokenDocArtifact,
  DesignTokenLeaf,
  DesignTokensDocument,
  ThemeExportArtifact,
} from '@/core/types/design-tokens.js';
import type { Stack } from '@/core/types/domain.js';
import { SchemaValidator } from '@/validators/validator.js';

import { DEFAULT_DESIGN_TOKENS } from './defaults.js';

interface FlattenedToken {
  key: string;
  type: string;
  value: unknown;
  description?: string;
}

export class DesignTokenService {
  constructor(private readonly validator = new SchemaValidator()) {}

  async seed(projectRoot: string): Promise<void> {
    const target = join(projectRoot, PATHS.DESIGN_TOKENS_FILE);

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(DEFAULT_DESIGN_TOKENS, null, 2)}\n`, {
      flag: 'wx',
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    });
  }

  async load(projectRoot: string): Promise<DesignTokensDocument> {
    const target = join(projectRoot, PATHS.DESIGN_TOKENS_FILE);
    const raw = await readFile(target, 'utf8');
    const parsed = JSON.parse(raw) as DesignTokensDocument;
    const validation = this.validator.validate('design-tokens', parsed);

    if (!validation.valid) {
      throw new Error(
        `Invalid design token file: ${validation.errors.map((error) => error.message).join('; ')}`,
      );
    }

    return parsed;
  }

  async generateDocs(projectRoot: string): Promise<DesignTokenDocArtifact[]> {
    const tokens = await this.load(projectRoot);
    const flattened = flattenTokens(tokens);
    const sections = groupTokens(flattened);

    return [
      {
        path: join(PATHS.DESIGN_SYSTEM_DIR, 'tokens.md'),
        content: buildTokensMarkdown(flattened),
      },
      {
        path: join(PATHS.DESIGN_SYSTEM_DIR, 'components.md'),
        content: buildSectionMarkdown('Component Defaults', sections.components),
      },
      {
        path: join(PATHS.DESIGN_SYSTEM_DIR, 'motion.md'),
        content: buildSectionMarkdown('Motion', sections.motion),
      },
      {
        path: join(PATHS.DESIGN_SYSTEM_DIR, 'accessibility.md'),
        content: buildSectionMarkdown('Accessibility', sections.accessibility),
      },
      {
        path: join(PATHS.DESIGN_SYSTEM_DIR, 'responsive.md'),
        content: buildResponsiveMarkdown(sections.spacing),
      },
      {
        path: join(PATHS.DESIGN_SYSTEM_DIR, 'patterns.md'),
        content: buildPatternsMarkdown(flattened),
      },
    ];
  }

  async writeDocs(projectRoot: string): Promise<string[]> {
    const docs = await this.generateDocs(projectRoot);

    await Promise.all(
      docs.map(async (artifact) => {
        const target = join(projectRoot, artifact.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, artifact.content);
      }),
    );

    return docs.map((artifact) => artifact.path);
  }

  async exportTheme(projectRoot: string, stack: Stack | null): Promise<ThemeExportArtifact[]> {
    const flattened = flattenTokens(await this.load(projectRoot));
    const cssVariables = flattened
      .map((token) => `  --${token.key.replace(/\./g, '-')}: ${stringifyValue(token.value)};`)
      .join('\n');
    const tailwindEntries = flattened
      .filter((token) => token.type === 'color')
      .map((token) => `    '${token.key.replace(/\./g, '-')}' : '${stringifyValue(token.value)}',`)
      .join('\n');
    const flutterEntries = flattened
      .filter((token) => token.type === 'color')
      .map(
        (token) =>
          `  static const String ${toIdentifier(token.key)} = '${stringifyValue(token.value)}';`,
      )
      .join('\n');

    const artifacts: ThemeExportArtifact[] = [
      {
        path: '.paqad/theme/theme.css',
        content: `:root {\n${cssVariables}\n}\n`,
      },
      {
        path: '.paqad/theme/tailwind.theme.cjs',
        content:
          'module.exports = {\n  theme: {\n    extend: {\n      colors: {\n' +
          `${tailwindEntries}\n` +
          '      },\n    },\n  },\n};\n',
      },
    ];

    if (stack === 'flutter') {
      artifacts.push({
        path: '.paqad/theme/theme_tokens.dart',
        content: 'class ThemeTokens {\n' + `${flutterEntries}\n` + '}\n',
      });
    }

    return artifacts;
  }

  async writeThemeExports(projectRoot: string, stack: Stack | null): Promise<string[]> {
    const artifacts = await this.exportTheme(projectRoot, stack);

    await Promise.all(
      artifacts.map(async (artifact) => {
        const target = join(projectRoot, artifact.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, artifact.content);
      }),
    );

    return artifacts.map((artifact) => artifact.path);
  }
}

function flattenTokens(
  node: DesignTokensDocument,
  pathSegments: string[] = [],
  tokens: FlattenedToken[] = [],
): FlattenedToken[] {
  for (const [key, value] of Object.entries(node)) {
    const nextPath = [...pathSegments, key];

    if (isTokenLeaf(value)) {
      tokens.push({
        key: nextPath.join('.'),
        type: value.$type,
        value: value.$value,
        description: value.$description,
      });
      continue;
    }

    flattenTokens(value, nextPath, tokens);
  }

  return tokens.sort((left, right) => left.key.localeCompare(right.key));
}

function isTokenLeaf(value: unknown): value is DesignTokenLeaf {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$value' in value &&
    '$type' in value &&
    typeof (value as Record<string, unknown>).$type === 'string'
  );
}

function groupTokens(tokens: FlattenedToken[]): Record<string, FlattenedToken[]> {
  return {
    components: tokens.filter((token) => token.key.startsWith('components.')),
    motion: tokens.filter((token) => token.key.startsWith('motion.')),
    accessibility: tokens.filter((token) => token.key.startsWith('accessibility.')),
    spacing: tokens.filter((token) => token.key.startsWith('spacing.')),
  };
}

function buildTokensMarkdown(tokens: FlattenedToken[]): string {
  const lines = ['# Design Tokens', '', '| Token | Type | Value |', '| --- | --- | --- |'];

  for (const token of tokens) {
    lines.push(`| \`${token.key}\` | \`${token.type}\` | \`${stringifyValue(token.value)}\` |`);
  }

  return `${lines.join('\n')}\n`;
}

function buildSectionMarkdown(title: string, tokens: FlattenedToken[]): string {
  const lines = [`# ${title}`, ''];

  if (tokens.length === 0) {
    lines.push('No tokens defined yet.', '');
    return lines.join('\n');
  }

  for (const token of tokens) {
    lines.push(`- \`${token.key}\`: \`${stringifyValue(token.value)}\``);
  }

  lines.push('');

  return lines.join('\n');
}

function buildResponsiveMarkdown(tokens: FlattenedToken[]): string {
  const lines = ['# Responsive Design', '', '## Spacing Scale', ''];

  for (const token of tokens) {
    lines.push(`- \`${token.key}\`: \`${stringifyValue(token.value)}\``);
  }

  lines.push('', 'Use the spacing scale as the basis for layout density and breakpoints.', '');

  return lines.join('\n');
}

function buildPatternsMarkdown(tokens: FlattenedToken[]): string {
  const highlighted = tokens.filter((token) =>
    ['color.primary', 'color.secondary', 'typography.heading.h1', 'components.button.radius'].some(
      (prefix) => token.key.startsWith(prefix),
    ),
  );
  const lines = ['# Design Patterns', '', '## Framework Guidance', ''];

  for (const token of highlighted) {
    lines.push(`- Base pattern from \`${token.key}\`: \`${stringifyValue(token.value)}\``);
  }

  lines.push(
    '',
    'Keep generated UI aligned with these tokens before introducing new variants.',
    '',
  );

  return lines.join('\n');
}

function stringifyValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function toIdentifier(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+(.)/g, (_, character: string) => character.toUpperCase());
}
