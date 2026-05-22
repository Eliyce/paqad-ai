import type { ExecutionSlice } from '@/core/types/planning.js';

export function buildDependencyQueue(slices: ExecutionSlice[]): ExecutionSlice[] {
  const byId = new Map(slices.map((slice) => [slice.slice_id, slice]));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const slice of slices) {
    incoming.set(slice.slice_id, slice.depends_on.length);
    outgoing.set(slice.slice_id, []);
  }

  for (const slice of slices) {
    for (const dependency of slice.depends_on) {
      outgoing.get(dependency)?.push(slice.slice_id);
    }
  }

  const ready = slices
    .filter((slice) => incoming.get(slice.slice_id) === 0)
    .map((slice) => slice.slice_id)
    .sort(compareSliceIds);
  const ordered: ExecutionSlice[] = [];

  while (ready.length > 0) {
    const nextId = ready.shift()!;
    const slice = byId.get(nextId)!;
    ordered.push(slice);

    for (const dependent of outgoing.get(nextId)!) {
      const remaining = incoming.get(dependent)! - 1;
      incoming.set(dependent, remaining);
      if (remaining === 0) {
        ready.push(dependent);
        ready.sort(compareSliceIds);
      }
    }
  }

  if (ordered.length !== slices.length) {
    throw new Error('Execution slices contain a cycle or unresolved dependency.');
  }

  return ordered;
}

export function collectBlockedSlices(slices: ExecutionSlice[], escalatedSliceId: string): string[] {
  const dependents = new Map<string, string[]>();
  for (const slice of slices) {
    for (const dependency of slice.depends_on) {
      const bucket = dependents.get(dependency) ?? [];
      bucket.push(slice.slice_id);
      dependents.set(dependency, bucket);
    }
  }

  const blocked = new Set<string>();
  const queue = [...(dependents.get(escalatedSliceId) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || blocked.has(current)) {
      continue;
    }
    blocked.add(current);
    queue.push(...(dependents.get(current) ?? []));
  }

  return [...blocked].sort(compareSliceIds);
}

function compareSliceIds(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true });
}
