import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isCancelledError } from '@/core/errors/cancelled-error.js';
import { writeProjectProfile } from '@/core/project-profile.js';
import { readModuleMapEvents } from '@/module-decisions/events.js';
import { PatternVectorService } from '@/patterns/pattern-rag.js';
import { RagService } from '@/rag/service.js';
import type { EmbeddingProvider, ProviderFactory, StoredVectorChunk } from '@/rag/types.js';
import type { IntelligenceConfig } from '@/core/types/project-profile.js';

function baseProfile(intelligence?: Partial<IntelligenceConfig>) {
  return {
    project: { name: 'Demo', id: 'demo', description: 'Demo' },
    active_capabilities: ['content', 'coding', 'security'] as const,
    stack_profile: {
      frameworks: ['node-cli'],
      traits: [],
      toolchains: [],
      version_bands: [],
      sources: [],
    },
    commands: {
      install: 'pnpm install',
      dev: 'pnpm dev',
      test: 'pnpm test',
      test_single: 'pnpm test -- one',
      lint: 'pnpm lint',
      format: 'pnpm format',
      migrate: 'pnpm migrate',
      build: 'pnpm build',
    },
    strictness: {
      full_lane_default: false,
      require_adversarial_review: true,
      block_on_stale_docs: true,
      require_db_review_for_migrations: true,
    },
    compliance_packs: [],
    features: {
      spec_only_mode: false,
      market_research: false,
      design_research: false,
      team_agents: true,
      supply_chain_governance: false,
      ai_governance: false,
    },
    mcp: { servers: [] },
    model_routing: {
      default_model: 'gpt-5',
      reasoning_model: 'gpt-5',
      fast_model: 'gpt-5-mini',
    },
    research: { depth: 'standard' as const },
    intelligence: {
      rag_enabled: false,
      rag_similarity_threshold: 0.75,
      rag_top_n: 20,
      ...intelligence,
    },
    efficiency: { differential_refresh: true },
    escalation: {
      destructive_operations: 'block' as const,
      risky_migrations: 'warn' as const,
      security_findings: 'block' as const,
      db_row_threshold: 1000,
    },
    custom: {
      classification_dimensions: [],
      verification_plugins: [],
      escalation_rules: [],
    },
  };
}

// A provider that aborts the consumer's controller the moment it is asked to
// embed, so the rebuild is cancelled while chunks are in flight.
function abortingProviderFactory(controller: AbortController): ProviderFactory {
  const provider: EmbeddingProvider = {
    name: 'local',
    model: 'fake-local',
    async validate() {
      return;
    },
    async embed(input: string | string[]) {
      controller.abort();
      const batch = Array.isArray(input) ? input : [input];
      return batch.map(() => [0.5, 0.5]);
    },
  };
  return async () => provider;
}

describe('RagService.rebuild consumer cancellation (PQD-104)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-rag-cancel-'));
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    // A substantive file so the chunker emits at least one chunk to embed.
    const body = Array.from(
      { length: 40 },
      (_unused, index) =>
        `export function fn${index}() {\n  const value${index} = 'authentication and billing logic ${index}';\n  return value${index}.length;\n}`,
    ).join('\n\n');
    writeFileSync(join(projectRoot, 'src/auth.ts'), `${body}\n`);
    vi.spyOn(PatternVectorService.prototype, 'refresh').mockResolvedValue();
    writeProjectProfile(
      projectRoot,
      baseProfile({
        rag_enabled: true,
        embedding_provider: 'local',
        embedding_model: 'fake-local',
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('writes a loadable partial index, leaves no full index, and emits run.cancelled', async () => {
    const controller = new AbortController();
    const service = new RagService(projectRoot, abortingProviderFactory(controller));

    let cancelled = false;
    let checkpointPath: string | undefined;
    try {
      await service.rebuild({ signal: controller.signal });
    } catch (error) {
      cancelled = isCancelledError(error);
      if (isCancelledError(error)) {
        checkpointPath = error.details?.checkpoint_path as string | undefined;
      }
    }

    expect(cancelled).toBe(true);
    expect(checkpointPath).toBe('.paqad/vectors/index.partial.json');

    // The partial index is present and loadable; the full index is not written.
    const partialFile = join(projectRoot, '.paqad/vectors/index.partial.json');
    expect(existsSync(partialFile)).toBe(true);
    const partial = JSON.parse(readFileSync(partialFile, 'utf8')) as {
      items: StoredVectorChunk[];
    };
    expect(partial.items.length).toBeGreaterThan(0);
    expect(existsSync(join(projectRoot, '.paqad/vectors/index.json'))).toBe(false);

    const cancelEvents = readModuleMapEvents(projectRoot).filter(
      (event) => event.type === 'run.cancelled',
    );
    expect(cancelEvents).toHaveLength(1);
  });

  it('returns immediately without writing any index when pre-aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const embed = vi.fn();
    const service = new RagService(projectRoot, async () => ({
      name: 'local',
      model: 'fake-local',
      async validate() {
        return;
      },
      embed,
    }));

    await expect(service.rebuild({ signal: controller.signal })).rejects.toMatchObject({
      code: 'CANCELLED_BY_CONSUMER',
    });

    expect(embed).not.toHaveBeenCalled();
    expect(existsSync(join(projectRoot, '.paqad/vectors/index.json'))).toBe(false);
    expect(existsSync(join(projectRoot, '.paqad/vectors/index.partial.json'))).toBe(false);
  });
});
