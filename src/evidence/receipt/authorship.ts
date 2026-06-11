// Issue #120 — resolve the change-authorship dimension folded into the #118
// receipt: which adapter wrote the change, the declared model/provider, and the
// human who accepted it.
//
// The trust split is deliberate. `agent` is a *known fact* — the onboarded
// adapter recorded in the onboarding manifest. `model`/`provider` are *declared*
// — an adapter knows it is "cursor" but Cursor routes to many models, so we read
// them from the environment (the only place that can honestly say which model
// ran) and stamp `provenance: 'declared'` rather than pretending to certainty.
// `accepting_human` is the git identity that will author the commit; it is the
// same name/email git already records in history, so recording it here adds no
// new disclosure — and it can be suppressed entirely with an env opt-out.
//
// Field names follow the cross-vendor `agent-trace` convention (`model_id` =
// `provider/model`) so the record interoperates with that ecosystem instead of
// inventing a competing authorship format.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { execa } from 'execa';

import { PATHS } from '@/core/constants/paths.js';
import { ADAPTER_TYPES, type AdapterType } from '@/core/types/adapter.js';
import type { ChangeAuthorship } from '@/core/types/evidence-ledger.js';
import type { OnboardingManifest } from '@/core/types/onboarding.js';

/** Git identity (name/email) of the human accepting the change. */
export interface GitIdentity {
  name?: string;
  email?: string;
}

/** Env opt-out: when set, `accepting_human` is omitted from the attestation. */
const NO_HUMAN_ENV = 'PAQAD_NO_HUMAN_ATTESTATION';

function isAdapterType(value: string | undefined): value is AdapterType {
  return value !== undefined && (ADAPTER_TYPES as readonly string[]).includes(value);
}

/** Read the onboarded adapter from the manifest, or `undefined` when the project
 *  is not onboarded / the manifest is unreadable. */
export function readOnboardedAgent(projectRoot: string): AdapterType | undefined {
  const path = join(projectRoot, PATHS.ONBOARDING_MANIFEST);
  if (!existsSync(path)) return undefined;
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as Partial<OnboardingManifest>;
    return isAdapterType(manifest.adapter) ? manifest.adapter : undefined;
  } catch {
    return undefined;
  }
}

/** Read the local git identity that will author the commit. Returns `null` when
 *  git is unavailable or unconfigured — never throws. */
export async function readGitIdentity(projectRoot: string): Promise<GitIdentity | null> {
  async function config(key: string): Promise<string | undefined> {
    try {
      const result = await execa('git', ['-C', projectRoot, 'config', '--get', key]);
      const value = result.stdout.trim();
      return value.length > 0 ? value : undefined;
    } catch {
      return undefined;
    }
  }
  const [name, email] = await Promise.all([config('user.name'), config('user.email')]);
  if (name === undefined && email === undefined) return null;
  return { name, email };
}

export interface BuildAuthorshipInput {
  agent?: AdapterType;
  env?: NodeJS.ProcessEnv;
  gitIdentity?: GitIdentity | null;
}

/**
 * Assemble {@link ChangeAuthorship} from already-resolved inputs — pure, no IO.
 *
 * model/provider precedence: explicit `PAQAD_AGENT_MODEL` / `PAQAD_AGENT_PROVIDER`
 * win; the agent-trace–style `PAQAD_MODEL_ID` (`provider/model`) fills any gap.
 * When both model and provider are known, `model_id` is re-derived canonically so
 * the record always carries the interop identifier.
 *
 * Returns `undefined` when nothing meaningful resolved (no agent, no declared
 * model/provider, no accepting human) so the predicate omits the field entirely.
 */
export function buildChangeAuthorship(input: BuildAuthorshipInput): ChangeAuthorship | undefined {
  const env = input.env ?? {};

  const [idProvider, idModel] = splitModelId(env.PAQAD_MODEL_ID);
  const model = nonEmpty(env.PAQAD_AGENT_MODEL) ?? idModel;
  const provider = nonEmpty(env.PAQAD_AGENT_PROVIDER) ?? idProvider;
  const model_id = model !== undefined && provider !== undefined ? `${provider}/${model}` : undefined;

  const declared = model !== undefined || provider !== undefined;

  const accepting_human =
    isTruthyEnv(env[NO_HUMAN_ENV]) || input.gitIdentity == null
      ? undefined
      : pickIdentity(input.gitIdentity);

  if (input.agent === undefined && !declared && accepting_human === undefined) {
    return undefined;
  }

  return {
    ...(input.agent !== undefined ? { agent: input.agent } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(provider !== undefined ? { provider } : {}),
    ...(model_id !== undefined ? { model_id } : {}),
    ...(accepting_human !== undefined ? { accepting_human } : {}),
    provenance: declared ? 'declared' : 'unknown',
  };
}

export interface ResolveAuthorshipInput {
  projectRoot: string;
  env?: NodeJS.ProcessEnv;
  /** Injected for tests; defaults to {@link readGitIdentity}. */
  gitIdentity?: GitIdentity | null;
}

/**
 * Resolve authorship for a change: read the onboarded adapter from the manifest,
 * read the git identity (unless injected), then assemble via
 * {@link buildChangeAuthorship}. Never throws — a failed resolution yields
 * `undefined` (a weaker trust signal, not a verdict).
 */
export async function resolveChangeAuthorship(
  input: ResolveAuthorshipInput,
): Promise<ChangeAuthorship | undefined> {
  const agent = readOnboardedAgent(input.projectRoot);
  const gitIdentity =
    input.gitIdentity !== undefined ? input.gitIdentity : await readGitIdentity(input.projectRoot);
  return buildChangeAuthorship({ agent, env: input.env, gitIdentity });
}

function splitModelId(raw: string | undefined): [string | undefined, string | undefined] {
  const value = nonEmpty(raw);
  if (value === undefined) return [undefined, undefined];
  const slash = value.indexOf('/');
  if (slash <= 0 || slash === value.length - 1) return [undefined, value];
  return [value.slice(0, slash), value.slice(slash + 1)];
}

function pickIdentity(identity: GitIdentity): GitIdentity | undefined {
  const name = nonEmpty(identity.name);
  const email = nonEmpty(identity.email);
  if (name === undefined && email === undefined) return undefined;
  return {
    ...(name !== undefined ? { name } : {}),
    ...(email !== undefined ? { email } : {}),
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isTruthyEnv(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}
