export const DOC_TYPES = [
  'stories',
  'spec',
  'user-flow',
  'schema',
  'query',
  'index',
  'registry',
  'ui',
  'api',
  'integration',
  'error-catalog',
  'glossary',
  'decision-record',
  'review-report',
  'sequence-plan',
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export interface DocPath {
  type: DocType;
  path: string;
}

export interface ApiEndpointDoc {
  method: string;
  route: string;
  auth: 'required' | 'public';
  permissions: string[];
  rate_limit?: string;
  description: string;
  request_schema_ref: string;
  response_schema_ref: string;
  error_codes_ref: string;
  added_in: string;
  last_updated: string;
}

export interface ApiSchemaField {
  name: string;
  type: string;
  required: boolean;
  validation?: string;
  description: string;
}

export interface IntegrationEventPayloadField {
  name: string;
  type: string;
  description: string;
}

export interface IntegrationEvent {
  event_class: string;
  published_by: string;
  payload_fields: IntegrationEventPayloadField[];
  subscribers: string[];
  async: boolean;
  added_in: string;
}

export interface IntegrationContract {
  type: 'event' | 'service-call' | 'shared-model' | 'job';
  interface_desc: string;
  contract_version: string;
  breaking_change_policy: string;
  fallback: string;
}

export interface ErrorCatalogEntry {
  code: string;
  http_status?: number;
  user_message: string;
  internal_message: string;
  trigger: string;
  recovery_path: string;
  retry_safe: boolean;
  logged: boolean;
  alerted: boolean;
  added_in: string;
  last_updated: string;
}

export interface IntegrationDoc {
  name: string;
  depends_on: string[];
  provides_to: string[];
}
