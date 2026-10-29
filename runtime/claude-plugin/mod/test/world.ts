import type { AgentInfo, On, RenderElement, RenderInput, RenderNode } from 'claude-code';

export const ROOT = '/work';
export const SESSION_ID = 'ses-fixture';
export const SNAPSHOT = `.paqad/session/hud/${SESSION_ID}.json`;
export const RECEIPT = `.paqad/session/hud/${SESSION_ID}.receipt.md`;
export const ENGINE_BAND = 'engine band';
export const HEARTBEAT = `.paqad/session/hud/${SESSION_ID}.live`;
export const LAST_BLOCK = `.paqad/session/hud/${SESSION_ID}.last-block.json`;

export interface World {
  files: Map<string, string>;
  store: Map<string, unknown>;
  closedPanes: string[];
  commands: string[];
  reads: string[];
  agents: AgentInfo[];
  opened: string[];
  drawn: Array<{ component: string; props: unknown }>;
  asked: Array<{ question: string; options: string[] }>;
  answers: Array<string | null>;
  runs: Array<{ argv: readonly string[]; cwd?: string; timeoutMs?: number }>;
  run: { exitCode: number; stdout: string; stderr: string } | 'reject';
  onRun: ((argv: readonly string[]) => void) | null;
  runGate: Promise<void> | null;
  pluginBinary: boolean;
  marksAllowedOnce: boolean;
  toasts: string[];
  logs: Array<{ text: string; to: string | undefined }>;
  writes: Array<{ path: string; text: string }>;
  played: unknown[];
  spoken: string[];
  verdict: { decision: 'allow' | 'ask' | 'deny'; reason?: string; rule?: string } | 'throw';
  during: Map<string, () => Promise<void>>;
  unreadable: Set<string>;
  put: (path: string, text: string) => void;
  remove: (path: string) => void;
}

export interface WorldOptions {
  files?: Readonly<Record<string, string>>;
  store?: Map<string, unknown>;
  env?: Readonly<Record<string, string>>;
  version?: { version: string; base?: string };
  band?: RenderElement;
  refuse?: Readonly<Record<string, string>>;
  sessionId?: string | null;
  root?: string;
}

export const OVERRIDE_RECORDED =
  '**▸ paqad** · recorded a one-time override of RL-13 on src/x.ts by a person. It shows on the receipt.\n{"overridden":true}\n';

export const TAKEN = `"/paqad" refused: it is the plugin's /paqad-product-discovery:paqad`;

export const ENGINE_CARD = { type: 'engine', ref: 0 } as const;

export const ONBOARDED = { '.paqad/framework-path.txt': '~/.paqad-ai/current\n' };

const relOf = (path: string): string =>
  path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path;

function markAllowedOnce(world: World): void {
  const stop = world.files.get(LAST_BLOCK);
  if (stop === undefined || !stop.startsWith('{')) return;
  world.files.set(
    LAST_BLOCK,
    JSON.stringify({ ...JSON.parse(stop), used: true, allowed_once: true }),
  );
}

export function worldOf(on: On, options: WorldOptions = {}): World {
  const world: World = {
    files: new Map(Object.entries(options.files ?? {})),
    store: options.store ?? new Map(),
    closedPanes: [],
    commands: [],
    reads: [],
    agents: [],
    opened: [],
    drawn: [],
    asked: [],
    answers: [],
    runs: [],
    run: { exitCode: 0, stdout: OVERRIDE_RECORDED, stderr: '' },
    onRun: null,
    runGate: null,
    pluginBinary: true,
    marksAllowedOnce: true,
    toasts: [],
    logs: [],
    writes: [],
    played: [],
    spoken: [],
    verdict: { decision: 'allow' },
    during: new Map(),
    unreadable: new Set(),
    put: (path, text) => void world.files.set(path, text),
    remove: (path) => void world.files.delete(path),
  };
  const isDir = (path: string) => [...world.files.keys()].some((f) => f.startsWith(`${path}/`));

  on('fs.read', ($, e) => {
    world.reads.push(relOf(e.path));
    const text = world.files.get(relOf(e.path));
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text };
  });
  on('fs.exists', ($, e) =>
    world.unreadable.has(relOf(e.path))
      ? { deny: `EACCES: ${e.path}` }
      : {
          value:
            world.files.has(relOf(e.path)) ||
            isDir(relOf(e.path)) ||
            (world.pluginBinary && /runtime\/claude-plugin\/bin\/paqad-ai$/.test(e.path)),
        },
  );
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
  on('session.root', () => ({ value: options.root ?? ROOT }));
  on('session.id', () =>
    options.sessionId === null
      ? { deny: 'the session id is not available' }
      : { value: options.sessionId ?? SESSION_ID },
  );
  on('session.version', () => ({
    value: options.version ?? { version: '2.1.302', base: '2.1.302' },
  }));
  on('agent.list', () => ({ value: world.agents }));
  on('command.register', ($, e) => {
    const refusal = options.refuse?.[e.name];
    if (refusal !== undefined) return { deny: refusal };
    world.commands.push(e.name);
    return { value: { command: e.name } };
  });
  on('ui.log', ($, e) => {
    world.logs.push({ text: e.text, to: e.to });
    return { value: undefined } as never;
  });
  on('store.get', ($, e) => ({ value: world.store.get(e.key) }) as never);
  on('store.set', ($, e) => {
    world.store.set(e.key, e.value);
    return { value: undefined } as never;
  });
  on('store.delete', ($, e) => {
    world.store.delete(e.key);
    return { value: undefined } as never;
  });
  on('store.keys', () => ({ value: [...world.store.keys()] }) as never);
  on('ui.close', ($, e) => {
    world.closedPanes.push(e.id);
    return { value: true } as never;
  });
  on('ui.open', ($, e) => {
    world.opened.push(e.id);
    return { value: { isPlaced: true } };
  });
  on('session.start', ($, e) => ({ cwd: e.cwd }));
  on('prompt.submit', ($, e) => ({ text: e.text }));
  on('turn.start', ($, e) => ({ turnId: e.turnId }));
  on('turn.complete', () => ({ text: '' }));
  on('tool.call', async ($, e) => {
    const inFlight = world.during.get(String(e.tool));
    if (inFlight) await inFlight();
    if (e.tool !== 'AskUserQuestion') return { result: 'ok' } as never;
    const asked = (
      e as unknown as { questions: Array<{ question: string; options: Array<{ label: string }> }> }
    ).questions[0]!;
    world.asked.push({ question: asked.question, options: asked.options.map((o) => o.label) });
    const answer = world.answers.shift();
    if (answer === undefined || answer === null) return { deny: 'dismissed' } as never;
    if (answer === 'throw') throw new Error('question failed');
    return { result: { questions: [asked], answers: { [asked.question]: answer } } } as never;
  });
  on('tool.check', () => {
    if (world.verdict === 'throw') throw new Error('engine check failed');
    return world.verdict;
  });
  on('process.run', async ($, e) => {
    world.runs.push({ argv: e.argv, cwd: e.init?.cwd, timeoutMs: e.init?.timeoutMs });
    if (world.runGate) await world.runGate;
    world.onRun?.(e.argv);
    const marks = world.marksAllowedOnce && e.argv.includes('--token');
    if (marks && world.run !== 'reject' && world.run.exitCode === 0) markAllowedOnce(world);
    return world.run === 'reject'
      ? { deny: 'spawn failed' }
      : { value: { ...world.run, isStdoutTruncated: false, isStderrTruncated: false } };
  });
  on('fs.write', ($, e) => {
    world.writes.push({ path: relOf(e.path), text: e.text });
    world.files.set(relOf(e.path), e.text);
    return { value: undefined } as never;
  });
  on('audio.play', ($, e) => {
    world.played.push(e.clip);
    return { value: undefined } as never;
  });
  on('audio.speak', ($, e) => {
    world.spoken.push(e.text);
    return { value: { synthesizer: 'test' } } as never;
  });
  on('ui.toast', ($, e) => {
    world.toasts.push(e.text);
    return { value: undefined } as never;
  });
  on('ui.render', ($, e) => {
    world.drawn.push({ component: e.component, props: e.props });
    if (e.component === 'AskUserQuestion') return ENGINE_CARD;
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

export function command(args = '', name = 'paqad') {
  return {
    command: name,
    args,
    origin: { kind: 'composer' as const },
    presentation: { isFullscreen: false, columns: 100 },
  };
}

export function stringsOf(node: RenderNode | RenderElement | null | undefined): string[] {
  if (node === null || node === undefined) return [];
  if (typeof node === 'string') return [node];
  const children = (node as { children?: readonly RenderNode[] }).children ?? [];
  const label = (node as { props?: { label?: unknown } }).props?.label;
  if (children.length === 0 && typeof label === 'string') return [label];
  return children.flatMap((child) => stringsOf(child));
}

export function linesOf(node: RenderElement): string[] {
  const children = (node as { children?: readonly RenderNode[] }).children ?? [];
  return children.map((child) => stringsOf(child).join(''));
}

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
