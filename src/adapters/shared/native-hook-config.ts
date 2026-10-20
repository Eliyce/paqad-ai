import { readFileSync } from 'node:fs';
import { join } from 'pathe';

import type { GeneratedFile } from '../adapter.interface.js';
import { buildHostHookChain, completionRecordCommand, type RenderedHook } from './paqad-hooks.js';

interface HookEntry {
  type: string;
  command: string;
  onFailure?: string;
  timeout?: number;
}

interface HookMatcher {
  matcher?: string | null;
  hooks: HookEntry[];
}

type HookEvents = Record<string, HookMatcher[]>;

export interface NativeHookConfigOptions {
  projectRoot: string;
  settingsPath: string;
  chain: RenderedHook[];
  pruneExact?: ReadonlySet<string>;
  pruneBasenames?: readonly string[];
  transform?: (merged: Record<string, unknown>) => Record<string, unknown>;
}

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
        hooks: [
          {
            type: 'command',
            command: entry.command,
            ...(entry.onFailure !== undefined ? { onFailure: entry.onFailure } : {}),
            ...(entry.timeout !== undefined ? { timeout: entry.timeout } : {}),
          },
        ],
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

const RECORD_HOOK_BASENAME = 'verification-record.mjs';

export interface NativeCompletionHookOptions {
  projectRoot: string;
  settingsPath: string;
  completionEvent: string;
  adapterType?: string;
}

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

export function buildFullHookChain(
  adapterType: string,
  env: NodeJS.ProcessEnv = process.env,
): RenderedHook[] {
  return buildHostHookChain(adapterType, env);
}

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
