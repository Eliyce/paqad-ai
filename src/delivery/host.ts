export type DeliveryHost = 'github' | 'gitlab' | 'bitbucket' | 'unknown';

export function detectDeliveryHost(remoteUrl: string | null | undefined): DeliveryHost {
  if (!remoteUrl) {
    return 'unknown';
  }
  const host = extractHost(remoteUrl);
  if (host === null) {
    return 'unknown';
  }
  if (host === 'github.com' || host.endsWith('.github.com')) {
    return 'github';
  }
  if (host === 'gitlab.com' || host.startsWith('gitlab.')) {
    return 'gitlab';
  }
  if (host === 'bitbucket.org' || host.startsWith('bitbucket.')) {
    return 'bitbucket';
  }
  return 'unknown';
}

function extractHost(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  const ssh = /^[^@]+@([^:]+):/.exec(trimmed);
  if (ssh) {
    return ssh[1].toLowerCase();
  }
  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function parseOwnerRepo(remoteUrl: string | null | undefined): {
  owner: string;
  repo: string;
} | null {
  if (!remoteUrl) {
    return null;
  }
  const ssh = /git@[^:]+:([^/]+)\/([^/.]+)(?:\.git)?$/.exec(remoteUrl.trim());
  if (ssh) {
    return { owner: ssh[1], repo: ssh[2] };
  }
  const https = /https?:\/\/[^/]+\/([^/]+)\/([^/.]+)(?:\.git)?\/?$/.exec(remoteUrl.trim());
  if (https) {
    return { owner: https[1], repo: https[2] };
  }
  return null;
}
