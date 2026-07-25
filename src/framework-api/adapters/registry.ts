// Per-ecosystem framework-API adapter registry (issue #397).
//
// Mirrors `EcosystemParserRegistry` (src/introspection/ecosystems/registry.ts) so the two
// read alike. It exists from day one, with only the node adapter registered, because
// paqad-ai is installed into onboarded projects of ANY stack: a Laravel or Python project
// must get a clean "no adapter for this ecosystem" rather than the node code path pointed
// at a `vendor/` directory. #398's PHP, Python and JVM adapters register here.

import type { StackEcosystem } from '@/core/types/introspection.js';

import type { FrameworkApiAdapter } from '../types.js';

import { nodeFrameworkApiAdapter } from './node.js';

export class FrameworkApiAdapterRegistry {
  private readonly adapters = new Map<StackEcosystem, FrameworkApiAdapter>();

  constructor(adapters: FrameworkApiAdapter[] = []) {
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  register(adapter: FrameworkApiAdapter): void {
    this.adapters.set(adapter.ecosystem, adapter);
  }

  /** The adapter for an ecosystem, or null when none is registered yet. */
  get(ecosystem: StackEcosystem): FrameworkApiAdapter | null {
    return this.adapters.get(ecosystem) ?? null;
  }

  list(): FrameworkApiAdapter[] {
    return [...this.adapters.values()];
  }
}

export function createDefaultFrameworkApiAdapterRegistry(): FrameworkApiAdapterRegistry {
  return new FrameworkApiAdapterRegistry([nodeFrameworkApiAdapter]);
}
