import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';

import { bandForScore, scorePresence } from '../scoring/index.js';
import type { SectionData } from '../types.js';
import { fileMtime } from './fs-helpers.js';

/**
 * Subset of project-profile.yaml the dashboard inspects. We deliberately do
 * NOT call `readProjectProfile` from `src/core/project-profile.ts` because
 * that function may rewrite the file when a legacy schema is detected — a
 * side effect that would violate the dashboard's "read-only viewing"
 * contract. A minimal local YAML parse is sufficient.
 */
interface ProfileSubset {
  project?: { name?: unknown; id?: unknown; description?: unknown };
  commands?: Record<string, unknown>;
  intelligence?: { rag_enabled?: unknown; embedding_provider?: unknown };
  mcp?: { servers?: unknown };
  routing?: { domain?: unknown };
}

const REQUIRED_FIELDS: ReadonlyArray<{ label: string; check: (p: ProfileSubset) => boolean }> = [
  {
    label: 'project.name',
    check: (p) => typeof p.project?.name === 'string' && p.project.name.trim().length > 0,
  },
  {
    label: 'project.id',
    check: (p) => typeof p.project?.id === 'string' && (p.project.id as string).trim().length > 0,
  },
  {
    label: 'commands.install',
    check: (p) => typeof p.commands?.install === 'string',
  },
  {
    label: 'commands.test',
    check: (p) => typeof p.commands?.test === 'string',
  },
  {
    label: 'commands.build',
    check: (p) => typeof p.commands?.build === 'string',
  },
  {
    label: 'routing.domain',
    check: (p) => typeof p.routing?.domain === 'string',
  },
];

const HELPER = {
  what: 'The project-profile.yaml file is the framework\'s declaration of your project: name, ID, commands, RAG, and MCP servers.',
  goodLooksLike: 'All required fields filled in by onboarding, commands updated to match the real toolchain, and RAG configured if you want vector retrieval.',
} as const;

export interface ProjectProfileSection {
  section: SectionData;
  projectName: string | null;
}

export function collectProjectProfile(projectRoot: string): ProjectProfileSection {
  const profilePath = join(projectRoot, PATHS.PROJECT_PROFILE);
  if (!existsSync(profilePath)) {
    return {
      section: {
        id: 'project-profile',
        title: 'Project profile',
        band: 'unknown',
        score: null,
        summary: 'Run `paqad-ai onboard` to create project-profile.yaml.',
        metrics: [],
        helper: HELPER,
      },
      projectName: null,
    };
  }

  let profile: ProfileSubset | null = null;
  try {
    profile = (YAML.parse(readFileSync(profilePath, 'utf8')) ?? {}) as ProfileSubset;
  } catch {
    profile = null;
  }

  if (profile === null) {
    return {
      section: {
        id: 'project-profile',
        title: 'Project profile',
        band: 'red',
        score: 0,
        summary: 'project-profile.yaml is present but failed to parse.',
        metrics: [
          { label: 'parse', value: 'failed' },
        ],
        helper: HELPER,
      },
      projectName: null,
    };
  }

  const presentFields = REQUIRED_FIELDS.filter((f) => f.check(profile)).length;
  const score = scorePresence({ expected: REQUIRED_FIELDS.length, present: presentFields });
  const ragEnabled = profile.intelligence?.rag_enabled === true;
  const mcpServers = Array.isArray(profile.mcp?.servers) ? (profile.mcp.servers as unknown[]).length : 0;
  const mtime = fileMtime(profilePath);
  const name = typeof profile.project?.name === 'string' ? (profile.project.name as string) : null;

  const summary =
    presentFields === REQUIRED_FIELDS.length
      ? `Configured · RAG ${ragEnabled ? 'on' : 'off'} · ${mcpServers} MCP server(s)`
      : `Missing ${REQUIRED_FIELDS.length - presentFields} required field(s)`;

  return {
    section: {
      id: 'project-profile',
      title: 'Project profile',
      band: bandForScore(score),
      score,
      summary,
      metrics: [
        { label: 'required fields', value: `${presentFields}/${REQUIRED_FIELDS.length}` },
        { label: 'rag', value: ragEnabled ? 'on' : 'off' },
        { label: 'mcp servers', value: String(mcpServers) },
      ],
      helper: HELPER,
      details: {
        mtimeMs: mtime,
        missingFields: REQUIRED_FIELDS.filter((f) => !f.check(profile!)).map((f) => f.label),
      },
    },
    projectName: name,
  };
}
