import type { HealthCategory } from '@/core/types/codebase-health.js';

/** Verbatim report header (issue #355, paqad voice — plain words, no jargon). */
export const HEALTH_REPORT_HEADER =
  '**Codebase health** — I scanned this project for code and packages that no longer ' +
  'earn their place. Every finding below carries proof; nothing here is a guess. Findings ' +
  "marked 'needs judgment' are candidates I couldn't prove mechanically — you decide.";

/**
 * The one-liner "why it matters" for each category, each two sentences or fewer,
 * grounded in the verified evidence base from the issue's research.
 */
export const HEALTH_WHY_IT_MATTERS: Record<HealthCategory, string> = {
  'dead-code':
    'Unused code still costs you: it confuses readers, slows builds, and can fire by ' +
    'accident — a US trading firm lost $460M in 45 minutes to code nobody had used since 2003.',
  'unused-dependency':
    'A package you declare but never import is pure liability: it grows your install, your ' +
    'attack surface, and your audit noise for zero benefit.',
  'vulnerable-dependency':
    'A dependency with a known advisory is a door left open — and 78% of the vulnerabilities ' +
    'you carry live in packages you never chose directly.',
  'deprecated-dependency':
    'A deprecated or end-of-life package stops getting security fixes: today it works, and one ' +
    'day it quietly becomes the weakest link (event-stream, colors, xz-utils all started here).',
  'secret-leak':
    'A committed secret is compromised the moment it lands in git history — rotate it, because ' +
    'deleting the line does not un-leak it.',
  duplication:
    'Copy-paste blocks drift apart over time: you fix the bug in one copy and ship the other, ' +
    'and duplicated code has jumped 81% since AI assistants arrived.',
  'stale-doc':
    'Docs that no longer match the code mislead the next reader — 93% of developers hit outdated ' +
    'docs and 60% never fix them, so the rot compounds.',
  'ai-slop':
    'Redundant, low-value AI-generated code passes review more easily than it should, quietly ' +
    'inflating the surface everyone has to maintain.',
};

/** Short human label for a category, used in report headings and the dashboard. */
export const HEALTH_CATEGORY_LABEL: Record<HealthCategory, string> = {
  'dead-code': 'Dead code',
  'unused-dependency': 'Unused packages',
  'vulnerable-dependency': 'Risky packages',
  'deprecated-dependency': 'Outdated packages',
  'secret-leak': 'Leaked secrets',
  duplication: 'Copy-paste duplication',
  'stale-doc': 'Stale docs',
  'ai-slop': 'AI slop',
};
