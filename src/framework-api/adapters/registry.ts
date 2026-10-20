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
