import type { DeliveryHost } from '@/delivery/host.js';
import type {
  ResolvedDeliveryHost,
  ResolvedDeliveryTicket,
  HostProviderKind,
} from '@/core/types/delivery-policy.js';
import type { ProjectMcpServer, TicketProviderKind } from '@/core/types/project-profile.js';

/**
 * Issue #42 — provider resolution. A provider is resolved from the
 * delivery-policy `process.{ticket,host}` section; `connected` reflects whether
 * the capability can actually run yet (the MCP / host CLI is present). This is
 * what powers graceful degradation at runtime and the dashboard's
 * configured-vs-active view.
 */

export interface TicketProviderResolution {
  kind: TicketProviderKind;
  /** Name of the MCP server that will satisfy this provider, or null. */
  server: string | null;
  connected: boolean;
}

export interface HostProviderResolution {
  kind: HostProviderKind;
  connected: boolean;
}

/**
 * Resolve the ticket provider: the configured kind, the first enabled MCP
 * server of that kind (or the explicitly named server), and whether such a
 * server exists. `server: ""` in config means "first enabled of that kind".
 */
export function resolveTicketProvider(
  servers: ProjectMcpServer[],
  ticket: ResolvedDeliveryTicket,
): TicketProviderResolution {
  const enabled = servers.filter((s) => s.enabled);

  if (ticket.server) {
    const named = enabled.find((s) => s.name === ticket.server);
    return {
      kind: ticket.provider,
      server: named ? named.name : null,
      connected: named !== undefined,
    };
  }

  const byKind = enabled.find((s) => s.kind === ticket.provider);
  return {
    kind: ticket.provider,
    server: byKind ? byKind.name : null,
    connected: byKind !== undefined,
  };
}

export interface HostEnvironment {
  /** Host inferred from `git remote get-url origin`, or null. */
  remoteHost: DeliveryHost | null;
  /** Whether the host CLI (`gh` for GitHub) is available + authenticated. */
  cliAvailable: boolean;
}

/**
 * Resolve the host provider. Host operations (PR, checks) run through the host
 * CLI, so `connected` requires both that the CLI is available and that the
 * actual git remote matches the configured host kind.
 */
export function resolveHostProvider(
  host: ResolvedDeliveryHost,
  env: HostEnvironment,
): HostProviderResolution {
  const remoteMatches = env.remoteHost === null ? false : env.remoteHost === host.provider;
  return {
    kind: host.provider,
    connected: env.cliAvailable && remoteMatches,
  };
}
