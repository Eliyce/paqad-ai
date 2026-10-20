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
import { layoutBand, type BandRow, type BandSegment } from './band';
import { runPaqadCommand } from './commands';
import { ancestorDirs, decideStatus, registersCommand } from './config';
import {
  EDIT_TOOLS,
  ORG_ENFORCED,
  RULE_STOP_ALLOW,
  RULE_STOP_FALSE_POSITIVE,
  RULE_STOP_FIX,
  RULE_STOP_HEADER,
  RULE_STOP_NO_REASON,
  RULE_STOP_REASON_HEADER,
  RULE_STOP_SHOW,
  buildBandView,
  freshRuleStop,
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
import { cardKey, isExpertsCall, tableCardLines, type TableLine } from './table';
import type { PaqadHudSnapshot, PaqadPaneTab, PaqadStatus, PaqadTone } from './types';

type ToolCheckResult = Awaited<ReturnType<EngineInterface['tool']['check']>>;

const AGENT_TICK_MS = 1500;
const AFTER_TURN_MS = 2000;

const statusAtom = atom({ plugin: 'paqad', key: 'status' } as const, null as PaqadStatus | null);
const snapshotAtom = atom(
  { plugin: 'paqad', key: 'snapshot' } as const,
  null as PaqadHudSnapshot | null,
);
const nowAtom = atom({ plugin: 'paqad', key: 'now' } as const, 0);
const paneTabAtom = atom({ plugin: 'paqad', key: 'paneTab' } as const, null as PaqadPaneTab | null);
const tableSeatAtom = atom({ plugin: 'paqad', key: 'tableSeat' } as const, null as string | null);
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
      if (changed || isLive(snapshot)) {
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
}

function startTicker($: EngineInterface): void {
  if (ticker || !live) return;
  ticker = $.clock.every(AGENT_TICK_MS, () => {
    void (async () => {
      let running = agentCalls > 0;
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
    } catch {}
  }
  let engine: { version: string; base?: string } | null = null;
  try {
    engine = await $.session.version();
  } catch {}
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
  if (!stop) return verdict;
  if (stop.managed) {
    $.ui.toast(ORG_ENFORCED);
    return verdict;
  }
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

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    live = null;
    lastText = undefined;
    verdictSeen = undefined;
    ticker?.cancel();
    ticker = null;
    try {
      const status = await readStatus($);
      await update($, statusAtom, () => ({ on: status.on, reason: status.reason }));
      if (registersCommand(status)) {
        await $.command.register({
          name: 'paqad',
          description:
            'Where the paqad change stands: status, decisions, rules, receipt, cost, trust, ships, record',
          argumentHint: '[status|decisions|rules|receipt|cost|trust|ships|record]',
          immediate: true,
        });
      }
      if (status.on && status.root) {
        live = { root: status.root, sessionId: await $.session.id() };
        await refresh($);
      }
    } catch {}
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

  on('prompt.submit', async ($, e, next) => {
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
    const draw = (line: TableLine) => drawLine(Text, line);
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

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const status = await read($, statusAtom);
    const holdsExperts = e.props.calls.some((call) => isExpertsCall(call.tool, call.input));
    return status?.on && holdsExperts && !e.props.isExpanded
      ? next({ ...e, props: { ...e.props, isExpanded: true } })
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
