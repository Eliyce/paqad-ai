import { siteMapPreflightRequirements } from '@/site-map/preflight-requirements.js';

import type { PreflightRequirement } from './contract.js';

const REGISTRY: Record<string, PreflightRequirement[]> = {
  'site-map': siteMapPreflightRequirements,
};

export function requirementsFor(workflow: string): PreflightRequirement[] {
  return REGISTRY[workflow] ?? [];
}
