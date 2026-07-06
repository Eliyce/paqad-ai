// Frozen-spec sidecar persistence (#300) — the missing durable record that lets a
// later run tell a frozen spec's source has moved.
//
// The spec-freeze lifecycle (issue #102) builds a FeatureSpec, freezes it, and stamps
// `frozen.spec_hash` — but nothing ever WROTE that frozen spec to disk, so at a later
// pre-mutation seam there was no frozen hash to compare the current markdown against.
// This store closes that: after a spec is frozen (`freezeSpec`), persist it here so the
// spec-change guard can detect a mid-build goal change and mint a `spec.change` pause.
//
// One JSON sidecar per spec at `.paqad/specs/<spec_id>.frozen.json`. Writes are atomic
// (temp + rename); reads never throw on a corrupt or partially-written sidecar. The
// mechanism is inert until a real freeze writes a sidecar — no sidecars, no reads matter.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { FeatureSpec } from '@/core/types/feature-spec.js';

const FROZEN_SUFFIX = '.frozen.json';

/** The sidecar path for one frozen spec: `.paqad/specs/<spec_id>.frozen.json`. */
export function frozenSpecPath(projectRoot: string, specId: string): string {
  return join(projectRoot, PATHS.PLANNING_SPECS_DIR, `${specId}${FROZEN_SUFFIX}`);
}

/**
 * Persists a frozen FeatureSpec as its sidecar. THE documented freeze entry point:
 * callers run `freezeSpec(spec, …)` then hand the result here. Refuses an unfrozen spec
 * loudly — a sidecar without `frozen` metadata would carry no hash to check against.
 */
export function writeFrozenSpec(projectRoot: string, spec: FeatureSpec): string {
  if (spec.frozen === null) {
    throw new Error(`Refusing to persist unfrozen spec ${spec.spec_id}: freeze it first.`);
  }
  const target = frozenSpecPath(projectRoot, spec.spec_id);
  mkdirSync(join(projectRoot, PATHS.PLANNING_SPECS_DIR), { recursive: true });
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(spec, null, 2) + '\n', 'utf8');
  renameSync(tmp, target);
  return target;
}

/**
 * Reads every persisted frozen spec. Returns `[]` when the specs dir is absent (the
 * common case — nothing has been frozen). Tolerant: a corrupt, unparseable, or
 * still-unfrozen sidecar is skipped rather than throwing, so one bad file never blinds
 * the guard to the others.
 */
export function readFrozenSpecs(projectRoot: string): FeatureSpec[] {
  const dir = join(projectRoot, PATHS.PLANNING_SPECS_DIR);
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(FROZEN_SUFFIX));
  } catch {
    return [];
  }
  const specs: FeatureSpec[] = [];
  for (const name of names) {
    try {
      const spec = JSON.parse(readFileSync(join(dir, name), 'utf8')) as FeatureSpec;
      if (spec.frozen !== null && spec.frozen !== undefined) {
        specs.push(spec);
      }
    } catch {
      continue;
    }
  }
  return specs;
}
