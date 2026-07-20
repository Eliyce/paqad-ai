// Per-feature evidence report renderer (issue #371).
//
// A PURE projection of a feature's on-disk bundle into ONE self-contained,
// human-readable HTML page — no LLM, no network, no file reads. It consumes the
// existing `exportFeatureBundle()` document plus the `foldFeature()` result and
// returns an HTML string. The page follows the house contract established by
// `src/dashboard/export-packet.ts`: inline styles only, NO <script> tags, NO
// external requests. Interactivity is CSS-only (`<details>/<summary>`), so it works
// from a `file://` origin and fully offline — which doubles as a provable
// no-tracking property for the compliance story.
//
// Because the page is a pure function of the JSON on disk, its logic is byte-for-byte
// identical whether the change was made in Claude Code, Codex, Gemini, Cursor, or
// anywhere else. That sameness is the point: the chat surface always differs per host;
// the report is the one place paqad's output is exactly the same everywhere.
//
// Honesty is load-bearing. A FAILED gate is rendered as plainly and prominently as a
// PASSED one; a marker-only "thinking" stage reads 🟡 "marked (no recorded work)", never
// 🟢 done; a backstop-closed stage is flagged as including idle time; a receipt whose
// hash chain does not recompute says so. And every section — never a blank gap —
// renders an explicit plain-English note when its source file or field is absent, with a
// distinct note when the absence is because enterprise governance is off (issue #371).

import { createHash } from 'node:crypto';

import {
  PAQAD_STATUS_GLYPH,
  PAQAD_STATUS_LABEL,
  PAQAD_TERM_TRANSLATIONS,
  PAQAD_VERDICT,
  paqadGlyphLegend,
  type PaqadStatusKind,
} from '@/core/constants/paqad-voice.js';
import type { InTotoStatement, ReceiptEnvelope } from '@/core/types/evidence-ledger.js';
import { ZERO_DIGEST } from '@/evidence/digests.js';
import { DSSE_PAYLOAD_TYPE, pae } from '@/evidence/receipt/dsse.js';
import { decodeReceiptStatement } from '@/evidence/receipt/project.js';
import { isMandatoryStage } from '@/stage-evidence/stages.js';
import type { FoldedChange, FoldedStage } from '@/stage-evidence/types.js';

import type { FeatureBundleExport } from './export.js';
import { parseFeatureDirName } from './paths.js';

export interface RenderFeatureReportOptions {
  /** ISO timestamp stamped into the page; supplied so the render is deterministic. */
  generatedAt: string;
  /** The paqad version that produced the change (for the header). */
  paqadVersion?: string | null;
}

// ── Small pure helpers ──────────────────────────────────────────────────────

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Humanise a wall-clock millisecond span: "820ms", "3.1s", "2m 5s", "1h 3m". */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return 'unknown';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) {
    const s = ms / 1000;
    return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes === 0 ? `${hours}h` : `${hours}h ${remMinutes}m`;
}

/** A short clock label (HH:MM:SS UTC) for a timeline row, or '' when absent. */
function clockLabel(iso: string | null): string {
  if (!iso) return '';
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return '';
  return iso.slice(11, 19);
}

const GLYPH_FOR = PAQAD_STATUS_GLYPH;

/** `🟢 done` — a glyph always paired with its word so the line survives the glyph stripped. */
function glyphWord(kind: PaqadStatusKind, word: string): string {
  return `${GLYPH_FOR[kind]} ${escapeHtml(word)}`;
}

// ── Receipt integrity (self-consistency, honest) ─────────────────────────────

export interface ReceiptIntegrity {
  present: boolean;
  /** True only when the envelope's `receipt_hash` recomputes from its own bytes. */
  verified: boolean;
  statement: InTotoStatement | null;
  envelope: ReceiptEnvelope | null;
}

/**
 * Verify a SINGLE feature receipt envelope against ITSELF — recompute
 * `sha256(pae(payloadType, payload) + prev_receipt_hash)` and compare to the recorded
 * `receipt_hash`. A feature receipt is hash-chained to the feature's OWN prior receipt,
 * so `prev_receipt_hash` is legitimately non-zero; `verifyReceiptChain` (which assumes a
 * genesis-rooted array starting at ZERO_DIGEST) would falsely read it as broken. This is
 * the honest per-envelope check: it proves the bytes were not edited after signing, and
 * it is NOT an asymmetric signature — the page says "hash-chained", never "signed".
 */
export function verifyFeatureReceiptSelf(envelope: ReceiptEnvelope): boolean {
  try {
    const payload = Buffer.from(envelope.payload, 'base64');
    const encoded = pae(envelope.payloadType ?? DSSE_PAYLOAD_TYPE, payload);
    const prev = envelope.paqad?.prev_receipt_hash ?? ZERO_DIGEST;
    const expected = createHash('sha256').update(encoded).update(prev).digest('hex');
    return envelope.paqad?.receipt_hash === expected;
  } catch {
    return false;
  }
}

function readReceiptIntegrity(bundle: FeatureBundleExport): ReceiptIntegrity {
  const envelope = (bundle.files.receipt as ReceiptEnvelope | undefined) ?? null;
  if (!envelope || typeof envelope !== 'object' || !envelope.payload) {
    return { present: false, verified: false, statement: null, envelope: null };
  }
  const statement = decodeReceiptStatement(envelope);
  return { present: true, verified: verifyFeatureReceiptSelf(envelope), statement, envelope };
}

// ── Verdict derivation ────────────────────────────────────────────────────────

type VerdictKind = 'pass' | 'fail' | 'inconclusive';

/**
 * The headline verdict, in the contract words. Derived from the same signals the
 * completion gate uses: a failed stage or a failed receipt gate is "Needs your
 * attention"; a complete/recovered change with no failure is "Safe to merge"; an
 * unverifiable change (`cannot-verify`) is "Inconclusive"; anything left (incomplete /
 * blocked) is "Needs your attention" — never dressed up as safe.
 */
export function deriveReportVerdict(
  fold: FoldedChange,
  receiptStatement: InTotoStatement | null,
): VerdictKind {
  const hasFailedStage = fold.stages.some((stage) => stage.state === 'failed');
  const receiptRows = receiptRowsOf(receiptStatement);
  const hasFailedGate =
    receiptRows.some((row) => String(row.verdict).toLowerCase() === 'fail') ||
    String(receiptStatement?.predicate?.verification_result ?? '').toUpperCase() === 'FAILED';
  if (hasFailedStage || hasFailedGate) return 'fail';
  const verdict = fold.completeness.verdict;
  if (verdict === 'complete' || verdict === 'recovered') return 'pass';
  if (verdict === 'cannot-verify') return 'inconclusive';
  return 'fail';
}

interface ReceiptRow {
  engine?: string;
  code?: string;
  verdict?: string;
  strength_class?: string;
  detail?: string;
  content_hash?: string;
}

function receiptRowsOf(statement: InTotoStatement | null): ReceiptRow[] {
  const rows = (statement?.predicate as { rows?: unknown } | undefined)?.rows;
  return Array.isArray(rows) ? (rows as ReceiptRow[]) : [];
}

/**
 * De-duplicate graded rows by their `content_hash` (which excludes `ts`), so a receipt
 * that carries the same gate result twice from repeated verify passes shows it once.
 */
function dedupeByHash(rows: ReceiptRow[]): ReceiptRow[] {
  const seen = new Set<string>();
  const out: ReceiptRow[] = [];
  for (const row of rows) {
    const key = row.content_hash ?? `${row.engine}\0${row.code}\0${row.verdict}\0${row.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

const VERDICT_WORD: Record<VerdictKind, string> = {
  pass: PAQAD_VERDICT.pass,
  fail: PAQAD_VERDICT.fail,
  inconclusive: PAQAD_VERDICT.inconclusive,
};

const VERDICT_KIND_GLYPH: Record<VerdictKind, PaqadStatusKind> = {
  pass: 'good',
  fail: 'failed',
  inconclusive: 'needsLook',
};

// ── Stage timeline ────────────────────────────────────────────────────────────

interface StageView {
  glyphKind: PaqadStatusKind;
  word: string;
  note: string;
}

/**
 * Map one folded stage to its honest glyph + note for the timeline. Mirrors the
 * end-of-change receipt's honesty (`src/verification/repository/receipt.ts`) and adds the
 * report-only "includes idle time" flag for a stage a backstop closed hours later.
 */
function stageView(stage: FoldedStage, endAdapter: string | null): StageView {
  switch (stage.state) {
    case 'complete':
    case 'redone': {
      if (stage.duration_unreliable) {
        return {
          glyphKind: 'needsLook',
          word: PAQAD_STATUS_LABEL.needsLook,
          note: 'marked (near-zero duration — no recorded work)',
        };
      }
      let note =
        stage.evidence_source === 'inferred-git'
          ? 'done (reconstructed from the diff)'
          : stage.evidence_source === 'inferred-artifact'
            ? 'done (inferred from an artifact)'
            : 'done';
      if (endAdapter === 'backstop') {
        note = `${note} — includes idle time (closed by the completion backstop)`;
      }
      if (stage.state === 'redone') note = `${note} (redone)`;
      return { glyphKind: 'good', word: PAQAD_STATUS_LABEL.good, note };
    }
    case 'inconclusive':
      return {
        glyphKind: 'needsLook',
        word: PAQAD_STATUS_LABEL.needsLook,
        note: 'marked (no recorded work)',
      };
    case 'failed':
      return { glyphKind: 'failed', word: PAQAD_STATUS_LABEL.failed, note: 'failed' };
    case 'running':
      return {
        glyphKind: 'needsLook',
        word: PAQAD_STATUS_LABEL.needsLook,
        note: 'started, not finished',
      };
    case 'skipped':
      return { glyphKind: 'skipped', word: PAQAD_STATUS_LABEL.skipped, note: 'skipped' };
    default:
      // 'missing' (a mandatory stage with no record) and any other unhandled state.
      return {
        glyphKind: 'needsLook',
        word: PAQAD_STATUS_LABEL.needsLook,
        note: 'not recorded',
      };
  }
}

/** The `stage_end` adapter for a stage, from the raw rows (drives the idle-time flag). */
function stageEndAdapter(rawStageRows: LooseRow[], stage: string): string | null {
  let adapter: string | null = null;
  for (const row of rawStageRows) {
    if (row.kind === 'stage_end' && row.stage === stage && typeof row.adapter === 'string') {
      adapter = row.adapter;
    }
  }
  return adapter;
}

type LooseRow = Record<string, unknown>;

function asRows(value: unknown): LooseRow[] {
  return Array.isArray(value) ? (value as LooseRow[]) : [];
}

// ── Section rendering ─────────────────────────────────────────────────────────

/**
 * A drill-in detail panel with a stable `id` so the submenu can navigate to it. Panels
 * are hidden until targeted (CSS `:target`) so the page opens on the overview and reveals
 * one section at a time — "first glance overview, then go deeper". `emptyNote` renders
 * when `body` is empty, so a section is never a blank gap. Print shows every panel.
 */
function panel(id: string, title: string, body: string, emptyNote?: string): string {
  const inner =
    body.trim().length > 0
      ? body
      : `<p class="empty">${escapeHtml(emptyNote ?? 'Nothing recorded.')}</p>`;
  return `<section class="panel" id="${escapeHtml(id)}"><div class="panel-head"><h2>${escapeHtml(title)}</h2><a class="back" href="#overview">↑ overview</a></div>${inner}</section>`;
}

function renderTimeline(fold: FoldedChange, rawStageRows: LooseRow[]): string {
  // Show every mandatory stage (a missing one reads "not recorded", honestly) plus any
  // optional stage that actually ran.
  const shown = fold.stages.filter(
    (stage) =>
      isMandatoryStage(stage.stage) || stage.started_at !== null || stage.ended_at !== null,
  );
  const items = shown
    .map((stage) => {
      const view = stageView(stage, stageEndAdapter(rawStageRows, stage.stage));
      const label = escapeHtml(stage.stage.replace(/_/g, ' '));
      const start = clockLabel(stage.started_at);
      const end = clockLabel(stage.ended_at);
      const duration =
        stage.duration_ms !== null && !stage.duration_unreliable
          ? formatDuration(stage.duration_ms)
          : stage.started_at && !stage.ended_at
            ? 'open'
            : '—';
      const timing =
        start || end
          ? `<span class="when">${escapeHtml(start || '—')}${end ? ` → ${escapeHtml(end)}` : ''}</span>`
          : '';
      return `<li class="stage"><span class="glyph">${GLYPH_FOR[view.glyphKind]}</span><span class="stage-name">${label}</span><span class="dur">${escapeHtml(duration)}</span><span class="stage-note">${glyphWordless(view.word)} · ${escapeHtml(view.note)}</span>${timing}</li>`;
    })
    .join('');
  return panel('timeline', 'Timeline', `<ol class="timeline">${items}</ol>`);
}

/** The status WORD without a glyph (the timeline already prints the glyph in its own cell). */
function glyphWordless(word: string): string {
  return `<span class="word">${escapeHtml(word)}</span>`;
}

function renderPlan(bundle: FeatureBundleExport): string {
  const plan = bundle.files.plan as
    | {
        summary?: string;
        steps?: { id?: string; description?: string; module?: string }[];
        decisions?: string[];
        risks?: { description?: string; mitigation?: string }[];
        modules_touched?: string[];
        reuse?: {
          consulted?: { source?: string; query?: string; target?: string; hits?: number }[];
          reusing?: { symbol?: string; file?: string; how?: string; package?: string }[];
          new_constructs?: { name?: string; justification?: string }[];
        };
      }
    | undefined;
  if (!plan) {
    return panel(
      'plan',
      'Plan',
      '',
      'No plan was recorded for this change. The plan is written when the planning stage is compiled (paqad-ai plan compile).',
    );
  }
  const parts: string[] = [];
  if (plan.summary) parts.push(`<p>${escapeHtml(plan.summary)}</p>`);
  const steps = plan.steps ?? [];
  if (steps.length > 0) {
    const items = steps
      .map(
        (step) =>
          `<li><strong>${escapeHtml(step.id ?? '')}</strong> ${escapeHtml(step.description ?? '')}${step.module ? ` <span class="tag">${escapeHtml(step.module)}</span>` : ''}</li>`,
      )
      .join('');
    parts.push(`<h3>Steps</h3><ol class="steps">${items}</ol>`);
  }
  const decisions = plan.decisions ?? [];
  if (decisions.length > 0) {
    parts.push(
      `<h3>Decisions</h3><ul>${decisions.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`,
    );
  }
  const risks = plan.risks ?? [];
  if (risks.length > 0) {
    const items = risks
      .map(
        (risk) =>
          `<li><span class="risk">${escapeHtml(risk.description ?? '')}</span><span class="mitigation">Mitigation: ${escapeHtml(risk.mitigation ?? '—')}</span></li>`,
      )
      .join('');
    parts.push(`<h3>Risks</h3><ul class="risks">${items}</ul>`);
  }
  const reuse = plan.reuse;
  if (reuse) {
    // Issue #357 — what the plan checked before building. Rendered as three plain lists so
    // the reader can see the reuse question was actually answered, not just claimed.
    const consulted = (reuse.consulted ?? [])
      .map(
        (entry) =>
          `<li><span class="tag">${escapeHtml(entry.source ?? '')}</span> ${escapeHtml(entry.query ?? '')}${entry.target ? ` <span class="tag">${escapeHtml(entry.target)}</span>` : ''} — ${entry.hits ?? 0} hit(s)</li>`,
      )
      .join('');
    const reusing = (reuse.reusing ?? [])
      .map(
        (claim) =>
          `<li><strong>${escapeHtml(claim.symbol ?? '')}</strong>${claim.package ? ` <span class="tag">${escapeHtml(claim.package)}</span>` : claim.file ? ` <span class="tag">${escapeHtml(claim.file)}</span>` : ''} — ${escapeHtml(claim.how ?? '')}</li>`,
      )
      .join('');
    const constructs = (reuse.new_constructs ?? [])
      .map(
        (construct) =>
          `<li><strong>${escapeHtml(construct.name ?? '')}</strong> — ${escapeHtml(construct.justification ?? '')}</li>`,
      )
      .join('');
    parts.push('<h3>Reuse</h3>');
    if (consulted) parts.push(`<h4>Consulted</h4><ul class="consulted">${consulted}</ul>`);
    if (reusing) parts.push(`<h4>Reusing</h4><ul class="reusing">${reusing}</ul>`);
    if (constructs)
      parts.push(`<h4>New, justified</h4><ul class="new-constructs">${constructs}</ul>`);
  }
  return panel('plan', 'Plan', parts.join(''), 'The plan is empty.');
}

function renderSpec(bundle: FeatureBundleExport): string {
  const spec = bundle.files.specification as
    | {
        behaviour?: string[];
        acceptance_criteria?: {
          criterion_id?: string;
          given?: string;
          when?: string;
          then?: string;
          proof_type?: string;
        }[];
        invariants?: { invariant_id?: string; statement?: string; confirmed?: boolean }[];
        frozen?: { frozen_at?: string; signed_off_by?: string } | null;
      }
    | undefined;
  if (!spec) {
    return panel(
      'spec',
      'Specification',
      '',
      'No frozen specification was recorded. The spec is written when it is frozen before code (paqad-ai spec freeze).',
    );
  }
  const parts: string[] = [];
  if (spec.frozen?.frozen_at) {
    parts.push(
      `<p class="freeze">${glyphWord('good', 'Frozen')} ${escapeHtml(clockLabel(spec.frozen.frozen_at) || spec.frozen.frozen_at)}${spec.frozen.signed_off_by ? `, signed off by ${escapeHtml(spec.frozen.signed_off_by)}` : ''}.</p>`,
    );
  }
  const behaviour = spec.behaviour ?? [];
  if (behaviour.length > 0) {
    parts.push(
      `<h3>Behaviour</h3><ul>${behaviour.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`,
    );
  }
  const acs = spec.acceptance_criteria ?? [];
  if (acs.length > 0) {
    const items = acs
      .map((ac) => {
        // The parser can truncate a `then` mid-sentence (observed: "then": "the") — render
        // defensively, showing whatever is present.
        const gwt = [
          ac.given ? `<span class="gwt-k">Given</span> ${escapeHtml(ac.given)}` : '',
          ac.when ? `<span class="gwt-k">When</span> ${escapeHtml(ac.when)}` : '',
          ac.then ? `<span class="gwt-k">Then</span> ${escapeHtml(ac.then)}` : '',
        ]
          .filter(Boolean)
          .join(' ');
        return `<li class="ac"><strong>${escapeHtml(ac.criterion_id ?? '')}</strong> ${gwt || '<span class="empty">no given/when/then recorded</span>'}${ac.proof_type ? ` <span class="tag">${escapeHtml(ac.proof_type)}</span>` : ''}</li>`;
      })
      .join('');
    parts.push(`<h3>Acceptance criteria</h3><ul class="acs">${items}</ul>`);
  }
  const invariants = spec.invariants ?? [];
  if (invariants.length > 0) {
    const items = invariants
      .map(
        (inv) =>
          `<li>${inv.confirmed ? glyphWord('good', 'confirmed') : glyphWord('needsLook', 'unconfirmed')} <strong>${escapeHtml(inv.invariant_id ?? '')}</strong> ${escapeHtml(inv.statement ?? '')}</li>`,
      )
      .join('');
    parts.push(`<h3>Invariants</h3><ul class="invariants">${items}</ul>`);
  }
  return panel('spec', 'Specification', parts.join(''), 'The specification is empty.');
}

function renderRules(bundle: FeatureBundleExport): string {
  const rows = asRows(bundle.files.ruleRun);
  if (rows.length === 0) {
    return panel(
      'rules',
      'Rules',
      '',
      'No rule-script runs were recorded. Rule scripts run during the checks stage of a feature-development change.',
    );
  }
  let deterministic = 0;
  let heuristic = 0;
  let skipped = 0;
  let blocked = false;
  for (const row of rows) {
    const counts = (row.counts as Record<string, number> | undefined) ?? {};
    deterministic += Number(counts.deterministic ?? 0);
    heuristic += Number(counts.heuristic ?? 0);
    skipped += Number(counts.skipped ?? 0);
    if (row.blocking === true) blocked = true;
  }
  const total = deterministic + heuristic + skipped;
  const blockLine = blocked
    ? `<p>${glyphWord('failed', 'Blocked')}: at least one rule run blocked the change.</p>`
    : `<p>${glyphWord('good', 'Clear')}: no rule run blocked the change.</p>`;
  const body =
    `<p>${rows.length} rule run${rows.length === 1 ? '' : 's'} recorded, ${total} finding${total === 1 ? '' : 's'} in total ` +
    `(${deterministic} deterministic · ${heuristic} heuristic · ${skipped} skipped).</p>${blockLine}`;
  return panel('rules', 'Rules', body);
}

function renderRetrieval(bundle: FeatureBundleExport): string {
  const rows = asRows(bundle.files.rag);
  if (rows.length === 0) {
    return panel(
      'retrieval',
      'Retrieval',
      '',
      'No retrieval was recorded for this change (grep is the honest default; RAG is an optional accelerator).',
    );
  }
  const byKind = new Map<string, number>();
  for (const row of rows) {
    const kind = typeof row.kind === 'string' ? row.kind : 'other';
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  }
  const refreshed = byKind.get('refreshed') ?? 0;
  const called = byKind.get('called') ?? 0;
  const used = byKind.get('used') ?? 0;
  const fallback = byKind.get('fallback') ?? 0;
  const lines: string[] = [];
  if (called > 0) lines.push(`retrieval ran ${called} time${called === 1 ? '' : 's'}`);
  if (used > 0) lines.push(`delivered context ${used} time${used === 1 ? '' : 's'}`);
  if (fallback > 0)
    lines.push(
      `fell back to grep ${fallback} time${fallback === 1 ? '' : 's'} (scores were below the floor)`,
    );
  if (refreshed > 0)
    lines.push(`refreshed the index ${refreshed} time${refreshed === 1 ? '' : 's'}`);
  const summary = lines.length > 0 ? `${lines.join(', ')}.` : 'Retrieval activity recorded.';
  const body = `<p>${escapeHtml(summary.charAt(0).toUpperCase() + summary.slice(1))}</p>`;
  return panel('retrieval', 'Retrieval', body);
}

function renderReceipt(integrity: ReceiptIntegrity): string {
  if (!integrity.present) {
    return panel(
      'receipt',
      'Verification receipt',
      '',
      'No verification receipt was written. The signed receipt is an enterprise governance capability — enable enterprise (and enterprise_evidence_ledger) to record it. The gates still ran; only the receipt file is gated off.',
    );
  }
  const statement = integrity.statement;
  const result = String(statement?.predicate?.verification_result ?? '').toUpperCase();
  const resultKind: PaqadStatusKind =
    result === 'PASSED' ? 'good' : result === 'FAILED' ? 'failed' : 'needsLook';
  const integrityLine = integrity.verified
    ? `${glyphWord('good', 'Integrity verified')} — the receipt's hash chain recomputes from its own bytes (hash-chained, not a signature).`
    : `${glyphWord('failed', 'Could not verify integrity')} — the receipt's hash chain does not recompute; treat it as tampered or corrupt.`;
  const rows = dedupeByHash(receiptRowsOf(statement));
  const rowsHtml =
    rows.length > 0
      ? `<table class="gates"><thead><tr><th>Gate</th><th>Result</th><th>Detail</th></tr></thead><tbody>${rows
          .map((row) => {
            const v = String(row.verdict ?? '').toLowerCase();
            const kind: PaqadStatusKind =
              v === 'pass' ? 'good' : v === 'fail' ? 'failed' : 'needsLook';
            return `<tr><td><code>${escapeHtml(row.code ?? '')}</code></td><td>${GLYPH_FOR[kind]} ${escapeHtml(row.verdict ?? '')}</td><td>${escapeHtml(row.detail ?? '')}</td></tr>`;
          })
          .join('')}</tbody></table>`
      : '<p class="empty">The receipt carries no graded gate rows.</p>';
  const body =
    `<p class="receipt-result">Result: ${GLYPH_FOR[resultKind]} ${escapeHtml(result || 'n/a')}</p>` +
    `<p>${integrityLine}</p>${rowsHtml}`;
  return panel('receipt', 'Verification receipt', body);
}

function renderAiBom(bundle: FeatureBundleExport): string {
  const aiBom = bundle.files.aiBom as
    | { serialNumber?: string; components?: { name?: string; hashes?: { content?: string }[] }[] }
    | undefined;
  if (!aiBom) {
    return panel(
      'aibom',
      'AI bill of materials',
      '',
      'No AI-BOM was written. The CycloneDX AI-BOM is an enterprise governance capability — enable enterprise (and enterprise_ai_bom) to record it.',
    );
  }
  const components = aiBom.components ?? [];
  const rows = components
    .map(
      (component) =>
        `<tr><td><code>${escapeHtml(component.name ?? '')}</code></td><td><code class="sha">${escapeHtml((component.hashes?.[0]?.content ?? '').slice(0, 16))}</code></td></tr>`,
    )
    .join('');
  const table =
    components.length > 0
      ? `<table class="bom"><thead><tr><th>File</th><th>SHA-256</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="empty">No file components recorded.</p>';
  const body = `<p>${components.length} file${components.length === 1 ? '' : 's'} inventoried${aiBom.serialNumber ? ` · CycloneDX serial <code>${escapeHtml(aiBom.serialNumber)}</code>` : ''}.</p>${table}`;
  return panel('aibom', 'AI bill of materials', body);
}

function renderDelivery(bundle: FeatureBundleExport): string {
  const delivery = bundle.files.delivery as
    | {
        branch?: string | null;
        base_branch?: string | null;
        commits?: { sha?: string; subject?: string }[];
        head_sha?: string | null;
        merge_commit?: string | null;
      }
    | undefined;
  if (!delivery) {
    return panel(
      'delivery',
      'Delivery',
      '',
      'No delivery record yet. The commit trail is linked by the git post-commit / post-merge hooks once the change is committed.',
    );
  }
  const commits = delivery.commits ?? [];
  const parts: string[] = [];
  parts.push(
    `<p>Branch <code>${escapeHtml(delivery.branch ?? 'unknown')}</code>${delivery.base_branch ? ` onto <code>${escapeHtml(delivery.base_branch)}</code>` : ''}.</p>`,
  );
  if (commits.length > 0) {
    const items = commits
      .map(
        (commit) =>
          `<li><code class="sha">${escapeHtml((commit.sha ?? '').slice(0, 10))}</code> ${escapeHtml(commit.subject ?? '')}</li>`,
      )
      .join('');
    parts.push(
      `<p>${commits.length} commit${commits.length === 1 ? '' : 's'}${delivery.merge_commit ? `, merged as <code class="sha">${escapeHtml(delivery.merge_commit.slice(0, 10))}</code>` : ''}.</p><ul class="commits">${items}</ul>`,
    );
  } else {
    parts.push('<p class="empty">No commits linked yet.</p>');
  }
  return panel('delivery', 'Delivery', parts.join(''));
}

/**
 * Render the review from the bundle's rigid `review.json` (issue #402). This used to read
 * an agent-authored `.md` discovered from the review stage row — a design that invited the
 * model to free-write a review file, which is how `review-notes.md` landed in a bundle dir.
 * The review is now a rigid record like the plan, so it renders structurally.
 */
function renderReview(bundle: FeatureBundleExport): string {
  const review = bundle.files.review as
    | {
        summary?: string;
        verdict?: string;
        findings?: { severity?: string; description?: string; file?: string }[];
        checked?: string[];
        rollback?: string;
      }
    | undefined;
  if (!review) {
    return panel(
      'review',
      'Review',
      '',
      'No review was recorded for this change. The review is written when the review stage is recorded (paqad-ai review record).',
    );
  }
  const parts: string[] = [];
  if (review.verdict) {
    parts.push(
      `<p class="verdict"><strong>${escapeHtml(reviewVerdictLabel(review.verdict))}</strong></p>`,
    );
  }
  if (review.summary) parts.push(`<p>${escapeHtml(review.summary)}</p>`);
  const findings = review.findings ?? [];
  if (findings.length > 0) {
    const items = findings
      .map(
        (finding) =>
          `<li><span class="tag">${escapeHtml(finding.severity ?? '')}</span> ${escapeHtml(finding.description ?? '')}${finding.file ? ` <code>${escapeHtml(finding.file)}</code>` : ''}</li>`,
      )
      .join('');
    parts.push(`<h3>Findings</h3><ul class="findings">${items}</ul>`);
  } else {
    parts.push('<p class="empty">No findings were raised.</p>');
  }
  const checked = review.checked ?? [];
  if (checked.length > 0) {
    parts.push(
      `<h3>Checked</h3><ul>${checked.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`,
    );
  }
  if (review.rollback) {
    parts.push(`<h3>Rollback</h3><p>${escapeHtml(review.rollback)}</p>`);
  }
  return panel('review', 'Review', parts.join(''));
}

/** The narration contract's verdict words, spelled the way paqad says them. */
function reviewVerdictLabel(verdict: string): string {
  if (verdict === 'safe-to-merge') return 'Safe to merge';
  if (verdict === 'needs-attention') return 'Needs your attention';
  if (verdict === 'inconclusive') return 'Inconclusive';
  return verdict;
}

function renderFooter(): string {
  const legend = escapeHtml(paqadGlyphLegend());
  const terms = PAQAD_TERM_TRANSLATIONS.map(
    (translation) =>
      `<tr><td class="term">${escapeHtml(translation.term)}</td><td>${escapeHtml(translation.plain)}</td></tr>`,
  ).join('');
  return `<footer class="footer">
<p class="legend">${legend}</p>
<details><summary><span class="h3">What these words mean</span></summary>
<table class="terms"><tbody>${terms}</tbody></table>
</details>
<p class="provenance">This page was generated locally by a script. No AI was involved, and no data left this machine.</p>
</footer>`;
}

// ── Overview (the at-a-glance dashboard) ──────────────────────────────────────

interface OverviewTile {
  /** The section id this tile drills into. */
  target: string;
  label: string;
  /** The big value (a number, a duration, a short status word). */
  value: string;
  /** A one-line sub-caption under the value. */
  sub: string;
  /** Status glyph kind — present only for genuine status tiles (never decoration). */
  kind?: PaqadStatusKind;
}

/** Total wall-clock across stages whose duration is reliable (idle-inflated ends excluded). */
function totalReliableDuration(fold: FoldedChange): number {
  return fold.stages.reduce(
    (sum, stage) =>
      stage.duration_ms !== null && !stage.duration_unreliable ? sum + stage.duration_ms : sum,
    0,
  );
}

/** Build the overview stat tiles from the same data the detail panels render. */
function buildOverviewTiles(
  bundle: FeatureBundleExport,
  fold: FoldedChange,
  integrity: ReceiptIntegrity,
): OverviewTile[] {
  const tiles: OverviewTile[] = [];

  // Stages — a status tile.
  const passed = fold.completeness.required_passed;
  const total = fold.completeness.required_total;
  tiles.push({
    target: 'timeline',
    label: 'Stages recorded',
    value: `${passed}/${total}`,
    sub: passed >= total ? 'all mandatory stages done' : 'some stages incomplete',
    kind: passed >= total ? 'good' : 'needsLook',
  });

  // Active time — a metric tile (no status glyph).
  tiles.push({
    target: 'timeline',
    label: 'Active time',
    value: formatDuration(totalReliableDuration(fold)),
    sub: 'summed across recorded stages',
  });

  // Rules — a status tile.
  const ruleRows = asRows(bundle.files.ruleRun);
  let findings = 0;
  let blocked = false;
  for (const row of ruleRows) {
    const counts = (row.counts as Record<string, number> | undefined) ?? {};
    findings += Number(counts.deterministic ?? 0) + Number(counts.heuristic ?? 0);
    if (row.blocking === true) blocked = true;
  }
  tiles.push({
    target: 'rules',
    label: 'Rule findings',
    value: ruleRows.length === 0 ? '—' : String(findings),
    sub:
      ruleRows.length === 0
        ? 'no rule runs'
        : blocked
          ? 'a rule blocked the change'
          : 'nothing blocked',
    kind: ruleRows.length === 0 ? 'skipped' : blocked ? 'failed' : 'good',
  });

  // Retrieval — a metric tile.
  const ragRows = asRows(bundle.files.rag);
  tiles.push({
    target: 'retrieval',
    label: 'Retrieval events',
    value: ragRows.length === 0 ? '—' : String(ragRows.length),
    sub: ragRows.length === 0 ? 'grep only (RAG not used)' : 'index + query activity',
  });

  // Receipt — a status tile.
  tiles.push({
    target: 'receipt',
    label: 'Verification receipt',
    value: !integrity.present ? 'Off' : integrity.verified ? 'Verified' : 'Unverifiable',
    sub: !integrity.present
      ? 'enterprise governance off'
      : integrity.verified
        ? 'hash chain recomputes'
        : 'hash chain does not recompute',
    kind: !integrity.present ? 'skipped' : integrity.verified ? 'good' : 'failed',
  });

  // AI-BOM — a metric tile.
  const aiBom = bundle.files.aiBom as { components?: unknown[] } | undefined;
  const componentCount = Array.isArray(aiBom?.components) ? aiBom.components.length : null;
  tiles.push({
    target: 'aibom',
    label: 'AI-BOM files',
    value: aiBom === undefined ? 'Off' : String(componentCount ?? 0),
    sub: aiBom === undefined ? 'enterprise governance off' : 'inventoried with SHA-256',
  });

  // Delivery — a metric tile.
  const delivery = bundle.files.delivery as
    { branch?: string | null; commits?: unknown[] } | undefined;
  const commitCount = Array.isArray(delivery?.commits) ? delivery.commits.length : 0;
  tiles.push({
    target: 'delivery',
    label: 'Commits',
    value: delivery === undefined ? '—' : String(commitCount),
    sub: delivery?.branch ? `on ${delivery.branch}` : 'not linked yet',
  });

  return tiles;
}

/** Render the overview: the verdict hero + the clickable stat tiles. */
function renderOverview(
  title: string,
  headerMeta: string,
  verdict: VerdictKind,
  tiles: OverviewTile[],
): string {
  const hero = `<a class="hero ${verdict}" href="#timeline"><span class="hero-verdict">${GLYPH_FOR[VERDICT_KIND_GLYPH[verdict]]} ${escapeHtml(VERDICT_WORD[verdict])}</span><span class="hero-meta">${headerMeta}</span></a>`;
  const cards = tiles
    .map(
      (tile) =>
        `<a class="tile" href="#${escapeHtml(tile.target)}"><span class="tile-label">${escapeHtml(tile.label)}</span><span class="tile-value">${tile.kind ? `${GLYPH_FOR[tile.kind]} ` : ''}${escapeHtml(tile.value)}</span><span class="tile-sub">${escapeHtml(tile.sub)}</span></a>`,
    )
    .join('');
  return `<section id="overview" class="overview"><h1 class="page-title">${escapeHtml(title)}</h1>${hero}<div class="tiles">${cards}</div></section>`;
}

/** The sticky submenu that drills into each detail section. */
function renderSubmenu(): string {
  const items: [string, string][] = [
    ['overview', 'Overview'],
    ['timeline', 'Timeline'],
    ['plan', 'Plan'],
    ['spec', 'Spec'],
    ['rules', 'Rules'],
    ['retrieval', 'Retrieval'],
    ['receipt', 'Receipt'],
    ['aibom', 'AI-BOM'],
    ['delivery', 'Delivery'],
    ['review', 'Review'],
  ];
  return `<nav class="submenu">${items
    .map(([id, label]) => `<a href="#${id}">${escapeHtml(label)}</a>`)
    .join('')}</nav>`;
}

// ── Assembly ────────────────────────────────────────────────────────────────

const STYLE = `
:root{color-scheme:light dark;--bg:#fafafa;--card:#ffffff;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--accent:#2563eb;--good:#16a34a;--fail:#dc2626;--warn:#d97706;--tag:#eef2ff;--tag-ink:#3730a3;--bar:#0f172a;--bar-fg:#f8fafc}
@media (prefers-color-scheme:dark){:root{--bg:#0b1020;--card:#111827;--ink:#e5e7eb;--muted:#94a3b8;--line:#1f2937;--accent:#60a5fa;--good:#4ade80;--fail:#f87171;--warn:#fbbf24;--tag:#1e293b;--tag-ink:#c7d2fe;--bar:#111827;--bar-fg:#f8fafc}}
:root[data-theme=dark]{--bg:#0b1020;--card:#111827;--ink:#e5e7eb;--muted:#94a3b8;--line:#1f2937;--accent:#60a5fa;--good:#4ade80;--fail:#f87171;--warn:#fbbf24;--tag:#1e293b;--tag-ink:#c7d2fe;--bar:#111827;--bar-fg:#f8fafc}
:root[data-theme=light]{--bg:#fafafa;--card:#ffffff;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--accent:#2563eb;--good:#16a34a;--fail:#dc2626;--warn:#d97706;--tag:#eef2ff;--tag-ink:#3730a3;--bar:#0f172a;--bar-fg:#f8fafc}
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;color:var(--ink);background:var(--bg);margin:0;line-height:1.5;font-size:15px}
main{max-width:900px;margin:0 auto;padding:20px}
h1,h2,.h2,h3,.h3{margin:0}
.page-title{font-size:22px;font-weight:650;margin:0 0 14px}
/* Top bar with the paqad wordmark */
.topbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;background:var(--bar);color:var(--bar-fg);padding:12px 20px}
.brand{font-size:17px;font-weight:700;letter-spacing:.01em;display:flex;align-items:baseline;gap:6px}
.brand .mark{color:#60a5fa;font-size:18px}
.brand-sub{color:color-mix(in srgb,var(--bar-fg) 65%,transparent);font-size:13px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.verdict-pill{font-size:13px;font-weight:640;padding:5px 12px;border-radius:999px;text-decoration:none;border:1px solid transparent;white-space:nowrap}
.verdict-pill.pass{background:color-mix(in srgb,var(--good) 22%,transparent);color:var(--bar-fg);border-color:var(--good)}
.verdict-pill.fail{background:color-mix(in srgb,var(--fail) 26%,transparent);color:var(--bar-fg);border-color:var(--fail)}
.verdict-pill.inconclusive{background:color-mix(in srgb,var(--warn) 26%,transparent);color:var(--bar-fg);border-color:var(--warn)}
/* Sticky submenu */
.submenu{position:sticky;top:47px;z-index:4;display:flex;gap:2px;flex-wrap:wrap;background:var(--bg);border-bottom:1px solid var(--line);padding:8px 20px}
.submenu a{color:var(--muted);text-decoration:none;font-size:13px;font-weight:560;padding:5px 10px;border-radius:7px}
.submenu a:hover{background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent)}
/* Overview hero + tiles */
.hero{display:flex;flex-direction:column;gap:4px;border-radius:14px;padding:18px 20px;margin:0 0 18px;border:1px solid var(--line);text-decoration:none;color:inherit}
.hero.pass{background:color-mix(in srgb,var(--good) 13%,transparent);border-color:var(--good)}
.hero.fail{background:color-mix(in srgb,var(--fail) 13%,transparent);border-color:var(--fail)}
.hero.inconclusive{background:color-mix(in srgb,var(--warn) 13%,transparent);border-color:var(--warn)}
.hero-verdict{font-size:20px;font-weight:680}
.hero-meta{color:var(--muted);font-size:12.5px}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin:0 0 8px}
.tile{display:flex;flex-direction:column;gap:3px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;text-decoration:none;color:inherit}
.tile:hover{border-color:var(--accent)}
.tile-label{color:var(--muted);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.03em}
.tile-value{font-size:24px;font-weight:680;font-variant-numeric:tabular-nums}
.tile-sub{color:var(--muted);font-size:12.5px}
/* Detail panels — hidden until the submenu targets them */
.panel{display:none;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:18px 0;scroll-margin-top:96px}
.panel:target{display:block}
.panel-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 0 10px}
.panel-head h2{font-size:17px;font-weight:620}
.back{font-size:12px;color:var(--muted);text-decoration:none;white-space:nowrap}
.back:hover{color:var(--accent)}
h3,.h3{font-size:13px;font-weight:620;margin:16px 0 6px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em}
.empty{color:var(--muted);font-style:italic;margin:6px 0}
.muted{color:var(--muted);font-weight:400}
ul,ol{margin:6px 0;padding-left:20px}
li{margin:4px 0}
.timeline{list-style:none;padding:0}
.stage{display:grid;grid-template-columns:22px 150px 74px 1fr;gap:8px;align-items:baseline;padding:7px 0;border-bottom:1px solid var(--line)}
.stage:last-child{border-bottom:0}
.stage-name{font-weight:560;text-transform:capitalize}
.dur{color:var(--muted);font-variant-numeric:tabular-nums;font-size:13px}
.stage-note{color:var(--ink);font-size:13px}
.stage .when{grid-column:2 / -1;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.word{font-weight:560}
.tag{background:var(--tag);color:var(--tag-ink);border-radius:6px;padding:1px 7px;font-size:12px;font-weight:560}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;background:color-mix(in srgb,var(--muted) 12%,transparent);border-radius:5px;padding:1px 5px}
code.sha{letter-spacing:.02em}
table{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.03em;font-size:11.5px}
.risks li,.acs li{margin:8px 0}
.mitigation{display:block;color:var(--muted);font-size:13px}
.gwt-k{font-weight:640;color:var(--accent)}
.freeze{margin:0 0 4px}
pre.review{white-space:pre-wrap;word-break:break-word;background:color-mix(in srgb,var(--muted) 8%,transparent);border-radius:8px;padding:12px;font-size:13px;overflow-x:auto}
summary{cursor:pointer;list-style:revert}
.footer{color:var(--muted);font-size:13px;margin-top:24px;border-top:1px solid var(--line);padding-top:16px}
.legend{font-size:13px}
.terms td{border:0;padding:3px 8px 3px 0}
.terms .term{font-weight:600;color:var(--ink);white-space:nowrap}
.provenance{margin-top:12px;font-style:italic}
@page{margin:16mm}
/* Print: reveal every panel and the full page so a Save-as-PDF is complete. */
@media print{.topbar{position:static}.submenu{display:none}.panel{display:block!important;break-inside:avoid;border-color:#bbb}.back{display:none}body{background:#fff;color:#000}}
`;

/**
 * Render a feature's evidence bundle into ONE self-contained HTML page (issue #371).
 * Pure: no file reads, no network, no model. Every section renders whatever exists and
 * a graceful plain-English note for whatever does not.
 */
export function renderFeatureReportHtml(
  bundle: FeatureBundleExport,
  fold: FoldedChange,
  options: RenderFeatureReportOptions,
): string {
  const parts = parseFeatureDirName(bundle.dir_name);
  const plan = bundle.files.plan as { title?: string } | undefined;
  const title =
    plan?.title ??
    (parts ? parts.slug.replace(/-/g, ' ') : bundle.dir_name).replace(/\b\w/g, (c) =>
      c.toUpperCase(),
    );
  const integrity = readReceiptIntegrity(bundle);
  const verdict = deriveReportVerdict(fold, integrity.statement);
  const rawStageRows = asRows(bundle.files.stageEvidence);

  const headerMeta = [
    parts?.issue ? `Issue #${escapeHtml(parts.issue)}` : '',
    parts?.ulid ? `ULID ${escapeHtml(parts.ulid)}` : '',
    `Generated ${escapeHtml(options.generatedAt)}`,
    options.paqadVersion ? `paqad ${escapeHtml(options.paqadVersion)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const tiles = buildOverviewTiles(bundle, fold, integrity);

  const topbar = `<header class="topbar"><div class="brand"><span class="mark">▸</span> paqad</div><div class="brand-sub">evidence report · ${escapeHtml(title)}</div><a class="verdict-pill ${verdict}" href="#overview">${GLYPH_FOR[VERDICT_KIND_GLYPH[verdict]]} ${escapeHtml(VERDICT_WORD[verdict])}</a></header>`;

  const body = [
    renderOverview(title, headerMeta, verdict, tiles),
    renderTimeline(fold, rawStageRows),
    renderPlan(bundle),
    renderSpec(bundle),
    renderRules(bundle),
    renderRetrieval(bundle),
    renderReceipt(integrity),
    renderAiBom(bundle),
    renderDelivery(bundle),
    renderReview(bundle),
    renderFooter(),
  ].join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — paqad evidence report</title>
<style>${STYLE}</style>
</head>
<body>
${topbar}
${renderSubmenu()}
<main>
${body}
</main>
</body>
</html>
`;
}
