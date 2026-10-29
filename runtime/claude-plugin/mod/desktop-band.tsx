import type { Elements } from 'claude-code';

import {
  CLOSED_WORDS,
  CLOSE_MENU_QUESTION,
  FEATURE_WORDS,
  HIDDEN_WORDS,
  NEEDS_YOU_WORDS,
  READY_WORDS,
  flagWords,
  identityText,
  type DesktopBand,
  type IdentityView,
} from './desktop-view';
import { SIGNAL, lightColor } from './palette';
import { liveHeadline, miniStages, strip } from './strip';

type D = Elements['desktop'];

export interface BandActions {
  ledger: () => void;
  flags: () => void;
  minimise: () => void;
  expand: () => void;
  close: () => void;
  closeNow: () => void;
  hideAlways: () => void;
  cancel: () => void;
  show: () => void;
}

function brand(ui: D) {
  const { Text } = ui;
  return <Text weight="semibold">paqad</Text>;
}

function controls(ui: D, actions: BandActions, minimised: boolean) {
  const { Button } = ui;
  return [
    <Button dimColor key="paqad-ledger" onPress={actions.ledger}>
      Ledger
    </Button>,
    minimised ? (
      <Button plain dimColor key="paqad-expand" onPress={actions.expand}>
        ⤢
      </Button>
    ) : (
      <Button plain dimColor key="paqad-minimise" onPress={actions.minimise}>
        −
      </Button>
    ),
    <Button plain dimColor key="paqad-close" onPress={actions.close}>
      ×
    </Button>,
  ];
}

function flags(ui: D, count: number, actions: BandActions) {
  const { Text, Button } = ui;
  if (count === 0) return [];
  return [
    <Text key="paqad-flag-mark" size="footnote" color={SIGNAL.caution}>
      ⚑
    </Text>,
    <Button plain dimColor key="paqad-flags" onPress={actions.flags}>
      {flagWords(count)}
    </Button>,
  ];
}

function identityRow(ui: D, identity: IdentityView, actions: BandActions) {
  const { Box, Text } = ui;
  return (
    <Box key="paqad-identity" flexDirection="row" alignItems="center" columnGap="sm">
      <Text wrap="truncate-end">
        {brand(ui)}
        <Text size="footnote" dimColor>
          {identityText(identity)}
        </Text>
      </Text>
      <Box flexGrow={1} />
      {flags(ui, identity.flags, actions)}
      {controls(ui, actions, false)}
    </Box>
  );
}

function closeMenu(ui: D, actions: BandActions) {
  const { Box, Text, Button } = ui;
  return (
    <Box key="paqad-close-menu" flexDirection="row" alignItems="center" columnGap="sm">
      <Text size="footnote">{CLOSE_MENU_QUESTION}</Text>
      <Button key="paqad-close-now" onPress={actions.closeNow}>
        Close for now
      </Button>
      <Button key="paqad-close-always" onPress={actions.hideAlways}>
        Hide always
      </Button>
      <Button plain dimColor key="paqad-close-cancel" onPress={actions.cancel}>
        Cancel
      </Button>
    </Box>
  );
}

function messageRow(ui: D, band: Extract<DesktopBand, { kind: 'feature' }>, tick: number) {
  const { Text, Svg } = ui;
  const headline = band.headline;
  if (headline.live) {
    const drawn = liveHeadline({
      columns: band.strip.columns,
      signal: headline.signal,
      text: headline.text,
      note: headline.note,
      clock: headline.clock,
      ...(band.strip.clockMs === undefined ? {} : { clockMs: band.strip.clockMs }),
    });
    return <Svg key="paqad-message" source={drawn.source} alt={band.headlineAlt} />;
  }
  return (
    <Text key="paqad-message" wrap="truncate-end">
      <Text size="heading" color={lightColor(headline.signal, headline.live, tick)}>
        ●{' '}
      </Text>
      <Text size="heading" weight="semibold">
        {headline.text}
      </Text>
      {headline.note ? <Text size="footnote" dimColor>{`    ${headline.note}`}</Text> : null}
      {headline.live && headline.clock ? (
        <Text size="footnote" dimColor>{`    ${headline.clock}`}</Text>
      ) : null}
    </Text>
  );
}

function bodyRow(ui: D, band: Extract<DesktopBand, { kind: 'feature' }>) {
  const { Text } = ui;
  return (
    <Text key="paqad-gap" size="footnote" dimColor wrap="truncate-end">
      {band.activity[0] ?? band.headline.gap ?? ' '}
    </Text>
  );
}

function minimisedRow(
  ui: D,
  band: Extract<DesktopBand, { kind: 'feature' }>,
  tick: number,
  actions: BandActions,
) {
  const { Box, Text, Svg } = ui;
  const view = band.minimised;
  return (
    <Box key="paqad-minimised" flexDirection="row" alignItems="center" columnGap="sm">
      <Text wrap="truncate-end">
        {brand(ui)}
        <Text size="footnote" dimColor>{`   ${FEATURE_WORDS}   `}</Text>
        <Text color={lightColor(view.light, view.live, tick)}>● </Text>
        <Text size="footnote">{view.text}</Text>
      </Text>
      <Svg source={miniStages(view.stages)} alt={`Stages: ${view.text}`} width={64} height={4} />
      <Box flexGrow={1} />
      {view.cost ? (
        <Text size="footnote" dimColor>
          {view.cost}
        </Text>
      ) : null}
      {controls(ui, actions, true)}
    </Box>
  );
}

function featureBand(
  ui: D,
  band: Extract<DesktopBand, { kind: 'feature' }>,
  tick: number,
  actions: BandActions,
) {
  const { Box, Svg } = ui;
  if (band.mode === 'minimised') {
    return (
      <Box key="paqad-band" flexDirection="column" rowGap="xs">
        {minimisedRow(ui, band, tick, actions)}
        {band.menu ? closeMenu(ui, actions) : null}
      </Box>
    );
  }
  return (
    <Box key="paqad-band" flexDirection="column" rowGap="xs">
      {identityRow(ui, band.identity, actions)}
      {band.menu ? closeMenu(ui, actions) : null}
      {messageRow(ui, band, tick)}
      {bodyRow(ui, band)}
      <Box key="paqad-strip">
        <Svg source={strip(band.strip).source} alt={band.alt} />
      </Box>
    </Box>
  );
}

function closedBand(
  ui: D,
  band: Extract<DesktopBand, { kind: 'closed' | 'hidden' }>,
  actions: BandActions,
) {
  const { Box, Text, Button } = ui;
  return (
    <Box key="paqad-band" flexDirection="row" alignItems="center" columnGap="sm">
      <Text size="footnote">
        {brand(ui)}
        {band.needsYou ? (
          <Text color={SIGNAL.attention}>{`   ● ${NEEDS_YOU_WORDS}`}</Text>
        ) : (
          <Text dimColor>{`   ${band.kind === 'closed' ? CLOSED_WORDS : HIDDEN_WORDS}`}</Text>
        )}
      </Text>
      <Box flexGrow={1} />
      <Button plain dimColor key="paqad-show" onPress={actions.show}>
        Show
      </Button>
    </Box>
  );
}

function workflowBand(
  ui: D,
  band: Extract<DesktopBand, { kind: 'workflow' }>,
  tick: number,
  actions: BandActions,
) {
  const { Box, Text, Button } = ui;
  return (
    <Box key="paqad-band" flexDirection="row" alignItems="center" columnGap="sm">
      <Text wrap="truncate-end">
        {brand(ui)}
        <Text size="footnote" dimColor>{`   ${band.words}   `}</Text>
        {band.running ? (
          <Text color={lightColor('accent', true, tick)}>● </Text>
        ) : (
          <Text dimColor>● </Text>
        )}
        {band.running ? (
          <Text size="footnote">{`running · ${band.clock ?? '0:00'}`}</Text>
        ) : (
          <Text size="footnote" dimColor>
            idle
          </Text>
        )}
      </Text>
      <Box flexGrow={1} />
      <Text size="footnote" dimColor>
        {band.cost}
      </Text>
      <Button dimColor key="paqad-workflow-ledger" onPress={actions.ledger}>
        Ledger
      </Button>
    </Box>
  );
}

function unreadableBand(
  ui: D,
  band: Extract<DesktopBand, { kind: 'unreadable' }>,
  actions: BandActions,
) {
  const { Box, Text } = ui;
  return (
    <Box key="paqad-band" flexDirection="column" rowGap="xs">
      <Box key="paqad-identity" flexDirection="row" alignItems="center" columnGap="sm">
        <Text>{brand(ui)}</Text>
        <Box flexGrow={1} />
        {controls(ui, actions, false)}
      </Box>
      <Text wrap="truncate-end">
        <Text size="heading" color={SIGNAL.attention}>
          ●{' '}
        </Text>
        <Text size="heading" weight="semibold">
          {band.headline}
        </Text>
      </Text>
    </Box>
  );
}

export function drawDesktopBand(ui: D, band: DesktopBand, tick: number, actions: BandActions) {
  const { Text } = ui;
  switch (band.kind) {
    case 'none':
      return null;
    case 'ready':
      return (
        <Text key="paqad-band">
          {brand(ui)}
          <Text size="footnote" dimColor>{`   ${READY_WORDS}`}</Text>
        </Text>
      );
    case 'unreadable':
      return unreadableBand(ui, band, actions);
    case 'workflow':
      return workflowBand(ui, band, tick, actions);
    case 'closed':
    case 'hidden':
      return closedBand(ui, band, actions);
    case 'feature':
      return featureBand(ui, band, tick, actions);
  }
}
