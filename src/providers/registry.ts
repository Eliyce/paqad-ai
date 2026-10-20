import type { DeliveryHost } from '@/delivery/host.js';
import type {
  ResolvedDeliveryHost,
  ResolvedDeliveryTicket,
  HostProviderKind,
} from '@/core/types/delivery-policy.js';
import type { ProjectMcpServer, TicketProviderKind } from '@/core/types/project-profile.js';

export interface TicketProviderResolution {
  kind: TicketProviderKind;
  server: string | null;
  connected: boolean;
}

export interface HostProviderResolution {
  kind: HostProviderKind;
  connected: boolean;
}

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
  remoteHost: DeliveryHost | null;
  cliAvailable: boolean;
}

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
