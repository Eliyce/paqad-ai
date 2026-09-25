import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { sha256Hex } from '@/compliance/markdown.js';
import { splitFrontMatter } from '@/feature-evidence/envelope.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import {
  appendSpecCorrectionRow,
  appendSpecStepRow,
  clearStaged,
  readClarification,
  readExpertNeed,
  readExpertNotes,
  readExperts,
  readGrounding,
  readLabel,
  readRememberedInputs,
  readRequest,
  readSpecCorrectionRows,
  readSpecStepRows,
  readStagedExpertQuestions,
  readStagedJson,
  readStagedText,
  rememberInput,
  stagedFilePath,
  stagingDir,
  writeExpertNotes,
  writeExpertRoster,
  writeLabel,
  writeRequest,
  writeStagedText,
  type ExpertRosterEntry,
} from '@/spec-pipeline/run-store.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-run-store-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const ULID = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const DIR = `581-run-store-${ULID}`;

function entry(role: ExpertRosterEntry['role']): ExpertRosterEntry {
  return {
    role,
    reason: `why ${role}`,
    lens: 'lens',
    budget_tokens: 1000,
    grounding_truncated: false,
    brief_hash: 'h',
    tokens_used: null,
  };
}

const QUESTION = { business_text: 'q?', why_it_matters: 'w', options: ['a'], grounded_in: null };

describe('staging dir (issue #581, FR-1)', () => {
  it('is keyed by the change ULID, so a renamed bundle maps to the same staging dir', () => {
    expect(stagingDir(DIR)).toBe(`.paqad/tmp/spec-pipeline/${ULID}`);
    expect(stagingDir(`change-${ULID}`)).toBe(stagingDir(DIR));
    expect(stagedFilePath(DIR, 'craft')).toBe(`.paqad/tmp/spec-pipeline/${ULID}/spec.md`);
  });

  it('reads null for a missing or malformed staged file, and clears one without error', () => {
    const root = tempRoot();
    expect(readStagedText(root, DIR, 'task')).toBeNull();
    writeStagedText(root, DIR, 'task', '{ not json');
    expect(readStagedJson(root, DIR, 'task')).toBeNull();
    clearStaged(root, DIR, 'task');
    clearStaged(root, DIR, 'task');
    expect(existsSync(join(root, stagedFilePath(DIR, 'task')))).toBe(false);
  });
});

describe('request.md', () => {
  it('writes the request with an envelope front matter and a body-only content hash', () => {
    const root = tempRoot();
    expect(readRequest(root, DIR)).toBe('');
    writeRequest(root, DIR, 'Export invoices as CSV.\n', { sessionId: 'ses-a' });
    const raw = readFileSync(join(root, featureFilePath(DIR, 'request')), 'utf8');
    const { header, body } = splitFrontMatter(raw);
    expect(body).toBe('Export invoices as CSV.\n');
    expect(header).toMatchObject({
      doc_type: 'paqad.request',
      change: ULID,
      session_id: 'ses-a',
      content_hash: sha256Hex('Export invoices as CSV.\n'),
    });
    expect(readRequest(root, DIR)).toBe('Export invoices as CSV.\n');
  });
});

describe('clarification.json', () => {
  it('carries the envelope header and a label section in the value/signals/question_budget shape', () => {
    const root = tempRoot();
    writeLabel(root, DIR, { label: 'okay', signals: [], question_budget: 3 }, { sessionId: 's' });
    const doc = JSON.parse(readFileSync(join(root, featureFilePath(DIR, 'clarification')), 'utf8'));
    expect(Object.keys(doc).slice(0, 6)).toEqual([
      'schema_version',
      'doc_type',
      'change',
      'session_id',
      'recorded_at',
      'content_hash',
    ]);
    expect(doc).toMatchObject({
      doc_type: 'paqad.clarification',
      change: ULID,
      label: { value: 'okay', signals: [], question_budget: 3 },
      questions: null,
    });
    expect(readLabel(root, DIR)).toEqual({ label: 'okay', signals: [], question_budget: 3 });
  });

  it('reads null for a missing file, a non-object file, and sections that are not objects', () => {
    const root = tempRoot();
    expect(readClarification(root, DIR)).toBeNull();
    const abs = join(root, featureFilePath(DIR, 'clarification'));
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, '[]');
    expect(readClarification(root, DIR)).toBeNull();
    writeFileSync(abs, JSON.stringify({ label: 'okay', questions: [] }));
    expect(readClarification(root, DIR)).toEqual({ label: null, questions: null });
    expect(readLabel(root, DIR)).toBeNull();
  });
});

describe('experts.json (FR-8)', () => {
  it('stores each finding once with its role, the tokens on the roster, and the questions in staging', () => {
    const root = tempRoot();
    expect(readExperts(root, DIR)).toBeNull();
    expect(readExpertNeed(root, DIR)).toBeNull();
    writeExpertRoster(root, DIR, [entry('db-expert'), entry('qa-engineer')]);
    expect(readExpertNotes(root, DIR)).toBeNull();
    writeExpertNotes(root, DIR, {
      notes: [
        {
          role: 'db-expert',
          findings: [{ id: 'EX-db-expert-1', target: 'invoices', claim: 'index it' }],
        },
        // An expert with only a question and no finding.
        { role: 'qa-engineer', findings: [], questions: [QUESTION] },
      ],
      tokens: { 'db-expert': 700 },
    });
    const experts = readExperts(root, DIR)!;
    expect(experts.findings).toEqual([
      { id: 'EX-db-expert-1', role: 'db-expert', target: 'invoices', claim: 'index it' },
    ]);
    expect(experts.roster.map((e) => e.tokens_used)).toEqual([700, null]);
    expect(experts.synthesis).toBeNull();
    expect(readStagedExpertQuestions(root, DIR)).toEqual([
      { role: 'qa-engineer', questions: [QUESTION] },
    ]);
    // The notes rebuild in memory: one per expert, the questions back on their expert.
    expect(readExpertNotes(root, DIR)).toEqual({
      notes: [
        {
          role: 'db-expert',
          findings: [{ id: 'EX-db-expert-1', target: 'invoices', claim: 'index it' }],
        },
        { role: 'qa-engineer', findings: [], questions: [QUESTION] },
      ],
      tokens: { 'db-expert': 700 },
    });
    expect(readExpertNeed(root, DIR)).toEqual({
      experts: [
        { role: 'db-expert', reason: 'why db-expert' },
        { role: 'qa-engineer', reason: 'why qa-engineer' },
      ],
    });

    // Re-recording notes with no questions clears the staged questions.
    writeExpertNotes(root, DIR, { notes: [], tokens: {} });
    expect(existsSync(join(root, stagedFilePath(DIR, 'expertQuestions')))).toBe(false);
    expect(readStagedExpertQuestions(root, DIR)).toEqual([]);
  });

  it('records notes against an empty roster when none was recorded first', () => {
    const root = tempRoot();
    writeExpertNotes(root, DIR, { notes: [], tokens: {} });
    expect(readExperts(root, DIR)).toEqual({ roster: [], findings: [], synthesis: null });
  });

  it('reads null when the roster section is not an array', () => {
    const root = tempRoot();
    const abs = join(root, featureFilePath(DIR, 'experts'));
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, JSON.stringify({ roster: 'nope' }));
    expect(readExperts(root, DIR)).toBeNull();
  });
});

describe('readGrounding', () => {
  const GROUNDING = {
    references: [{ kind: 'doc', ref: 'docs/a.md' }],
    terms: ['invoice'],
    sparse: false,
    path: 'docs-fallback',
  };

  it('reads the staged grounding before freeze', () => {
    const root = tempRoot();
    expect(readGrounding(root, DIR)).toBeNull();
    writeStagedText(root, DIR, 'grounding', JSON.stringify(GROUNDING));
    expect(readGrounding(root, DIR)).toEqual(GROUNDING);
  });

  it('falls back to the frozen specification.json grounding, which has no terms', () => {
    const root = tempRoot();
    const abs = join(root, featureFilePath(DIR, 'specification'));
    mkdirSync(join(abs, '..'), { recursive: true });
    const frozen = { references: GROUNDING.references, sparse: false, path: 'docs-fallback' };
    writeFileSync(abs, JSON.stringify({ grounding: frozen }));
    expect(readGrounding(root, DIR)).toEqual({ ...GROUNDING, terms: [] });
    writeFileSync(abs, JSON.stringify({ grounding: { references: 'nope' } }));
    expect(readGrounding(root, DIR)).toBeNull();
    writeFileSync(abs, JSON.stringify({}));
    expect(readGrounding(root, DIR)).toBeNull();
  });
});

describe('remembered inputs (FR-4)', () => {
  it('remembers a .paqad/tmp input once, project-relative, and ignores files elsewhere', () => {
    const root = tempRoot();
    const input = join(root, '.paqad', 'tmp', 'need.json');
    rememberInput(root, DIR, input);
    rememberInput(root, DIR, input);
    rememberInput(root, DIR, join(root, 'need.json'));
    rememberInput(root, DIR, join(tmpdir(), 'elsewhere.json'));
    expect(readRememberedInputs(root, DIR)).toEqual(['.paqad/tmp/need.json']);
  });

  it('matches an input spelled through the resolved root (a symlinked checkout)', () => {
    const real = tempRoot();
    const link = join(tmpdir(), `paqad-run-store-link-${process.pid}-${Date.now()}`);
    symlinkSync(real, link, 'junction');
    roots.push(link);
    rememberInput(link, DIR, join(realpathSync(real), '.paqad', 'tmp', 'spec.md'));
    expect(readRememberedInputs(link, DIR)).toEqual(['.paqad/tmp/spec.md']);
  });

  it('treats an unresolvable root as the only spelling there is', () => {
    const missing = join(tmpdir(), `paqad-run-store-missing-${process.pid}-${Date.now()}`);
    roots.push(missing);
    rememberInput(missing, DIR, join(missing, '.paqad', 'tmp', 'x.json'));
    expect(readRememberedInputs(missing, DIR)).toEqual(['.paqad/tmp/x.json']);
  });
});

describe('stage-evidence rows (FR-7)', () => {
  it('appends spec-step and spec-correction rows, each with the envelope header', () => {
    const root = tempRoot();
    appendSpecStepRow(root, DIR, { step: 'task', outcome: 'complete', artifactHash: 'abc' });
    appendSpecStepRow(
      root,
      DIR,
      { step: 'task', outcome: 'complete', artifactHash: 'def', tokens: 12 },
      { sessionId: 'ses-b' },
    );
    appendSpecCorrectionRow(root, DIR, { spec_id: 'S-1', changed_sections: ['behaviour'] });
    const steps = readSpecStepRows(root, DIR);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({
      doc_type: 'paqad.stage-evidence',
      change: ULID,
      kind: 'spec-step',
      artifact_hash: 'abc',
    });
    expect(steps[0]).not.toHaveProperty('tokens');
    expect(steps[1]).toMatchObject({ session_id: 'ses-b', tokens: 12 });
    expect(readSpecCorrectionRows(root, DIR)).toMatchObject([
      { kind: 'spec-correction', spec_id: 'S-1', changed_sections: ['behaviour'] },
    ]);
  });
});
