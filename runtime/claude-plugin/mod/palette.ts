export const INK = {
  ink: '#6E7D86',
  inkDark: '#C2CBD0',
  muted: '#8E979D',
  mutedDark: '#97A1A7',
  headline: '#1F2428',
  headlineDark: '#E8ECEE',
  hairOpacity: 0.28,
  faintOpacity: 0.3,
  faintStrokeOpacity: 0.45,
} as const;

export const SIGNAL = {
  accent: '#F90093',
  attention: '#F37748',
  caution: '#C98A1B',
  cautionDark: '#E3B04B',
  pass: '#2F8F6B',
  passDark: '#5FC29C',
  passText: '#26775A',
  fail: '#D23B3B',
  failDark: '#F08080',
  onSignal: '#FFFFFF',
} as const;

export type StatusSet = {
  name: string;
  done: string;
  doneDark: string;
  failed: string;
  failedDark: string;
};

export const STATUS_B: StatusSet = {
  name: 'B · brand + functional green and red',
  done: SIGNAL.pass,
  doneDark: SIGNAL.passDark,
  failed: SIGNAL.fail,
  failedDark: SIGNAL.failDark,
};

export const PX_PER_COLUMN = 8.5;

export const BREATH = ['FF', 'CC', '8C', '66', '8C', 'CC'] as const;

export const SVG_FONT =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif";

export type Signal = 'accent' | 'attention' | 'caution' | 'pass' | 'fail' | 'idle';

export function signalColor(signal: Signal): string {
  if (signal === 'accent') return SIGNAL.accent;
  if (signal === 'attention') return SIGNAL.attention;
  if (signal === 'caution') return SIGNAL.caution;
  if (signal === 'pass') return STATUS_B.done;
  if (signal === 'fail') return STATUS_B.failed;
  return INK.muted;
}

export function lightColor(signal: Signal, live: boolean, tick: number): string {
  const color = signalColor(signal);
  return live ? `${color}${BREATH[Math.abs(Math.trunc(tick)) % BREATH.length]}` : color;
}
