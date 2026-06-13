import type { ReceiptCard } from './dashboard-types';
import type { Graph } from './types';

/**
 * Issue #165 — per-module "what the AI changed", projected from the existing
 * verification receipts (no new source of truth). Each receipt names the files
 * it covers; we map those files to their module via the graph and keep the
 * latest verified change per module.
 */
export interface ModuleActivity {
  moduleId: string;
  /** ISO timestamp of the most recent change recorded for this module. */
  lastChange: string;
  /** Checks on the latest receipt that touched this module. */
  checks: number;
  /** Human who accepted the latest change, or null when none is recorded. */
  acceptedBy: string | null;
  /** Whether the latest receipt verified clean. */
  verified: boolean;
  /** Receipt hash for linking to the receipt snapshot. */
  receiptHash: string;
}

export type ActivityByModule = Record<string, ModuleActivity>;

/** Build path -> moduleId lookups from the graph's file nodes (exact + basename). */
function fileToModule(graph: Graph): { exact: Map<string, string>; base: Map<string, string> } {
  const exact = new Map<string, string>();
  const base = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.type !== 'file' || !node.parent_id) continue;
    const path = node.id.replace(/^file:/, '');
    exact.set(path, node.parent_id);
    const basename = path.split('/').pop();
    if (basename) base.set(basename, node.parent_id);
    // The label is often the same relpath; index it too for robustness.
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

/**
 * Aggregate the latest AI change per module. Receipts without a verified
 * timestamp are skipped (they cannot be placed on a timeline).
 */
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

/** A module counts as recently active when its latest change is within 30 days. */
export function isRecent(activity: ModuleActivity, now: number): boolean {
  const t = Date.parse(activity.lastChange);
  return !Number.isNaN(t) && now - t <= RECENT_MS;
}
