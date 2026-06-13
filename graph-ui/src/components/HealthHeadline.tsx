import { useMemo } from 'react';

import { useAppStore } from '../lib/store';
import type { Graph } from '../lib/types';

interface Props {
  graph: Graph | null;
}

interface TierCounts {
  green: number;
  amber: number;
  red: number;
  unknown: number;
  measured: number;
}

function tierCounts(graph: Graph | null): TierCounts {
  const counts: TierCounts = { green: 0, amber: 0, red: 0, unknown: 0, measured: 0 };
  if (!graph) return counts;
  for (const node of graph.nodes) {
    if (node.type !== 'module') continue;
    const tier = (node.attributes.health_tier ?? 'unknown') as keyof Omit<TierCounts, 'measured'>;
    if (tier === 'green' || tier === 'amber' || tier === 'red') {
      counts[tier] += 1;
      counts.measured += 1;
    } else {
      counts.unknown += 1;
    }
  }
  return counts;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Issue #163 — the authored "state of your codebase" headline. A one-line
 * verdict plus a few framed facts, so an owner feels the state in seconds
 * before the canvas invites exploration. Facts come from the live module
 * health on the graph and the verification receipts.
 */
export function HealthHeadline({ graph }: Props) {
  const activityByModule = useAppStore((s) => s.activityByModule);

  // Modules an AI agent shipped to this week, from the receipt-backed activity.
  const weekModules = useMemo(() => {
    const cutoff = Date.now() - WEEK_MS;
    const week = Object.values(activityByModule).filter((a) => {
      const t = Date.parse(a.lastChange);
      return !Number.isNaN(t) && t >= cutoff;
    });
    return { total: week.length, unverified: week.filter((a) => !a.verified).length };
  }, [activityByModule]);

  const counts = useMemo(() => tierCounts(graph), [graph]);

  const verdict =
    counts.red > 0
      ? 'At risk'
      : counts.amber > 0
        ? 'Needs attention'
        : counts.measured > 0
          ? 'Healthy'
          : 'Not yet measured';

  const attention = counts.amber + counts.red;
  const attentionFact =
    counts.measured > 0
      ? `${attention} ${attention === 1 ? 'area needs' : 'areas need'} attention.`
      : 'Run paqad-ai onboard to measure your areas.';

  const activityFact =
    weekModules.total > 0
      ? ` AI agents shipped to ${weekModules.total} ${weekModules.total === 1 ? 'module' : 'modules'} this week, ${
          weekModules.unverified === 0 ? 'all verified' : `${weekModules.unverified} unverified`
        }.`
      : '';

  return (
    <div
      className="shrink-0 border-b px-6 py-4"
      style={{
        background: 'var(--color-canvas)',
        borderColor: 'color-mix(in srgb, var(--color-border) 60%, transparent)',
      }}
    >
      <div className="text-page font-semibold">{verdict}.</div>
      <p className="mt-0.5 text-secondary" style={{ color: 'var(--color-muted)' }}>
        {attentionFact}
        {activityFact}
      </p>
    </div>
  );
}
