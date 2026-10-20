import { atom, read, update } from 'claude-code';
import type { EngineInterface, Register, RenderElement, RenderNode, Timer } from 'claude-code';

import {
  evidenceCard,
  evidenceRowLimit,
  evidenceRows,
  isOwnQuestion,
  matchPending,
  pendingPacketPath,
  questionTexts,
} from './ask-evidence';
import { allGreenKey, bandHeadline, laneMode, layoutBand, spinnerWord } from './band';
import { chimeClip } from './chime';
import { chipFor, chipLine, paqadCall, type Chip } from './chips';
import { readRepoDecision, runPaqadCommand, type RepoDecision } from './commands';
import { ancestorDirs, decideStatus, isChimeOn, registersCommand } from './config';
import {
  EDIT_TOOLS,
  ORG_ENFORCED,
  PENDING_DECISIONS_DIR,
  RULE_STOP_ALLOW,
  RULE_STOP_FALSE_POSITIVE,
  RULE_STOP_FIX,
  RULE_STOP_HEADER,
  RULE_STOP_NO_REASON,
  RULE_STOP_REASON_HEADER,
  RULE_STOP_SHOW,
  buildBandView,
  entrySentinelPath,
  freshRuleStop,
  heartbeatPath,
  isLive,
  isRefreshTool,
  isStageAgent,
  joinPath,
  lastBlockPath,
  overrideArgs,
  parseSnapshot,
  receiptPath,
  ruleStopQuestion,
  ruleTextQuestion,
  snapshotPath,
  type RuleStop,
} from './model';
import { runPaqad } from './paqad-cli';
import { PANE_ID, PANE_TITLE, buildPaneView } from './pane';
import { isReceiptCommand, receiptCard, verdictKey, verdictToast, watchVerdict } from './receipt';
import {
  CLOSE_FOR_NOW,
  CLOSE_HEADER,
  CLOSE_QUESTION,
  HIDE_ALWAYS,
  MINIMISED_KEY,
  hiddenKey,
  readBandVisibility,
} from './visibility';
import type {
  BandAction,
  BandBlock,
  BandLayout,
  BandRow,
  BandSegment,
  BandSplitRow,
} from './shell';
import { cardKey, isExpertsCall, tableCardLines, type TableLine } from './table';
import type { PaqadHudSnapshot, PaqadPaneTab, PaqadStatus, PaqadTone } from './types';

type ToolCheckResult = Awaited<ReturnType<EngineInterface['tool']['check']>>;

const AGENT_TICK_MS = 1500;
const AFTER_TURN_MS = 2000;
const HEARTBEAT_MS = 60_000;

const statusAtom = atom({ plugin: 'paqad', key: 'status' } as const, null as PaqadStatus | null);
const snapshotAtom = atom(
  { plugin: 'paqad', key: 'snapshot' } as const,
  null as PaqadHudSnapshot | null,
);
const nowAtom = atom({ plugin: 'paqad', key: 'now' } as const, 0);
const paneTabAtom = atom({ plugin: 'paqad', key: 'paneTab' } as const, null as PaqadPaneTab | null);
const tableSeatAtom = atom({ plugin: 'paqad', key: 'tableSeat' } as const, null as string | null);
const minimisedAtom = atom({ plugin: 'paqad', key: 'minimised' } as const, false as boolean);
const hiddenAtom = atom({ plugin: 'paqad', key: 'hidden' } as const, false as boolean);
const closedAtom = atom({ plugin: 'paqad', key: 'bandClosed' } as const, false as boolean);
const greenSeenAtom = atom({ plugin: 'paqad', key: 'greenSeen' } as const, [] as string[]);
const tableCardsAtom = atom(
  { plugin: 'paqad', key: 'tableCards' } as const,
  {} as Record<string, string>,
);

const TONE_COLOR: Record<PaqadTone, string | undefined> = {
  neutral: undefined,
  working: 'suggestion',
  'needs-you': 'permission',
  good: 'success',
  warn: 'warning',
  bad: 'error',
};

type TextElement = ReturnType<EngineInterface['ui']['resolve']>['Text'];

function drawLine(Text: TextElement, line: TableLine, wrap: 'wrap' | 'truncate' = 'wrap') {
  return (
    <Text wrap={wrap}>
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

interface Live {
  root: string;
  sessionId: string;
}

let live: Live | null = null;
let ticker: Timer | null = null;
let agentCalls = 0;
let reading = false;
let readAgain = false;
let lastText: string | null | undefined;
let verdictSeen: string | null | undefined;
let chimeOn = false;
let heartbeat: Timer | null = null;
let turnStartedAt: number | null = null;
const rawCalls = new Set<string>();

async function readText($: EngineInterface, path: string): Promise<string | null> {
  try {
    if (!(await $.fs.exists(path))) return null;
    const text = await $.fs.read(path);
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
}

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
      const watch = watchVerdict(verdictSeen, verdictKey(snapshot?.verdict));
      verdictSeen = watch.seen;
      if (watch.fire && snapshot?.verdict) landVerdict($, snapshot.verdict);
      if (changed) await landAllGreen($, snapshot);
      if (changed || isLive(snapshot) || turnStartedAt !== null) {
        const at = await $.clock.now();
        await update($, nowAtom, () => at);
      }
      if (isLive(snapshot)) startTicker($);
    } while (readAgain);
  } catch {
  } finally {
    reading = false;
  }
}

function landVerdict($: EngineInterface, verdict: NonNullable<PaqadHudSnapshot['verdict']>): void {
  try {
    $.ui.toast(verdictToast(verdict));
  } catch {}
  if (!chimeOn) return;
  try {
    void $.audio.play(chimeClip()).catch(() => {});
  } catch {}
}

async function landAllGreen($: EngineInterface, snapshot: PaqadHudSnapshot | null): Promise<void> {
  const key = allGreenKey(snapshot);
  if (!key || !snapshot) return;
  const seen = (await read($, greenSeenAtom)) ?? [];
  if (seen.includes(key)) return;
  await update($, greenSeenAtom, (keys) => [...(keys ?? []), key]);
  try {
    $.ui.toast(bandHeadline(snapshot, buildBandView(snapshot, await read($, nowAtom))));
  } catch {}
  if (!chimeOn) return;
  try {
    void $.audio.play(chimeClip()).catch(() => {});
  } catch {}
}

async function beat($: EngineInterface): Promise<void> {
  const at = live;
  if (!at) return;
  try {
    const now = await $.clock.now();
    await $.fs.write(
      heartbeatPath(at.root, at.sessionId),
      `${JSON.stringify({ session_id: at.sessionId, written_at: new Date(now).toISOString() })}\n`,
    );
  } catch {}
}

function startTicker($: EngineInterface): void {
  if (ticker || !live) return;
  ticker = $.clock.every(AGENT_TICK_MS, () => {
    void (async () => {
      let running = agentCalls > 0 || turnStartedAt !== null;
      try {
        running ||= (await $.agent.list()).some(isStageAgent);
      } catch {}
      if (!running) {
        ticker?.cancel();
        ticker = null;
      }
      await refresh($);
    })();
  });
}

async function readStatus(
  $: EngineInterface,
): Promise<PaqadStatus & { root: string | null; chime: boolean }> {
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
    } catch {}
  }
  let engine: { version: string; base?: string } | null = null;
  try {
    engine = await $.session.version();
  } catch {}
  const env = {
    CLAUDE_CODE_REMOTE: await $.env.get('CLAUDE_CODE_REMOTE'),
    PAQAD_DISABLED: await $.env.get('PAQAD_DISABLED'),
    PAQAD_ENABLE: await $.env.get('PAQAD_ENABLE'),
    PAQAD_HUD_VIEW: await $.env.get('PAQAD_HUD_VIEW'),
    PAQAD_HUD_CHIME: await $.env.get('PAQAD_HUD_CHIME'),
  };
  const status = decideStatus({ onboarded: root !== null, env, localConfig, teamConfigs, engine });
  return { ...status, root, chime: isChimeOn({ env, localConfig, teamConfigs }) };
}

async function openPane($: EngineInterface, tab: PaqadPaneTab): Promise<void> {
  try {
    await update($, paneTabAtom, () => tab);
    await $.ui.open({ id: PANE_ID, title: PANE_TITLE });
  } catch {}
}

async function claimCard($: EngineInterface, toolUseId: string | undefined): Promise<void> {
  if (!toolUseId) return;
  const key = cardKey(await read($, snapshotAtom));
  await update($, tableCardsAtom, (cards) =>
    cards?.[key] ? cards : { ...(cards ?? {}), [key]: toolUseId },
  );
}

function isBlank(node: RenderNode | null | undefined): boolean {
  if (node === null || node === undefined) return true;
  if (typeof node === 'string') return node.trim() === '';
  if (node.type === 'Button') return false;
  const children = (node as { children?: readonly RenderNode[] }).children ?? [];
  return children.every((child) => isBlank(child));
}

async function askReason($: EngineInterface): Promise<string | null> {
  try {
    const answer = await $.ui.ask('Add a reason to the record?', {
      options: [RULE_STOP_NO_REASON, RULE_STOP_FALSE_POSITIVE],
      header: RULE_STOP_REASON_HEADER,
    });
    return answer === RULE_STOP_NO_REASON || answer.trim() === '' ? null : answer.trim();
  } catch {
    return null;
  }
}

async function chooseRuleStop($: EngineInterface, stop: RuleStop): Promise<string> {
  const first = await $.ui.ask(ruleStopQuestion(stop), {
    options: [RULE_STOP_FIX, RULE_STOP_ALLOW, RULE_STOP_SHOW],
    header: RULE_STOP_HEADER,
  });
  if (first !== RULE_STOP_SHOW) return first;
  return $.ui.ask(ruleTextQuestion(stop), {
    options: [RULE_STOP_FIX, RULE_STOP_ALLOW],
    header: RULE_STOP_HEADER,
  });
}

async function readRepoDecisions($: EngineInterface, root: string): Promise<RepoDecision[]> {
  const dir = joinPath(root, PENDING_DECISIONS_DIR);
  if (!(await $.fs.exists(dir))) return [];
  try {
    const names = (await $.fs.list(dir))
      .filter((entry) => entry.kind === 'file' && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort();
    const packets: RepoDecision[] = [];
    for (const name of names) {
      packets.push(readRepoDecision(name, await readText($, joinPath(dir, name))));
    }
    return packets;
  } catch {
    return [];
  }
}

async function hasPendingDecision($: EngineInterface, root: string): Promise<boolean> {
  const dir = joinPath(root, PENDING_DECISIONS_DIR);
  if (!(await $.fs.exists(dir))) return false;
  try {
    return (await $.fs.list(dir)).some((entry) => entry.kind === 'file');
  } catch {
    return true;
  }
}

async function answerRuleStop(
  $: EngineInterface,
  toolUseId: string | undefined,
  verdict: ToolCheckResult,
): Promise<ToolCheckResult> {
  const at = live;
  if (!at) return verdict;
  const stop = freshRuleStop(
    await readText($, lastBlockPath(at.root, at.sessionId)),
    at.sessionId,
    toolUseId,
  );
  if (!stop || (verdict as { rule?: unknown }).rule !== undefined) return verdict;
  if (stop.managed) {
    $.ui.toast(ORG_ENFORCED);
    return verdict;
  }
  if (!stop.sole || (await hasPendingDecision($, at.root))) return verdict;
  if (!(await $.fs.exists(entrySentinelPath(at.root, at.sessionId)))) return verdict;
  if ((await chooseRuleStop($, stop)) !== RULE_STOP_ALLOW) return verdict;
  const reason = await askReason($);
  const ran = await runPaqad(
    $,
    'rules override',
    overrideArgs(stop, at.sessionId, at.root, reason),
    at.root,
  );
  if (!ran.ok) {
    $.ui.toast('paqad could not record the override, so the edit stays blocked.');
    return verdict;
  }
  await refresh($);
  return {
    decision: 'allow',
    reason: `Allowed once by a person, recorded as an override of ${stop.rule}.`,
  };
}

type UiElements = ReturnType<EngineInterface['ui']['resolve']>;

async function storeSet($: EngineInterface, key: string, value: boolean): Promise<void> {
  try {
    if (value) await $.store.set(key, true);
    else await $.store.delete(key);
  } catch {}
}

async function storeGet($: EngineInterface, key: string): Promise<unknown> {
  try {
    return await $.store.get(key);
  } catch {
    return undefined;
  }
}

async function setMinimised($: EngineInterface, value: boolean): Promise<void> {
  await update($, minimisedAtom, () => value);
  await storeSet($, MINIMISED_KEY, value);
}

async function setHidden($: EngineInterface, value: boolean): Promise<void> {
  await update($, hiddenAtom, () => value);
  if (live) await storeSet($, hiddenKey(live.root), value);
}

async function askClose($: EngineInterface): Promise<void> {
  let answer: string;
  try {
    answer = await $.ui.ask(CLOSE_QUESTION, {
      options: [CLOSE_FOR_NOW, HIDE_ALWAYS],
      header: CLOSE_HEADER,
    });
  } catch {
    return;
  }
  if (answer === CLOSE_FOR_NOW) await update($, closedAtom, () => true);
  else if (answer === HIDE_ALWAYS) await setHidden($, true);
}

async function showBand($: EngineInterface, all: boolean): Promise<void> {
  await update($, closedAtom, () => false);
  await setHidden($, false);
  if (all) await setMinimised($, false);
}

async function pressAction($: EngineInterface, action: BandAction): Promise<void> {
  if (action === 'minimise') await setMinimised($, true);
  else if (action === 'restore') await setMinimised($, false);
  else if (action === 'close') await askClose($);
  else await showBand($, action === 'show');
}

function drawSegment($: EngineInterface, ui: UiElements, segment: BandSegment, index: number) {
  const { Text, Button } = ui;
  const tab = segment.opens;
  const action = segment.action;
  if (tab || action) {
    return (
      <Button
        key={segment.key ?? `paqad-${tab ?? action}-${index}`}
        plain
        {...(segment.hotkey ? { hotkey: segment.hotkey } : {})}
        dimColor={segment.dim === true}
        onPress={() => void (tab ? openPane($, tab) : pressAction($, action!))}
      >
        <Text color={segment.tone ? TONE_COLOR[segment.tone] : undefined}>{segment.text}</Text>
      </Button>
    );
  }
  return (
    <Text
      color={segment.tone ? TONE_COLOR[segment.tone] : undefined}
      dimColor={segment.dim === true}
    >
      {segment.text}
    </Text>
  );
}

function drawRow($: EngineInterface, ui: UiElements, row: BandRow) {
  const { Box, Text } = ui;
  if (!row.some((segment) => segment.opens || segment.action)) {
    return (
      <Text wrap="truncate">{row.map((segment, index) => drawSegment($, ui, segment, index))}</Text>
    );
  }
  return (
    <Box flexDirection="row">{row.map((segment, index) => drawSegment($, ui, segment, index))}</Box>
  );
}

function drawSplit($: EngineInterface, ui: UiElements, split: BandSplitRow) {
  const { Box } = ui;
  return (
    <Box flexDirection="row">
      <Box flexDirection="row" flexGrow={1}>
        {drawRow($, ui, split.left)}
      </Box>
      <Box flexDirection="row">{drawRow($, ui, split.right)}</Box>
    </Box>
  );
}

function drawBlock($: EngineInterface, ui: UiElements, block: BandBlock, desktop: boolean) {
  const { Box, Text } = ui;
  const Svg = desktop && 'Svg' in ui ? ui.Svg : null;
  return (
    <Box key={block.key} flexDirection="column" flexGrow={1}>
      {drawRow($, ui, block.title)}
      {block.svg && Svg ? (
        <Svg
          source={block.svg.source}
          alt={block.svg.alt}
          width={block.svg.width}
          height={block.svg.height}
        />
      ) : block.cells.length > 0 ? (
        <Box flexDirection="row">
          {block.cells.map((cell) => (
            <Box key={cell.key} flexDirection="column" paddingRight={1}>
              <Text
                color={cell.top.tone ? TONE_COLOR[cell.top.tone] : undefined}
                dimColor={cell.top.dim === true}
              >
                {cell.top.text}
              </Text>
              <Text
                color={cell.bottom.tone ? TONE_COLOR[cell.bottom.tone] : undefined}
                dimColor={cell.bottom.dim === true}
              >
                {cell.bottom.text}
              </Text>
            </Box>
          ))}
        </Box>
      ) : null}
      {block.note ? drawRow($, ui, block.note) : null}
    </Box>
  );
}

function drawBand($: EngineInterface, e: { surface: string }, layout: BandLayout) {
  const ui = $.ui.resolve(e as never) as UiElements;
  const { Box } = ui;
  if (layout.kind === 'none') return null;
  if (layout.kind === 'line') return drawRow($, ui, layout.row);
  const desktop = e.surface === 'desktop';
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={TONE_COLOR[layout.tone]}
      paddingX={1}
    >
      {drawSplit($, ui, layout.header)}
      {layout.blocks.length > 0 ? (
        <Box flexDirection={layout.direction}>
          {layout.blocks.map((block) => drawBlock($, ui, block, desktop))}
        </Box>
      ) : null}
      {layout.footer ? drawSplit($, ui, layout.footer) : null}
    </Box>
  );
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    live = null;
    turnStartedAt = null;
    lastText = undefined;
    verdictSeen = undefined;
    chimeOn = false;
    rawCalls.clear();
    ticker?.cancel();
    ticker = null;
    heartbeat?.cancel();
    heartbeat = null;
    try {
      const status = await readStatus($);
      await update($, statusAtom, () => ({ on: status.on, reason: status.reason }));
      if (registersCommand(status)) {
        await $.command.register({
          name: 'paqad',
          description:
            'Where the paqad change stands: status, decisions, rules, receipt, cost, trust, ships, record, or show the band again',
          argumentHint: '[status|decisions|rules|receipt|cost|trust|ships|record|show]',
          immediate: true,
        });
      }
      if (status.on && status.root) {
        chimeOn = status.chime;
        live = { root: status.root, sessionId: await $.session.id() };
        const minimised = (await storeGet($, MINIMISED_KEY)) === true;
        const hidden = (await storeGet($, hiddenKey(status.root))) === true;
        await update($, minimisedAtom, () => minimised);
        await update($, hiddenAtom, () => hidden);
        await update($, closedAtom, () => false);
        await beat($);
        heartbeat = $.clock.every(HEARTBEAT_MS, () => void beat($));
        await refresh($);
      }
    } catch {}
    return next(e);
  });

  on('command.run', { command: 'paqad' }, async ($, e) => {
    const status = await read($, statusAtom);
    if (live) await refresh($);
    const at = live;
    const sub = e.args.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    if (status?.on && at && sub === 'show') await showBand($, true);
    return runPaqadCommand({
      ...(status?.on && at && sub === 'decisions'
        ? { repoDecisions: await readRepoDecisions($, at.root) }
        : {}),
      args: e.args,
      standDown: status?.on ? null : (status?.reason ?? 'not-onboarded'),
      snapshot: await read($, snapshotAtom),
      receipt: at ? await readText($, receiptPath(at.root, at.sessionId)) : null,
      now: await $.clock.now(),
    });
  }).catch(() => ({ text: 'paqad could not read its record for this session. Try again.' }));

  on('prompt.submit', async ($, e, next) => {
    if (live) {
      turnStartedAt = await $.clock.now();
      startTicker($);
    }
    await beat($);
    const result = await next(e);
    await refresh($);
    return result;
  }).catch(($, e, next) => next(e));

  on('tool.call', async ($, e, next) => {
    if (!live) return next(e);
    const tool = String(e.tool);
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

  for (const tool of EDIT_TOOLS) {
    on('tool.check', { tool }, async ($, e, next) => {
      const verdict = await next(e);
      if (verdict.decision !== 'deny') return verdict;
      try {
        return await answerRuleStop($, e.tool_use_id, verdict);
      } catch {
        return verdict;
      }
    }).catch(() => ({ decision: 'deny' as const }));
  }

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) turnStartedAt = null;
    const result = await next(e);
    if (live) {
      await refresh($);
      if (e.agentId === undefined) $.clock.after(AFTER_TURN_MS, () => void refresh($));
    }
    return result;
  }).catch(($, e, next) => next(e));

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const status = await read($, statusAtom);
    if (!status?.on || e.props.hasSurvey) return next(e);
    const layout = layoutBand(
      await read($, snapshotAtom),
      { columns: e.props.bodyColumns, maxRows: e.props.maxRows },
      {
        now: await read($, nowAtom),
        surface: e.surface === 'desktop' ? 'desktop' : 'terminal',
        turnStartedAt,
      },
      readBandVisibility(
        { minimised: await read($, minimisedAtom), hidden: await read($, hiddenAtom) },
        await read($, closedAtom),
      ),
    );
    const others = await next(e);
    const drawn = drawBand($, e, layout);
    const { Box } = $.ui.resolve(e);
    return (
      <Box flexDirection="column">
        {drawn}
        {isBlank(others) ? null : (others as RenderElement)}
      </Box>
    );
  });

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e);
    const status = await read($, statusAtom);
    if (!status?.on) return next(e);
    const view = buildPaneView(await read($, snapshotAtom), await read($, paneTabAtom), {
      seat: await read($, tableSeatAtom),
      now: await read($, nowAtom),
      columns: e.props.bodyColumns,
    });
    const ui = $.ui.resolve(e);
    const { Box, Text, Button } = ui;
    const Link = 'Link' in ui ? ui.Link : null;
    const draw = (line: TableLine) => {
      const link = line.find((segment) => segment.href);
      return link?.href && Link ? (
        <Link href={link.href}>{link.text.trim()}</Link>
      ) : (
        drawLine(Text, line)
      );
    };
    const table = view.table;
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
        {view.rows.map(draw)}
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

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (isExpertsCall(e.props.tool, e.props.input)) {
      const status = await read($, statusAtom);
      if (!status?.on) return next(e);
      const snapshot = await read($, snapshotAtom);
      const cards = await read($, tableCardsAtom);
      const table = snapshot?.table ?? null;
      if (
        !table ||
        snapshot?.lane === 'fast' ||
        cards?.[cardKey(snapshot)] !== e.props.tool_use_id
      ) {
        return next(e);
      }
      const { Box, Text } = $.ui.resolve(e);
      return (
        <Box flexDirection="column">
          {tableCardLines(table, await read($, nowAtom)).map((line) => drawLine(Text, line))}
        </Box>
      );
    }
    const call = paqadCall(e.props.tool, e.props.input);
    if (!call || rawCalls.has(e.props.tool_use_id)) return next(e);
    const status = await read($, statusAtom);
    if (!status?.on) return next(e);
    const chip = chipFor(call, e.props, await read($, snapshotAtom));
    if (!chip) return next(e);
    const { Text } = $.ui.resolve(e);
    return drawLine(Text, chipLine([chip]), 'truncate');
  });

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const status = await read($, statusAtom);
    if (!status?.on) return next(e);
    const holdsExperts = e.props.calls.some((call) => isExpertsCall(call.tool, call.input));
    if (holdsExperts || e.props.isExpanded) {
      for (const call of e.props.calls) rawCalls.add(call.tool_use_id);
      return e.props.isExpanded ? next(e) : next({ ...e, props: { ...e.props, isExpanded: true } });
    }
    const snapshot = await read($, snapshotAtom);
    const chips: Chip[] = [];
    let others = 0;
    for (const call of e.props.calls) {
      const parsed = paqadCall(call.tool, call.input);
      const chip = parsed ? chipFor(parsed, call, snapshot) : null;
      if (chip) chips.push(chip);
      else others += 1;
    }
    if (chips.length === 0) return next(e);
    const engine = others > 0 ? await next(e) : null;
    const { Box, Text } = $.ui.resolve(e);
    return (
      <Box flexDirection="column">
        {drawLine(Text, chipLine(chips))}
        {engine === null || isBlank(engine) ? null : (engine as RenderElement)}
      </Box>
    );
  });

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const status = await read($, statusAtom);
    const word = status?.on ? spinnerWord(await read($, snapshotAtom)) : null;
    return word ? next({ ...e, props: { ...e.props, word } }) : next(e);
  });

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const status = await read($, statusAtom);
    const mode = status?.on ? laneMode(await read($, snapshotAtom)) : null;
    return mode && !e.props.modes.includes(mode)
      ? next({ ...e, props: { ...e.props, modes: [...e.props.modes, mode] } })
      : next(e);
  });

  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (e.props.isErrored || !isReceiptCommand(e.props.command, e.props.args)) return next(e);
    const status = await read($, statusAtom);
    if (!status?.on) return next(e);
    const card = receiptCard(e.props.text, (await read($, snapshotAtom))?.verdict ?? null);
    if (!card) return next(e);
    const { Box, Text } = $.ui.resolve(e);
    return <Box flexDirection="column">{card.map((line) => drawLine(Text, line))}</Box>;
  });

  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const status = await read($, statusAtom);
    const at = live;
    if (!status?.on || !at || isOwnQuestion(e.props.questions)) return next(e);
    const texts = questionTexts(e.props.questions);
    const pending = (await read($, snapshotAtom))?.decisions.pending ?? [];
    const decision = matchPending(texts, pending);
    const path = decision ? pendingPacketPath(at.root, decision.id) : null;
    const rows = path ? evidenceRows(await readText($, path)) : [];
    const engine = await next(e);
    if (rows.length === 0) return engine;
    const { Box, Text } = $.ui.resolve(e);
    return (
      <Box flexDirection="column">
        {evidenceCard(rows, evidenceRowLimit(e.surface)).map((line) =>
          drawLine(Text, line, 'truncate'),
        )}
        {engine as RenderElement}
      </Box>
    );
  });
};
