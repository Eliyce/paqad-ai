import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  GateSkipKind,
  VerificationGate,
  VerificationOrigin,
} from '@/core/types/verification.js';
import type { VerificationEvidenceGate } from '@/core/types/verification-evidence.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { validateVisualEvidenceRecord } from '@/feature-evidence/schema.js';

import type { VisualEvidenceMode } from '../repository/visual-evidence-mode.js';
import {
  AGENT_ATTACHED_JOURNEY,
  type VeSkipReason,
  type VisualEvidenceManifest,
} from '@/visual-evidence/types.js';
import { findVisualEvidenceWaiver, visualEvidenceWaiverHint } from '@/visual-evidence/readiness.js';
import {
  PACK_REGISTRY_FAULT_REMEDIATION,
  packRegistryFaultDetail,
} from '@/visual-evidence/trigger.js';

const GATE_NAME = 'visual-evidence' as VerificationGate;

const DOCUMENTED_SKIP_REASONS: ReadonlySet<VeSkipReason> = new Set([
  'no-documented-flow',
  'no-capture-script',
  'capture-script-invalid',
]);

const LOCAL_ORIGINS: ReadonlySet<VerificationOrigin> = new Set(['hook-completion', 'git-backstop']);

export interface VisualEvidenceGateInput {
  projectRoot: string;
  dirName: string | null;
  mode: VisualEvidenceMode;
  origin: VerificationOrigin;
  isFeatureDev: boolean;
  flagOn: boolean;
  frontendTriggered: boolean;
  packRegistryFault?: { runtimeRoot: string } | null;
}

function skipped(
  detail: string,
  skipReason: string,
  kind: GateSkipKind = 'not-required',
): VerificationEvidenceGate {
  return {
    name: GATE_NAME,
    status: 'skipped',
    detail,
    remediation: null,
    failures: [],
    skip_reason: skipReason,
    skip_kind: kind,
  };
}

const STRICT_UNCAPTURED: ReadonlySet<VeSkipReason> = new Set([
  'no-documented-flow',
  'no-capture-script',
]);

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

function fileMatches(absPath: string, expectedBytes: number, expectedSha: string): boolean {
  try {
    const bytes = readFileSync(absPath);
    if (bytes.length !== expectedBytes) return false;
    return createHash('sha256').update(bytes).digest('hex') === expectedSha;
  } catch {
    return false;
  }
}

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
      if (mode === 'strict' && manifest.skips.every((s) => STRICT_UNCAPTURED.has(s.reason))) {
        const waiver = findVisualEvidenceWaiver(projectRoot, dirName);
        if (waiver) {
          return skipped(`waived by ${waiver} (${reasons}).`, `waived by ${waiver}`);
        }
        return environmental(
          mode,
          `visual evidence is strict, but nothing was captured for this frontend change (${reasons}).`,
          'attach screenshots with `paqad-ai visual-evidence attach <png...>`, add a capture script for a documented journey and re-run `paqad-ai visual-evidence run`, ' +
            `or record a waiver: ${visualEvidenceWaiverHint(projectRoot, dirName)}.`,
        );
      }
      const kind = manifest.skips.every((s) => s.reason === 'no-documented-flow')
        ? 'not-required'
        : 'did-not-run';
      return skipped(`no visual evidence to capture (${reasons}).`, phrases.join(', '), kind);
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

  const failures = integrityFailures(projectRoot, dirName, manifest);
  if (failures.length > 0) {
    return environmental(
      mode,
      `visual-evidence.json references files that do not match: ${failures.join('; ')}.`,
      're-run `paqad-ai visual-evidence run` to regenerate the screenshots.',
    );
  }

  const captured = manifest.steps.filter((s) => s.status === 'captured');
  const attached = captured.filter((s) => s.journey_id === AGENT_ATTACHED_JOURNEY).length;
  const attachedNote =
    attached > 0 ? ` ${attached} of them agent-attached (not scripted captures).` : '';
  const detail = `${captured.length} step(s) captured across ${manifest.plan.length} flow(s); hashes verified.${attachedNote}${visualAcNote(projectRoot, dirName)}`;
  return pass(detail);
}

function visualAcNote(projectRoot: string, dirName: string): string {
  try {
    const raw = readFileSync(join(projectRoot, featureFilePath(dirName, 'specification')), 'utf8');
    const spec = JSON.parse(raw) as {
      acceptance_criteria?: Array<{ criterion_id?: string; id?: string; proof_type?: string }>;
    };
    const visual = (spec.acceptance_criteria ?? [])
      .filter((ac) => ac.proof_type === 'visual')
      .map((ac) => ac.criterion_id ?? ac.id)
      .filter((id): id is string => typeof id === 'string');
    return visual.length > 0 ? ` Visually evidenced: ${visual.join(', ')}.` : '';
  } catch {
    return '';
  }
}
