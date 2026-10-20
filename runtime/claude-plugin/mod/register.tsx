// The paqad HUD mod (issue #639, Parts 8 and 9): thin glue between Claude Code's events and the
// pure modules beside it. `config.ts` decides whether the mod stands down, `model.ts` reads the
// session's snapshot and turns it into what the band shows, `band.ts` lays the band out in rows,
// `commands.ts` answers `/paqad`, `pane.ts` (with `cost.ts`) fills the paqad pane (Part 23), and
// `table.ts` draws the High Table: its band instrument, its live card in the chat and its pane
// tab (Part 14).
//
// The mod only shows and asks. Every check stays one of the plugin's hooks in `hooks.json`, so
// the mod being off, blocked or broken changes no hook's decision (decision 2). It reads only
// `.paqad/`, never calls a model or the network, and starts no process (decisions 3 and 4).
//
// How each stand-down (decision 5) is applied:
//   - every other one (never onboarded, `CLAUDE_CODE_REMOTE=true`, paqad off, Claude Code older
//     than 2.1.301) needs `$` to read, so it is decided at `session.start`. Until then, and from
//     then on when standing down, every hook passes straight to `next(e)`: no read, no timer, no
//     band, no command. The one exception is a project never onboarded, where `/paqad` alone is
//     registered so `/paqad status` can say that paqad is not active here.

import { atom, read, update } from 'claude-code';
import type { EngineInterface, Register, RenderElement, RenderNode, Timer } from 'claude-code';

import { layoutBand, type BandRow, type BandSegment } from './band';
import { runPaqadCommand } from './commands';
import { ancestorDirs, decideStatus, registersCommand } from './config';
import {
  buildBandView,
  isLive,
  isRefreshTool,
  isStageAgent,
  joinPath,
  parseSnapshot,
  receiptPath,
  snapshotPath,
} from './model';
import { PANE_ID, PANE_TITLE, buildPaneView } from './pane';
import { cardKey, isExpertsCall, tableCardLines, type TableLine } from './table';
import type { PaqadHudSnapshot, PaqadPaneTab, PaqadStatus, PaqadTone } from './types';

/** How often the band re-reads the snapshot while a stage agent runs (FR-24: 1 to 2 seconds). */
const AGENT_TICK_MS = 1500;
/** One more read after a turn ends, for what the Stop hooks write once the turn is over. */
const AFTER_TURN_MS = 2000;

const statusAtom = atom({ plugin: 'paqad', key: 'status' } as const, null as PaqadStatus | null);
const snapshotAtom = atom(
  { plugin: 'paqad', key: 'snapshot' } as const,
  null as PaqadHudSnapshot | null,
);
const nowAtom = atom({ plugin: 'paqad', key: 'now' } as const, 0);
/**
 * The pane tab the person picked, written only from a press (a render hook never writes); `null`
 * until they pick one, while the pane opens on the High Table when the change has one.
 */
const paneTabAtom = atom({ plugin: 'paqad', key: 'paneTab' } as const, null as PaqadPaneTab | null);
/** The High Table seat picked in the pane, by role, written only from a press. */
const tableSeatAtom = atom({ plugin: 'paqad', key: 'tableSeat' } as const, null as string | null);
/**
 * The first `paqad-ai spec pipeline experts` call of each change, by change id: the one chat row
 * the live High Table card is drawn over. Written by `tool.call`, never by a render hook.
 */
const tableCardsAtom = atom(
  { plugin: 'paqad', key: 'tableCards' } as const,
  {} as Record<string, string>,
);

/** The theme colour each tone draws in; the words beside it always say the same thing. */
const TONE_COLOR: Record<PaqadTone, string | undefined> = {
  neutral: undefined,
  working: 'suggestion',
  'needs-you': 'permission',
  good: 'success',
  warn: 'warning',
  bad: 'error',
};

/** The `Text` element a surface draws with. */
type TextElement = ReturnType<EngineInterface['ui']['resolve']>['Text'];

/** One line of the card or the pane: each part in its colour, the words saying the same. */
function drawLine(Text: TextElement, line: TableLine) {
  return (
    <Text wrap="wrap">
      {line.map((segment) => (
        <Text
          color={segment.tone ? TONE_COLOR[segment.tone] : undefined}
          dimColor={segment.dim === true}
        >
          {segment.text}
        </Text>
      ))}
    </Text>
  );
}

/**
 * What the hooks need between events. Not drawn from (the band reads `$.state`), and rebuilt by
 * `session.start` after a hot reload, which drops module variables and timers alike.
 */
interface Live {
  /** The folder holding `.paqad/framework-path.txt`. */
  root: string;
  sessionId: string;
}

let live: Live | null = null;
let ticker: Timer | null = null;
/** Agent calls still running; the ticker keeps going while any is. */
let agentCalls = 0;
let reading = false;
let readAgain = false;
let lastText: string | null | undefined;

async function readText($: EngineInterface, path: string): Promise<string | null> {
  try {
    if (!(await $.fs.exists(path))) return null;
    const text = await $.fs.read(path);
    return typeof text === 'string' ? text : null;
  } catch {
    return null; // Missing, unreadable or too large: the band reads "not yet".
  }
}

/** Re-read the session's snapshot into `$.state`. One read at a time; never throws. */
async function refresh($: EngineInterface): Promise<void> {
  if (!live) return;
  if (reading) {
    readAgain = true;
    return;
  }
  reading = true;
  try {
    do {
      readAgain = false;
      const at = live;
      if (!at) return;
      const text = await readText($, snapshotPath(at.root, at.sessionId));
      const changed = text !== lastText;
      lastText = text;
      const snapshot = changed ? parseSnapshot(text) : await read($, snapshotAtom);
      if (changed) await update($, snapshotAtom, () => snapshot);
      // The live clock moves only while a stage runs; otherwise the band has nothing to redraw.
      if (changed || isLive(snapshot)) {
        const at = await $.clock.now();
        await update($, nowAtom, () => at);
      }
      if (isLive(snapshot)) startTicker($);
    } while (readAgain);
  } catch {
    // A failed read leaves the last good snapshot on screen; the next event tries again.
  } finally {
    reading = false;
  }
}

/** Tick every 1.5 s while a stage agent (or an Agent call) runs; stop once none does. */
function startTicker($: EngineInterface): void {
  if (ticker || !live) return;
  ticker = $.clock.every(AGENT_TICK_MS, () => {
    void (async () => {
      let running = agentCalls > 0;
      try {
        running ||= (await $.agent.list()).some(isStageAgent);
      } catch {
        // No agent list: keep to the Agent calls we saw start.
      }
      if (!running) {
        ticker?.cancel();
        ticker = null;
      }
      await refresh($);
    })();
  });
}

/** Everything `config.ts` needs, read through `$`. */
async function readStatus($: EngineInterface): Promise<PaqadStatus & { root: string | null }> {
  const start = await $.session.root();
  let root: string | null = null;
  for (const dir of ancestorDirs(start)) {
    if (await $.fs.exists(joinPath(dir, '.paqad/framework-path.txt'))) {
      root = dir;
      break;
    }
  }
  const teamConfigs: Array<{ name: string; text: string }> = [];
  let localConfig: string | null = null;
  if (root) {
    localConfig = await readText($, joinPath(root, '.paqad/.config'));
    const dir = joinPath(root, '.paqad/configs');
    try {
      for (const entry of await $.fs.list(dir)) {
        if (entry.kind !== 'file' || !entry.name.startsWith('.config.')) continue;
        const text = await readText($, joinPath(dir, entry.name));
        if (text !== null) teamConfigs.push({ name: entry.name, text });
      }
    } catch {
      // No team configs: the defaults stand.
    }
  }
  let engine: { version: string; base?: string } | null = null;
  try {
    engine = await $.session.version();
  } catch {
    // An engine that cannot say its version counts as too old.
  }
  const status = decideStatus({
    onboarded: root !== null,
    env: {
      CLAUDE_CODE_REMOTE: await $.env.get('CLAUDE_CODE_REMOTE'),
      PAQAD_DISABLED: await $.env.get('PAQAD_DISABLED'),
      PAQAD_ENABLE: await $.env.get('PAQAD_ENABLE'),
      PAQAD_HUD_VIEW: await $.env.get('PAQAD_HUD_VIEW'),
    },
    localConfig,
    teamConfigs,
    engine,
  });
  return { ...status, root };
}

/** Show the paqad pane on `tab`: the tab is chosen first, so the pane draws it at once. */
async function openPane($: EngineInterface, tab: PaqadPaneTab): Promise<void> {
  try {
    await update($, paneTabAtom, () => tab);
    await $.ui.open({ id: PANE_ID, title: PANE_TITLE });
  } catch {
    // A pane that cannot open leaves the band as it was; the next press tries again.
  }
}

/**
 * Keep the first experts call of the change as the card's row. Later experts calls of the same
 * change keep the engine's own row, so the card is drawn once and updates in place.
 */
async function claimCard($: EngineInterface, toolUseId: string | undefined): Promise<void> {
  if (!toolUseId) return;
  const key = cardKey(await read($, snapshotAtom));
  await update($, tableCardsAtom, (cards) =>
    cards?.[key] ? cards : { ...(cards ?? {}), [key]: toolUseId },
  );
}

/** True when a drawn tree holds no text: the engine's empty band, which ours replaces. */
function isBlank(node: RenderNode | null | undefined): boolean {
  if (node === null || node === undefined) return true;
  if (typeof node === 'string') return node.trim() === '';
  if (node.type === 'Button') return false;
  const children = (node as { children?: readonly RenderNode[] }).children ?? [];
  return children.every((child) => isBlank(child));
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    live = null;
    lastText = undefined;
    ticker?.cancel();
    ticker = null;
    try {
      const status = await readStatus($);
      await update($, statusAtom, () => ({ on: status.on, reason: status.reason }));
      if (registersCommand(status)) {
        // The name is written as a literal here and in the matcher below, so `claude plugin
        // validate` reads the hook as one that answers its own command, not as a gate.
        await $.command.register({
          name: 'paqad',
          description: 'Where the paqad change stands: status, decisions, rules, receipt, cost',
          argumentHint: '[status|decisions|rules|receipt|cost]',
          immediate: true,
        });
      }
      if (status.on && status.root) {
        live = { root: status.root, sessionId: await $.session.id() };
        await refresh($);
      }
    } catch {
      // The mod never stands in the session's way: on any failure it simply stays dark.
    }
    return next(e);
  });

  on('command.run', { command: 'paqad' }, async ($, e) => {
    const status = await read($, statusAtom);
    if (live) await refresh($);
    const at = live;
    return runPaqadCommand({
      args: e.args,
      standDown: status?.on ? null : (status?.reason ?? 'not-onboarded'),
      snapshot: await read($, snapshotAtom),
      receipt: at ? await readText($, receiptPath(at.root, at.sessionId)) : null,
      now: await $.clock.now(),
    });
  }).catch(() => ({ text: 'paqad could not read its record for this session. Try again.' }));

  // Refresh points (FR-24). Each passes the event on untouched and returns what `next` answered,
  // so no hook's decision moves; the `.catch` replays `next` if anything here throws.
  on('prompt.submit', async ($, e, next) => {
    const result = await next(e);
    await refresh($);
    return result;
  }).catch(($, e, next) => next(e));

  on('tool.call', async ($, e, next) => {
    if (!live) return next(e);
    const tool = String(e.tool);
    // A call's arguments sit beside `tool` on the event (`{ tool: 'Bash', command }`).
    const input = e as unknown as { command?: unknown };
    const isAgent = tool === 'Agent' || tool === 'Task';
    if (isExpertsCall(tool, input)) {
      await claimCard($, (e as { tool_use_id?: string }).tool_use_id);
    }
    if (isAgent) {
      agentCalls += 1;
      startTicker($);
    }
    try {
      const result = await next(e);
      if (isRefreshTool(tool, input)) await refresh($);
      return result;
    } finally {
      if (isAgent) agentCalls = Math.max(0, agentCalls - 1);
    }
  }).catch(($, e, next) => next(e));

  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    if (live) {
      await refresh($);
      if (e.agentId === undefined) $.clock.after(AFTER_TURN_MS, () => void refresh($));
    }
    return result;
  }).catch(($, e, next) => next(e));

  // The band (Part 9). A render hook never writes state: it reads the atoms and draws.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const status = await read($, statusAtom);
    if (!status?.on || e.props.hasSurvey) return next(e);
    const view = buildBandView(await read($, snapshotAtom), await read($, nowAtom));
    const rows = layoutBand(view, { columns: e.props.bodyColumns, maxRows: e.props.maxRows });
    const others = await next(e);
    const { Box, Text, Button } = $.ui.resolve(e);
    const part = (segment: BandSegment) => (
      <Text
        color={segment.tone ? TONE_COLOR[segment.tone] : undefined}
        dimColor={segment.dim === true}
      >
        {segment.text}
      </Text>
    );
    const line = (row: BandRow) => {
      if (!row.some((segment) => segment.opens))
        return <Text wrap="truncate">{row.map(part)}</Text>;
      // A row with a part that opens the pane (the cost pill, the High Table label): a Button sits
      // beside Text, so the row is a Box.
      return (
        <Box flexDirection="row">
          {row.map((segment) => {
            const tab = segment.opens;
            return tab ? (
              <Button
                key={`paqad-open-${tab}`}
                plain
                dimColor={segment.dim === true}
                onPress={() => void openPane($, tab)}
              >
                {segment.text}
              </Button>
            ) : (
              part(segment)
            );
          })}
        </Box>
      );
    };
    return (
      <Box flexDirection="column">
        {rows.map(line)}
        {isBlank(others) ? null : (others as RenderElement)}
      </Box>
    );
  });

  // The paqad pane (Parts 23 and 14): a tab row of Buttons, then the shown tab, on the terminal and
  // on Desktop. Opened by the cost pill or the High Table label; reads the atoms, never writes.
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e);
    const status = await read($, statusAtom);
    if (!status?.on) return next(e);
    const view = buildPaneView(await read($, snapshotAtom), await read($, paneTabAtom), {
      seat: await read($, tableSeatAtom),
      now: await read($, nowAtom),
    });
    const ui = $.ui.resolve(e);
    const { Box, Text, Button } = ui;
    const draw = (line: TableLine) => drawLine(Text, line);
    const table = view.table;
    // Svg draws on Desktop only; the terminal gets the same round table as text.
    const Svg = e.surface === 'desktop' && 'Svg' in ui ? ui.Svg : null;
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          {view.tabs.map((tab) => (
            <Button
              key={tab.key}
              variant={tab.selected ? 'primary' : undefined}
              onPress={() => void update($, paneTabAtom, () => tab.id)}
            >
              {tab.selected ? `${tab.label} (shown)` : tab.label}
            </Button>
          ))}
        </Box>
        {view.lines.map((text) => (
          <Text wrap="wrap">{text}</Text>
        ))}
        {table ? (
          <Box flexDirection="column">
            {Svg ? (
              <Svg source={table.svg.source} alt={table.svg.alt} width={160} height={160} />
            ) : (
              table.ring.map(draw)
            )}
            {table.seats.map(draw)}
            <Box flexDirection="row">
              {table.buttons.map((seat) => (
                <Button
                  key={seat.key}
                  variant={seat.selected ? 'primary' : undefined}
                  onPress={() => void update($, tableSeatAtom, () => seat.role)}
                >
                  {seat.label}
                </Button>
              ))}
            </Box>
            {table.detail.map(draw)}
            {table.rulings.map(draw)}
          </Box>
        ) : null}
      </Box>
    );
  });

  // The live High Table card (Part 14): drawn over the change's first `paqad-ai spec pipeline
  // experts` row only, from `$.state`, so it redraws in place as the seats move. Every other row,
  // and that row while the change has no table, is the engine's own.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!isExpertsCall(e.props.tool, e.props.input)) return next(e);
    const status = await read($, statusAtom);
    if (!status?.on) return next(e);
    const snapshot = await read($, snapshotAtom);
    const cards = await read($, tableCardsAtom);
    const table = snapshot?.table ?? null;
    if (!table || snapshot?.lane === 'fast' || cards?.[cardKey(snapshot)] !== e.props.tool_use_id) {
      return next(e);
    }
    const { Box, Text } = $.ui.resolve(e);
    return (
      <Box flexDirection="column">
        {tableCardLines(table, await read($, nowAtom)).map((line) => drawLine(Text, line))}
      </Box>
    );
  });

  // A folded run of calls that holds an experts call unfolds, so the card's row is on screen.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const status = await read($, statusAtom);
    const holdsExperts = e.props.calls.some((call) => isExpertsCall(call.tool, call.input));
    return status?.on && holdsExperts && !e.props.isExpanded
      ? next({ ...e, props: { ...e.props, isExpanded: true } })
      : next(e);
  });
};
