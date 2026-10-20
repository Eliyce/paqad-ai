import { missingBinaries } from '@/rule-scripts/execute.js';
import type { DeliveryShell } from '@/delivery/runner.js';
import type { HealthCategory, HealthToolStatus } from '@/core/types/codebase-health.js';

export interface HealthToolSpec {
  tool: string;
  used_for: HealthCategory[];
  requires_network: boolean;
  install_hint: string;
}

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

export function healthToolSpec(tool: string): HealthToolSpec | undefined {
  return HEALTH_TOOLS.find((spec) => spec.tool === tool);
}

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

export type { DeliveryShell as HealthShell };
