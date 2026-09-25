import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEvidenceCommand } from '@/cli/commands/evidence.js';
import { sha256Hex } from '@/compliance/markdown.js';
import { PATHS } from '@/core/constants/paths.js';
import type { FeatureSpec } from '@/core/types/feature-spec.js';
import { verifyReceiptSeal } from '@/evidence/receipt/dsse.js';
import { decodeReceiptStatement } from '@/evidence/receipt/envelope.js';
import { listInFlightFeatures } from '@/feature-evidence/adoption.js';
import { splitFrontMatter, textHashMatches } from '@/feature-evidence/envelope.js';
import { readFeatureRecord } from '@/feature-evidence/feature-record.js';
import type { BundleCompletenessConfig } from '@/feature-evidence/manifest.js';
import {
  evidenceMigrationPending,
  formatEvidenceMigration,
  LEGACY_SPECS_DIR,
  migrateFeatureEvidence,
  migrationSessionId,
  type EvidenceMigrationResult,
} from '@/feature-evidence/migrate.js';
import { featureDir, featureFilePath } from '@/feature-evidence/paths.js';
import {
  projectFeatureReceipt,
  readFeatureReceipt,
  verifyEvidenceSeal,
} from '@/feature-evidence/receipt.js';
import { writeFeatureReport } from '@/feature-evidence/report-writer.js';
import { markDone, setActiveFeature } from '@/feature-evidence/session-control.js';
import { readUnitFile } from '@/session-ledger/ledger.js';
import { aggregateSpecPipelineMetrics, listRunDirs } from '@/spec-pipeline/metrics.js';
import {
  readClarification,
  readExperts,
  readSpecStepRows,
  readStagedText,
  stagingDir,
} from '@/spec-pipeline/run-store.js';
import { runSpecChangeGuard } from '@/spec/spec-change-guard.js';
import { bundleCompletenessGate } from '@/verification/repository/bundle-completeness-gate.js';

// Issue #581 (FR-12, AC-18, AC-19, AC-20, AC-28) — the one-time evidence migration, over a
// fixture with one example of each case A to D, sealed history, and another session's change.

const U_A = '01JABCDEFGHJKMNPQRSTVWXYZ1';
const U_B = '01JABCDEFGHJKMNPQRSTVWXYZ2';
const U_C = '01JABCDEFGHJKMNPQRSTVWXYZ3';
const A = `100-alpha-${U_A}`;
const B = `200-beta-${U_B}`;
const B_HALF = `change-${U_B}`;
const C = `300-gamma-${U_C}`;

const SPEC = '# Spec alpha\n\nExport as CSV.\n';
const REQUEST = '# Alpha\n\nLet me export the table.\n';
const BRIEF =
  '# Expert brief — qa-engineer\n\n- Lens: `x`\n- Why you were brought in: tests\n' +
  '- Granted budget: 6000 tokens\n- Grounding truncated: yes\n\n## Request\n\nAlpha\n';
const TASK = '{"intent":"Export the table","scope":{}}\n';
const GITIGNORE =
  '# >>> paqad-ai managed (do not edit between markers) >>>\nledger/\ncompliance/\n_specs/\n' +
  '# <<< paqad-ai managed <<<\n\nsite-map/\n';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function write(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

function read(root: string, rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

function jsonl(rows: Record<string, unknown>[]): string {
  return rows.map((row) => `${JSON.stringify(row)}\n`).join('');
}

function logRow(step: string, ts: string, extra: Record<string, unknown> = {}) {
  return {
    ts,
    step,
    outcome: 'complete',
    hash: `h-${step}`,
    enforcement: { enabled: true },
    ...extra,
  };
}

function pipeline(root: string, run: string, file: string, content: string): void {
  write(root, join(LEGACY_SPECS_DIR, run, 'pipeline', file), content);
}

/** A pre-#581 feature.json (schema version 1). */
function legacyFeature(root: string, dir: string, ulid: string, title: string): void {
  write(
    root,
    featureFilePath(dir, 'feature'),
    `${JSON.stringify(
      {
        schema_version: 1,
        doc_type: 'paqad.feature',
        issue: dir.split('-')[0],
        title,
        slug: title,
        ulid,
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
        lane: 'full',
        status: 'active',
        spec_id: null,
        session_first_seen: 'ses_old',
        adapter: 'claude-code',
        content_hash: 'old',
      },
      null,
      2,
    )}\n`,
  );
}

/** A pre-#581 frozen record, naming a tmp source and a `_specs` run dir. */
function legacySpecification(): FeatureSpec & Record<string, unknown> {
  return {
    schema_version: '1',
    spec_id: 'S-alpha',
    spec_file: '.paqad/tmp/alpha-spec.md',
    spec_hash: sha256Hex(SPEC),
    behaviour: ['FR-1'],
    acceptance_criteria: [],
    invariants: [],
    open_questions: [],
    frozen: { frozen_at: '2026-09-01T00:00:00Z', spec_hash: sha256Hex(SPEC), signed_off_by: 'o' },
    provenance: { pipeline_produced: true },
    run_dir: `${LEGACY_SPECS_DIR}/${A}`,
  };
}

/** The full fixture: A (frozen, sealed), B (renamed + half run), C (no bundle), D (tmp). */
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-migrate-'));
  roots.push(root);
  write(root, '.paqad/.gitignore', GITIGNORE);

  // Case A — a frozen old bundle with a receipt, and its pipeline run.
  legacyFeature(root, A, U_A, 'alpha');
  write(root, featureFilePath(A, 'plan'), '{"summary":"old plan"}\n');
  write(root, featureFilePath(A, 'specification'), `${JSON.stringify(legacySpecification())}\n`);
  write(root, join(featureDir(A), 'specification.md'), '# Spec alpha (projection)\n');
  write(root, featureFilePath(A, 'review'), '{"verdict":"approve"}\n');
  write(root, featureFilePath(A, 'delivery'), '{"branch":"feat/alpha"}\n');
  write(
    root,
    featureFilePath(A, 'stageEvidence'),
    jsonl([
      {
        ts: '2026-09-01T00:00:00.000Z',
        kind: 'open',
        session_id: 'ses_old',
        doc_type: 'paqad.stage-evidence',
        content_hash: 'x',
      },
    ]),
  );
  write(
    root,
    featureFilePath(A, 'evidence'),
    jsonl([{ schema_version: 1, ts: '2026-09-01T00:00:00.000Z', code: 'format', verdict: 'pass' }]),
  );
  projectFeatureReceipt(root, A, {
    fileDigests: [{ name: 'src/a.ts', sha256: 'aaa' }],
    rows: [],
    verifierVersion: '1.0.0',
    timeVerified: '2026-09-01T00:00:00.000Z',
    write: { aiBom: false },
  });
  pipeline(root, A, 'request.md', REQUEST);
  pipeline(root, A, 'label.json', '{"label":"okay","signals":[],"question_budget":3}');
  pipeline(
    root,
    A,
    'questions.json',
    '{"questions":[],"auto_answered":[],"asked":0,"answered":0,"deferred":0}',
  );
  pipeline(root, A, 'experts.json', '{"experts":[{"role":"qa-engineer","reason":"tests"}]}');
  pipeline(
    root,
    A,
    'expert-notes.json',
    JSON.stringify({
      notes: [
        {
          role: 'qa-engineer',
          findings: [{ id: 'EX-qa-engineer-1', target: 't', claim: 'c', kind: 'invariant' }],
          questions: [{ id: 'Q1', text: 'q?' }],
        },
      ],
      tokens: { 'qa-engineer': 2200 },
    }),
  );
  pipeline(root, A, 'expert-merge.json', '{"merged":true}');
  pipeline(
    root,
    A,
    'expert-synthesis.json',
    '{"verdict":"ready","accepted":["EX-qa-engineer-1"],"declined":[],"conflicts":[],"gaps":[],"questions":[],"tokens":900}',
  );
  pipeline(root, A, 'briefs/qa-engineer.md', BRIEF);
  pipeline(root, A, 'spec.md', SPEC);
  pipeline(root, A, 'task.json', TASK);
  pipeline(
    root,
    A,
    'log.jsonl',
    jsonl([
      logRow('ground', '2026-09-01T01:00:00.000Z'),
      logRow('label', '2026-09-01T01:01:00.000Z', { tokens: 120 }),
      logRow('finish', '2026-09-01T01:02:00.000Z'),
    ]),
  );

  // Case B — the renamed run reached finish, so the half run left by the rename is dropped.
  legacyFeature(root, B, U_B, 'beta');
  write(
    root,
    featureFilePath(B, 'stageEvidence'),
    jsonl([
      {
        ts: '2026-09-02T00:00:00.000Z',
        kind: 'open',
        session_id: 'ses_old',
        doc_type: 'paqad.stage-evidence',
        content_hash: 'x',
      },
    ]),
  );
  pipeline(root, B_HALF, 'log.jsonl', jsonl([logRow('ground', '2026-09-02T01:00:00.000Z')]));
  pipeline(
    root,
    B,
    'log.jsonl',
    jsonl([
      logRow('ground', '2026-09-02T02:00:00.000Z'),
      logRow('finish', '2026-09-02T02:01:00.000Z'),
    ]),
  );
  pipeline(root, B, 'task.json', TASK);
  pipeline(root, B, 'spec.md', '# Working spec beta\n');

  // Case C — a spec run whose change never opened.
  pipeline(root, C, 'request.md', '# Gamma\n');
  pipeline(root, C, 'log.jsonl', jsonl([logRow('ground', '2026-09-03T01:00:00.000Z')]));

  // Case D — old record-verb inputs in tmp, beside files that must stay.
  write(root, '.paqad/tmp/alpha-request.md', REQUEST);
  write(root, '.paqad/tmp/100-alpha-questions.json', '{}');
  write(root, `.paqad/tmp/notes-${U_C}.md`, 'x');
  write(root, '.paqad/tmp/copied-task.json', TASK);
  write(root, '.paqad/tmp/unrelated.md', 'keep me');
  write(root, '.paqad/tmp/change-notes.md', 'keep me too');
  mkdirSync(join(root, '.paqad/tmp/alpha-dir'), { recursive: true });
  return root;
}

/** Every file under the project, path to bytes. */
function snapshot(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(child);
      else files.set(child, read(root, child));
    }
  };
  walk('');
  return files;
}

function kinds(result: EvidenceMigrationResult): string[] {
  return result.actions.map((action) => action.kind);
}

describe('migrateFeatureEvidence cases A to D (issue #581, AC-18)', () => {
  it('reaches the target layout and deletes the old folder and its ignore line', () => {
    const root = fixture();
    const result = migrateFeatureEvidence(root);

    expect(existsSync(join(root, LEGACY_SPECS_DIR))).toBe(false);
    expect(read(root, '.paqad/.gitignore')).toBe(GITIGNORE.replace('_specs/\n', ''));
    expect(kinds(result)).toContain('remove-specs-dir');
    expect(kinds(result)).toContain('remove-gitignore-line');

    // A: the pipeline facts land in the bundle through the live writers, new header on each.
    const request = read(root, featureFilePath(A, 'request'));
    expect(splitFrontMatter(request).body).toBe(REQUEST);
    expect(textHashMatches(request)).toBe(true);
    expect(readClarification(root, A)?.label?.value).toBe('okay');
    expect(readClarification(root, A)?.questions?.counts.asked).toBe(0);
    const experts = readExperts(root, A)!;
    expect(experts.roster[0]).toMatchObject({
      role: 'qa-engineer',
      budget_tokens: 6000,
      grounding_truncated: true,
      brief_hash: sha256Hex(BRIEF),
      tokens_used: 2200,
    });
    expect(experts.findings?.map((finding) => finding.id)).toEqual(['EX-qa-engineer-1']);
    expect(experts.synthesis?.verdict).toBe('ready');
    const specMd = read(root, featureFilePath(A, 'specMd'));
    expect(splitFrontMatter(specMd).body).toBe(SPEC);
    const steps = readSpecStepRows(root, A);
    expect(steps.map((row) => row.step)).toEqual(['ground', 'label', 'finish']);
    expect(steps[0]!.recorded_at).toBe('2026-09-01T01:00:00.000Z');
    expect(steps[1]!.tokens).toBe(120);
    // Dropped: the merge file and the briefs; a frozen run stages nothing.
    expect(readdirSync(join(root, featureDir(A)))).not.toContain('expert-merge.json');
    expect(readStagedText(root, A, 'task')).toBeNull();

    // B: the renamed run is kept, the half run dropped, and the unfrozen state staged.
    expect(result.actions).toContainEqual({ kind: 'drop-duplicate', source: B_HALF, kept: B });
    expect(readSpecStepRows(root, B).map((row) => row.step)).toEqual(['ground', 'finish']);
    expect(readStagedText(root, B, 'task')).toBe(TASK);
    expect(readStagedText(root, B, 'craft')).toBe('# Working spec beta\n');

    // C: a spec-only bundle under the run's name, closed so nothing adopts it.
    expect(readFeatureRecord(root, C)?.status).toBe('spec-only');
    expect(readUnitFile(root, featureFilePath(C, 'stageEvidence')).map((row) => row.kind)).toEqual([
      'spec-step',
      'close',
    ]);
    expect(listInFlightFeatures(root)).not.toContain(C);

    // D: the old inputs go; files that name no migrated change stay.
    const tmp = readdirSync(join(root, '.paqad/tmp')).sort();
    expect(tmp).toEqual(['alpha-dir', 'change-notes.md', 'spec-pipeline', 'unrelated.md']);
    expect(stagingDir(B)).toContain('spec-pipeline');
  });

  it('never rewrites sealed history: pre-existing files keep their bytes and the receipt verifies (AC-19)', () => {
    const root = fixture();
    const before = snapshot(root);
    migrateFeatureEvidence(root);
    const after = snapshot(root);
    for (const [path, bytes] of before) {
      if (!path.startsWith(`${featureDir(A)}/`) && !path.startsWith(`${featureDir(B)}/`)) continue;
      // Appended to, never rewritten: every existing byte is still the file's prefix.
      expect(after.get(path)?.startsWith(bytes), path).toBe(true);
      if (!path.endsWith('stage-evidence.jsonl')) expect(after.get(path), path).toBe(bytes);
    }
    const receipt = readFeatureReceipt(root, A)!;
    expect(verifyReceiptSeal(receipt)).toBe(true);
    expect(verifyEvidenceSeal(root, A, decodeReceiptStatement(receipt)!)).toBe(true);
  });

  it('is idempotent: a second run changes no bytes and reports nothing', () => {
    const root = fixture();
    migrateFeatureEvidence(root);
    const first = snapshot(root);
    const second = migrateFeatureEvidence(root);
    expect(second.actions).toEqual([]);
    expect(snapshot(root)).toEqual(first);
    expect(formatEvidenceMigration(second)).toBe(
      'Nothing to migrate: the evidence layout is current.',
    );
  });

  it('writes nothing on a dry run and prints the plan', () => {
    const root = fixture();
    const before = snapshot(root);
    const result = migrateFeatureEvidence(root, { dryRun: true });
    expect(snapshot(root)).toEqual(before);
    const text = formatEvidenceMigration(result);
    expect(text).toContain('Evidence migration (would):');
    expect(text).toContain(
      `merge ${A} into ${A}: add request.md, clarification.json, experts.json, spec.md, stage-evidence.jsonl (+3 rows)`,
    );
    expect(text).toContain(`delete ${B_HALF} (a half run; kept ${B})`);
    expect(text).toContain('staged task, craft for a later freeze');
    expect(text).toContain(`into a new spec-only bundle ${C}`);
    expect(text).toContain('delete .paqad/tmp/alpha-request.md');
    expect(text).toContain(`delete ${LEGACY_SPECS_DIR}/`);
    expect(text).toContain('remove the _specs/ line from .paqad/.gitignore');
  });
});

describe('migrateFeatureEvidence and other sessions (AC-28)', () => {
  it('leaves a change another session holds, then migrates it once that change closes', () => {
    const root = fixture();
    setActiveFeature(root, 'ses_other', A);
    // Unrelated controls: this session's own, one that holds a different change, and junk.
    setActiveFeature(root, 'ses_me', B);
    write(root, `${PATHS.FEATURE_EVIDENCE_SESSION_DIR}/readme.txt`, 'x');
    mkdirSync(join(root, PATHS.FEATURE_EVIDENCE_SESSION_DIR, 'sub.json'), { recursive: true });

    const held = migrateFeatureEvidence(root, { sessionId: 'ses_me' });
    expect(held.actions).toContainEqual({ kind: 'skip-held', source: A, bundle: A });
    expect(existsSync(join(root, LEGACY_SPECS_DIR, A))).toBe(true);
    expect(existsSync(join(root, featureFilePath(A, 'request')))).toBe(false);
    // Its folder stays, so the ignore line stays too.
    expect(read(root, '.paqad/.gitignore')).toContain('_specs/');
    expect(formatEvidenceMigration(held)).toContain('is open in another session');
    // B belonged to this session, so it migrated.
    expect(existsSync(join(root, LEGACY_SPECS_DIR, B))).toBe(false);

    markDone(root, 'ses_other', A);
    const later = migrateFeatureEvidence(root, { sessionId: 'ses_me' });
    expect(kinds(later)).toContain('merge');
    expect(existsSync(join(root, LEGACY_SPECS_DIR))).toBe(false);
    expect(read(root, '.paqad/.gitignore')).not.toContain('_specs/');
  });

  it('treats a paused change as held, and a closed one as free', () => {
    const root = fixture();
    setActiveFeature(root, 'ses_other', A);
    setActiveFeature(root, 'ses_other', B); // A is now paused under ses_other
    const held = migrateFeatureEvidence(root, { sessionId: '  ' });
    expect(held.actions).toContainEqual({ kind: 'skip-held', source: A, bundle: A });

    write(
      root,
      featureFilePath(A, 'stageEvidence'),
      `${read(root, featureFilePath(A, 'stageEvidence'))}${jsonl([{ kind: 'close', doc_type: 'paqad.stage-evidence', content_hash: 'x', session_id: 's', ts: 't' }])}`,
    );
    const free = migrateFeatureEvidence(root);
    expect(free.actions.some((action) => action.kind === 'merge' && action.source === A)).toBe(
      true,
    );
  });
});

describe('migrateFeatureEvidence edge cases', () => {
  function project(): string {
    const root = mkdtempSync(join(tmpdir(), 'paqad-migrate-edge-'));
    roots.push(root);
    return root;
  }

  it('does nothing on a project with no old folder and no ignore line', () => {
    const root = project();
    expect(migrateFeatureEvidence(root).actions).toEqual([]);
    expect(evidenceMigrationPending(root)).toBe(false);
    write(root, '.paqad/.gitignore', 'ledger/\n');
    expect(migrateFeatureEvidence(root).actions).toEqual([]);
  });

  it('removes a stale ignore line even when the folder is already gone', () => {
    const root = project();
    write(root, '.paqad/.gitignore', GITIGNORE);
    expect(kinds(migrateFeatureEvidence(root))).toEqual(['remove-gitignore-line']);
  });

  it('leaves entries that are not change folders, and the folder with them', () => {
    const root = project();
    write(root, `${LEGACY_SPECS_DIR}/doctor.md`, 'x');
    write(root, '.paqad/.gitignore', GITIGNORE);
    expect(evidenceMigrationPending(root)).toBe(true);
    const result = migrateFeatureEvidence(root);
    expect(result.actions).toEqual([{ kind: 'skip-unrecognized', source: 'doctor.md' }]);
    expect(formatEvidenceMigration(result)).toContain('leave doctor.md: not a change folder');
    expect(read(root, '.paqad/.gitignore')).toContain('_specs/');
  });

  it('keeps the half run with more completed steps when no renamed run finished', () => {
    const root = project();
    pipeline(
      root,
      B_HALF,
      'log.jsonl',
      jsonl([
        logRow('ground', '2026-09-02T01:00:00.000Z'),
        logRow('label', '2026-09-02T01:01:00.000Z'),
      ]),
    );
    pipeline(root, B, 'log.jsonl', jsonl([logRow('ground', '2026-09-02T02:00:00.000Z')]));
    const result = migrateFeatureEvidence(root);
    expect(result.actions).toContainEqual({ kind: 'drop-duplicate', source: B, kept: B_HALF });
    // With no bundle, the kept run's own name becomes the spec-only bundle.
    expect(readFeatureRecord(root, B_HALF)?.status).toBe('spec-only');
  });

  it('prefers the renamed run on a tie', () => {
    const root = project();
    pipeline(root, B_HALF, 'log.jsonl', jsonl([logRow('ground', '2026-09-02T01:00:00.000Z')]));
    pipeline(root, B, 'log.jsonl', jsonl([logRow('ground', '2026-09-02T02:00:00.000Z')]));
    pipeline(
      root,
      `200-betb-${U_B}`,
      'log.jsonl',
      jsonl([logRow('ground', '2026-09-02T02:00:00.000Z')]),
    );
    const result = migrateFeatureEvidence(root);
    expect(result.actions).toContainEqual({ kind: 'drop-duplicate', source: B_HALF, kept: B });
  });

  it('keeps only valid log rows, their tokens and times when readable', () => {
    const root = project();
    pipeline(
      root,
      C,
      'log.jsonl',
      jsonl([
        { ts: 'not a time', step: 'ground', outcome: 'complete', artifact_hash: 'ah', tokens: 5 },
        { step: 'label', outcome: 'complete', tokens: -1 },
        { step: '', outcome: 'complete' },
        { outcome: 'complete' },
        { step: 'task', outcome: 'redo' },
      ]) + '42\n{partial\n',
    );
    migrateFeatureEvidence(root);
    const rows = readSpecStepRows(root, C);
    expect(rows.map((row) => [row.step, row.artifact_hash, row.tokens])).toEqual([
      ['ground', 'ah', 5],
      ['label', '', undefined],
    ]);
  });

  it('adds nothing a bundle already has, and copies no spec.md whose hash differs', () => {
    const root = fixture();
    // A frozen record whose source changed since, and a bundle that already has spec-step rows.
    pipeline(root, A, 'spec.md', '# edited after freeze\n');
    write(root, featureFilePath(A, 'request'), 'already here\n');
    write(root, featureFilePath(A, 'clarification'), '{}\n');
    write(root, featureFilePath(A, 'experts'), '{}\n');
    write(
      root,
      featureFilePath(A, 'stageEvidence'),
      jsonl([
        {
          kind: 'spec-step',
          step: 'ground',
          outcome: 'complete',
          doc_type: 'paqad.stage-evidence',
          content_hash: 'x',
          session_id: 's',
          ts: 't',
        },
      ]),
    );
    const result = migrateFeatureEvidence(root);
    const merge = result.actions.find((action) => action.kind === 'merge' && action.source === A);
    expect(merge).toMatchObject({ added: [] });
    expect(formatEvidenceMigration(result)).toContain(`merge ${A} into ${A}: add nothing new`);
    expect(existsSync(join(root, featureFilePath(A, 'specMd')))).toBe(false);
  });

  it('copies no spec.md for a frozen record with no spec_hash, and stages nothing for it', () => {
    const root = project();
    legacyFeature(root, A, U_A, 'alpha');
    write(root, featureFilePath(A, 'specification'), '{"spec_id":"S"}\n');
    pipeline(root, A, 'spec.md', SPEC);
    pipeline(root, A, 'task.json', TASK);
    migrateFeatureEvidence(root);
    expect(existsSync(join(root, featureFilePath(A, 'specMd')))).toBe(false);
    expect(readStagedText(root, A, 'task')).toBeNull();
  });

  it('tolerates missing and malformed pipeline files', () => {
    const root = project();
    pipeline(root, C, 'label.json', 'not json');
    pipeline(root, C, 'questions.json', '{"questions":"nope"}');
    pipeline(root, C, 'experts.json', '{"experts":[{"role":"qa-engineer","reason":"r"}]}');
    pipeline(root, C, 'briefs/qa-engineer.md', '# brief with no budget line\n');
    pipeline(root, C, 'expert-notes.json', '{"notes":[{"role":"qa-engineer","findings":[]}]}');
    migrateFeatureEvidence(root);
    expect(readClarification(root, C)).toBeNull();
    expect(readExperts(root, C)?.roster[0]).toMatchObject({
      budget_tokens: 0,
      grounding_truncated: false,
      tokens_used: null,
    });
    expect(readExperts(root, C)?.synthesis).toBeNull();
  });

  it('records a roster with no brief, and experts with no notes', () => {
    const root = project();
    pipeline(root, C, 'experts.json', '{}');
    pipeline(
      root,
      `400-delta-${U_A}`,
      'experts.json',
      '{"experts":[{"role":"qa-engineer","reason":"r"}]}',
    );
    migrateFeatureEvidence(root);
    expect(readExperts(root, C)?.roster).toEqual([]);
    expect(readExperts(root, `400-delta-${U_A}`)?.roster[0]).toMatchObject({ brief_hash: '' });
    expect(readExperts(root, `400-delta-${U_A}`)?.findings).toBeNull();
  });

  it('reports a run it could not migrate and leaves it in place', () => {
    const root = fixture();
    // A directory where request.md belongs makes the write fail.
    mkdirSync(join(root, featureFilePath(A, 'request')), { recursive: true });
    const result = migrateFeatureEvidence(root);
    expect(result.actions.find((action) => action.kind === 'failed')).toMatchObject({ source: A });
    expect(formatEvidenceMigration(result)).toContain(`leave ${A}: migration failed`);
    expect(existsSync(join(root, LEGACY_SPECS_DIR, A))).toBe(true);
    expect(read(root, '.paqad/.gitignore')).toContain('_specs/');
  });

  it('reads the migration session from the host environment', () => {
    expect(migrationSessionId({ SE_SESSION: 'a', CLAUDE_SESSION_ID: 'b' })).toBe('a');
    expect(migrationSessionId({ CLAUDE_SESSION_ID: 'b' })).toBe('b');
    expect(migrationSessionId({})).toBeNull();
    expect(typeof (migrationSessionId() ?? '')).toBe('string');
  });
});

describe('readers on a migrated old bundle and a new one (AC-20)', () => {
  const config: BundleCompletenessConfig = {
    ruleComplianceOn: false,
    metricsEnabled: false,
    duplicationOn: false,
    featureReport: false,
    ragEnabled: false,
    enterprise: false,
    evidenceLedger: false,
    aiBom: false,
    specPipelineStrict: false,
    specPipelineEnabled: true,
    expertsEnabled: true,
    stageIsolationExpected: false,
  };

  it('report, metrics --all, the completeness gate and the spec-change guard all read them', () => {
    const root = fixture();
    migrateFeatureEvidence(root);

    for (const dir of [A, C]) {
      expect(
        writeFeatureReport(root, dir, { generatedAt: '2026-09-25T00:00:00.000Z' }).html,
      ).toContain('<html');
    }

    const metrics = aggregateSpecPipelineMetrics(root, listRunDirs(root));
    expect(metrics.runs).toBeGreaterThanOrEqual(1);
    expect(metrics.label_distribution.okay).toBe(1);
    expect(metrics.experts_fired['qa-engineer']).toBe(1);

    // The migrated old bundle passes, the new files' hashes included (old headers stay unchecked).
    const gate = bundleCompletenessGate({
      projectRoot: root,
      sessionId: 'ses_1',
      dirName: A,
      mode: 'strict',
      origin: 'hook-completion',
      isFeatureDev: true,
      config,
      changeMetrics: null,
    });
    expect(gate?.status, gate?.detail).toBe('pass');

    // The signed source now sits in the bundle and still matches: nothing is stale.
    const guard = runSpecChangeGuard({
      projectRoot: root,
      sessionId: 'ses_1',
      seam: 'pre-mutation',
    });
    expect(guard.ran).toBe(false);
    expect(statSync(join(root, featureFilePath(A, 'specMd'))).isFile()).toBe(true);
  });
});

describe('paqad-ai evidence migrate', () => {
  let out: string[];
  beforeEach(() => {
    out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    process.exitCode = undefined;
  });
  afterEach(() => {
    process.exitCode = undefined;
  });

  async function run(...args: string[]): Promise<void> {
    // Never let a default project root fall back to the real checkout.
    vi.spyOn(process, 'cwd').mockReturnValue(join(tmpdir(), 'paqad-migrate-no-such-root'));
    await createEvidenceCommand().parseAsync(['node', 'evidence', 'migrate', ...args]);
  }

  it('prints the plan and writes nothing with --dry-run', async () => {
    const root = fixture();
    await run('--dry-run', '--project-root', root);
    expect(out.join('')).toContain('Evidence migration (would):');
    expect(existsSync(join(root, LEGACY_SPECS_DIR))).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it('migrates, and exits 1 when a run failed', async () => {
    const root = fixture();
    mkdirSync(join(root, featureFilePath(A, 'request')), { recursive: true });
    await run('--project-root', root);
    expect(out.join('')).toContain('Evidence migration (did):');
    expect(process.exitCode).toBe(1);
  });
});
