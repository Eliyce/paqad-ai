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
 * including an explicit attribution value the team set by hand (INV-4). The merge goes through
 * `parseDocument` rather than parse-then-stringify so the team's own COMMENTS and key order
 * survive too — a config file people hand-edit is one they annotate, and silently eating those
 * annotations on re-onboard would be its own small betrayal of INV-4.
 */
function buildAiderAttributionConfig(projectRoot: string): GeneratedFile | null {
  if (!shouldStripAiAttribution(projectRoot)) {
    return null;
  }
  const path = '.aider.conf.yml';
  const doc = readAiderConfig(join(projectRoot, path));
  for (const key of AIDER_ATTRIBUTION_KEYS) {
    if (!doc.has(key)) {
      doc.set(key, false);
    }
  }
  return { path, content: doc.toString(), autoUpdate: true };
}

/**
 * Parse an existing `.aider.conf.yml` as an editable document. Absent, unreadable or
 * non-mapping content yields an empty mapping document, so a corrupt config is replaced with a
 * valid one rather than throwing during onboarding.
 */
function readAiderConfig(path: string): YAML.Document {
  const empty = () => new YAML.Document({});
  if (!existsSync(path)) {
    return empty();
  }
  try {
    const doc = YAML.parseDocument(readFileSync(path, 'utf8'));
    return doc.errors.length === 0 && YAML.isMap(doc.contents) ? doc : empty();
  } catch {
    return empty();
  }
}
