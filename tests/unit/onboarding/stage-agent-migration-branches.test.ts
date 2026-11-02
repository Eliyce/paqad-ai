import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  PROJECT_AGENTS_DIR,
  carriesManagedMarker,
  migrateProjectStageAgents,
  recordRemovedStageAgents,
  stageAgentBodyHash,
} from '@/onboarding/stage-agent-migration.js';
import { STAGE_AGENT_MARKER } from '@/stage-isolation/agent-writer.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-stage-migration-'));
  roots.push(root);
  mkdirSync(join(root, PROJECT_AGENTS_DIR), { recursive: true });
  return root;
}

function agent(root: string, name: string, content: string): void {
  writeFileSync(join(root, PROJECT_AGENTS_DIR, name), content);
}

describe('stage-agent migration branches', () => {
  it('finds the marker on the first line or after frontmatter, never inside unclosed frontmatter', () => {
    expect(carriesManagedMarker(`${STAGE_AGENT_MARKER}\nbody`)).toBe(true);
    expect(carriesManagedMarker(`---\nname: x\n---\n${STAGE_AGENT_MARKER}\nbody`)).toBe(true);
    expect(carriesManagedMarker(`---\nname: x\n${STAGE_AGENT_MARKER}`)).toBe(false);
    expect(carriesManagedMarker('plain body')).toBe(false);
  });

  it('removes marked, stamped-known and known bodies; keeps the rest; merges the manifest', () => {
    const root = project();
    const known = 'generated body';
    const stamped = 'stamped body';
    agent(root, 'paqad-zeta.md', 'hand-written body');
    agent(root, 'paqad-marked.md', `${STAGE_AGENT_MARKER}\nbody`);
    agent(root, 'paqad-known.md', `${known}\n`);
    agent(root, 'paqad-stamped.md', `${stamped}\n<!-- written by paqad-ai 1.0.0 -->\n`);
    agent(root, 'paqad-edited.md', `edited\n<!-- written by paqad-ai 1.0.0 -->\n`);
    agent(root, 'paqad-open.md', '---\nname: open\n');
    agent(root, 'other.md', `${STAGE_AGENT_MARKER}\n`);
    mkdirSync(join(root, PROJECT_AGENTS_DIR, 'paqad-dir.md'));
    mkdirSync(dirname(join(root, PATHS.ONBOARDING_MANIFEST)), { recursive: true });
    writeFileSync(
      join(root, PATHS.ONBOARDING_MANIFEST),
      JSON.stringify({
        removed_stage_agents: [
          { path: `${PROJECT_AGENTS_DIR}/paqad-old.md`, reason: 'managed-marker' },
          { path: `${PROJECT_AGENTS_DIR}/paqad-known.md`, reason: 'managed-marker' },
        ],
      }),
    );

    const result = migrateProjectStageAgents(
      root,
      new Set([stageAgentBodyHash(known), stageAgentBodyHash(stamped)]),
    );
    const at = (name: string) => `${PROJECT_AGENTS_DIR}/${name}`;
    expect(result.removed).toEqual([
      at('paqad-known.md'),
      at('paqad-marked.md'),
      at('paqad-stamped.md'),
    ]);
    expect(result.kept).toEqual([
      at('paqad-dir.md'),
      at('paqad-edited.md'),
      at('paqad-open.md'),
      at('paqad-zeta.md'),
    ]);
    expect(existsSync(join(root, PROJECT_AGENTS_DIR, 'other.md'))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(root, PATHS.ONBOARDING_MANIFEST), 'utf8')) as {
      removed_stage_agents: Array<{ path: string; reason: string }>;
    };
    expect(manifest.removed_stage_agents).toEqual([
      { path: at('paqad-known.md'), reason: 'generated-body' },
      { path: at('paqad-marked.md'), reason: 'managed-marker' },
      { path: at('paqad-old.md'), reason: 'managed-marker' },
      { path: at('paqad-stamped.md'), reason: 'legacy-stamp' },
    ]);
  });

  it('returns nothing without an agents folder and skips a manifest that cannot be read', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-stage-migration-'));
    roots.push(root);
    expect(migrateProjectStageAgents(root, new Set())).toEqual({ removed: [], kept: [] });
    recordRemovedStageAgents(root, [{ path: 'x', reason: 'managed-marker' }]);
    expect(existsSync(join(root, PATHS.ONBOARDING_MANIFEST))).toBe(false);
  });
});
