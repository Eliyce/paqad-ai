import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';

import { shouldStripAiAttribution } from '@/delivery/attribution-config.js';

import type { AdapterCapabilities, AdapterContext, GeneratedFile } from '../adapter.interface.js';
import { BaseAdapter } from '../shared/base-adapter.js';

/**
 * Aider's own attribution keys (issue #538). Unlike every other agent, aider does not just add
 * a trailer — by default it rewrites the git AUTHOR and COMMITTER name fields too, so the
 * commit itself stops being the developer's. All three go to false together; leaving any one on
 * still puts aider's name on the change.
 */
const AIDER_ATTRIBUTION_KEYS = [
  'attribute-author',
  'attribute-committer',
  'attribute-co-authored-by',
] as const;

export class AiderAdapter extends BaseAdapter {
  readonly type = 'aider' as const;
  override readonly capabilities: AdapterCapabilities = {
    skills: false,
    agents: false,
    hooks: false,
    mcp: false,
    caching: false,
    memory: false,
  };

  protected configTemplateName() {
    return 'aider.md.hbs';
  }
  protected configOutputPath() {
    return 'CONVENTIONS.md';
  }
  protected skillsRoot() {
    return '.aider/skills';
  }
  protected agentsRoot() {
    return '.aider/agents';
  }
  protected hooksOutputPath() {
    return '.aider/hooks.json';
  }
  protected mcpOutputPath() {
    return 'aider.mcp.json';
  }
  protected cacheOutputPath() {
    return '.aider/cache.json';
  }
  protected memoryOutputPath() {
    return '.aider/memory.json';
  }

  override async generateConfig(context: AdapterContext): Promise<GeneratedFile[]> {
    const base = await super.generateConfig(context);
    const attribution = buildAiderAttributionConfig(context.projectRoot);
    return attribution ? [...base, attribution] : base;
  }
}

/**
 * Turn off aider's git attribution when the project's `ai_attribution` policy says `strip`.
 * Returns null when the policy says `keep`, so nothing is written and no file appears in a
 * project that did not ask for one.
 *
 * Merges rather than overwrites: an existing `.aider.conf.yml` keeps every key it already has,
 * including an explicit attribution value the team set by hand (INV-4).
 */
function buildAiderAttributionConfig(projectRoot: string): GeneratedFile | null {
  if (!shouldStripAiAttribution(projectRoot)) {
    return null;
  }
  const path = '.aider.conf.yml';
  const existing = readAiderConfig(join(projectRoot, path));
  const merged: Record<string, unknown> = { ...existing };
  for (const key of AIDER_ATTRIBUTION_KEYS) {
    if (!(key in merged)) {
      merged[key] = false;
    }
  }
  return { path, content: YAML.stringify(merged), autoUpdate: true };
}

/** Parse an existing `.aider.conf.yml`; absent, unreadable or non-mapping ⇒ empty. */
function readAiderConfig(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const parsed: unknown = YAML.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
