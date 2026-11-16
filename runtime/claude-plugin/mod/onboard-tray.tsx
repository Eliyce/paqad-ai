import type { Elements } from 'claude-code';

type D = Elements['desktop'];

export interface TrayProvider {
  id: string;
  label: string;
  needsNpm: boolean;
}

export const TRAY_PROVIDERS: readonly TrayProvider[] = [
  { id: 'claude-code', label: 'Claude Code', needsNpm: false },
  { id: 'codex-cli', label: 'Codex', needsNpm: true },
  { id: 'cursor', label: 'Cursor', needsNpm: true },
  { id: 'gemini-cli', label: 'Gemini CLI', needsNpm: true },
  { id: 'windsurf', label: 'Windsurf', needsNpm: true },
  { id: 'antigravity', label: 'Antigravity', needsNpm: true },
];

export const TRAY_QUESTION = 'Which AI tools does your team use?';
export const ALLOW_LIST_WORDS = 'Let it work without stopping to ask';
export const START_WORDS = 'Start onboarding';
export const NONE_TICKED_WORDS = 'Tick at least one AI tool';

export interface TrayState {
  ticked: string[];
  allowList: boolean;
  npmAvailable: boolean;
}

export function initialTray(npmAvailable: boolean): TrayState {
  return { ticked: ['claude-code'], allowList: true, npmAvailable };
}

export interface TrayRow {
  key: string;
  text: string;
  ticked: boolean;
  available: boolean;
  label: string;
}

export function trayRows(state: TrayState): TrayRow[] {
  const providers = TRAY_PROVIDERS.map((provider) => {
    const available = !provider.needsNpm || state.npmAvailable;
    const ticked = available && state.ticked.includes(provider.id);
    return {
      key: provider.id,
      text: available
        ? `${ticked ? '☑' : '☐'} ${provider.label}`
        : `– ${provider.label} · needs npm`,
      ticked,
      available,
      label: available
        ? `${provider.label}, ${ticked ? 'ticked' : 'not ticked'}`
        : `${provider.label}, unavailable: needs npm`,
    };
  });
  const allow = {
    key: 'allow-list',
    text: `${state.allowList ? '☑' : '☐'} ${ALLOW_LIST_WORDS}`,
    ticked: state.allowList,
    available: true,
    label: `${ALLOW_LIST_WORDS}, ${state.allowList ? 'ticked' : 'not ticked'}`,
  };
  return [...providers, allow];
}

export function toggleTray(state: TrayState, key: string): TrayState {
  if (key === 'allow-list') return { ...state, allowList: !state.allowList };
  const provider = TRAY_PROVIDERS.find((entry) => entry.id === key);
  if (!provider || (provider.needsNpm && !state.npmAvailable)) return state;
  const ticked = state.ticked.includes(key)
    ? state.ticked.filter((id) => id !== key)
    : [...state.ticked, key];
  return { ...state, ticked };
}

export function startBlockedText(state: TrayState): string | null {
  return state.ticked.length === 0 ? NONE_TICKED_WORDS : null;
}

export function traySubmitText(state: TrayState, sessionId: string): string | null {
  if (startBlockedText(state) !== null) return null;
  const providers = TRAY_PROVIDERS.filter((provider) => state.ticked.includes(provider.id))
    .map((provider) => provider.id)
    .join(',');
  return `/paqad:onboard ${providers} --session ${sessionId} --allow-list ${state.allowList ? 'yes' : 'no'}`;
}

export interface TrayActions {
  toggle: (key: string) => void;
  start: () => void;
  dismiss: () => void;
}

export function drawOnboardTray(ui: D, state: TrayState, actions: TrayActions) {
  const { Box, Text, Button } = ui;
  const blocked = startBlockedText(state);
  return (
    <Box key="paqad-onboard-tray" flexDirection="column" rowGap="xs">
      <Text weight="semibold">{TRAY_QUESTION}</Text>
      {trayRows(state).map((row) =>
        row.available ? (
          <Button plain key={`paqad-tray-${row.key}`} onPress={() => actions.toggle(row.key)}>
            <Text>{row.text}</Text>
          </Button>
        ) : (
          <Text key={`paqad-tray-${row.key}`} dimColor>
            {`${row.text} (unavailable)`}
          </Text>
        ),
      )}
      <Box flexDirection="row" columnGap="sm">
        {blocked === null ? (
          <Button key="paqad-tray-start" onPress={actions.start}>
            <Text>{START_WORDS}</Text>
          </Button>
        ) : (
          <Text key="paqad-tray-blocked">{blocked}</Text>
        )}
        <Button plain dimColor key="paqad-tray-dismiss" onPress={actions.dismiss}>
          <Text>Not now</Text>
        </Button>
      </Box>
    </Box>
  );
}
