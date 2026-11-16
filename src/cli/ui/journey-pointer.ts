const HOST_LABELS: Readonly<Record<string, string>> = {
  'claude-code': 'Claude Code',
  'codex-cli': 'Codex',
  antigravity: 'Antigravity',
  'gemini-cli': 'Gemini CLI',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  continue: 'Continue',
};

export function journeyPointer(hosts: readonly string[]): string | null {
  const names = hosts.map((host) => HOST_LABELS[host] ?? host);
  if (names.length === 0) return null;
  const where =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
  return `Next: say "onboard paqad" in ${where} to write your docs and rules as a guided journey.`;
}

export const OPEN_JOURNEY_LINE =
  'An onboarding journey is open here. Say "resume paqad onboarding" in your AI tool, or run `paqad-ai onboarding resume`.';
