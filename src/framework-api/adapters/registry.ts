// Per-ecosystem framework-API adapter registry (issue #397).
//
// Mirrors `EcosystemParserRegistry` (src/introspection/ecosystems/registry.ts) so the two
// read alike. It exists because paqad-ai is installed into onboarded projects of ANY stack:
// an ecosystem with no adapter must get a clean "no adapter for this ecosystem" rather than
// the wrong code path pointed at its install tree. Issue #398 filled the PHP, Python and
// JVM slots Phase B reserved; go, rust and dart are still deliberately unregistered.

import type { StackEcosystem } from '@/core/types/introspection.js';

import type { FrameworkApiAdapter } from '../types.js';

import { jvmFrameworkApiAdapter } from './jvm.js';
import { nodeFrameworkApiAdapter } from './node.js';
import { phpFrameworkApiAdapter } from './php.js';
import { pythonFrameworkApiAdapter } from './python.js';

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
  return new FrameworkApiAdapterRegistry([
    nodeFrameworkApiAdapter,
    phpFrameworkApiAdapter,
    pythonFrameworkApiAdapter,
    jvmFrameworkApiAdapter,
  ]);
}
