import type { ReceiptCard } from './dashboard-types';
import type { Graph } from './types';

export interface ModuleActivity {
  moduleId: string;
  lastChange: string;
  checks: number;
  acceptedBy: string | null;
  verified: boolean;
  receiptHash: string;
}

export type ActivityByModule = Record<string, ModuleActivity>;

function fileToModule(graph: Graph): { exact: Map<string, string>; base: Map<string, string> } {
  const exact = new Map<string, string>();
  const base = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.type !== 'file' || !node.parent_id) continue;
    const path = node.id.replace(/^file:/, '');
    exact.set(path, node.parent_id);
    const basename = path.split('/').pop();
    if (basename) base.set(basename, node.parent_id);
    exact.set(node.label, node.parent_id);
  }
  return { exact, base };
}

function modulesForSubjects(
  subjects: { name: string }[],
  lookup: ReturnType<typeof fileToModule>,
): Set<string> {
  const modules = new Set<string>();
  for (const subject of subjects) {
    const hit =
      lookup.exact.get(subject.name) ??
      lookup.exact.get(subject.name.replace(/^\.?\//, '')) ??
      lookup.base.get(subject.name.split('/').pop() ?? subject.name);
    if (hit) modules.add(hit);
  }
  return modules;
}

export function computeActivity(graph: Graph | null, receipts: ReceiptCard[]): ActivityByModule {
  if (!graph) return {};
  const lookup = fileToModule(graph);
  const byModule: ActivityByModule = {};

  for (const receipt of receipts) {
    if (!receipt.time_verified) continue;
    const ts = Date.parse(receipt.time_verified);
    if (Number.isNaN(ts)) continue;
    const acceptedBy = receipt.authorship?.accepting_human?.name ?? null;
    const verified = receipt.verification_result === 'PASSED';
    for (const moduleId of modulesForSubjects(receipt.subjects, lookup)) {
      const existing = byModule[moduleId];
      if (existing && Date.parse(existing.lastChange) >= ts) continue;
      byModule[moduleId] = {
        moduleId,
        lastChange: receipt.time_verified,
        checks: receipt.checks.length,
        acceptedBy,
        verified,
        receiptHash: receipt.receipt_hash,
      };
    }
  }
  return byModule;
}

const RECENT_MS = 30 * 24 * 60 * 60 * 1000;

export function isRecent(activity: ModuleActivity, now: number): boolean {
  const t = Date.parse(activity.lastChange);
  return !Number.isNaN(t) && now - t <= RECENT_MS;
}
