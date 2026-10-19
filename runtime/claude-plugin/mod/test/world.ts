// The world beneath the paqad HUD mod in its `claude plugin test` files (issue #639, Parts 8
// and 9): an in-memory project the mod's `$` calls are answered from, standing for the engine.
// Not shipped behaviour: only the tests import it.

import type { AgentInfo, On, RenderElement, RenderInput, RenderNode } from 'claude-code';

export const ROOT = '/work';
export const SESSION_ID = 'ses-fixture';
export const SNAPSHOT = `.paqad/session/hud/${SESSION_ID}.json`;
export const RECEIPT = `.paqad/session/hud/${SESSION_ID}.receipt.md`;
/** What the engine's own band holds in these tests, so a test can tell it from the mod's. */
export const ENGINE_BAND = 'engine band';

export interface World {
  files: Map<string, string>;
  commands: string[];
  /** Every path the mod read, in order. */
  reads: string[];
  agents: AgentInfo[];
  /** Every pane id the mod asked the engine to open, in order. */
  opened: string[];
  /** Every render the engine itself drew (what the mod passed on to `next`), in order. */
  drawn: Array<{ component: string; props: unknown }>;
  put: (path: string, text: string) => void;
  remove: (path: string) => void;
}

export interface WorldOptions {
  files?: Readonly<Record<string, string>>;
  env?: Readonly<Record<string, string>>;
  version?: { version: string; base?: string };
  /** What the engine (or another mod beneath paqad) draws in the band. */
  band?: RenderElement;
}

/** An onboarded project: the file the mod looks for to know paqad is set up here. */
export const ONBOARDED = { '.paqad/framework-path.txt': '~/.paqad-ai/current\n' };

const relOf = (path: string): string =>
  path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path;

export function worldOf(on: On, options: WorldOptions = {}): World {
  const world: World = {
    files: new Map(Object.entries(options.files ?? {})),
    commands: [],
    reads: [],
    agents: [],
    opened: [],
    drawn: [],
    put: (path, text) => void world.files.set(path, text),
    remove: (path) => void world.files.delete(path),
  };
  const isDir = (path: string) => [...world.files.keys()].some((f) => f.startsWith(`${path}/`));

  on('fs.read', ($, e) => {
    world.reads.push(relOf(e.path));
    const text = world.files.get(relOf(e.path));
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text };
  });
  on('fs.exists', ($, e) => ({ value: world.files.has(relOf(e.path)) || isDir(relOf(e.path)) }));
  on('fs.list', ($, e) => {
    const dir = relOf(e.path);
    if (!isDir(dir)) return { deny: `ENOENT: ${e.path}` };
    const names = new Map<string, 'file' | 'dir'>();
    for (const file of world.files.keys()) {
      if (!file.startsWith(`${dir}/`)) continue;
      const rest = file.slice(dir.length + 1);
      names.set(rest.split('/')[0] ?? '', rest.includes('/') ? 'dir' : 'file');
    }
    return {
      value: [...names.entries()].map(([name, kind]) => ({
        name,
        kind,
        size: 0,
        mtimeMs: 0,
        isLink: false,
      })),
    };
  });
  on('env.get', ($, e) => ({ value: options.env?.[e.name] }));
  on('session.root', () => ({ value: ROOT }));
  on('session.id', () => ({ value: SESSION_ID }));
  on('session.version', () => ({
    value: options.version ?? { version: '2.1.302', base: '2.1.302' },
  }));
  on('agent.list', () => ({ value: world.agents }));
  on('command.register', ($, e) => {
    world.commands.push(e.name);
    return { value: { command: e.name } };
  });
  on('ui.open', ($, e) => {
    world.opened.push(e.id);
    return { value: { isPlaced: true } };
  });
  on('session.start', ($, e) => ({ cwd: e.cwd }));
  on('prompt.submit', ($, e) => ({ text: e.text }));
  on('turn.complete', () => ({ text: '' }));
  on('tool.call', () => ({ result: 'ok' }) as never);
  // The engine's own band holds nothing outside a survey; a test that wants another mod's lines
  // beneath paqad's passes them as `band`.
  on('ui.render', ($, e) => {
    world.drawn.push({ component: e.component, props: e.props });
    return options.band ?? { type: 'Text', props: {}, children: [''] };
  });
  return world;
}

export const START = { cwd: ROOT, surface: 'terminal' as const, isInteractive: true };

export function band(
  surface: 'terminal' | 'desktop',
  props: Partial<RenderInput<'AbovePrompt'>['props']> = {},
): RenderInput<'AbovePrompt'> {
  const maxRows = props.maxRows ?? 12;
  return {
    component: 'AbovePrompt',
    surface,
    requestId: 'band',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows,
      bodyColumns: 95,
      scroll: { offset: 0, bodyRows: maxRows - 1 },
      view: {},
      ...props,
    },
  } as RenderInput<'AbovePrompt'>;
}

/** A render of the paqad pane on a surface, as the engine asks for it once the pane is open. */
export function pane(surface: 'terminal' | 'desktop', requestId = 'paqad'): RenderInput<'Pane'> {
  return {
    component: 'Pane',
    surface,
    requestId,
    props: {
      title: 'paqad',
      isFocused: false,
      bodyColumns: 90,
      placement: 'inline',
      scroll: { offset: 0, bodyRows: 20 },
      view: {},
    },
  } as RenderInput<'Pane'>;
}

export function command(args = '') {
  return {
    command: 'paqad',
    args,
    origin: { kind: 'composer' as const },
    presentation: { isFullscreen: false, columns: 100 },
  };
}

/** Every string a drawn tree holds, in drawing order. */
export function stringsOf(node: RenderNode | RenderElement | null | undefined): string[] {
  if (node === null || node === undefined) return [];
  if (typeof node === 'string') return [node];
  const children = (node as { children?: readonly RenderNode[] }).children ?? [];
  // A Button drawn with its words as children may hold them as its label once validated.
  const label = (node as { props?: { label?: unknown } }).props?.label;
  if (children.length === 0 && typeof label === 'string') return [label];
  return children.flatMap((child) => stringsOf(child));
}

/** The drawn band's lines: each `Text` directly under the band's column `Box`, as one string. */
export function linesOf(node: RenderElement): string[] {
  const children = (node as { children?: readonly RenderNode[] }).children ?? [];
  return children.map((child) => stringsOf(child).join(''));
}

/** The chat row of one tool call, as the engine asks for it. */
export function toolUse(
  surface: 'terminal' | 'desktop',
  toolUseId: string,
  command: string,
  tool = 'Bash',
): RenderInput<'ToolUse'> {
  return {
    component: 'ToolUse',
    surface,
    requestId: toolUseId,
    props: {
      tool_use_id: toolUseId,
      tool,
      input: { command },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    },
  } as RenderInput<'ToolUse'>;
}

/** A folded run of Bash calls, as the engine asks for it. */
export function toolGroup(
  surface: 'terminal' | 'desktop',
  commands: string[],
  isExpanded = false,
): RenderInput<'ToolGroup'> {
  return {
    component: 'ToolGroup',
    surface,
    requestId: 'group',
    props: {
      calls: commands.map((command, index) => ({
        tool_use_id: `g${index}`,
        tool: 'Bash',
        input: { command },
        isRunning: false,
        isErrored: false,
        isInterrupted: false,
      })),
      isActive: false,
      isExpanded,
    },
  } as RenderInput<'ToolGroup'>;
}

export const EXPERTS_COMMAND = 'pnpm exec paqad-ai spec pipeline experts --role qa-engineer';
