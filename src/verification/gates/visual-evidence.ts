// The visual-evidence gate (issue #551, Part F).
//
// Reads the rigid `visual-evidence.json` manifest a capture run wrote and turns it into an
// end-of-change verdict. It validates EXISTENCE + manifest integrity + hashes only — never the
// screenshot content. Outcomes (house EvidenceGateStatus):
//   - flag off / coding capability absent / not feature-dev / trigger says not-frontend → skipped
//   - frameworks declared but no built-in pack loaded (issue #579, an install fault) →
//     inconclusive under warn, fail under strict, never not-frontend
//   - manifest present, schema-valid, result: captured, every referenced file's size + SHA-256
//     match → pass
//   - manifest present recording only documented skips (no-documented-flow / no-capture-script /
//     capture-script-invalid) → skipped, reason surfaced
//   - an environmental outcome (manifest absent on a frontend change, result partial/skipped with
//     an environmental reason, or a hash/size mismatch) → inconclusive under warn, fail under strict
//
// Like bundle-completeness it is an evidence-gate FUNCTION (returns a VerificationEvidenceGate,
// which the Gate/GateResult class shape cannot — it has no `skipped`/`inconclusive`), wired at the
// same seam. It uses the `as VerificationGate` cast the other evidence gates use.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { VerificationGate, VerificationOrigin } from '@/core/types/verification.js';
import type { VerificationEvidenceGate } from '@/core/types/verification-evidence.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { validateVisualEvidenceRecord } from '@/feature-evidence/schema.js';

import type { VisualEvidenceMode } from '../repository/visual-evidence-mode.js';
import type { VeSkipReason, VisualEvidenceManifest } from '@/visual-evidence/types.js';
import {
  PACK_REGISTRY_FAULT_REMEDIATION,
  packRegistryFaultDetail,
} from '@/visual-evidence/trigger.js';

/** The gate marker (not a registered VERIFICATION_GATES member, like `bundle-completeness`). */
const GATE_NAME = 'visual-evidence' as VerificationGate;

/** Skip reasons that are a documented "nothing to capture", never an environmental failure. */
const DOCUMENTED_SKIP_REASONS: ReadonlySet<VeSkipReason> = new Set([
  'no-documented-flow',
  'no-capture-script',
  'capture-script-invalid',
]);

/**
 * Origins where the local feature bundle is present (mirrors bundle-completeness). The
 * visual-evidence bundle is git-ignored, so a fresh CI checkout has none — the gate must never
 * fail there.
 */
const LOCAL_ORIGINS: ReadonlySet<VerificationOrigin> = new Set(['hook-completion', 'git-backstop']);

export interface VisualEvidenceGateInput {
  projectRoot: string;
  /** The active feature bundle dir, or null when none is open / route is non-feature. */
  dirName: string | null;
  /** The resolved gate mode (warn | strict). */
  mode: VisualEvidenceMode;
  /** The verification origin — only LOCAL origins can hard-fail (CI clones have no bundle). */
  origin: VerificationOrigin;
  /** Whether this change is feature-development (the gate only applies then). */
  isFeatureDev: boolean;
  /** visual_evidence flag AND the coding capability are both on. */
  flagOn: boolean;
  /** Whether the change is frontend-triggering (a changed file matched a pack's frontend_globs). */
  frontendTriggered: boolean;
  /**
   * Issue #579 — set when frameworks are declared but the built-in pack registry loaded none
   * (a PackRegistryEmptyError). An install fault: fail under strict, inconclusive under warn,
   * never not-frontend.
   */
  packRegistryFault?: { runtimeRoot: string } | null;
}

function skipped(detail: string, skipReason: string): VerificationEvidenceGate {
  return {
    name: GATE_NAME,
    status: 'skipped',
    detail,
    remediation: null,
    failures: [],
    skip_reason: skipReason,
  };
}

/** The short, plain phrase each documented skip reads as in the verdict skip line. */
const DOCUMENTED_SKIP_PHRASE: Record<string, string> = {
  'no-documented-flow': 'no documented flow to capture',
  'no-capture-script': 'no capture script',
  'capture-script-invalid': 'capture script invalid',
};

function environmental(
  mode: VisualEvidenceMode,
  detail: string,
  remediation: string,
): VerificationEvidenceGate {
  return {
    name: GATE_NAME,
    status: mode === 'strict' ? 'fail' : 'inconclusive',
    detail,
    remediation,
    failures: [],
  };
}

function pass(detail: string): VerificationEvidenceGate {
  return { name: GATE_NAME, status: 'pass', detail, remediation: null, failures: [] };
}

function readManifest(projectRoot: string, dirName: string): VisualEvidenceManifest | null {
  try {
    const raw = readFileSync(join(projectRoot, featureFilePath(dirName, 'visualEvidence')), 'utf8');
    return JSON.parse(raw) as VisualEvidenceManifest;
  } catch {
    return null;
  }
}

/** Verify one referenced file's byte length + SHA-256 against the manifest record. */
function fileMatches(absPath: string, expectedBytes: number, expectedSha: string): boolean {
  try {
    // A single read, then compare against the buffer's own length — never stat-then-read the
    // same path (the TOCTOU pattern CodeQL flags), and one fewer syscall.
    const bytes = readFileSync(absPath);
    if (bytes.length !== expectedBytes) return false;
    return createHash('sha256').update(bytes).digest('hex') === expectedSha;
  } catch {
    return false;
  }
}

/** Every captured step (and the GIF) whose file is missing or whose size/hash disagrees. */
function integrityFailures(
  projectRoot: string,
  dirName: string,
  manifest: VisualEvidenceManifest,
): string[] {
  const bundleAbs = join(projectRoot, '.paqad', 'ledger', 'feature-evidence', dirName);
  const failures: string[] = [];
  for (const step of manifest.steps) {
    if (step.status !== 'captured') continue;
    if (step.image_sha256 === undefined || step.image_bytes === undefined) {
      failures.push(`${step.dir}/image.png has no recorded hash`);
      continue;
    }
    const imageAbs = join(bundleAbs, step.dir, 'image.png');
    if (!fileMatches(imageAbs, step.image_bytes, step.image_sha256)) {
      failures.push(`${step.dir}/image.png size/hash mismatch`);
    }
  }
  if (manifest.gif) {
    const gifAbs = join(bundleAbs, manifest.gif.file);
    if (!fileMatches(gifAbs, manifest.gif.bytes, manifest.gif.sha256)) {
      failures.push('overview.gif size/hash mismatch');
    }
  }
  return failures;
}

/**
 * The visual-evidence verdict. Returns `null` only when the gate does not apply because there is
 * no feature bundle to check (not feature-dev / no active bundle) — every other case yields a row.
 */
export function visualEvidenceGate(
  input: VisualEvidenceGateInput,
): VerificationEvidenceGate | null {
  const { projectRoot, dirName, mode, origin, isFeatureDev, flagOn, frontendTriggered } = input;
  const { packRegistryFault } = input;

  if (!isFeatureDev || !dirName) {
    return null;
  }
  if (!flagOn) {
    return skipped(
      'visual evidence is off (flag off or coding capability absent).',
      'visual evidence is off',
    );
  }
  if (!LOCAL_ORIGINS.has(origin)) {
    return skipped(
      `visual evidence is informational on ${origin} — no committed local bundle.`,
      `informational on ${origin}`,
    );
  }
  if (packRegistryFault) {
    return environmental(
      mode,
      packRegistryFaultDetail(packRegistryFault.runtimeRoot),
      PACK_REGISTRY_FAULT_REMEDIATION,
    );
  }
  if (!frontendTriggered) {
    return skipped('not-frontend — no changed file matched a frontend surface.', 'not-frontend');
  }

  const manifest = readManifest(projectRoot, dirName);
  if (!manifest) {
    return environmental(
      mode,
      'a frontend change was made but no visual-evidence.json was captured.',
      'run `paqad-ai visual-evidence run` (check the app is reachable and the browser is provisioned).',
    );
  }
  if (validateVisualEvidenceRecord(manifest).length > 0) {
    return environmental(
      mode,
      'visual-evidence.json is present but does not match its schema.',
      're-run `paqad-ai visual-evidence run` to regenerate a valid manifest.',
    );
  }

  if (manifest.result === 'skipped') {
    const documented = manifest.skips.every((s) => DOCUMENTED_SKIP_REASONS.has(s.reason));
    const reasons = manifest.skips.map((s) => s.reason).join(', ') || 'no capture';
    if (documented && manifest.skips.length > 0) {
      const phrases = [...new Set(manifest.skips.map((s) => DOCUMENTED_SKIP_PHRASE[s.reason]))];
      return skipped(`no visual evidence to capture (${reasons}).`, phrases.join(', '));
    }
    return environmental(
      mode,
      `visual evidence could not be captured (${reasons}).`,
      'resolve the environmental issue (browser/app/selectors) and re-run `paqad-ai visual-evidence run`.',
    );
  }

  if (manifest.result === 'partial') {
    const failed = manifest.steps.filter((s) => s.status === 'failed').length;
    return environmental(
      mode,
      `visual evidence is partial — ${failed} step(s) failed (selector-not-found).`,
      'fix the failing selector(s) in the capture script and re-run `paqad-ai visual-evidence run`.',
    );
  }

  // result === 'captured' — verify every referenced file.
  const failures = integrityFailures(projectRoot, dirName, manifest);
  if (failures.length > 0) {
    return environmental(
      mode,
      `visual-evidence.json references files that do not match: ${failures.join('; ')}.`,
      're-run `paqad-ai visual-evidence run` to regenerate the screenshots.',
    );
  }

  const captured = manifest.steps.filter((s) => s.status === 'captured').length;
  const detail = `${captured} step(s) captured across ${manifest.plan.length} flow(s); hashes verified.${visualAcNote(projectRoot, dirName)}`;
  return pass(detail);
}

/**
 * Read-only AC enrichment: name any acceptance criteria the frozen spec marked `(proof: visual)`,
 * so the developer sees which requirements this evidence covers. Best-effort; never throws.
 */
function visualAcNote(projectRoot: string, dirName: string): string {
  try {
    const raw = readFileSync(join(projectRoot, featureFilePath(dirName, 'specification')), 'utf8');
    const spec = JSON.parse(raw) as {
      acceptance_criteria?: Array<{ id?: string; proof_type?: string }>;
    };
    const visual = (spec.acceptance_criteria ?? [])
      .filter((ac) => ac.proof_type === 'visual' && typeof ac.id === 'string')
      .map((ac) => ac.id as string);
    return visual.length > 0 ? ` Visually evidenced: ${visual.join(', ')}.` : '';
  } catch {
    return '';
  }
}
