import type { Gate } from './gate.interface.js';

import {
  areRegistriesStale,
  collectCanonicalDocumentationFailures,
  collectUnresolvedDocTargets,
  formatCanonicalDocTarget,
} from './documentation-checks.js';
import { createFail, createPass } from './shared.js';

export class DocumentationFreshnessGate implements Gate {
  readonly gate = 'documentation-freshness' as const;

  async check(context: Parameters<Gate['check']>[0]) {
    const unresolvedDocTargets = await collectUnresolvedDocTargets(
      context.project_root,
      context.changed_files,
      context.stale_doc_targets,
    );
    if (context.code_changed && unresolvedDocTargets.length > 0) {
      return createFail(
        this.gate,
        `Canonical docs not updated for changed code: ${unresolvedDocTargets.map(formatCanonicalDocTarget).join('; ')}`,
        'Update the stale canonical docs before treating the implementation as complete.',
      );
    }

    const missingDocs = await collectCanonicalDocumentationFailures(
      context.project_root,
      context.expected_ui_modules,
      context.expected_api_modules,
      context.expected_integration_modules,
      context.expected_error_catalog_modules,
    );

    if (missingDocs.length > 0) {
      return createFail(
        this.gate,
        `Missing canonical docs: ${missingDocs.join(', ')}`,
        'Create or update the missing canonical documentation files.',
      );
    }

    if (areRegistriesStale(context.registry_refreshed_at)) {
      return createFail(
        this.gate,
        'Registries are stale',
        'Run the registry refresh and update the registry refresh timestamp.',
      );
    }

    if (!context.glossary_updated) {
      return createFail(
        this.gate,
        'Glossary is out of date',
        'Update the glossary with new terms introduced by the change.',
      );
    }

    return createPass(this.gate, 'Canonical documentation is current');
  }
}
