import { describe, expect, it } from 'vitest';

import {
  changeIsFeatureDev,
  isDocumentationPath,
  isFeatureDevEdit,
  isFrameworkInternalPath,
  isHostAgentConfigPath,
} from '@/stage-evidence/scope.js';

describe('scope — isFrameworkInternalPath', () => {
  it('flags .paqad metadata and out-of-tree paths', () => {
    expect(isFrameworkInternalPath('.paqad/.config')).toBe(true);
    expect(isFrameworkInternalPath('.paqad/configs/.config.policy')).toBe(true);
    expect(isFrameworkInternalPath('.paqad/.agent-entry-loaded')).toBe(true);
    expect(isFrameworkInternalPath('.paqad')).toBe(true);
    expect(isFrameworkInternalPath('../outside/x.ts')).toBe(true);
    expect(isFrameworkInternalPath('')).toBe(true);
  });

  it('does not flag ordinary source', () => {
    expect(isFrameworkInternalPath('src/a.ts')).toBe(false);
    expect(isFrameworkInternalPath('app/Http/Controller.php')).toBe(false);
  });

  it('normalises an absolute host path against the project root', () => {
    expect(isFrameworkInternalPath('/proj/.paqad/.config', '/proj')).toBe(true);
    expect(isFrameworkInternalPath('/proj/src/a.ts', '/proj')).toBe(false);
  });
});

describe('scope — isDocumentationPath', () => {
  it('flags the docs tree, markdown/rst docs, and top-level project docs', () => {
    expect(isDocumentationPath('docs')).toBe(true);
    expect(isDocumentationPath('docs/inbound/README.md')).toBe(true);
    expect(isDocumentationPath('docs/instructions/rules/x.md')).toBe(true);
    expect(isDocumentationPath('guide.mdx')).toBe(true);
    expect(isDocumentationPath('handbook.rst')).toBe(true);
    expect(isDocumentationPath('notes.adoc')).toBe(true);
    expect(isDocumentationPath('README')).toBe(true);
    expect(isDocumentationPath('CHANGELOG.md')).toBe(true);
    expect(isDocumentationPath('CONTRIBUTING.md')).toBe(true);
    expect(isDocumentationPath('LICENSE')).toBe(true);
    expect(isDocumentationPath('src/module/README.md')).toBe(true);
  });

  it('does not flag source, tests, or config', () => {
    expect(isDocumentationPath('src/a.ts')).toBe(false);
    expect(isDocumentationPath('app/Http/Controller.php')).toBe(false);
    expect(isDocumentationPath('tests/a.test.ts')).toBe(false);
    expect(isDocumentationPath('package.json')).toBe(false);
    expect(isDocumentationPath('src/documentation.ts')).toBe(false);
  });
});

describe('scope — isHostAgentConfigPath', () => {
  it('flags every paqad-managed host-agent config directory', () => {
    expect(isHostAgentConfigPath('.claude/settings.json')).toBe(true);
    expect(isHostAgentConfigPath('.codex/hooks.json')).toBe(true);
    expect(isHostAgentConfigPath('.gemini/settings.json')).toBe(true);
    expect(isHostAgentConfigPath('.junie/mcp/mcp.json')).toBe(true);
    expect(isHostAgentConfigPath('.cursor/rules/paqad.mdc')).toBe(true);
    expect(isHostAgentConfigPath('.windsurf/hooks.json')).toBe(true);
    expect(isHostAgentConfigPath('.continue/mcp.json')).toBe(true);
    expect(isHostAgentConfigPath('.aider/cache.json')).toBe(true);
    expect(isHostAgentConfigPath('.aiassistant/agents')).toBe(true);
    expect(isHostAgentConfigPath('.ai/mcp/mcp.json')).toBe(true);
    expect(isHostAgentConfigPath('.claude')).toBe(true);
    expect(isHostAgentConfigPath('.windsurfrules')).toBe(true);
  });

  it('does not treat a `.ai`-prefixed lookalike dir as host config', () => {
    expect(isHostAgentConfigPath('.airflow/dags.py')).toBe(false);
    expect(isFeatureDevEdit('.ai/mcp/mcp.json')).toBe(false);
  });

  it('does NOT flag .github (CI workflows are real code), source, or docs', () => {
    expect(isHostAgentConfigPath('.github/workflows/ci.yml')).toBe(false);
    expect(isHostAgentConfigPath('.github/copilot-instructions.md')).toBe(false);
    expect(isHostAgentConfigPath('src/a.ts')).toBe(false);
    expect(isHostAgentConfigPath('docs/a.md')).toBe(false);
    expect(isHostAgentConfigPath('.claudely/x.ts')).toBe(false);
    expect(isHostAgentConfigPath('.windsurfrules.bak')).toBe(false);
  });

  it('normalises an absolute host path against the project root', () => {
    expect(isHostAgentConfigPath('/proj/.junie/mcp/mcp.json', '/proj')).toBe(true);
    expect(isHostAgentConfigPath('/proj/src/a.ts', '/proj')).toBe(false);
  });
});

describe('scope — isFeatureDevEdit', () => {
  it('is feature development for any non-doc, non-framework edit (any stack)', () => {
    expect(isFeatureDevEdit('src/a.ts')).toBe(true);
    expect(isFeatureDevEdit('app/Http/Controller.php')).toBe(true);
    expect(isFeatureDevEdit('cmd/server/main.go')).toBe(true);
    expect(isFeatureDevEdit('service/handler.py')).toBe(true);
    expect(isFeatureDevEdit('tests/a.test.ts')).toBe(true);
    expect(isFeatureDevEdit('package.json')).toBe(true);
  });

  it('is NOT feature development for docs, framework-internal, or host-agent config edits', () => {
    expect(isFeatureDevEdit('docs/inbound/README.md')).toBe(false);
    expect(isFeatureDevEdit('README.md')).toBe(false);
    expect(isFeatureDevEdit('.paqad/configs/.config.policy')).toBe(false);
    expect(isFeatureDevEdit('.paqad/.agent-entry-loaded')).toBe(false);
    expect(isFeatureDevEdit('.junie/mcp/mcp.json')).toBe(false);
    expect(isFeatureDevEdit('.claude/settings.json')).toBe(false);
    expect(isFeatureDevEdit('.windsurfrules')).toBe(false);
    expect(isFeatureDevEdit('.github/workflows/ci.yml')).toBe(true);
  });

  it('fails closed for an unknown/absent target path (gate applies)', () => {
    expect(isFeatureDevEdit(undefined)).toBe(true);
  });
});

describe('scope — changeIsFeatureDev', () => {
  it('is true when any file is a non-doc, non-framework product change', () => {
    expect(changeIsFeatureDev(['docs/a.md', 'src/a.ts'])).toBe(true);
  });

  it('is false for a docs-only / framework-only change', () => {
    expect(changeIsFeatureDev(['docs/a.md', 'README.md', '.paqad/.config'])).toBe(false);
  });

  it('is false for a host-agent-config-only change', () => {
    expect(changeIsFeatureDev(['.junie/mcp/mcp.json'])).toBe(false);
    expect(
      changeIsFeatureDev(['.claude/settings.json', '.codex/hooks.json', '.paqad/.config']),
    ).toBe(false);
  });

  it('is true when a host-config change also touches real source', () => {
    expect(changeIsFeatureDev(['.claude/settings.json', 'src/a.ts'])).toBe(true);
  });

  it('is false for an empty change set (nothing to build)', () => {
    expect(changeIsFeatureDev([])).toBe(false);
  });
});
