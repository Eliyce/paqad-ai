import { ADAPTER_TYPES, type AdapterType } from '@/core/types/adapter.js';
import type { OnboardingManifest } from '@/core/types/onboarding.js';

import { AdapterFactory } from './factory.js';

export function deriveRecordedProviders(manifest: OnboardingManifest): AdapterType[] {
  const artifactPaths = new Set(
    manifest.generated_artifacts.map((artifact) => artifact.path.replaceAll('\\', '/')),
  );
  const recorded = ADAPTER_TYPES.filter((type) => {
    const configPath = AdapterFactory.create(type).getConfigPath().replaceAll('\\', '/');
    return artifactPaths.has(configPath);
  });
  return [manifest.adapter, ...recorded.filter((type) => type !== manifest.adapter)];
}
