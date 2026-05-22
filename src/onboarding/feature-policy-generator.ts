import type { GeneratedFile } from '@/adapters/adapter.interface.js';
import { PATHS } from '@/core/constants/paths.js';
import { renderDefaultFeatureDevelopmentPolicyYaml } from '@/pipeline/feature-development-policy.js';

export function generateFeatureDevelopmentPolicy(domain: 'coding' | 'content'): GeneratedFile[] {
  if (domain !== 'coding') {
    return [];
  }

  return [
    {
      path: `${PATHS.WORKFLOWS_DIR}/feature-development.yaml`,
      content: renderDefaultFeatureDevelopmentPolicyYaml(),
      autoUpdate: false,
    },
  ];
}
