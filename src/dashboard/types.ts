/**
 * Dashboard contract types (Phase 1 — issue #64).
 *
 * The shape returned by `buildReport(projectRoot)` is the single source of
 * truth shared by `paqad-ai dashboard` (HTTP/JSON) and `paqad-ai status`
 * (stdout JSON / Markdown). Keep it stable — UI cards, the status printer,
 * and downstream LLM consumers all key off these fields.
 */

/**
 * Stable identifiers for every section the phase-1 dashboard knows how to
 * render. Adding a section means adding an id here and registering a
 * collector in `src/dashboard/report.ts`.
 */
export const DASHBOARD_SECTION_IDS = [
  'project-profile',
  'framework-version',
  'rag-status',
  'decisions',
  'module-health',
  'stack-drift',
  'rules',
  'workflows',
  'module-docs',
  'design-system',
  'stack',
  'registries',
  'tools',
  'tech-debt',
  'architecture',
  'pentest',
  'session',
] as const;

export type DashboardSectionId = (typeof DASHBOARD_SECTION_IDS)[number];

/**
 * Score bands map 1:1 to the `--color-mod-*` design tokens in
 * `graph-ui/src/index.css`. `unknown` means the section is not applicable
 * for this project (e.g. pentest with no runs) — render with em-dash, not
 * 0%.
 */
export type ScoreBand = 'green' | 'amber' | 'red' | 'unknown';

export interface SectionMetric {
  label: string;
  value: string;
}

export interface SectionData {
  id: DashboardSectionId;
  /** Display title. Section names only — no prefix icons in v1. */
  title: string;
  /**
   * Score band derived from {@link score}. Use `unknown` when the section
   * cannot be scored (not applicable, source missing entirely).
   */
  band: ScoreBand;
  /**
   * Integer percentage 0–100, or `null` when {@link band} is `unknown`.
   * Always derived deterministically from existence + freshness; no
   * content-quality heuristics in phase 1.
   */
  score: number | null;
  /** One-line, ≤ 60 chars, state-derived. Never generic. */
  summary: string;
  /** Up to three compact metrics rendered under the card divider. */
  metrics: SectionMetric[];
  /**
   * Optional helper-text popover content. Rendered behind a `?` affordance,
   * never visible by default.
   */
  helper?: {
    what: string;
    goodLooksLike: string;
  };
  /**
   * Free-form details payload the drill-in view can consume. Shape is
   * per-section; the dashboard UI does not type-check this beyond
   * `Record<string, unknown>`.
   */
  details?: Record<string, unknown>;
}

export interface AttentionItem {
  /** Section the item belongs to. */
  sectionId: DashboardSectionId;
  /** Short, action-oriented sentence. */
  message: string;
  /** Optional severity used purely for ordering; UI does not colour by it. */
  severity: 'info' | 'warn' | 'critical';
}

export interface DashboardReport {
  /** Report shape version. Bump when the contract changes. */
  schemaVersion: 1;
  /** ISO timestamp of when the report was built. */
  generatedAt: string;
  /** Resolved project root the report describes. */
  projectRoot: string;
  /** Project display name from `.paqad/project-profile.yaml`. */
  projectName: string | null;
  /** Framework version recorded in `.paqad/framework-version.txt`. */
  frameworkVersion: string | null;
  /** True when the project has never been onboarded. */
  notOnboarded: boolean;
  /**
   * Weighted overall score across all applicable sections (0–100), or
   * `null` when the project is not onboarded.
   */
  overallScore: number | null;
  overallBand: ScoreBand;
  /** Top items the dashboard surfaces in the summary band. */
  attention: AttentionItem[];
  /** All sections in display order. */
  sections: SectionData[];
}
