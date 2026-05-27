import type { DashboardReport, ScoreBand, SectionData } from './types.js';

const BAND_GLYPHS: Record<ScoreBand, string> = {
  green: '🟢',
  amber: '🟡',
  red: '🔴',
  unknown: '⚪',
};

function scoreText(section: SectionData): string {
  if (section.score === null) return '—';
  return `${section.score}%`;
}

/**
 * Render a `DashboardReport` as Markdown suitable for piping into an LLM
 * prompt or pasting into a status update. Deterministic — same input,
 * same output (no timestamps re-formatted, no locale-dependent calls).
 */
export function renderMarkdown(report: DashboardReport): string {
  const lines: string[] = [];

  const name = report.projectName ?? '(unnamed project)';
  lines.push(`# paqad-ai status — ${name}`);
  lines.push('');
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Project root: ${report.projectRoot}`);
  if (report.frameworkVersion !== null) {
    lines.push(`- Framework version: ${report.frameworkVersion}`);
  }

  if (report.notOnboarded) {
    lines.push('');
    lines.push('> Project is not onboarded. Run `paqad-ai onboard` first.');
    return lines.join('\n');
  }

  lines.push(
    `- Overall: ${BAND_GLYPHS[report.overallBand]} ${
      report.overallScore !== null ? `${report.overallScore}%` : '—'
    } (${report.overallBand})`,
  );
  lines.push('');

  if (report.attention.length > 0) {
    lines.push('## Needs your attention');
    lines.push('');
    for (const item of report.attention) {
      const tag = item.severity === 'critical' ? '**critical**' : item.severity;
      lines.push(`- [${tag}] ${item.message} (${item.sectionId})`);
    }
    lines.push('');
  }

  lines.push('## Sections');
  lines.push('');
  lines.push('| Section | Score | Band | Summary |');
  lines.push('| --- | ---: | --- | --- |');
  for (const section of report.sections) {
    const score = scoreText(section);
    lines.push(
      `| ${section.title} | ${score} | ${BAND_GLYPHS[section.band]} ${section.band} | ${section.summary} |`,
    );
  }

  for (const section of report.sections) {
    if (section.metrics.length === 0) continue;
    lines.push('');
    lines.push(`### ${section.title}`);
    lines.push('');
    for (const m of section.metrics) {
      lines.push(`- ${m.label}: ${m.value}`);
    }
  }

  return lines.join('\n');
}
