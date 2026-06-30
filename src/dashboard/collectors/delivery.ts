import { readProjectProfile } from '@/core/project-profile.js';
import { readLatestDeliveryEvidence } from '@/delivery/delivery-ledger.js';
import { loadDeliveryPolicy } from '@/pipeline/delivery-policy.js';
import { resolveTicketProvider } from '@/providers/registry.js';

import { bandForScore } from '../scoring/index.js';
import type { AttentionItem, SectionData } from '../types.js';

/**
 * Issue #42 — the Delivery Workflow dashboard section. It is the always-on
 * answer to "is this on, and what will it do?": the configured/active state,
 * the resolved provider connections (GitHub / Jira), and the active
 * conventions. Git-only conventions are active immediately; provider-bound
 * capabilities are reported as dormant until their MCP / host is connected.
 */
const HELPER = {
  what: 'docs/instructions/workflows/delivery-policy.yaml configures the ticket_intake → delivery loop: branch/commit/PR conventions, CI gate, and tracker transitions.',
  goodLooksLike:
    'Enabled, conventions detected from your repo, and both the host (GitHub) and tracker (Jira) MCP connected so PR + ticket automation is active.',
} as const;

export function collectDelivery(projectRoot: string): {
  section: SectionData;
  attention: AttentionItem[];
} {
  const { policy } = loadDeliveryPolicy(projectRoot);
  const profile = readProjectProfile(projectRoot);
  // Buildout F6 (hard cutover, D1) — the dashboard reads delivery evidence from
  // the session-ledger, not the legacy file. The file remains the operational
  // source the policy loader overlays; both are written together by writeDetection.
  const detection = readLatestDeliveryEvidence(projectRoot);

  if (!policy.enabled) {
    return {
      section: {
        id: 'delivery',
        title: 'Delivery Workflow',
        band: 'unknown',
        score: null,
        summary: 'Disabled in delivery-policy.yaml',
        metrics: [{ label: 'Enabled', value: 'no' }],
        helper: HELPER,
        details: { enabled: false },
      },
      attention: [],
    };
  }

  const ticketRes = resolveTicketProvider(profile?.mcp?.servers ?? [], policy.process.ticket);
  // Host "connection" can't be auth-verified from a static collector; report
  // whether the git remote we detected matches the configured host kind.
  const hostDetected =
    detection?.host?.value !== undefined && detection.host.value === policy.process.host.provider;

  const connected = [ticketRes.connected, hostDetected].filter(Boolean).length;
  const score = connected === 2 ? 100 : connected === 1 ? 70 : 40;

  const manualSections = Object.entries(policy.process)
    .filter(([, section]) => section.maintained === 'manual')
    .map(([name]) => name);

  const attention: AttentionItem[] = [];
  if (!ticketRes.connected) {
    attention.push({
      sectionId: 'delivery',
      message: `Connect a ${policy.process.ticket.provider} MCP to activate ticket status + decision comments.`,
      severity: 'info',
    });
  }
  if (!hostDetected) {
    attention.push({
      sectionId: 'delivery',
      message: `Connect ${policy.process.host.provider} (host) to activate PR + CI automation.`,
      severity: 'info',
    });
  }

  return {
    section: {
      id: 'delivery',
      title: 'Delivery Workflow',
      band: bandForScore(score),
      score,
      summary:
        connected === 2
          ? 'Configured · GitHub ✓ · Jira ✓'
          : `Configured · ${policy.process.host.provider} ${hostDetected ? '✓' : '✗'} · ${policy.process.ticket.provider} ${ticketRes.connected ? '✓' : '✗ (dormant)'}`,
      metrics: [
        { label: 'Host', value: `${policy.process.host.provider} ${hostDetected ? '✓' : '✗'}` },
        {
          label: 'Tracker',
          value: `${policy.process.ticket.provider} ${ticketRes.connected ? '✓' : '✗'}`,
        },
        {
          label: 'Maintained',
          value: manualSections.length === 0 ? 'all auto' : `${manualSections.length} manual`,
        },
      ],
      helper: HELPER,
      details: {
        enabled: policy.enabled,
        host: { provider: policy.process.host.provider, detected: hostDetected },
        ticket: {
          provider: policy.process.ticket.provider,
          server: ticketRes.server,
          connected: ticketRes.connected,
        },
        ci_gate: policy.process.ci.gate,
        manual_sections: manualSections,
        detection,
      },
    },
    attention,
  };
}
