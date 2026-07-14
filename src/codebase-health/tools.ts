import { missingBinaries } from '@/rule-scripts/execute.js';
import type { DeliveryShell } from '@/delivery/runner.js';
import type { HealthCategory, HealthToolStatus } from '@/core/types/codebase-health.js';

/** A framework-owned external scanner and the categories it strengthens. */
export interface HealthToolSpec {
  tool: string;
  used_for: HealthCategory[];
  /** True when this tool reaches the network in normal use. */
  requires_network: boolean;
  install_hint: string;
}

/**
 * The scanners health run shells out to when present. All are optional: absent
 * tools degrade to a built-in fallback (labelled lower-confidence) or land in
 * `blocked_checks`. Licences are all permissive (osv-scanner Apache-2.0,
 * gitleaks MIT, jscpd MIT, Knip ISC) — none is bundled, only invoked if on PATH.
 */
export const HEALTH_TOOLS: HealthToolSpec[] = [
  {
    tool: 'osv-scanner',
    used_for: ['vulnerable-dependency'],
    requires_network: false,
    install_hint:
      'Install osv-scanner (https://github.com/google/osv-scanner) for offline vuln matching.',
  },
  {
    tool: 'gitleaks',
    used_for: ['secret-leak'],
    requires_network: false,
    install_hint:
      'Install gitleaks (https://github.com/gitleaks/gitleaks) to scan git history for secrets.',
  },
  {
    tool: 'jscpd',
    used_for: ['duplication'],
    requires_network: false,
    install_hint: 'Install jscpd (`npm i -g jscpd`) for cross-language copy-paste detection.',
  },
  {
    tool: 'knip',
    used_for: ['dead-code', 'unused-dependency'],
    requires_network: false,
    install_hint:
      'Install knip (`npm i -g knip`) to corroborate dead code and unused deps in JS/TS.',
  },
];

/** Look up a tool spec by name. */
export function healthToolSpec(tool: string): HealthToolSpec | undefined {
  return HEALTH_TOOLS.find((spec) => spec.tool === tool);
}

/**
 * Resolve which scanners are on PATH. Pure over `missingBinaries` so it never
 * spawns a subprocess — a fresh machine simply reports every tool unavailable.
 */
export function resolveToolAvailability(
  tools: HealthToolSpec[] = HEALTH_TOOLS,
): HealthToolStatus[] {
  const absent = new Set(missingBinaries(tools.map((spec) => spec.tool)));
  return tools.map((spec) => ({
    tool: spec.tool,
    available: !absent.has(spec.tool),
    used_for: spec.used_for,
  }));
}

export function isToolAvailable(availability: HealthToolStatus[], tool: string): boolean {
  return availability.some((status) => status.tool === tool && status.available);
}

/** The production shell factory (execa, never throws). Injected for tests. */
export type { DeliveryShell as HealthShell };
