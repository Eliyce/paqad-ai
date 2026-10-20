import { collectModuleDocs } from '@/dashboard/collectors/module-docs.js';
import { readRawModuleMap } from '@/module-map/reconciler.js';

export type SiteMapPrerequisiteWorkflow = 'create documentation' | 'create module documentation';

export interface MissingSiteMapPrerequisite {
  workflow: SiteMapPrerequisiteWorkflow;
  reason: string;
}

export interface SiteMapPrerequisiteStatus {
  foundation_present: boolean;
  module_count: number;
  documented_module_count: number;
}

export interface SiteMapPrerequisites {
  satisfied: boolean;
  missing: MissingSiteMapPrerequisite[];
  status: SiteMapPrerequisiteStatus;
}

const FOUNDATION_MISSING: MissingSiteMapPrerequisite = {
  workflow: 'create documentation',
  reason:
    "The map uses the business terms and module structure from your project's documentation, so it needs the documentation foundation first.",
};

const MODULE_DOCS_MISSING: MissingSiteMapPrerequisite = {
  workflow: 'create module documentation',
  reason:
    'The map groups screens by module and labels them from the module docs, so it needs your modules documented first.',
};

export function detectSiteMapPrerequisites(projectRoot: string): SiteMapPrerequisites {
  const map = readRawModuleMap(projectRoot);

  if (map === null) {
    return {
      satisfied: false,
      missing: [FOUNDATION_MISSING],
      status: { foundation_present: false, module_count: 0, documented_module_count: 0 },
    };
  }

  const moduleCount = map.modules.length;
  const documentedModuleCount = countDocumentedModules(projectRoot);

  if (moduleCount > 0 && documentedModuleCount === 0) {
    return {
      satisfied: false,
      missing: [MODULE_DOCS_MISSING],
      status: { foundation_present: true, module_count: moduleCount, documented_module_count: 0 },
    };
  }

  return {
    satisfied: true,
    missing: [],
    status: {
      foundation_present: true,
      module_count: moduleCount,
      documented_module_count: documentedModuleCount,
    },
  };
}

function countDocumentedModules(projectRoot: string): number {
  const present = collectModuleDocs(projectRoot).details?.['present'];
  return typeof present === 'number' ? present : 0;
}
