import type { DeliveryShell } from './runner.js';
import {
  detectDelivery,
  hasDetection,
  summarizeDetection,
  type DetectedDelivery,
  type GitSnapshot,
} from './detection.js';
import { writeDetection } from './detection-store.js';

export interface DeliveryDetectionResult {
  detected: DetectedDelivery;
  summary: string[];
  connectNudge: string | null;
  filled: boolean;
}

export async function gatherGitSnapshot(shell: DeliveryShell): Promise<GitSnapshot> {
  const remote = await shell.run('git', ['remote', 'get-url', 'origin']);
  const head = await shell.run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const branches = await shell.run('git', ['branch', '--all', '--format=%(refname:short)']);
  const commits = await shell.run('git', ['log', '-n', '100', '--format=%s']);

  return {
    remoteUrl: remote.exitCode === 0 ? remote.stdout.trim() || null : null,
    defaultBranch: head.exitCode === 0 ? head.stdout.trim() || null : null,
    branchNames:
      branches.exitCode === 0
        ? branches.stdout
            .split('\n')
            .map((b) => b.trim())
            .filter((b) => b !== '' && !b.includes('->'))
        : [],
    recentCommitSubjects:
      commits.exitCode === 0
        ? commits.stdout
            .split('\n')
            .map((s) => s.trim())
            .filter((s) => s !== '')
        : [],
  };
}

export function buildConnectNudge(detected: DetectedDelivery): string | null {
  const targets: string[] = [];
  targets.push('Jira');
  if (detected.host) {
    targets.push(detected.host.value === 'github' ? 'GitHub' : detected.host.value);
  } else {
    targets.push('GitHub');
  }
  return `Connect ${targets.join(' + ')} (MCP) to activate ticket status + PR automation.`;
}

export async function runDeliveryDetection(
  projectRoot: string,
  shell: DeliveryShell,
): Promise<DeliveryDetectionResult> {
  const snapshot = await gatherGitSnapshot(shell);
  const detected = detectDelivery(snapshot);
  const filled = hasDetection(detected);

  if (filled) {
    writeDetection(projectRoot, detected);
  }

  return {
    detected,
    summary: summarizeDetection(detected),
    connectNudge: buildConnectNudge(detected),
    filled,
  };
}
