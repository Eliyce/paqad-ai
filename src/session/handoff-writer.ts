import { existsSync, readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ContextBudgetOptimizer } from '@/context/budget-optimizer.js';
import { ContextEvictor } from '@/context/context-evictor.js';
import { PriorityClassifier } from '@/context/priority-classifier.js';
import { readProjectProfile } from '@/core/project-profile.js';
import type { StructuredHandoff } from './types.js';
import { TurnSummarizer } from '../context/turn-summarizer.js';

export class HandoffWriter {
  constructor(
    private readonly summarizer: TurnSummarizer,
    private readonly projectRoot: string,
  ) {}

  async write(
    turns: Array<{ text: string; timestamp: string }>,
    stackStateHash: string,
    sessionId: string,
    activeTask: StructuredHandoff['active_task'],
    contextPointers: StructuredHandoff['context_pointers'],
    originalContextTokens: number,
    executionProgress?: StructuredHandoff['execution_progress'],
  ): Promise<StructuredHandoff> {
    const profile = readProjectProfile(this.projectRoot);
    const optimizer = profile
      ? ContextBudgetOptimizer.fromProfile(
          this.projectRoot,
          profile,
          this.summarizer,
          new PriorityClassifier(),
          new ContextEvictor(),
        )
      : null;
    const summarizeBeforeIndex = optimizer?.summarizeBeforeIndex(turns.length) ?? turns.length;
    const olderTurns =
      optimizer === null
        ? turns.map((t, i) => this.summarizer.summarize(t.text, i, t.timestamp))
        : await optimizer.summarizeTurns(turns, summarizeBeforeIndex);
    const recentTurns = turns
      .slice(summarizeBeforeIndex)
      .map((t, i) => this.summarizer.summarize(t.text, summarizeBeforeIndex + i, t.timestamp));
    const summarized = [...olderTurns, ...recentTurns];

    if (profile && optimizer) {
      const currentHitRate = this.readLatestHitRate();
      await optimizer.evaluate(originalContextTokens, optimizer.resolveMaxTokens(profile), {
        summarized_turn_count: olderTurns.length,
        current_hit_rate: currentHitRate,
        target_hit_rate: profile.efficiency.context_hit_rate_target ?? 0.7,
      });
    }

    // Collect top 5 most recent decisions across all turns
    const allDecisions = summarized
      .flatMap((s) => s.decisions.map((d) => ({ description: d, rationale: '' })))
      .slice(-5);

    // Collect all unique files touched
    const filesModified = [...new Set(summarized.flatMap((s) => s.files_touched))].slice(0, 15);

    // Collect blockers from last 5 turns
    const blockers = summarized
      .slice(-5)
      .flatMap((s) => s.blockers.map((b) => ({ description: b, severity: 'warning' as const })))
      .slice(0, 3);

    // Collect next steps from last 5 turns
    const nextSteps = summarized
      .slice(-5)
      .flatMap((s) => s.next_steps)
      .slice(0, 5);

    const handoff: StructuredHandoff = {
      version: 2,
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      stack_state_hash: stackStateHash,
      retrieval: {
        rag_enabled: Boolean(profile?.intelligence.rag_enabled),
        embedding_provider: profile?.intelligence.embedding_provider,
      },
      active_task: activeTask,
      decisions: allDecisions,
      files_modified: filesModified,
      blockers,
      next_steps: nextSteps,
      open_questions: [],
      context_pointers: contextPointers,
      execution_progress: executionProgress,
      compression_stats: {
        original_context_tokens: originalContextTokens,
        handoff_tokens: 0, // filled below
        compression_ratio: 0,
      },
    };

    const handoffJson = JSON.stringify(handoff, null, 2);
    const handoffTokens = Math.ceil(handoffJson.length / 4);
    handoff.compression_stats.handoff_tokens = handoffTokens;
    handoff.compression_stats.compression_ratio =
      originalContextTokens > 0 ? handoffTokens / originalContextTokens : 0;

    await this.persistBoth(handoff);
    return handoff;
  }

  private toMarkdown(handoff: StructuredHandoff): string {
    const lines: string[] = [
      `# Session Handoff`,
      ``,
      `**Session:** ${handoff.session_id}  `,
      `**Timestamp:** ${handoff.timestamp}  `,
      `**Stack Hash:** ${handoff.stack_state_hash}`,
      ``,
      `## Retrieval`,
      ``,
      `**RAG enabled:** ${handoff.retrieval.rag_enabled ? 'yes' : 'no'}  `,
      `**Embedding provider:** ${handoff.retrieval.embedding_provider ?? 'none'}`,
      ``,
      `## Active Task`,
      ``,
      `**Classification:** ${handoff.active_task.classification}  `,
      `**Description:** ${handoff.active_task.description}`,
      handoff.active_task.spec_path ? `**Spec:** ${handoff.active_task.spec_path}` : '',
      ``,
      `## Decisions`,
      ``,
      ...handoff.decisions.map(
        (d) => `- ${d.description}${d.rationale ? ` _(${d.rationale})_` : ''}`,
      ),
      ``,
      `## Files Modified`,
      ``,
      ...handoff.files_modified.map((f) => `- ${f}`),
      ``,
      `## Blockers`,
      ``,
      ...handoff.blockers.map((b) => `- [${b.severity}] ${b.description}`),
      ``,
      `## Next Steps`,
      ``,
      ...handoff.next_steps.map((s) => `- ${s}`),
      ``,
      `## Context Pointers`,
      ``,
      `**Spec artifacts:** ${handoff.context_pointers.spec_artifacts.join(', ') || 'none'}  `,
      `**Relevant files:** ${handoff.context_pointers.relevant_files.join(', ') || 'none'}  `,
      `**Relevant docs:** ${handoff.context_pointers.relevant_docs.join(', ') || 'none'}`,
      ...(handoff.execution_progress
        ? [
            ``,
            `## Execution Progress`,
            ``,
            `**Manifest:** ${handoff.execution_progress.manifest_slug}  `,
            `**Current slice:** ${handoff.execution_progress.current_slice ?? 'none'}  `,
            `**Current status:** ${handoff.execution_progress.current_slice_status ?? 'none'}  `,
            `**Completed:** ${handoff.execution_progress.completed_slices.join(', ') || 'none'}  `,
            `**Pending:** ${handoff.execution_progress.pending_slices.join(', ') || 'none'}  `,
            `**Escalated:** ${handoff.execution_progress.escalated_slices.join(', ') || 'none'}`,
          ]
        : []),
      ``,
      `## Compression Stats`,
      ``,
      `- Original tokens: ${handoff.compression_stats.original_context_tokens}`,
      `- Handoff tokens: ${handoff.compression_stats.handoff_tokens}`,
      `- Compression ratio: ${(handoff.compression_stats.compression_ratio * 100).toFixed(1)}%`,
    ];
    return lines.filter((l) => l !== '').join('\n');
  }

  private async persistBoth(handoff: StructuredHandoff): Promise<void> {
    const sessionDir = join(this.projectRoot, '.paqad', 'session');
    await mkdir(sessionDir, { recursive: true });

    const jsonPath = join(sessionDir, 'handoff.json');
    const mdPath = join(sessionDir, 'handoff.md');
    const statsPath = join(sessionDir, 'handoff-stats.json');

    await writeFile(jsonPath, JSON.stringify(handoff, null, 2), 'utf8');
    await writeFile(mdPath, this.toMarkdown(handoff), 'utf8');
    await writeFile(
      statsPath,
      JSON.stringify(
        {
          session_id: handoff.session_id,
          original_context_tokens: handoff.compression_stats.original_context_tokens,
          handoff_tokens: handoff.compression_stats.handoff_tokens,
          compression_ratio: handoff.compression_stats.compression_ratio,
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  private readLatestHitRate(): number | undefined {
    const path = join(this.projectRoot, '.paqad', 'session', 'context-hit-log.json');
    if (!existsSync(path)) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { hit_rate?: unknown };
      return typeof parsed.hit_rate === 'number' ? parsed.hit_rate : undefined;
    } catch {
      return undefined;
    }
  }
}
