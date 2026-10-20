import { joinPath, OWN_QUESTION_HEADERS } from './model';
import type { TableLine } from './table';
import type { PaqadHudSnapshot } from './types';

type Pending = PaqadHudSnapshot['decisions']['pending'][number];

export const EVIDENCE_CATEGORIES: readonly string[] = [
  'fix.proof_method',
  'spec.expert_conflict',
  'delivery.open_pr',
  'intake.requirement',
];

export const TERMINAL_EVIDENCE_ROWS = 12;
export const OTHER_EVIDENCE_ROWS = 48;

const PENDING_DIR = '.paqad/decisions/pending';
const SAFE_ID = /^D-[A-Za-z0-9_-]{1,64}$/;

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function normal(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s?.:!]+$/, '')
    .trim();
}

export function questionTexts(questions: readonly unknown[]): string[] {
  return questions.flatMap((question) => {
    const text = str(rec(question)?.question);
    return text ? [text] : [];
  });
}

export function isOwnQuestion(questions: readonly unknown[]): boolean {
  return (
    questions.length > 0 &&
    questions.every((question) => {
      const header = str(rec(question)?.header);
      return header !== null && OWN_QUESTION_HEADERS.includes(header);
    })
  );
}

export function carriesEvidence(category: string): boolean {
  return EVIDENCE_CATEGORIES.includes(category);
}

export function matchPending(
  texts: readonly string[],
  pending: readonly Pending[],
): Pending | null {
  for (const decision of pending) {
    if (!carriesEvidence(decision.category) || !SAFE_ID.test(decision.id)) continue;
    const wanted = normal(decision.question);
    const hit = texts.some(
      (text) => (wanted !== '' && normal(text) === wanted) || text.includes(decision.id),
    );
    if (hit) return decision;
  }
  return null;
}

export function pendingPacketPath(root: string, id: string): string | null {
  return SAFE_ID.test(id) ? joinPath(root, `${PENDING_DIR}/${id}.json`) : null;
}

function evidenceItems(evidence: Rec): string[] {
  const items: string[] = [];
  const file = str(evidence.file);
  if (file) items.push(`file ${file}`);
  const modified = str(evidence.last_modified);
  if (modified) items.push(`last changed ${modified}`);
  if (typeof evidence.callers === 'number') items.push(`${evidence.callers} callers`);
  if (typeof evidence.similarity === 'number') items.push(`similarity ${evidence.similarity}`);
  const rule = str(evidence.rule_match);
  if (rule) items.push(`rule ${rule}`);
  if (evidence.evidence_partial === true) items.push('evidence is partial');
  if (Array.isArray(evidence.findings)) {
    for (const finding of evidence.findings) {
      const text = str(finding);
      if (text) items.push(text);
    }
  }
  return items;
}

export function evidenceRows(packetText: string | null): string[] {
  if (packetText === null) return [];
  let packet: Rec | null;
  try {
    packet = rec(JSON.parse(packetText));
  } catch {
    return [];
  }
  const options = Array.isArray(packet?.options) ? packet.options : [];
  return options.flatMap((entry) => {
    const option = rec(entry);
    const evidence = rec(option?.evidence);
    if (!option || !evidence) return [];
    const label = str(option.label) ?? str(option.option_key) ?? 'option';
    return evidenceItems(evidence).map((item) => `${label}: ${item}`);
  });
}

export function evidenceCard(rows: readonly string[], max: number): TableLine[] {
  if (rows.length === 0) return [];
  const room = Math.max(2, Math.floor(max));
  const fits = rows.length <= room;
  const shown = fits ? rows : rows.slice(0, room - 1);
  const more = rows.length - shown.length;
  return [
    ...shown.map((row): TableLine => [{ text: row }]),
    ...(more > 0 ? [[{ text: `+${more} more`, dim: true }] as TableLine] : []),
  ];
}

export function evidenceRowLimit(surface: string): number {
  return surface === 'terminal' ? TERMINAL_EVIDENCE_ROWS : OTHER_EVIDENCE_ROWS;
}
