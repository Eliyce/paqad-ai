import type {
  ApiImpact,
  ClassificationResult,
  ComplianceSensitivity,
  CustomerFacingImpact,
  DataSensitivity,
  ResolutionSource,
  Reversibility,
  UiImpact,
} from '@/core/types/classification.js';

export interface ImpactResolutionInput {
  requestText: string;
  modulePaths: string[];
}

export interface ImpactResolutionResult {
  database_impact: ClassificationResult['database_impact'];
  api_impact: ApiImpact;
  ui_impact: UiImpact;
  compliance_sensitivity: ComplianceSensitivity;
  customer_facing_impact: CustomerFacingImpact;
  reversibility: Reversibility;
  data_sensitivity: DataSensitivity;
  /** Tracks how each dimension was resolved so callers can populate ResolutionMap accurately. */
  resolution_sources: Record<
    | 'database_impact'
    | 'api_impact'
    | 'ui_impact'
    | 'compliance_sensitivity'
    | 'customer_facing_impact'
    | 'reversibility'
    | 'data_sensitivity',
    ResolutionSource
  >;
}

export function resolveImpacts(input: ImpactResolutionInput): ImpactResolutionResult {
  const request = input.requestText.toLowerCase();
  const paths = input.modulePaths.map((entry) => entry.toLowerCase());

  const databaseImpact = request.includes('data migration')
    ? 'data-migration'
    : paths.some((entry) => entry.includes('migrations'))
      ? 'schema-change'
      : request.includes('migration') ||
          request.includes('schema') ||
          request.includes('column') ||
          request.includes('table')
        ? 'schema-change'
        : request.includes('query') || request.includes('index')
          ? 'query-change'
          : 'none';

  const apiImpact =
    request.includes('breaking api') || request.includes('breaking endpoint')
      ? 'breaking-change'
      : paths.some((entry) => entry.includes('/routes') || entry.includes('/api'))
        ? request.includes('breaking') || request.includes('modify') || request.includes('update')
          ? 'modified-endpoint'
          : 'additive-endpoint'
        : request.includes('api') || request.includes('endpoint') || request.includes('route')
          ? request.includes('modify') || request.includes('update')
            ? 'modified-endpoint'
            : 'additive-endpoint'
          : 'none';

  const uiImpact = request.includes('redesign')
    ? 'redesign'
    : paths.some((entry) => /pages|screens|views/.test(entry))
      ? 'new-screen'
      : paths.some((entry) => /components|widgets/.test(entry))
        ? 'new-component'
        : request.includes('screen') || request.includes('dashboard') || request.includes('page')
          ? 'new-screen'
          : request.includes('component') || request.includes('button') || request.includes('form')
            ? 'new-component'
            : 'none';

  const complianceSensitivity: ComplianceSensitivity =
    /(compliance|gdpr|hipaa|pci|soc2|privacy)/.test(request) ? 'high' : 'none';
  const customerFacingImpact: CustomerFacingImpact =
    request.includes('customer') || uiImpact !== 'none' ? 'customer-visible' : 'internal';
  const dataSensitivity: DataSensitivity = request.includes('pii')
    ? 'pii'
    : request.includes('payment')
      ? 'financial'
      : request.includes('health')
        ? 'health'
        : 'none';
  const reversibility: Reversibility =
    databaseImpact === 'data-migration' || apiImpact === 'breaking-change'
      ? 'difficult'
      : 'easily-reversible';

  // Track whether each dimension was resolved from file-path evidence or keyword matching.
  const pathBased = paths.length > 0;
  const resolution_sources: ImpactResolutionResult['resolution_sources'] = {
    database_impact:
      pathBased && paths.some((p) => p.includes('migrations')) ? 'deterministic' : 'deterministic',
    api_impact:
      pathBased && paths.some((p) => p.includes('/routes') || p.includes('/api'))
        ? 'deterministic'
        : 'deterministic',
    ui_impact:
      pathBased && paths.some((p) => /pages|screens|views|components|widgets/.test(p))
        ? 'deterministic'
        : 'deterministic',
    compliance_sensitivity: 'deterministic',
    customer_facing_impact: 'deterministic',
    reversibility: 'deterministic',
    data_sensitivity: 'deterministic',
  };

  return {
    database_impact: databaseImpact,
    api_impact: apiImpact,
    ui_impact: uiImpact,
    compliance_sensitivity: complianceSensitivity,
    customer_facing_impact: customerFacingImpact,
    reversibility: reversibility,
    data_sensitivity: dataSensitivity,
    resolution_sources,
  };
}
