import { findingAnchor, type MachineFinding } from './sources.js';

export const DIGEST_LINE_CAP = 150;

const CHANGED_FILE_LIMIT = 12;

export interface DigestCriterion {
  criterion_id: string;
  given?: string;
  when?: string;
  then?: string;
  proof_type?: string;
}

export interface DigestStage {
  stage: string;
  state: string;
}

export interface ReviewDigestInput {
  feature: string | null;
  generated_at: string;
  changed_files: string[];
  stages: DigestStage[];
  criteria: DigestCriterion[];
  findings: MachineFinding[];
}

const BLIND_SPOTS: readonly string[] = [
  'Semantic duplication — logic re-implemented in different words. The detector matches tokens, not meaning.',
  'Architectural fit — whether this belongs in this module at all.',
  'Naming and API shape — nothing grades whether a name will read well in six months.',
  'Whether the tests assert the RIGHT behaviour; coverage proves they ran, not that they are correct.',
  'Rollback and data-migration risk, and anything only reproducible against real data.',
];

function section(title: string, rows: string[], emptyLine: string): string[] {
  return [`## ${title}`, '', ...(rows.length > 0 ? rows : [emptyLine]), ''];
}

function criterionLine(criterion: DigestCriterion): string {
  const gwt = [
    criterion.given ? `given ${criterion.given}` : '',
    criterion.when ? `when ${criterion.when}` : '',
    criterion.then ? `then ${criterion.then}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const proof = criterion.proof_type ? ` [${criterion.proof_type}]` : '';
  return `- ${criterion.criterion_id}${proof} — ${gwt || 'no given/when/then recorded'}`;
}

function findingLine(finding: MachineFinding): string {
  const anchor = findingAnchor(finding) ?? '-';
  return `${finding.source} | ${finding.severity} | ${finding.tier} | ${anchor} | ${finding.message}`;
}

function capLines(lines: string[]): string[] {
  if (lines.length <= DIGEST_LINE_CAP) return lines;
  const kept = lines.slice(0, DIGEST_LINE_CAP - 1);
  return [
    ...kept,
    `> …truncated: ${lines.length - kept.length} more lines (cap ${DIGEST_LINE_CAP}).`,
  ];
}

export function buildReviewDigest(input: ReviewDigestInput): string {
  const lines: string[] = [
    '# Review digest',
    '',
    `> Machine-built ${input.generated_at} from cached evidence — no model wrote a word of it.`,
    '> Confirm or contest every deterministic row below. An unaddressed deterministic finding is itself a review finding.',
    '',
    '## Change',
    '',
    `- Feature: ${input.feature ?? 'none active'}`,
  ];

  if (input.changed_files.length === 0) {
    lines.push('- Changed files: none recorded');
  } else {
    const shown = input.changed_files.slice(0, CHANGED_FILE_LIMIT);
    lines.push(`- Changed files (${input.changed_files.length}):`);
    lines.push(...shown.map((file) => `  - ${file}`));
    if (input.changed_files.length > shown.length) {
      lines.push(`  - …and ${input.changed_files.length - shown.length} more`);
    }
  }

  lines.push(
    input.stages.length === 0
      ? '- Stages: none recorded'
      : `- Stages: ${input.stages.map((stage) => `${stage.stage}=${stage.state}`).join(' · ')}`,
  );
  lines.push('');

  lines.push(
    ...section(
      'Spec',
      input.criteria.map(criterionLine),
      'No frozen acceptance criteria on record (`paqad-ai spec freeze` writes them).',
    ),
  );

  const findingRows =
    input.findings.length === 0
      ? []
      : [
          'source | severity | tier | file:line | message',
          '--- | --- | --- | --- | ---',
          ...input.findings.map(findingLine),
        ];
  lines.push(
    ...section(
      'Machine findings',
      findingRows,
      'No machine findings recorded. Nothing ran, or everything it ran came back clean — check the stage states above before reading this as "clean".',
    ),
  );

  lines.push(
    ...section(
      'Blind spots',
      BLIND_SPOTS.map((spot) => `- ${spot}`),
      'none recorded',
    ),
  );

  return `${capLines(lines).join('\n').trimEnd()}\n`;
}
