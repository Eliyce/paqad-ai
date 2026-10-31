import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { splitSkillFrontmatter } from '@/skills/frontmatter-parser.js';

import { activationCutoff, forEachActivation, pruneActivations } from './activations.js';
import { readAuthoringDefects } from './evidence.js';
import { descriptionLength } from './lint/fields.js';
import { discoverInstalledSkills, overlapScore, type InstalledArtifact } from './overlap.js';
import { readSkillPathContext } from './paths.js';
import { meetsThreshold } from './thresholds.js';
import { TRACKED_ROOT } from './workspace.js';

export const ACTIVATION_HOOK_HOSTS: readonly string[] = ['claude-code'];

export interface CatalogSkillRow {
  skill: string;
  path: string;
  fires: number;
  trigger_rate: number | null;
  last_fired: string | null;
  dark: boolean;
  listing_chars: number;
  user_invoked_without_disable: boolean;
}

export interface SkillCatalogReport {
  host: string;
  activation_data: boolean;
  window_days: number;
  skills: CatalogSkillRow[];
  dark: string[];
  rivals: Array<{ left: string; right: string; score: number }>;
  added: number;
  refused: number;
  pruned: number;
}

function userInvokedWithoutDisable(projectRoot: string, skill: InstalledArtifact): boolean {
  try {
    const split = splitSkillFrontmatter(readFileSync(join(projectRoot, skill.path), 'utf8'));
    if (!split.ok) return false;
    return split.data['user-invocable'] === true && split.data['disable-model-invocation'] !== true;
  } catch {
    return false;
  }
}

export function countAddedSkills(projectRoot: string): number {
  const root = join(projectRoot, TRACKED_ROOT);
  if (!existsSync(root)) return 0;
  let added = 0;
  for (const name of readdirSync(root).sort()) {
    try {
      const evidence = JSON.parse(readFileSync(join(root, name, 'evidence.json'), 'utf8')) as {
        skill?: unknown;
      };
      if (typeof evidence.skill === 'string') added += 1;
    } catch {
      continue;
    }
  }
  return added;
}

export function buildSkillCatalogReport(input: {
  projectRoot: string;
  host: string;
  now: Date;
  darkWindowDays: number;
  collisionThreshold: number;
}): SkillCatalogReport {
  const pruned = pruneActivations(input.projectRoot, input.now, input.darkWindowDays);
  const installed = discoverInstalledSkills(
    input.projectRoot,
    readSkillPathContext(input.projectRoot),
    { userHome: null },
  );
  const hasHook = ACTIVATION_HOOK_HOSTS.includes(input.host);
  const windowStart = input.now.getTime() - input.darkWindowDays * 86_400_000;
  const fires = new Map<string, number>();
  const last = new Map<string, string>();
  let total = 0;
  if (hasHook) {
    const cutoff = activationCutoff(input.now, input.darkWindowDays);
    forEachActivation(input.projectRoot, (activation) => {
      const at = Date.parse(activation.at);
      if (!(at >= cutoff)) return;
      const previous = last.get(activation.skill);
      if (previous === undefined || activation.at > previous)
        last.set(activation.skill, activation.at);
      if (at >= windowStart) {
        fires.set(activation.skill, (fires.get(activation.skill) ?? 0) + 1);
        total += 1;
      }
    });
  }
  const skills = installed.map((skill): CatalogSkillRow => {
    const count = fires.get(skill.name) ?? 0;
    return {
      skill: skill.name,
      path: skill.path,
      fires: count,
      trigger_rate:
        hasHook && total > 0 ? Math.round((count / total) * 1000) / 1000 : hasHook ? 0 : null,
      last_fired: last.get(skill.name) ?? null,
      dark: hasHook && count === 0,
      listing_chars: descriptionLength(skill.description),
      user_invoked_without_disable: userInvokedWithoutDisable(input.projectRoot, skill),
    };
  });
  const rivals: SkillCatalogReport['rivals'] = [];
  for (let left = 0; left < installed.length; left += 1) {
    for (let right = left + 1; right < installed.length; right += 1) {
      const score = overlapScore(installed[left]!.description, installed[right]!.description);
      if (meetsThreshold(score, input.collisionThreshold)) {
        rivals.push({ left: installed[left]!.name, right: installed[right]!.name, score });
      }
    }
  }
  return {
    host: input.host,
    activation_data: hasHook,
    window_days: input.darkWindowDays,
    skills,
    dark: skills.filter((row) => row.dark).map((row) => row.skill),
    rivals,
    added: countAddedSkills(input.projectRoot),
    refused: new Set(readAuthoringDefects(input.projectRoot).map((defect) => defect.skill)).size,
    pruned,
  };
}

export function renderCatalogLines(report: SkillCatalogReport): string[] {
  const lines: string[] = [
    `Skills added through their checks: ${report.added}. Skills refused: ${report.refused}.`,
  ];
  if (!report.activation_data) {
    lines.push(`activation data: none on ${report.host}`);
  }
  for (const row of report.skills) {
    const rate =
      row.trigger_rate === null ? 'no activation data' : `trigger rate ${row.trigger_rate}`;
    lines.push(
      `${row.skill}: ${rate}, ${row.fires} fire${row.fires === 1 ? '' : 's'} in ${report.window_days} days, listing ${row.listing_chars} characters` +
        (row.dark ? ', dark' : '') +
        (row.user_invoked_without_disable
          ? ', user-invoked: add disable-model-invocation: true'
          : ''),
    );
  }
  for (const rival of report.rivals) {
    lines.push(
      `${rival.left} and ${rival.right} compete for the same requests (${rival.score.toFixed(2)}).`,
    );
  }
  return lines;
}
