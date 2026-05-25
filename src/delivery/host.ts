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
  const lower = remoteUrl.toLowerCase();
  if (lower.includes('github.com')) {
    return 'github';
  }
  if (lower.includes('gitlab.com') || lower.includes('gitlab.')) {
    return 'gitlab';
  }
  if (lower.includes('bitbucket.org') || lower.includes('bitbucket.')) {
    return 'bitbucket';
  }
  return 'unknown';
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
