import chalk from 'chalk';

const ASCII = `
 ██████╗   █████╗   ██████╗   █████╗  ██████╗       █████╗  ██╗
 ██╔══██╗ ██╔══██╗ ██╔═══██╗ ██╔══██╗ ██╔══██╗     ██╔══██╗ ██║
 ██████╔╝ ███████║ ██║▄▄ ██║ ███████║ ██║  ██║     ███████║ ██║
 ██╔═══╝  ██╔══██║ ██║▀▀ ██║ ██╔══██║ ██║  ██║     ██╔══██║ ██║
 ██║      ██║  ██║ ╚██████╔╝ ██║  ██║ ██████╔╝     ██║  ██║ ██║
 ╚═╝      ╚═╝  ╚═╝  ╚══▀▀═╝  ╚═╝  ╚═╝ ╚═════╝      ╚═╝  ╚═╝ ╚═╝
`.trimEnd();

const SLOGAN =
  'AI Framework · Structured. Auditable. Scalable.\n' +
  'Documentation-first AI workflows for every stack.';
const PANEL_WIDTH = 68;

function borderLine(left: string, fill: string, right: string): string {
  return `${left}${fill.repeat(PANEL_WIDTH)}${right}`;
}

function pad(text = ''): string {
  return ` ${text}`.padEnd(PANEL_WIDTH, ' ');
}

function claudeAccent(text: string): string {
  return chalk.hex('#D97757').bold(text);
}

function claudeSurface(text: string): string {
  return chalk.hex('#F5E6DA')(text);
}

function claudeMuted(text: string): string {
  return chalk.hex('#9A6B55')(text);
}

export function printBanner(): void {
  console.log(claudeAccent(ASCII));
  console.log(claudeMuted(`  ${SLOGAN}`));
  console.log();
}

export function printNextSteps(): void {
  console.log();
  console.log(claudeAccent(borderLine('╔', '═', '╗')));
  console.log(claudeAccent('║') + claudeSurface(pad('  ONBOARDING COMPLETE')) + claudeAccent('║'));
  console.log(claudeAccent(borderLine('╠', '═', '╣')));
  console.log(claudeAccent('║') + claudeSurface(pad()) + claudeAccent('║'));
  console.log(
    claudeAccent('║') +
      claudeSurface(pad('  NEXT STEP: prompt your AI agent with:')) +
      claudeAccent('║'),
  );
  console.log(claudeAccent('║') + claudeSurface(pad()) + claudeAccent('║'));
  console.log(
    claudeAccent('║') +
      chalk.hex('#B45309').bold(pad('    create documentation')) +
      claudeAccent('║'),
  );
  console.log(claudeAccent('║') + claudeSurface(pad()) + claudeAccent('║'));
  console.log(
    claudeAccent('║') +
      claudeMuted(pad('  Generates docs/instructions/** and a reviewable module map.')) +
      claudeAccent('║'),
  );
  console.log(
    claudeAccent('║') +
      claudeMuted(pad('  Review the map, then prompt: create module documentation')) +
      claudeAccent('║'),
  );
  console.log(claudeAccent('║') + claudeSurface(pad()) + claudeAccent('║'));
  console.log(
    claudeAccent('║') +
      claudeMuted(pad('  Optional: prompt "analyze rules" then "generate rule scripts"')) +
      claudeAccent('║'),
  );
  console.log(
    claudeAccent('║') +
      claudeMuted(pad('  to enforce docs/instructions/rules/** as real checks.')) +
      claudeAccent('║'),
  );
  console.log(claudeAccent(borderLine('╚', '═', '╝')));
  console.log();
}


/**
 * One plain line telling a Codex developer to trust paqad's project hooks (issue #566,
 * step 6). Codex loads project-local `.codex/hooks.json` only when the `.codex/` layer is
 * trusted, so onboarding cannot make the gates fire on its own — the developer approves
 * them once in Codex's `/hooks` screen. Returns null when Codex was not onboarded, so a
 * non-Codex onboard prints nothing.
 */
export function codexTrustHint(adapters: readonly string[] | undefined): string | null {
  if (!adapters?.includes('codex-cli')) {
    return null;
  }
  return (
    'Codex: open Codex in this project, run /hooks, and approve paqad\u2019s hooks so the ' +
    'feature-development gates fire (project hooks load only when the .codex/ layer is trusted).'
  );
}
