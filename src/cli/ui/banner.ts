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
