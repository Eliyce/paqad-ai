import { classifyBundlePath } from '@/feature-evidence/bundle-integrity.js';
import { featureFilePath, type FeatureBundleFile } from '@/feature-evidence/paths.js';
import { currentFeature } from '@/feature-evidence/stage-ledger.js';

export function bundleArtifactFile(stage: string): FeatureBundleFile | null {
  if (stage === 'planning') return 'plan';
  if (stage === 'specification') return 'specification';
  if (stage === 'review') return 'review';
  return null;
}

export function bundleArtifactVerb(file: FeatureBundleFile): string {
  if (file === 'plan') return 'paqad-ai plan compile';
  if (file === 'specification') return 'paqad-ai spec freeze';
  return 'paqad-ai review record';
}

export interface BundleArtifactCheck {
  rigid: boolean;
  expected: string | null;
  accepted: string[];
  rejected: string[];
  verb: string | null;
}

export function checkBundleArtifacts(
  projectRoot: string,
  sessionId: string,
  stage: string,
  normalizedPaths: readonly string[],
): BundleArtifactCheck {
  const file = bundleArtifactFile(stage);
  if (!file) {
    const accepted: string[] = [];
    const rejected: string[] = [];
    for (const path of normalizedPaths) {
      const inBundle = classifyBundlePath(path);
      if (inBundle && (!inBundle.allowed || inBundle.screenshotSubtree)) {
        rejected.push(path);
      } else {
        accepted.push(path);
      }
    }
    return { rigid: false, expected: null, accepted, rejected, verb: null };
  }
  const dirName = currentFeature(projectRoot, sessionId);
  const expected = dirName ? featureFilePath(dirName, file) : null;
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const path of normalizedPaths) {
    if (expected !== null && path === expected) {
      accepted.push(path);
    } else {
      rejected.push(path);
    }
  }
  return { rigid: true, expected, accepted, rejected, verb: bundleArtifactVerb(file) };
}
