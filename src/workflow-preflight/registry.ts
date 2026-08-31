// The workflow-preflight registry (issue: site-map rebuild S3a).
//
// Maps a workflow name to the requirement list preflight checks for it. This is the ONLY place
// that knows which workflow has which requirements, so the runner (run.ts) stays generic and other
// workflows add their own requirements here without touching the runner. Ship `site-map` only; a
// workflow with no entry has no requirements, so preflight returns `ok: true` with no questions
// (never an error).

import { siteMapPreflightRequirements } from '@/site-map/preflight-requirements.js';

import type { PreflightRequirement } from './contract.js';

/** Workflow name to its declared requirements. Extend this to add preflight to another workflow. */
const REGISTRY: Record<string, PreflightRequirement[]> = {
  'site-map': siteMapPreflightRequirements,
};

/**
 * The requirements declared for a workflow, or an empty list when the workflow has none. An
 * unregistered workflow is not an error: it simply has nothing to check.
 */
export function requirementsFor(workflow: string): PreflightRequirement[] {
  return REGISTRY[workflow] ?? [];
}
