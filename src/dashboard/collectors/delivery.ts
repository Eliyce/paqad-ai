import { readProjectProfile } from '@/core/project-profile.js';
import { trackerName } from '@/delivery/degradation.js';
import { loadGitWorkflow } from '@/git-workflow/load.js';
import { resolveTicketProvider } from '@/providers/registry.js';

import { bandForScore } from '../scoring/index.js';
import type { AttentionItem, SectionData } from '../types.js';

const HELPER = {
  what: ".paqad/configs/git-workflow/ holds this team's rules for tickets, branches, commits, pull requests and how strictly they're checked.",
  goodLooksLike:
    'The rules load without errors, and every ticket source has its tracker MCP connected so ticket moves can be made.',
} as const;

export function collectDelivery(projectRoot: string): {
  section: SectionData;
  attention: AttentionItem[];
} {
  const loaded = loadGitWorkflow(projectRoot);
  const config = loaded.config;
  const profile = readProjectProfile(projectRoot);

  if (!config.enforcement.enabled) {
    return {
      section: {
        id: 'delivery',
        title: 'Delivery Workflow',
        band: 'unknown',
        score: null,
        summary: 'Turned off in .paqad/configs/git-workflow/enforcement.yaml',
        metrics: [{ label: 'Enabled', value: 'no' }],
        helper: HELPER,
        details: { enabled: false },
      },
      attention: [],
    };
  }

  const attention: AttentionItem[] = [];
  if (!loaded.valid) {
    attention.push({
      sectionId: 'delivery',
      message: `.paqad/configs/git-workflow/ has errors: ${loaded.errors[0]?.message ?? 'unknown error'}`,
      severity: 'warn',
    });
  }

  const sources = Object.entries(config.tickets.sources).map(([name, source]) => ({
    name,
    tracker: source.tracker,
    resolution: resolveTicketProvider(profile?.mcp?.servers ?? [], source),
  }));
  for (const source of sources.filter((entry) => !entry.resolution.connected)) {
    attention.push({
      sectionId: 'delivery',
      message: `Connect a ${trackerName(source.tracker)} MCP so ticket moves for ${source.name} can be made.`,
      severity: 'info',
    });
  }

  const connected = sources.filter((entry) => entry.resolution.connected).length;
  const trackerScore = sources.length === 0 ? 100 : Math.round((connected / sources.length) * 100);
  const score = loaded.valid ? Math.max(40, trackerScore) : 20;
  const trackers =
    sources.length === 0
      ? 'no ticket sources'
      : sources
          .map((entry) => `${entry.name} ${entry.resolution.connected ? '✓' : '✗ (dormant)'}`)
          .join(' · ');

  return {
    section: {
      id: 'delivery',
      title: 'Delivery Workflow',
      band: bandForScore(score),
      score,
      summary: loaded.valid ? `Configured · ${trackers}` : 'The git workflow rules have errors',
      metrics: [
        { label: 'Host', value: config.pull_requests.host },
        { label: 'Base branch', value: config.branches.base_branch },
        { label: 'Ticket sources', value: `${connected}/${sources.length} connected` },
      ],
      helper: HELPER,
      details: {
        enabled: true,
        valid: loaded.valid,
        source: loaded.source,
        errors: loaded.errors,
        host: config.pull_requests.host,
        sources: sources.map((entry) => ({
          name: entry.name,
          tracker: entry.tracker,
          server: entry.resolution.server,
          connected: entry.resolution.connected,
        })),
        ci_gate: config.pull_requests.ci.gate,
      },
    },
    attention,
  };
}
