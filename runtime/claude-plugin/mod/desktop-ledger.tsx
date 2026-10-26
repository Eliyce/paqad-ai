import type { Elements, RenderNode } from 'claude-code';

import {
  COST_LATER,
  NOTHING_TO_PROVE,
  STEP_MARKS,
  type CostMeter,
  type CostView,
  type DeliveryBlock,
  type DeliveryView,
  type DesktopLedger,
  type LedgerTab,
  type LightView,
  type RecordView,
  type TableView,
  type TrustStage,
  type TrustView,
  type WordTone,
  type WorkflowLedger,
} from './desktop-view';
import { SIGNAL, STATUS_B, signalColor } from './palette';
import { hairline, meter, nodeIcon, tabRule, tableRing } from './strip';
import type { PaqadPaneTab } from './types';

type D = Elements['desktop'];

export interface LedgerActions {
  tab: (id: PaqadPaneTab) => void;
  answer: (text: string) => void;
  sides: () => void;
  seat: (role: string) => void;
}

export interface LedgerState {
  sides: boolean;
  seat: string | null;
}

function toneColor(tone: WordTone): string | null {
  if (tone === 'pass') return STATUS_B.done;
  if (tone === 'fail') return STATUS_B.failed;
  if (tone === 'acc') return SIGNAL.accent;
  if (tone === 'att') return SIGNAL.attention;
  if (tone === 'cau') return SIGNAL.caution;
  return null;
}

function word(ui: D, text: string, tone: WordTone) {
  const { Text } = ui;
  const color = toneColor(tone);
  return color ? (
    <Text size="footnote" weight="medium" color={color}>
      {text}
    </Text>
  ) : (
    <Text size="footnote" weight="medium" dimColor>
      {text}
    </Text>
  );
}

function note(ui: D, text: string, key?: string) {
  const { Text } = ui;
  return (
    <Text key={key} size="footnote" dimColor>
      {text}
    </Text>
  );
}

function heading(ui: D, text: string) {
  const { Box, Text } = ui;
  return (
    <Box key={`paqad-heading-${text}`} marginTop={1}>
      <Text size="caption" weight="semibold" dimColor>
        {text}
      </Text>
    </Box>
  );
}

function hair(ui: D) {
  const { Svg } = ui;
  return <Svg source={hairline()} alt="" height={1} />;
}

function light(ui: D, view: LightView) {
  const { Box, Text } = ui;
  return (
    <Box key="paqad-light" flexDirection="column">
      <Text wrap="truncate-end">
        <Text size="heading" color={signalColor(view.signal)}>
          ●{' '}
        </Text>
        <Text size="heading" weight="semibold">
          {view.title}
        </Text>
      </Text>
      {view.why ? note(ui, view.why) : null}
    </Box>
  );
}

function row(
  ui: D,
  key: string,
  left: RenderNode,
  right: RenderNode | null,
  sub: string | null = null,
  under: RenderNode = null,
) {
  const { Box, Text } = ui;
  return (
    <Box key={key} flexDirection="column">
      <Box flexDirection="row" alignItems="center" columnGap="sm">
        <Box flexDirection="column" flexGrow={1}>
          {typeof left === 'string' ? <Text>{left}</Text> : left}
          {sub ? note(ui, sub) : null}
        </Box>
        {right}
      </Box>
      {under}
      {hair(ui)}
    </Box>
  );
}

function coded(ui: D, code: string | null, text: string) {
  const { Text } = ui;
  return (
    <Text>
      {code ? (
        <Text mono size="footnote" dimColor>
          {`${code}  `}
        </Text>
      ) : null}
      {text}
    </Text>
  );
}

function tabsRow(ui: D, tabs: readonly LedgerTab[], actions: LedgerActions) {
  const { Box, Button, Svg } = ui;
  const shown = Math.max(
    0,
    tabs.findIndex((tab) => tab.shown),
  );
  return (
    <Box key="paqad-tabs" flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        {tabs.map((tab) => (
          <Box
            key={`paqad-tab-box-${tab.id}`}
            width={tab.width}
            flexDirection="row"
            justifyContent="center"
          >
            <Button
              plain
              key={`paqad-tab-${tab.id}`}
              dimColor={!tab.shown}
              onPress={() => actions.tab(tab.id)}
            >
              {tab.label}
            </Button>
          </Box>
        ))}
      </Box>
      <Svg
        source={tabRule(tabs.length, shown)}
        alt={`${tabs[shown]?.label ?? 'Trust'} tab is shown`}
        height={2}
      />
    </Box>
  );
}

function stageHeading(ui: D, stage: TrustStage) {
  const { Box, Text } = ui;
  return (
    <Box
      key={`paqad-stage-${stage.key}`}
      flexDirection="row"
      alignItems="center"
      columnGap="sm"
      marginTop={1}
    >
      <Box flexGrow={1}>
        <Text size="caption" weight="semibold" dimColor>
          {stage.words.toUpperCase()}
        </Text>
      </Box>
      {word(ui, stage.word, stage.tone)}
    </Box>
  );
}

function stepLine(ui: D, step: TrustStage['steps'][number]) {
  const { Text } = ui;
  const mark = STEP_MARKS[step.mark];
  return (
    <Text key={`paqad-step-${step.key}`} size="footnote" wrap="truncate-end">
      {step.mark === 'failed' ? (
        <Text color={STATUS_B.failed}>{`${mark}  `}</Text>
      ) : step.mark === 'done' ? (
        <Text>{`${mark}  `}</Text>
      ) : (
        <Text dimColor>{`${mark}  `}</Text>
      )}
      {step.mark === 'not-yet' ? <Text dimColor>{step.words}</Text> : step.words}
      {step.detail ? <Text dimColor>{`  ·  ${step.detail}`}</Text> : null}
    </Text>
  );
}

function stagePart(ui: D, stage: TrustStage) {
  const { Box } = ui;
  return (
    <Box key={`paqad-proof-${stage.key}`} flexDirection="column" rowGap="xs">
      {stageHeading(ui, stage)}
      {stage.steps.map((step) => stepLine(ui, step))}
      {stage.gates.map((gate) =>
        row(ui, `paqad-gate-${gate.key}`, gate.words, word(ui, gate.word, gate.tone)),
      )}
    </Box>
  );
}

function trustTab(ui: D, view: TrustView) {
  const { Box, Text } = ui;
  if (view.empty) {
    return <Box flexDirection="column">{note(ui, view.empty, 'paqad-trust-empty')}</Box>;
  }
  return (
    <Box flexDirection="column" rowGap="xs">
      {view.stages.map((stage) => stagePart(ui, stage))}
      {view.note ? note(ui, view.note, 'paqad-trust-old') : null}
      {view.gates.map((gate) =>
        row(ui, `paqad-gate-${gate.key}`, gate.words, word(ui, gate.word, gate.tone)),
      )}
      {view.gaps.length > 0 || view.repairs ? (
        <Box key="paqad-record" flexDirection="column" marginTop={1}>
          {view.gaps.map((gap) => (
            <Text key={`paqad-gap-${gap}`} size="footnote">
              {gap}
            </Text>
          ))}
          {view.repairs ? note(ui, view.repairs, 'paqad-repairs') : null}
        </Box>
      ) : null}
      {view.claims.rows.length > 0 ? heading(ui, 'CLAIMS AND THE TESTS THAT PROVE THEM') : null}
      {view.claims.rows.map((claim) =>
        row(
          ui,
          `paqad-claim-${claim.key}`,
          coded(ui, claim.id, claim.label),
          word(ui, claim.word, claim.tone),
          claim.sub,
        ),
      )}
      {view.claims.rows.length > 0 && view.claims.more
        ? note(ui, view.claims.more, 'paqad-claims-more')
        : null}
      {view.flags.length > 0 ? heading(ui, 'FLAGS') : null}
      {view.flags.map((flag) =>
        row(
          ui,
          `paqad-flag-${flag.id}`,
          <Text>
            <Text color={SIGNAL.caution}>⚑ </Text>
            {flag.text}
          </Text>,
          word(ui, 'Open', 'cau'),
        ),
      )}
    </Box>
  );
}

function chiefPart(ui: D, view: TableView, state: LedgerState, actions: LedgerActions) {
  const { Box, Text, Button } = ui;
  const chief = view.chiefView;
  const answer = chief.answer;
  return (
    <Box key="paqad-chief" flexDirection="column" rowGap="xs">
      {light(ui, chief.light)}
      {chief.conflicts.map((conflict, index) => (
        <Box key={`paqad-conflict-${index}`} flexDirection="column">
          <Text size="footnote">
            <Text dimColor>{`${index + 1}.  `}</Text>
            {conflict.target}
          </Text>
          {state.sides
            ? note(ui, `The chief architect recommends: ${conflict.recommendation}`)
            : null}
          {state.sides && conflict.rationale ? note(ui, `Why: ${conflict.rationale}`) : null}
        </Box>
      ))}
      {answer ? (
        <Box flexDirection="row" columnGap="sm" marginTop={1}>
          <Button key="paqad-answer" onPress={() => actions.answer(answer)}>
            Answer in chat
          </Button>
          {chief.conflicts.length > 0 ? (
            <Button plain dimColor key="paqad-sides" onPress={actions.sides}>
              See each side
            </Button>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

function tableTab(ui: D, view: TableView | null, state: LedgerState, actions: LedgerActions) {
  const { Box, Text, Svg, Button } = ui;
  if (!view) return note(ui, 'The High Table did not sit for this change.');
  return (
    <Box flexDirection="column" rowGap="xs">
      <Box key="paqad-table-ring" flexDirection="row" alignItems="center" columnGap="md">
        <Svg source={tableRing(view.ring, view.chief)} alt={view.alt} width={150} height={150} />
        <Box flexDirection="column">
          <Text weight="semibold">{view.summary.notes}</Text>
          {note(ui, view.summary.findings)}
          {note(ui, view.summary.picked)}
          {note(ui, view.summary.standing)}
        </Box>
      </Box>
      {heading(ui, 'CHIEF ARCHITECT')}
      {chiefPart(ui, view, state, actions)}
      {heading(ui, 'SEATS')}
      {view.seats.map((seat) =>
        row(
          ui,
          `paqad-seat-row-${seat.role}`,
          <Text>
            <Text mono size="footnote" dimColor>
              {`${seat.initials}   `}
            </Text>
            {seat.words}
            {seat.picked ? (
              <Text size="footnote" dimColor>
                {'   picked'}
              </Text>
            ) : null}
          </Text>,
          <Box flexDirection="row" alignItems="center" columnGap="xs">
            {word(ui, seat.word, seat.tone)}
            <Button
              plain
              dimColor
              key={`paqad-seat-${seat.role}`}
              onPress={() => actions.seat(seat.role)}
            >
              ›
            </Button>
          </Box>,
          null,
          state.seat === seat.role && seat.details.length > 0 ? (
            <Box flexDirection="column" marginLeft={4}>
              {seat.details.map((detail, index) => note(ui, detail, `paqad-seat-detail-${index}`))}
            </Box>
          ) : null,
        ),
      )}
      {heading(ui, 'WHO SHAPED THE SPEC')}
      {view.shaped.empty ? note(ui, view.shaped.empty, 'paqad-shaped-empty') : null}
      {view.shaped.rows.map((line) =>
        row(
          ui,
          `paqad-shaped-${line.id}`,
          coded(ui, line.id, line.line === line.id ? '' : line.line),
          word(ui, line.who, 'dim'),
        ),
      )}
      {view.shaped.total ? note(ui, view.shaped.total, 'paqad-shaped-total') : null}
    </Box>
  );
}

function deliveryBlock(ui: D, block: DeliveryBlock) {
  const { Box, Text, Svg, Link } = ui;
  return (
    <Box key={`paqad-step-${block.label}`} flexDirection="column">
      <Box flexDirection="row" alignItems="center" columnGap="sm">
        <Svg
          source={nodeIcon(block.label, block.state, block.ci)}
          alt={`${block.title}: ${block.sub ?? block.state}`}
          width={24}
          height={24}
        />
        <Box flexDirection="column" flexGrow={1}>
          {block.reached ? (
            <Text weight="semibold">{block.title}</Text>
          ) : (
            <Text weight="semibold" dimColor>
              {block.title}
            </Text>
          )}
          {block.sub ? note(ui, block.sub) : null}
          {block.note ? note(ui, block.note) : null}
        </Box>
        {block.right ? word(ui, block.right, 'dim') : null}
      </Box>
      {block.commits.length > 0 ? (
        <Box flexDirection="column" marginLeft={4}>
          {block.commits.map((commit) =>
            commit.own ? (
              <Text key={`paqad-commit-${commit.sha}`} size="footnote">
                <Text mono dimColor>{`${commit.sha}  `}</Text>
                {commit.subject}
              </Text>
            ) : (
              <Text key={`paqad-commit-${commit.sha}`} size="footnote" dimColor>
                <Text mono>{`${commit.sha}  `}</Text>
                {`${commit.subject}  ·  on the branch already`}
              </Text>
            ),
          )}
        </Box>
      ) : null}
      {block.jobs.length > 0 ? (
        <Box flexDirection="column" marginLeft={4} rowGap="xs">
          {block.jobs.map((job, index) => (
            <Box key={`paqad-job-${index}`} flexDirection="column">
              <Box flexDirection="row">
                <Box flexGrow={1}>
                  <Text size="footnote">{job.name}</Text>
                </Box>
                {job.tone === 'fail' ? (
                  <Text size="footnote" color={STATUS_B.failed} tabular>
                    {job.time}
                  </Text>
                ) : (
                  <Text size="footnote" dimColor tabular>
                    {job.time}
                  </Text>
                )}
              </Box>
              <Svg
                source={meter(job.share, job.share === null ? 'acc' : 'ink')}
                alt={`${job.name} ${job.time}`}
                height={4}
              />
            </Box>
          ))}
        </Box>
      ) : null}
      {block.link ? (
        <Box marginLeft={4}>
          <Link href={block.link.href}>{block.link.text}</Link>
        </Box>
      ) : null}
    </Box>
  );
}

function deliveryTab(ui: D, view: DeliveryView) {
  const { Box } = ui;
  if (view.empty) return note(ui, view.empty);
  return (
    <Box flexDirection="column" rowGap="xs">
      {view.blocks.map((block) => deliveryBlock(ui, block))}
    </Box>
  );
}

function recordTab(ui: D, view: RecordView) {
  const { Box, Text } = ui;
  if (view.empty) return note(ui, view.empty);
  return (
    <Box flexDirection="column">
      {view.rows.map((entry) => (
        <Box key={`paqad-record-${entry.key}`} flexDirection="column">
          <Text size="footnote">
            <Text mono dimColor>{`${entry.time}   `}</Text>
            {entry.text}
          </Text>
          {hair(ui)}
        </Box>
      ))}
    </Box>
  );
}

function costBlock(ui: D, total: string, money: string | null, lines: readonly string[]) {
  const { Box, Text } = ui;
  return (
    <Box key="paqad-cost-total" flexDirection="column">
      <Text size="title" weight="semibold" tabular>
        {total}
      </Text>
      {money ? <Text size="footnote">{money}</Text> : null}
      {lines.map((line, index) => note(ui, line, `paqad-cost-note-${index}`))}
    </Box>
  );
}

function bars(ui: D, section: string, list: readonly CostMeter[]) {
  const { Box, Text, Svg } = ui;
  return list.map((entry) => (
    <Box key={`paqad-${section}-${entry.key}`} flexDirection="column">
      <Box flexDirection="row">
        <Box flexGrow={1}>
          <Text size="footnote">{entry.name}</Text>
        </Box>
        <Text size="footnote" dimColor tabular>
          {entry.right}
        </Text>
      </Box>
      <Svg source={meter(entry.share, 'ink')} alt={`${entry.name} ${entry.right}`} height={4} />
    </Box>
  ));
}

function costTab(ui: D, view: CostView | null) {
  const { Box } = ui;
  if (!view) return note(ui, COST_LATER);
  return (
    <Box flexDirection="column" rowGap="xs">
      {costBlock(
        ui,
        view.total,
        view.money,
        [view.note, view.live].filter((line): line is string => Boolean(line)),
      )}
      {view.stages.length > 0 ? heading(ui, 'BY STAGE') : null}
      {bars(ui, 'stage', view.stages)}
      {view.table.length > 0 ? heading(ui, 'HIGH TABLE') : null}
      {bars(ui, 'expert', view.table)}
      <Box key="paqad-not-counted" marginTop={1}>
        {note(ui, view.notCounted)}
      </Box>
    </Box>
  );
}

function workflowPane(ui: D, view: WorkflowLedger) {
  const { Box } = ui;
  return (
    <Box flexDirection="column" rowGap="sm">
      {light(ui, view.light)}
      {costBlock(ui, view.total, view.money, [view.note])}
    </Box>
  );
}

function body(
  ui: D,
  ledger: Extract<DesktopLedger, { kind: 'feature' }>,
  state: LedgerState,
  actions: LedgerActions,
) {
  switch (ledger.shown) {
    case 'table':
      return tableTab(ui, ledger.table, state, actions);
    case 'ships':
      return deliveryTab(ui, ledger.delivery);
    case 'record':
      return recordTab(ui, ledger.record);
    case 'cost':
      return costTab(ui, ledger.cost);
    default:
      return trustTab(ui, ledger.trust);
  }
}

export function drawDesktopLedger(
  ui: D,
  ledger: DesktopLedger,
  state: LedgerState,
  actions: LedgerActions,
) {
  const { Box } = ui;
  if (ledger.kind === 'none') {
    return <Box flexDirection="column">{note(ui, NOTHING_TO_PROVE, 'paqad-trust-empty')}</Box>;
  }
  if (ledger.kind === 'unreadable') {
    return <Box flexDirection="column">{light(ui, ledger.light)}</Box>;
  }
  if (ledger.kind === 'workflow') return workflowPane(ui, ledger.view);
  return (
    <Box flexDirection="column">
      {note(ui, ledger.subtitle, 'paqad-subtitle')}
      {tabsRow(ui, ledger.tabs, actions)}
      <Box key={`paqad-body-${ledger.shown}`} flexDirection="column" marginTop={1}>
        {body(ui, ledger, state, actions)}
      </Box>
    </Box>
  );
}
