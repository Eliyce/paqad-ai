import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readAuthoringDecision } from '@/authoring/decisions.js';
import {
  agentMemoryPath,
  appendOnlyProblem,
  memorySize,
  MEMORY_LEDGER,
  runMemoryConsolidate,
} from '@/authoring/memory.js';
import { AgentWorkspace, AuthoringRefusal } from '@/authoring/workspace.js';

import { AGENT_NAME, agentProject, cleanAgentProjects, put } from '../../shared/agent-pipeline.js';

afterEach(cleanAgentProjects);

const lines = (count: number, prefix = 'fact') =>
  Array.from({ length: count }, (_, index) => `- ${prefix} ${index}`).join('\n') + '\n';

function workspace(memory?: string): AgentWorkspace {
  const root = agentProject();
  if (memory !== undefined) put(root, agentMemoryPath(AGENT_NAME), memory);
  return new AgentWorkspace(root, AGENT_NAME);
}

describe('agent memory-consolidate (S8)', () => {
  it('AC-12: over the limit with no file, it prints the producer hint and writes nothing', () => {
    const ws = workspace(lines(250));
    const result = runMemoryConsolidate(ws);
    expect(result.lines[0]).toContain('is 250 lines');
    expect(result.lines[0]).toContain('--file <consolidated MEMORY.md>');
    expect(ws.exists('memory-curation.json')).toBe(false);
    expect(runMemoryConsolidate(workspace(lines(3))).lines[0]).toContain('nothing to consolidate');
  });

  it('AC-12: a consolidation within limits is written with before and after counts in the record and the ledger', () => {
    const ws = workspace(lines(250));
    const result = runMemoryConsolidate(ws, {
      text: lines(40, 'merged'),
      now: () => new Date('2026-11-01T00:00:00.000Z'),
    });
    expect(result.ok).toBe(true);
    expect(readFileSync(join(ws.projectRoot, agentMemoryPath(AGENT_NAME)), 'utf8')).toBe(
      lines(40, 'merged'),
    );
    const entry = ws.readJson<Array<Record<string, unknown>>>('memory-curation.json')![0]!;
    expect([entry.before_lines, entry.after_lines, entry.alters_behaviour]).toEqual([
      250,
      40,
      false,
    ]);
    expect(readFileSync(join(ws.projectRoot, MEMORY_LEDGER), 'utf8')).toContain('"after_lines":40');
  });

  it('AC-12: refuses the old text plus appended lines, and a file still over the limit', () => {
    const before = lines(20);
    expect(appendOnlyProblem(before, `${before}- new one\n`)).toContain('appended');
    expect(appendOnlyProblem(before, `- new one\n${before}`)).toContain('keeps every old line');
    expect(appendOnlyProblem(before, lines(5, 'merged'))).toBeNull();
    const ws = workspace(before);
    expect(() => runMemoryConsolidate(ws, { text: `${before}- new\n` })).toThrow(
      /not a consolidation/,
    );
    expect(() => runMemoryConsolidate(ws, { text: lines(201) })).toThrow(AuthoringRefusal);
    expect(memorySize('')).toEqual({ lines: 0, bytes: 0 });
  });

  it('AC-12: a behaviour-altering change raises authoring.improvement before the evals rerun', () => {
    const ws = workspace(lines(250));
    const result = runMemoryConsolidate(ws, { text: lines(30, 'merged'), altersBehaviour: true });
    expect(result.ok).toBe(false);
    expect(readAuthoringDecision(ws.projectRoot, result.decision!)?.category).toBe(
      'authoring.improvement',
    );
    expect(ws.read('draft/MEMORY.md')).toBe(lines(30, 'merged'));
    expect(readFileSync(join(ws.projectRoot, agentMemoryPath(AGENT_NAME)), 'utf8')).toBe(
      lines(250),
    );
    expect(result.lines[0]).toContain(`paqad-ai agent eval plan ${AGENT_NAME}`);
  });
});

describe('memory sizes and append checks, edges', () => {
  it('an empty memory has no lines, and any rewrite of an empty memory is allowed', () => {
    expect(memorySize('')).toEqual({ lines: 0, bytes: 0 });
    expect(appendOnlyProblem('\n', '- one\n- two\n')).toBeNull();
  });
});
