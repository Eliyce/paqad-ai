import type { AdapterType } from '@/core/types/adapter.js';

export function buildAgentConfigContext(input: {
  adapter: AdapterType;
  frameworkPath: string;
  rulesPath: string;
}): Record<string, unknown> {
  return input;
}
