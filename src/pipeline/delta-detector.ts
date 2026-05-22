import { listManifestSlugs, loadManifest } from '@/planning/manifest-parser.js';

export interface DeltaDetectionResult {
  delta_candidate: boolean;
  base_manifest_slug: string | null;
  prior_requirement_count: number | null;
  prior_criterion_count: number | null;
}

export async function detectDeltaCandidate(
  root: string,
  affectedModules: string[],
): Promise<DeltaDetectionResult> {
  if (affectedModules.length === 0) {
    return emptyResult();
  }

  const slugs = await listManifestSlugs(root);
  let bestMatch: DeltaDetectionResult & { overlap: number } = {
    ...emptyResult(),
    overlap: 0,
  };

  for (const slug of slugs) {
    try {
      const manifest = await loadManifest(root, slug);
      const manifestModules = manifest.classification.affected_modules ?? [];
      if (manifestModules.length === 0) {
        continue;
      }

      const shared = affectedModules.filter((modulePath) => manifestModules.includes(modulePath));
      const overlap = shared.length / Math.max(affectedModules.length, manifestModules.length, 1);
      if (overlap >= 0.5 && overlap > bestMatch.overlap) {
        bestMatch = {
          delta_candidate: true,
          base_manifest_slug: slug,
          prior_requirement_count: manifest.requirement_graph.length,
          prior_criterion_count: manifest.verification_matrix.length,
          overlap,
        };
      }
    } catch {
      // Corrupt manifests should not block classification.
    }
  }

  return {
    delta_candidate: bestMatch.delta_candidate,
    base_manifest_slug: bestMatch.base_manifest_slug,
    prior_requirement_count: bestMatch.prior_requirement_count,
    prior_criterion_count: bestMatch.prior_criterion_count,
  };
}

function emptyResult(): DeltaDetectionResult {
  return {
    delta_candidate: false,
    base_manifest_slug: null,
    prior_requirement_count: null,
    prior_criterion_count: null,
  };
}
