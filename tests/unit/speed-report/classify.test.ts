import { describe, expect, it } from 'vitest';

import {
  AWAY_AFTER_MS,
  CATEGORY,
  INJECTED_MARKERS,
  OWNER_CATEGORY,
  THINKING_MAX_MS,
  TOOL_INTERVAL_MAX_MS,
  classifyBashCommand,
  classifyUserRecord,
  commandWords,
  isFrameworkReread,
  isInjectedText,
  isOutsidePaqadDir,
  keepsToolInterval,
  isThinkingGap,
  lineCount,
  ownerColumn,
  ownerGapCategory,
  refusalLabel,
  roleForAgentType,
  roleRank,
  stripCommandPrefixes,
  testRunKind,
  toolCategory,
} from '@/speed-report/classify.js';

describe('speed report classification', () => {
  it('AC-3: puts each Bash command in the category the rules name', () => {
    const cases: Array<[string, string]> = [
      ['paqad-ai checks run', CATEGORY.checksRun],
      ['npx paqad-ai checks run --json', CATEGORY.checksRun],
      ['paqad-ai stage start development', CATEGORY.paqadCli],
      ['paqad-ai plan compile plan.json', CATEGORY.paqadCli],
      ['paqad-ai spec freeze spec.md', CATEGORY.paqadCli],
      ['paqad-ai review record r.json', CATEGORY.paqadCli],
      ['paqad-ai rules load', CATEGORY.paqadCli],
      ['paqad-ai decision create --category x', CATEGORY.paqadCli],
      ['paqad-ai lane set full', CATEGORY.paqadCli],
      ['paqad-ai route set feature-development', CATEGORY.paqadCli],
      ['paqad-ai debt add', CATEGORY.paqadCli],
      ['paqad-ai index query foo', CATEGORY.paqadCli],
      ['paqad-ai visual-evidence run', CATEGORY.paqadCli],
      ['paqad-ai feature report', CATEGORY.other],
      ['vitest run tests/unit/a.test.ts', CATEGORY.tests],
      ['pnpm test', CATEGORY.tests],
      ['pnpm test:coverage', CATEGORY.tests],
      ['pnpm ci', CATEGORY.tests],
      ['pnpm vitest run', CATEGORY.tests],
      ['pnpm exec vitest run', CATEGORY.tests],
      ['php artisan test', CATEGORY.tests],
      ['./vendor/bin/sail test', CATEGORY.tests],
      ['./vendor/bin/pest', CATEGORY.tests],
      ['vendor/bin/phpunit', CATEGORY.tests],
      ['tsc --noEmit', CATEGORY.lint],
      ['pnpm typecheck', CATEGORY.lint],
      ['pnpm exec eslint src', CATEGORY.lint],
      ['prettier --check .', CATEGORY.lint],
      ['pnpm lint', CATEGORY.lint],
      ['pnpm format:check', CATEGORY.lint],
      ['pnpm build', CATEGORY.lint],
      ['pnpm run build', CATEGORY.lint],
      ['tsup', CATEGORY.lint],
      ['git status --short', CATEGORY.git],
      ['gh pr view 1', CATEGORY.git],
      ['sleep 30', CATEGORY.waiting],
      ['until test -f x; do sleep 2; done', CATEGORY.waiting],
      ['while true; do sleep 1; done', CATEGORY.waiting],
      ['grep -rn foo src', CATEGORY.other],
      ['cat package.json | head', CATEGORY.other],
      ['', CATEGORY.other],
    ];
    for (const [command, category] of cases) {
      expect(classifyBashCommand(command), command).toBe(category);
    }
  });

  it('AC-4: a cd into a path holding paqad-ai counts the first real command, not a paqad CLI call', () => {
    const command = 'cd "/Users/x/paqad-ai npm" && pnpm test';
    expect(classifyBashCommand(command)).toBe(CATEGORY.tests);
    expect(classifyBashCommand(command)).not.toBe(CATEGORY.paqadCli);
    expect(classifyBashCommand("cd '/Users/x/paqad-ai npm' && git log")).toBe(CATEGORY.git);
    expect(classifyBashCommand('cd /Users/x/paqad-ai && ls')).toBe(CATEGORY.other);
  });

  it('AC-3: strips leading cd, export and VAR=value prefixes before matching', () => {
    expect(stripCommandPrefixes('cd "/a b" && export X=1 Y="2 3" && Z=4 W="a b" pnpm test')).toBe(
      'pnpm test',
    );
    expect(stripCommandPrefixes('  SE_SESSION=abc paqad-ai stage start review')).toBe(
      'paqad-ai stage start review',
    );
    expect(stripCommandPrefixes('cd somewhere; pnpm test')).toBe('cd somewhere; pnpm test');
    expect(stripCommandPrefixes('export X=1')).toBe('export X=1');
    expect(classifyBashCommand('export SE_SESSION=s && paqad-ai checks run')).toBe(
      CATEGORY.checksRun,
    );
    expect(classifyBashCommand('cd "/a && b" && git status')).toBe(CATEGORY.git);
  });

  it('strips a long unterminated export prefix in linear time', () => {
    const command = `export ${'A=1 '.repeat(5000)}`;
    const started = performance.now();
    expect(stripCommandPrefixes(command)).toBe(command.trim());
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('splits command words on quotes and stops at the first control operator', () => {
    expect(commandWords('vitest run "a b" -t \'c\' && pnpm build')).toEqual([
      'vitest',
      'run',
      'a b',
      '-t',
      'c',
    ]);
    expect(commandWords('git log | head')).toEqual(['git', 'log']);
    expect(commandWords('a ""')).toEqual(['a', '']);
  });

  it('AC-8: counts whole-suite and targeted test runs', () => {
    expect(testRunKind('pnpm test')).toBe('whole-suite');
    expect(testRunKind('vitest run --coverage')).toBe('whole-suite');
    expect(testRunKind('paqad-ai checks run')).toBe('whole-suite');
    expect(testRunKind('vitest run tests/unit/x.test.ts')).toBe('targeted');
    expect(testRunKind('pnpm test src/')).toBe('targeted');
    expect(testRunKind('vitest run -t name')).toBe('targeted');
    expect(testRunKind('pnpm ci')).toBe('whole-suite');
    expect(testRunKind('pnpm test:coverage')).toBe('whole-suite');
    expect(testRunKind('pnpm vitest run foo.test.ts')).toBe('targeted');
    expect(testRunKind('vitest run --testNamePattern=x')).toBe('targeted');
    expect(testRunKind('cd "/Users/x/paqad-ai npm" && pnpm vitest run tests/unit')).toBe(
      'targeted',
    );
    expect(testRunKind('git status')).toBeNull();
    expect(testRunKind('paqad-ai stage start checks')).toBeNull();
  });

  it('AC-3: labels an edit refused by a gate with one fixed reason', () => {
    const timeout =
      'PreToolUse:Edit hook error: [node "gate.mjs" pre-mutation]: timed out; blocking';
    const entry = 'PreToolUse:Edit hook error: [node "agent-entry-gate.mjs"]: Blocked';
    const other = 'PreToolUse:Write hook error: [node "gate.mjs"]: Needs your attention';
    expect(refusalLabel(true, timeout)).toBe(CATEGORY.blockedTimeout);
    expect(refusalLabel(true, entry)).toBe(CATEGORY.blockedEntry);
    expect(refusalLabel(true, other)).toBe(CATEGORY.blockedOther);
    expect(refusalLabel(false, timeout)).toBeNull();
    expect(refusalLabel(true, '<tool_use_error>String to replace not found')).toBeNull();
  });

  it('AC-3: categorises tool calls, including framework re-reads', () => {
    expect(toolCategory('Edit', { file_path: 'src/a.ts' })).toBe(CATEGORY.edit);
    expect(toolCategory('NotebookEdit', {})).toBe(CATEGORY.edit);
    expect(toolCategory('Read', { file_path: '/p/CLAUDE.md' })).toBe(CATEGORY.frameworkReread);
    expect(toolCategory('Read', { file_path: '/x/runtime/AGENT-ROUTER.md' })).toBe(
      CATEGORY.frameworkReread,
    );
    expect(toolCategory('Read', { file_path: 'src/a.ts' })).toBe(CATEGORY.other);
    expect(toolCategory('Bash', { command: 'pnpm lint' })).toBe(CATEGORY.lint);
    expect(toolCategory('Bash', {})).toBe(CATEGORY.other);
    expect(toolCategory('Grep', {})).toBe(CATEGORY.other);
    for (const path of [
      'AGENT-BOOTSTRAP.md',
      '.paqad/framework-path.txt',
      '.paqad/context/session-context.md',
      'docs/instructions/stack/overview.md',
      'docs\\instructions\\design-system\\hud.md',
      '/p/docs/instructions/workflows/feature-development.yaml',
    ]) {
      expect(isFrameworkReread(path), path).toBe(true);
    }
    expect(isFrameworkReread('docs/instructions/rules/module-map.yml')).toBe(false);
  });

  it('AC-3: tells injected messages from human prompts by the first 400 characters', () => {
    for (const marker of INJECTED_MARKERS) {
      expect(isInjectedText(`${marker} body`), marker).toBe(true);
    }
    expect(classifyUserRecord(false, 'Another Claude session sent a message:\nhi')).toBe(
      'injected',
    );
    expect(classifyUserRecord(false, 'please fix the bug')).toBe('human');
    expect(classifyUserRecord(true, 'Stop hook feedback')).toBe('tool-result');
  });

  it('AC-6: an injected marker at character 399 counts and one at 401 does not', () => {
    const marker = '<task-notification';
    expect(isInjectedText(`${'a'.repeat(399)}${marker}`)).toBe(true);
    expect(isInjectedText(`${'a'.repeat(401)}${marker}`)).toBe(false);
  });

  it('AC-6: keeps the boundaries on the side the strict wording gives', () => {
    expect(keepsToolInterval(TOOL_INTERVAL_MAX_MS)).toBe(true);
    expect(keepsToolInterval(TOOL_INTERVAL_MAX_MS + 1000)).toBe(false);
    expect(keepsToolInterval(-1)).toBe(false);
    expect(isThinkingGap(THINKING_MAX_MS - 1)).toBe(true);
    expect(isThinkingGap(THINKING_MAX_MS)).toBe(false);
    expect(isThinkingGap(-1)).toBe(false);
    expect(ownerGapCategory(AWAY_AFTER_MS)).toBe(OWNER_CATEGORY.reading);
    expect(ownerGapCategory(AWAY_AFTER_MS + 1000)).toBe(OWNER_CATEGORY.away);
  });

  it('maps subagent types to their stage owner through the stage agent names', () => {
    expect(roleForAgentType(null)).toBe('main');
    expect(roleForAgentType('paqad-development')).toBe('development');
    expect(roleForAgentType('paqad:paqad-review')).toBe('review');
    expect(roleForAgentType('paqad-documentation-sync')).toBe('documentation_sync');
    expect(roleForAgentType('paqad-expert')).toBe('expert');
    expect(roleForAgentType('paqad-chief-architect')).toBe('chief-architect');
    expect(roleForAgentType('Explore')).toBe('Explore');
    expect(roleForAgentType('general-purpose')).toBe('other');
    expect(roleRank('development')).toBeLessThan(roleRank('checks'));
    expect(roleRank('Explore')).toBeLessThan(roleRank('main'));
    expect(ownerColumn('development')).toBe('development');
    expect(ownerColumn('planning')).toBe('ceremony');
    expect(ownerColumn('main')).toBe('orchestrator');
    expect(ownerColumn('Explore')).toBe('other');
  });

  it('counts written lines and leaves .paqad out of the size', () => {
    expect(lineCount('')).toBe(0);
    expect(lineCount('a')).toBe(1);
    expect(lineCount('a\nb\n')).toBe(2);
    expect(isOutsidePaqadDir('/p/src/a.ts')).toBe(true);
    expect(isOutsidePaqadDir('/p/.paqad/x.json')).toBe(false);
    expect(isOutsidePaqadDir('.paqad/x.json')).toBe(false);
  });
});
