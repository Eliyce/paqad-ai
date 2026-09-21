import { readFileSync } from 'node:fs';
import { join } from 'pathe';

import type { GeneratedFile } from '../adapter.interface.js';
import { buildHostHookChain, completionRecordCommand, type RenderedHook } from './paqad-hooks.js';

/**
 * The ONE renderer that writes paqad's hooks into a host's native hook-config file
 * (issue #566). It replaces both the Claude-specific `mergeAgentEntryGate` and the
 * earlier record-only `buildNativeCompletionHookFile`, so there is a single way to
 * render a host hook config (RULE-13). It reproduces each host's prior output
 * byte-for-byte:
 *   - Claude `.claude/settings.json`: the full PreToolUse/UserPromptSubmit/
 *     SessionStart/Stop chain, plus the attribution transform the adapter passes.
 *   - Codex `.codex/hooks.json`: the same chain with Codex's native event names and
 *     `^apply_patch$` matcher, and the `codex-cli` host argv where a script is
 *     host-aware.
 *   - Gemini `.gemini/settings.json`: the single record-only `AfterAgent` hook, via
 *     the {@link buildNativeCompletionHookFile} convenience below.
 *
 * Idempotent and non-destructive: an existing settings file is parsed tolerantly and
 * every key outside a managed `hooks[event]` is preserved untouched; a retired hook
 * command (a legacy bare-`~` / `.sh` form, or a hook whose basename is in
 * `pruneBasenames`) is dropped before merging; a paqad command already present is not
 * re-added — so re-onboarding is byte-stable and a user's own hooks survive.
 */
interface HookEntry {
  type: string;
  command: string;
}

interface HookMatcher {
  matcher?: string | null;
  hooks: HookEntry[];
}

type HookEvents = Record<string, HookMatcher[]>;

export interface NativeHookConfigOptions {
  projectRoot: string;
  /** Project-relative path to the host's hook settings file (Claude:
   *  `.claude/settings.json`; Codex: `.codex/hooks.json`). */
  settingsPath: string;
  /** The ordered, host-resolved hook chain (from `buildHostHookChain`). */
  chain: RenderedHook[];
  /** Exact legacy command strings to prune from every managed event on re-onboard. */
  pruneExact?: ReadonlySet<string>;
  /** Hook file basenames to prune in ANY form (retired hooks with no replacement, or
   *  a hook whose argv changed so its command string is no longer an exact match). */
  pruneBasenames?: readonly string[];
  /** Optional post-merge transform (Claude uses it to fold in the attribution block),
   *  applied after the hooks are merged and before the object is serialized. */
  transform?: (merged: Record<string, unknown>) => Record<string, unknown>;
}

/** True when a command should be pruned: an exact legacy match, or it targets a
 *  pruned basename in any form. */
function shouldPrune(
  command: string,
  pruneExact: ReadonlySet<string> | undefined,
  pruneBasenames: readonly string[] | undefined,
): boolean {
  if (pruneExact?.has(command)) {
    return true;
  }
  return (pruneBasenames ?? []).some((file) => command.includes(file));
}

/** Drop pruned hooks from an event's existing groups, removing any group left empty. */
function pruneEventGroups(
  groups: HookMatcher[] | undefined,
  pruneExact: ReadonlySet<string> | undefined,
  pruneBasenames: readonly string[] | undefined,
): HookMatcher[] {
  return (Array.isArray(groups) ? groups : [])
    .map((group) => ({
      ...group,
      hooks: (group?.hooks ?? []).filter(
        (hook) => !shouldPrune(hook.command, pruneExact, pruneBasenames),
      ),
    }))
    .filter((group) => group.hooks.length > 0);
}

/**
 * Merge paqad's rendered chain into an existing host hooks object. Existing (pruned)
 * groups for an event come first, then paqad's entries as one group each, appended
 * only when the exact command is not already present (idempotent). Events not in the
 * chain are preserved untouched. Returns the next top-level object with `hooks`
 * reassigned in place (so key order is stable across re-onboards).
 */
export function mergeNativeHooks(
  existing: Record<string, unknown>,
  chain: RenderedHook[],
  pruneExact?: ReadonlySet<string>,
  pruneBasenames?: readonly string[],
): Record<string, unknown> {
  const hooks: HookEvents =
    existing.hooks && typeof existing.hooks === 'object' && !Array.isArray(existing.hooks)
      ? (existing.hooks as HookEvents)
      : {};

  // Group the chain by native event, preserving the chain's order.
  const byEvent = new Map<string, RenderedHook[]>();
  for (const rendered of chain) {
    const list = byEvent.get(rendered.nativeEvent) ?? [];
    list.push(rendered);
    byEvent.set(rendered.nativeEvent, list);
  }

  const nextHooks: HookEvents = { ...hooks };
  for (const [event, entries] of byEvent) {
    const merged = pruneEventGroups(hooks[event], pruneExact, pruneBasenames);
    for (const entry of entries) {
      const alreadyPresent = merged.some((group) =>
        group.hooks?.some((hook) => hook.command === entry.command),
      );
      if (alreadyPresent) {
        continue;
      }
      merged.push({
        ...(entry.matcher !== undefined ? { matcher: entry.matcher } : {}),
        hooks: [{ type: 'command', command: entry.command }],
      });
    }
    nextHooks[event] = merged;
  }

  return { ...existing, hooks: nextHooks };
}

export function buildNativeHookConfigFile(options: NativeHookConfigOptions): GeneratedFile {
  const { projectRoot, settingsPath, chain, pruneExact, pruneBasenames, transform } = options;
  const existing = readJsonObject(join(projectRoot, settingsPath));
  const merged = mergeNativeHooks(existing, chain, pruneExact, pruneBasenames);
  const next = transform ? transform(merged) : merged;
  return {
    path: settingsPath,
    content: `${JSON.stringify(next, null, 2)}\n`,
    autoUpdate: true,
  };
}

/** The record hook's basename — pruned in any form so its argv change cuts over cleanly. */
const RECORD_HOOK_BASENAME = 'verification-record.mjs';

export interface NativeCompletionHookOptions {
  projectRoot: string;
  /** Project-relative path to the host's hook settings file (Gemini:
   *  `.gemini/settings.json`). */
  settingsPath: string;
  /** The host's native "agent finished a turn" event (Gemini: `AfterAgent`). */
  completionEvent: string;
  /** The host adapter type, passed to the record hook as an argv (issue #265). */
  adapterType?: string;
}

/**
 * Render the record-only completion hook into a host whose native "agent finished"
 * hook must never disrupt the agent — today Gemini CLI's `AfterAgent`. A thin
 * specialization of {@link buildNativeHookConfigFile}: one completion entry, the
 * record hook pruned by basename so a prior form cuts over cleanly. Kept so Gemini's
 * output stays byte-identical while Codex moves to the full blocking chain (#566).
 */
export function buildNativeCompletionHookFile(options: NativeCompletionHookOptions): GeneratedFile {
  const { projectRoot, settingsPath, completionEvent, adapterType } = options;
  const chain: RenderedHook[] = [
    { nativeEvent: completionEvent, command: completionRecordCommand(adapterType) },
  ];
  return buildNativeHookConfigFile({
    projectRoot,
    settingsPath,
    chain,
    pruneBasenames: [RECORD_HOOK_BASENAME],
  });
}

/** The full pre-and-completion chain for a host that renders it (Claude, Codex). */
export function buildFullHookChain(
  adapterType: string,
  env: NodeJS.ProcessEnv = process.env,
): RenderedHook[] {
  return buildHostHookChain(adapterType, env);
}

/**
 * Read a JSON object from disk, returning `{}` when the file is absent (ENOENT) or
 * unparseable. Single read + ENOENT catch — never `existsSync(path) ?
 * readFileSync(path)`, which is the TOCTOU file-system race CodeQL flags.
 */
function readJsonObject(path: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
