import { describe, expect, it } from 'vitest';

import { AdapterFactory } from '@/adapters/factory.js';
import { BaseAdapter } from '@/adapters/shared/base-adapter.js';

describe('BaseAdapter.getAgentsRoot', () => {
  it.each([
    ['claude-code', '.claude/agents'],
    ['codex-cli', '.codex/agents'],
    ['cursor', '.cursor/agents'],
  ] as const)('%s exposes its agents root %s', (type, root) => {
    const adapter = AdapterFactory.create(type);
    expect(adapter).toBeInstanceOf(BaseAdapter);
    expect((adapter as BaseAdapter).getAgentsRoot()).toBe(root);
  });
});
