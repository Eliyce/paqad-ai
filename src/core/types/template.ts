export interface TemplateDefinition {
  name: string;
  source: string;
  destination: string;
  partials?: string[];
}

export type TemplateContext = Record<string, unknown>;
