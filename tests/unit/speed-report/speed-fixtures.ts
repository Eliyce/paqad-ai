import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { projectTranscriptSlug } from '@/speed-report/transcripts.js';

export const T0 = Date.parse('2026-10-20T10:00:00.000Z');

export function at(seconds: number): string {
  return new Date(T0 + seconds * 1000).toISOString();
}

export interface SpeedProject {
  root: string;
  projectRoot: string;
  transcriptsRoot: string;
  sessionDir: string;
}

export function speedProject(): SpeedProject {
  const root = mkdtempSync(join(tmpdir(), 'paqad-speed-'));
  const projectRoot = join(root, 'project');
  const transcriptsRoot = join(root, 'projects');
  mkdirSync(projectRoot, { recursive: true });
  const sessionDir = join(transcriptsRoot, projectTranscriptSlug(projectRoot));
  mkdirSync(sessionDir, { recursive: true });
  return { root, projectRoot, transcriptsRoot, sessionDir };
}

export interface BundleInput {
  dirName: string;
  change: string;
  title: string;
  lane?: string;
  rows: Array<{ session: string; at: string } | Record<string, unknown>>;
}

export function writeBundle(project: SpeedProject, bundle: BundleInput): void {
  const dir = join(project.projectRoot, '.paqad/ledger/feature-evidence', bundle.dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'feature.json'),
    JSON.stringify({
      schema_version: 2,
      doc_type: 'paqad.feature',
      change: bundle.change,
      session_id: 'ses',
      recorded_at: '2026-10-20T10:00:00.000Z',
      content_hash: 'a'.repeat(64),
      issue: null,
      title: bundle.title,
      slug: 'slug',
      lane: bundle.lane ?? 'full',
      status: 'active',
      spec_id: null,
      adapter: 'claude-code',
      branch: null,
      base_branch: null,
      updated_at: '2026-10-20T10:00:00.000Z',
    }),
  );
  const lines = bundle.rows.map((row) => {
    if ('session' in row && 'at' in row) {
      return JSON.stringify({
        schema_version: 2,
        doc_type: 'paqad.stage-evidence',
        change: bundle.change,
        session_id: row.session,
        recorded_at: row.at,
        content_hash: 'h',
        kind: 'stage_start',
      });
    }
    return JSON.stringify(row);
  });
  writeFileSync(join(dir, 'stage-evidence.jsonl'), `${lines.join('\n')}\n`);
}

export function writeTranscript(
  project: SpeedProject,
  session: string,
  records: readonly unknown[],
  agent?: { id: string; agentType: string },
): string {
  const lines = `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  if (!agent) {
    const path = join(project.sessionDir, `${session}.jsonl`);
    writeFileSync(path, lines);
    return path;
  }
  const dir = join(project.sessionDir, session, 'subagents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `agent-${agent.id}.meta.json`),
    JSON.stringify({ agentType: agent.agentType }),
  );
  const path = join(dir, `agent-${agent.id}.jsonl`);
  writeFileSync(path, lines);
  return path;
}

export function human(seconds: number, text: string): Record<string, unknown> {
  return { type: 'user', timestamp: at(seconds), message: { role: 'user', content: text } };
}

export function assistant(
  seconds: number,
  tools: Array<{ id: string; name: string; input?: Record<string, unknown> }> = [],
): Record<string, unknown> {
  return {
    type: 'assistant',
    timestamp: at(seconds),
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'x' },
        ...tools.map((tool) => ({
          type: 'tool_use',
          id: tool.id,
          name: tool.name,
          input: tool.input ?? {},
        })),
      ],
    },
  };
}

export function result(
  seconds: number,
  id: string,
  content = 'ok',
  isError = false,
): Record<string, unknown> {
  return {
    type: 'user',
    timestamp: at(seconds),
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }],
    },
  };
}
