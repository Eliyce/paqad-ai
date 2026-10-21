import { hudCostCachePath } from '@/hud/files.js';

import { cachedMessageUsage, readCostCache } from './change-cost.js';
import { messageUsd, roundUsd } from './prices.js';
import {
  addTokenUsage,
  emptyTokenUsage,
  maxTokenUsage,
  type TokenUsage,
} from './transcript-usage.js';

export interface WorkflowCost {
  tokens: number | null;
  usd: number | null;
  unpriced: string[];
}

export function workflowCostSince(
  projectRoot: string,
  sessionId: string,
  since: string,
): WorkflowCost {
  const from = Date.parse(since);
  const cache = readCostCache(hudCostCachePath(projectRoot, sessionId), sessionId);
  const mains = Object.values(cache.sources).filter((source) => source.kind === 'main');
  if (mains.length === 0 || Number.isNaN(from)) return { tokens: null, usd: null, unpriced: [] };
  const messages = new Map<string, { model: string | null; usage: TokenUsage }>();
  for (const source of mains) {
    for (const [id, kept] of Object.entries(source.messages)) {
      const at = kept[1] === null ? Number.NaN : Date.parse(kept[1]);
      if (Number.isNaN(at) || at < from) continue;
      const usage = cachedMessageUsage(kept);
      const existing = messages.get(id);
      messages.set(id, {
        model: existing?.model ?? kept[0],
        usage: existing ? maxTokenUsage(existing.usage, usage) : usage,
      });
    }
  }
  let usage = emptyTokenUsage();
  let usd = 0;
  let priced = false;
  const unpriced = new Set<string>();
  for (const message of messages.values()) {
    usage = addTokenUsage(usage, message.usage);
    const cost = messageUsd(message.usage, message.model);
    if (cost === null) {
      unpriced.add(message.model ?? 'unknown');
    } else {
      usd += cost;
      priced = true;
    }
  }
  return {
    tokens: usage.total,
    usd: priced ? roundUsd(usd) : null,
    unpriced: [...unpriced].sort(),
  };
}
