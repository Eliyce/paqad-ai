import type { DeliveryHost } from '@/delivery/host.js';
import type { HostProviderKind } from '@/git-workflow/types.js';
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

export interface TicketSourceRef {
  tracker: TicketProviderKind;
  server: string;
}

export function resolveTicketProvider(
  servers: ProjectMcpServer[],
  source: TicketSourceRef,
): TicketProviderResolution {
  const enabled = servers.filter((s) => s.enabled);

  if (source.server) {
    const named = enabled.find((s) => s.name === source.server);
    return {
      kind: source.tracker,
      server: named ? named.name : null,
      connected: named !== undefined,
    };
  }

  const byKind = enabled.find((s) => s.kind === source.tracker);
  return {
    kind: source.tracker,
    server: byKind ? byKind.name : null,
    connected: byKind !== undefined,
  };
}

export interface HostEnvironment {
  remoteHost: DeliveryHost | null;
  cliAvailable: boolean;
}

export function resolveHostProvider(
  host: HostProviderKind,
  env: HostEnvironment,
): HostProviderResolution {
  const remoteMatches = env.remoteHost === null ? false : env.remoteHost === host;
  return {
    kind: host,
    connected: env.cliAvailable && remoteMatches,
  };
}
