import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSpecPipelineCommand } from '@/cli/commands/spec-pipeline.js';
import type { AgentRole } from '@/core/types/agent.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { persistLedgerSessionId } from '@/rag-ledger/session.js';
import { readHighTable } from '@/spec-pipeline/high-table.js';
import {
  expertNotesLockDir,
  readExperts,
  readStagedExpertQuestions,
  writeExpertNotes,
  writeExpertRoster,
  type ExpertRosterEntry,
} from '@/spec-pipeline/run-store.js';
import type { ExpertNotesArtifact } from '@/spec-pipeline/experts/types.js';

import { pinSpecPipelineOff } from '../../shared/spec-pipeline-off.js';
import { ORD_501_ON_CALL, ORD_501_REQUEST, ORD_501_SEATS, seatNote } from './high-table.fixture.js';

const SES = 'ses_high_table_notes';
const CLI = join(process.cwd(), 'dist/cli/index.js');
const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-ht-notes-'));
  roots.push(root);
  pinSpecPipelineOff(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(
    join(root, '.paqad', '.config'),
    ['spec_pipeline_enabled=true', 'spec_pipeline_experts_enabled=true'].join('\n'),
    'utf8',
  );
  return root;
}

function openChange(root: string): string {
  const dir = openFeatureChange(root, SES, {
    adapter: 'claude-code',
    title: 'ORD-501 csv export',
    issue: 'ORD-501',
    lane: 'full',
    ulid: '01JABCDEFGHJKMNPQRSTVWXYZ2',
  });
  persistLedgerSessionId(root, SES);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
  process.exitCode = 0;
});
beforeEach(() => {
  process.exitCode = 0;
});

function rosterEntry(role: AgentRole): ExpertRosterEntry {
  return {
    role,
    reason: `${role} reason`,
    lens: role,
    budget_tokens: 4000,
    grounding_truncated: false,
    brief_hash: `hash-${role}`,
    tokens_used: null,
  };
}

const QUESTION = {
  business_text: 'Who may download the orders export?',
  why_it_matters: 'It decides who sees customer orders outside the app.',
  options: ['Only managers', 'Every staff member'],
  grounded_in: null,
};

function note(role: AgentRole, claims: string[], tokens: number, withQuestion = false) {
  return {
    notes: [
      {
        role,
        findings: claims.map((claim, index) => ({
          id: `EX-${role}-${index + 1}`,
          target: `${role} target ${index + 1}`,
          claim,
          kind: 'requirement' as const,
          severity: 'should' as const,
        })),
        ...(withQuestion ? { questions: [QUESTION] } : {}),
      },
    ],
    tokens: { [role]: tokens },
  } as ExpertNotesArtifact;
}

describe('experts notes merges one role at a time (AC-39)', () => {
  it('AC-39: a note for one role, then another, keeps both roles findings, tokens, questions and voice warnings', () => {
    const root = tempRoot();
    const dir = openChange(root);
    writeExpertRoster(root, dir, [rosterEntry('db-expert'), rosterEntry('security-auditor')]);

    writeExpertNotes(root, dir, {
      ...note('security-auditor', ['only staff with the orders role may export'], 1500, true),
      voice_warnings: [
        { id: 'EX-security-auditor-1', target: 'orders role', hint: 'say staff role' },
      ],
    });
    writeExpertNotes(root, dir, note('db-expert', ['read in pages', 'no new index'], 1800));

    const experts = readExperts(root, dir)!;
    expect(experts.findings!.map((finding) => finding.id)).toEqual([
      'EX-db-expert-1',
      'EX-db-expert-2',
      'EX-security-auditor-1',
    ]);
    expect(experts.roster.map((entry) => [entry.role, entry.tokens_used])).toEqual([
      ['db-expert', 1800],
      ['security-auditor', 1500],
    ]);
    expect(experts.voice_warnings).toEqual([
      { id: 'EX-security-auditor-1', target: 'orders role', hint: 'say staff role' },
    ]);
    expect(readStagedExpertQuestions(root, dir)).toEqual([
      { role: 'security-auditor', questions: [QUESTION] },
    ]);

    writeExpertNotes(root, dir, {
      ...note('security-auditor', ['customer email stays out'], 900),
      voice_warnings: [],
    });
    const again = readExperts(root, dir)!;
    expect(again.findings!.map((finding) => finding.claim)).toEqual([
      'read in pages',
      'no new index',
      'customer email stays out',
    ]);
    expect(again.voice_warnings).toEqual([]);
    expect(again.roster.find((entry) => entry.role === 'security-auditor')!.tokens_used).toBe(900);
    expect(again.roster.find((entry) => entry.role === 'db-expert')!.tokens_used).toBe(1800);
    expect(readStagedExpertQuestions(root, dir)).toEqual([]);
    expect(existsSync(expertNotesLockDir(root, dir))).toBe(false);
  });

  it('keeps a voice warning that does not belong to the role being replaced', () => {
    const root = tempRoot();
    const dir = openChange(root);
    writeExpertRoster(root, dir, [
      rosterEntry('qa-engineer'),
      rosterEntry('qa-engineer-x' as AgentRole),
    ]);
    writeExpertNotes(root, dir, {
      ...note('qa-engineer', ['a failed export says why'], 700),
      voice_warnings: [
        { id: 'EX-qa-engineer-1', target: 'export', hint: 'h' },
        { id: 'EX-qa-engineer-x-1', target: 'other', hint: 'h' },
      ],
    });
    writeExpertNotes(root, dir, {
      ...note('qa-engineer', ['an empty filter exports a header'], 800),
    });
    expect(readExperts(root, dir)!.voice_warnings).toEqual([
      { id: 'EX-qa-engineer-x-1', target: 'other', hint: 'h' },
    ]);
  });

  it('AC-39: seven seats recording their notes at the same time, as separate processes, lose nothing', async () => {
    const root = tempRoot();
    const dir = openChange(root);
    const run = async (args: string[]): Promise<void> => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await createSpecPipelineCommand().parseAsync(
        [...args, '--project-root', root, '--session', SES],
        { from: 'user' },
      );
      vi.restoreAllMocks();
    };
    await run(['ground']);
    await run(['label', ORD_501_REQUEST]);
    const need = join(root, 'need.json');
    writeFileSync(need, JSON.stringify({ experts: ORD_501_ON_CALL }), 'utf8');
    await run(['experts', 'record', need]);
    expect(readExperts(root, dir)!.roster.map((entry) => entry.role)).toEqual(ORD_501_SEATS);

    const files = ORD_501_SEATS.map((role, index) => {
      const path = join(root, `${role}-notes.json`);
      writeFileSync(path, JSON.stringify(seatNote(role, 1000 + index, true)), 'utf8');
      return path;
    });
    const results = await Promise.all(
      files.map((file) =>
        execa(
          'node',
          [
            CLI,
            'spec',
            'pipeline',
            'experts',
            'notes',
            file,
            '--project-root',
            root,
            '--session',
            SES,
          ],
          { cwd: root, env: { SE_SESSION: SES }, reject: false },
        ),
      ),
    );
    for (const result of results) expect(result.exitCode, result.stderr).toBe(0);

    const experts = readExperts(root, dir)!;
    expect(experts.findings).toHaveLength(13);
    expect(new Set(experts.findings!.map((finding) => finding.role))).toEqual(
      new Set(ORD_501_SEATS),
    );
    for (const [index, role] of ORD_501_SEATS.entries()) {
      expect(experts.roster.find((entry) => entry.role === role)!.tokens_used).toBe(1000 + index);
    }
    expect(
      readStagedExpertQuestions(root, dir)
        .map((entry) => entry.role)
        .sort(),
    ).toEqual([...ORD_501_SEATS].sort());
    const done = readHighTable(root, dir).filter((row) => row.event === 'done');
    expect(done.map((row) => row.role).sort()).toEqual([...ORD_501_SEATS].sort());
    expect(existsSync(expertNotesLockDir(root, dir))).toBe(false);
  }, 60_000);
});
