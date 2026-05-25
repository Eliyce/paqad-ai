/**
 * Infers the delivery host (GitHub / GitLab / Bitbucket / unknown) from a
 * `git remote -v` style URL. This is a static lookup; runtime execution lives
 * in delivery-runner.ts. GitLab and Bitbucket are recognised but not yet
 * automated — they fall through to the manual-PR remediation path.
 */

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

/**
 * Extracts the hostname from an ssh-style or https-style git remote URL.
 * Returns null when no recognisable host can be parsed — callers fall through
 * to the unknown-host path.
 */
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

/**
 * Extracts an owner/repo pair from a git remote URL. Returns null when the
 * URL shape isn't recognised. Callers must handle null by falling back to
 * the manual-PR remediation message.
 */
export function parseOwnerRepo(remoteUrl: string | null | undefined): {
  owner: string;
  repo: string;
} | null {
  if (!remoteUrl) {
    return null;
  }
  // git@github.com:owner/repo.git  or  https://github.com/owner/repo(.git)
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
