import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MOD_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../runtime/claude-plugin/mod',
);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '.claude-plugin' ? [] : files(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const sources = files(MOD_DIR).map((path) => ({
  name: relative(MOD_DIR, path).replace(/\\/g, '/'),
  text: readFileSync(path, 'utf8'),
}));

describe('the HUD mod source', () => {
  it('has the files the design names', () => {
    expect(sources.map((s) => s.name).sort()).toEqual(
      [
        'agents.ts',
        'ask-evidence.ts',
        'attention.ts',
        'band.ts',
        'chime.ts',
        'chips.ts',
        'command-name.ts',
        'commands.ts',
        'config.ts',
        'cost.ts',
        'desktop-band.tsx',
        'desktop-ledger.tsx',
        'desktop-view.ts',
        'headline.ts',
        'instruments.ts',
        'live.ts',
        'model.ts',
        'palette.ts',
        'pane.ts',
        'paqad-cli.ts',
        'receipt.ts',
        'register.test.ts',
        'register.tsx',
        'ship.ts',
        'status-entry.ts',
        'shell.ts',
        'strip.ts',
        'table.ts',
        'tabs.ts',
        'trust.ts',
        'visibility.ts',
        'test/fixtures.ts',
        'test/world.ts',
        'types/index.d.ts',
      ].sort(),
    );
  });

  it.each(sources.map((s) => [s.name, s.text]))(
    '%s calls no model, no network and no process outside the paqad-ai helper',
    (name, text) => {
      expect(text).not.toMatch(/\$\.model\b/);
      expect(text).not.toMatch(/\$\.http\b/);
      expect(text).not.toMatch(/\$\.audio\.speak\b/);
      if (name !== 'register.tsx') expect(text).not.toMatch(/\$\.process\b/);
      expect(text).not.toMatch(/\bimport\s*\(/);
      expect(text).not.toMatch(/\brequire\s*\(/);
      expect(text).not.toMatch(/from 'node:/);
    },
  );

  it('declares every state atom register.tsx uses in the PluginState contract', () => {
    const register = sources.find((s) => s.name === 'register.tsx')!.text;
    const contract = sources.find((s) => s.name === 'types/index.d.ts')!.text;
    const used = [...register.matchAll(/atom\(\s*\{ plugin: 'paqad', key: '([A-Za-z]+)' \}/g)].map(
      (match) => match[1]!,
    );
    expect(used.length).toBeGreaterThan(10);
    const start = contract.indexOf('interface PluginState');
    expect(start).toBeGreaterThan(-1);
    const block = contract.slice(start, contract.indexOf('\n  }\n', start));
    const declared = [...block.matchAll(/^\s{6}([A-Za-z]+):/gm)].map((match) => match[1]!);
    expect(used.filter((key) => !declared.includes(key))).toEqual([]);
  });

  it('the band shell imports no body code', () => {
    const shell = sources.find((s) => s.name === 'shell.ts')!.text;
    expect(shell.match(/from '\.\/([a-z-]+)'/g)).toEqual(["from './types'"]);
  });

  it('AC-16: starts two programs, rules override and the delivery refresh, each argv written at the call', () => {
    const register = sources.find((s) => s.name === 'register.tsx')!.text;
    const helper = sources.find((s) => s.name === 'paqad-cli.ts')!.text;
    expect(register.match(/\$\.process\./g)).toEqual(['$.process.', '$.process.']);
    expect(register).toContain("$.process.run([program, 'rules', 'override', ...args], {");
    const start = register.indexOf('$.process.run(\n      [\n        program,');
    expect(start, 'the delivery refresh call').toBeGreaterThan(-1);
    const call = register.slice(start, register.indexOf(');', start));
    expect(call.replace(/\s+/g, ' ')).toContain(
      "[ program, 'delivery-link', 'refresh', '--session', at.sessionId, '--project-root', at.root, '--min-age-seconds', String(Math.round((watch.delay ?? 0) / 1000)), ], { cwd: at.root, timeoutMs: PAQAD_CLI_TIMEOUT_MS }",
    );
    expect(call).not.toMatch(/snapshot|branch|title|ship/);
    expect(register).not.toMatch(/\$\.process\.spawn/);
    expect(helper).not.toMatch(/spawn|shell|exec|argv/);
  });

  it('AC-34: register.tsx has exactly two process runs and both start with the plugin program', () => {
    const register = sources.find((s) => s.name === 'register.tsx')!.text;
    expect(register.match(/\$\.process\.run\(/g)).toHaveLength(2);
    expect(register.match(/\$\.process\.run\(\s*\[\s*program,/g)).toHaveLength(2);
    expect(register).not.toContain("['paqad-ai'");
  });

  it('AC-37: the prompt.submit handler passes the event to next and reads no field of it', () => {
    const register = sources.find((s) => s.name === 'register.tsx')!.text;
    const start = register.indexOf("on('prompt.submit',");
    expect(start).toBeGreaterThan(-1);
    const handler = register.slice(start, register.indexOf('.catch(', start));
    expect(handler).toContain('await next(e)');
    expect(handler).not.toMatch(/\be\.|\be\[|\.\.\.e\b|\{[^}]*\}\s*=\s*e\b/);
  });

  it('the watch started after a git push can never fail or re-run the push', () => {
    const register = sources.find((s) => s.name === 'register.tsx')!.text;
    const start = register.indexOf('async function watchAfterPush(');
    expect(start, 'watchAfterPush').toBeGreaterThan(-1);
    const body = register.slice(start, register.indexOf('\n}\n', start));
    expect(body).toMatch(/^\s+try \{$/m);
    expect(body).toMatch(/\} catch \{\}/);
    const hook = register.indexOf('if (isGitPush(tool, input.command))');
    expect(register.slice(hook, register.indexOf('\n', hook))).toContain('await watchAfterPush($)');
  });

  it('AC-4: registers no tool.check hook, so it never reads or answers a permission check', () => {
    const register = sources.find((s) => s.name === 'register.tsx')!.text;
    expect(register).not.toMatch(/\bon\(\s*['"]tool\.check['"]/);
  });

  it('AC-2: the edit tools retry a denied call once, and only after allowRuleStopOnce returns a stop', () => {
    const register = sources.find((s) => s.name === 'register.tsx')!.text;
    const startMarker = "on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }";
    const start = register.indexOf(startMarker);
    expect(start, 'the Edit, Write and NotebookEdit tool.call hook').toBeGreaterThan(-1);
    expect(start, 'it sits after the unmatched tool.call hook').toBeGreaterThan(
      register.indexOf("on('tool.call', async ($, e, next) => {"),
    );
    const end = register.indexOf('.catch(', start);
    const hook = register.slice(start, end);
    expect(hook).toContain('allowRuleStopOnce($, e.tool_use_id)');
    expect(hook.match(/next\(e\)/g)).toHaveLength(2);
    expect(hook).not.toMatch(/\b(for|while)\s*\(/);
    expect(register.slice(end, register.indexOf('\n', end))).toContain(
      '.catch(($, e, next) => next(e));',
    );
  });

  it('every $.audio.play call writes its clip as an object literal with base64 and mime', () => {
    const register = sources.find((s) => s.name === 'register.tsx')!.text;
    const calls = register.match(/\$\.audio\.play\(.*$/gm) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).toMatch(/^\$\.audio\.play\(\{ base64: [^,]+, mime: 'audio\/wav' \}\)/);
    }
  });

  it('AC-12: every $.fs.write path names .paqad/session/hud/ at the call', () => {
    const register = sources.find((s) => s.name === 'register.tsx')!.text;
    const writes = [...register.matchAll(/\$\.fs\.write\(\s*([^,]+),/g)].map((m) => m[1]!);
    expect(writes).toHaveLength(2);
    for (const path of writes) {
      expect(path).toMatch(
        /^`\$\{[a-z.]+\}\/\.paqad\/session\/hud\/\$\{safeSessionId\([a-zA-Z.]+\)\}\.(live|last-block\.json)`$/,
      );
    }
  });

  it('command and tool matchers are literal', () => {
    const register = sources.find((s) => s.name === 'register.tsx')!.text;
    expect(register).not.toContain('{ command: name }');
    expect(register).not.toContain('{ tool: UPDATE_PLAN_TOOL }');
    expect(register).toContain("on('command.run', { command: 'paqad' }");
    expect(register).toContain("on('command.run', { command: 'paqad-hud' }");
    expect(register).toContain("on('tool.call', { tool: 'mcp__ccd_turn__update_plan' }");
    expect(register).toContain("name: 'paqad',");
    expect(register).toContain("name: 'paqad-hud',");
  });

  it('the README HUD section names every program, file, sound, variable and command the mod uses', () => {
    const readme = readFileSync(join(MOD_DIR, '../../../README.md'), 'utf8');
    const start = readme.indexOf('### What the HUD does (Claude Code)');
    const end = readme.indexOf('\n### ', start + 1);
    expect(start).toBeGreaterThan(-1);
    const section = readme.slice(start, end);
    const register = sources.find((s) => s.name === 'register.tsx')!.text;
    const used = sources
      .filter((s) => !s.name.endsWith('.test.ts') && !s.name.startsWith('test/'))
      .flatMap((s) =>
        s.text
          .split('\n')
          .filter((line) =>
            /process\.run|fs\.write|audio\.play|env\.get\(|command\.register/.test(line),
          )
          .map((line) => ({ name: s.name, line })),
      );
    expect(new Set(used.map((u) => u.name))).toEqual(new Set(['register.tsx']));
    expect(section).toContain('two programs, both paqad');
    expect(section).toContain('only after you choose **Allow once, recorded**');
    expect(section).toContain(
      '`<plugin>/runtime/claude-plugin/bin/paqad-ai rules override --rule <id>',
    );
    for (const file of ['`<session>.live`', '`<session>.last-block.json`']) {
      expect(section).toContain(file);
    }
    expect(section).toContain('The chime (off unless you set `hud_chime=true`)');
    const vars = [...register.matchAll(/\$\.env\.get\('([A-Z_]+)'\)/g)].map((m) => m[1]!);
    expect(vars.length).toBeGreaterThan(0);
    for (const name of vars) expect(section).toContain(`\`${name}\``);
    expect(section).toContain('**Commands:** `/paqad`, or `/paqad-hud`');
    expect(section).toContain('--outcome landed');
  });

  it('AC-38: the README holds the owner sentences word for word, in order, and names the plugin program', () => {
    const readme = readFileSync(join(MOD_DIR, '../../../README.md'), 'utf8');
    const row = readme.split('\n').find((line) => line.startsWith('| `registry.npmjs.org`'))!;
    const setup =
      'The packages downloaded may run their own setup code on your machine during the install.';
    const transitive =
      'Only these two are fixed: the packages they bring with them are chosen at install time and can still change.';
    const fixed =
      "It installs exact versions (`@huggingface/transformers` and `openai`, at the versions this release was built with) into Claude Code's plugin data folder, with `npm install --save-exact`.";
    expect(row.replace(/\s*\|\s*$/, '').endsWith(`${setup} ${transitive} ${fixed}`)).toBe(true);
    const start = readme.indexOf('### What the HUD does (Claude Code)');
    const section = readme.slice(start, readme.indexOf('\n### ', start + 1));
    const hooks =
      "- **Hooks on your prompt:** the HUD hooks each prompt you send only to restart its clock and redraw. It never reads, stores or sends the prompt's text.";
    expect(section).toContain(hooks);
    expect(section.indexOf('- **Sends:**')).toBeLessThan(section.indexOf(hooks));
    expect(section.indexOf(hooks)).toBeLessThan(section.indexOf('- **Commands:**'));
    expect(section.indexOf('`<plugin>/runtime/claude-plugin/bin/paqad-ai rules override')).toBe(
      section.indexOf(' rules override') - '`<plugin>/runtime/claude-plugin/bin/paqad-ai'.length,
    );
  });

  it('AC-18: the README names the background delivery refresh, when it runs, and that gh contacts GitHub', () => {
    const readme = readFileSync(join(MOD_DIR, '../../../README.md'), 'utf8');
    const start = readme.indexOf('### What the HUD does (Claude Code)');
    const section = readme.slice(start, readme.indexOf('\n### ', start + 1)).replace(/\s+/g, ' ');
    expect(section).toContain(
      '`paqad-ai delivery-link refresh --session <id> --project-root <path> --min-age-seconds <n>`',
    );
    expect(section).toContain("only while an open pull request's CI is pending");
    expect(section).toContain('every 30 seconds, for at most 60 minutes');
    expect(section).toContain('your own `gh` login, which contacts GitHub');
    expect(section).toContain('always on, with no setting');
    expect(section).not.toContain('Sends:** nothing, and it contacts no host');
  });

  it('AC-18: the README names the hooks on your edits word for word, and and no bullet says it reads the permission answer', () => {
    const readme = readFileSync(join(MOD_DIR, '../../../README.md'), 'utf8');
    expect(readme).toContain(
      [
        '- **Its hooks on your edits:**',
        "  - When one of paqad's rules stops an Edit, Write or NotebookEdit, the HUD asks you what should happen. If you allow it once, paqad records the override and runs the same edit again. paqad's own gate then asks Claude Code to show you its permission dialog for that one edit, and you approve it there. The HUD never approves an edit and never changes a permission answer. A deny from your settings rules, from another tool's hook or from a stop your organization enforces still blocks the edit. If anything fails, the edit stays blocked.",
      ].join('\n'),
    );
    expect(readme).not.toContain('**Its permission hooks:**');
    expect(readme).not.toContain("reads Claude Code's permission answer");
  });

  it('keeps every use of $ inside register.tsx, as the plugin directory reads a mod', () => {
    for (const { name, text } of sources) {
      if (name === 'register.tsx' || name.endsWith('.test.ts')) continue;
      expect(text, name).not.toMatch(/\$\.(process|fs|ui|clock|env|store|audio)\./);
    }
  });

  it.each(sources.map((s) => [s.name, s.text]))('%s uses no em dash', (_name, text) => {
    expect(text).not.toContain('—');
  });

  it('AC-32: ci ends with plugin:validate and plugin:test, after the build', () => {
    const scripts = (
      JSON.parse(readFileSync(join(MOD_DIR, '../../../package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(scripts.ci).toMatch(
      /pnpm run build && pnpm run plugin:validate && pnpm run plugin:test$/,
    );
    expect(scripts['plugin:validate']).toBe('node scripts/validate-plugin.mjs');
    expect(scripts['plugin:test']).toBe('node scripts/test-plugin.mjs');
  });

  it('keeps the pure modules free of Claude Code imports, so vitest runs them', () => {
    for (const name of [
      'ask-evidence.ts',
      'band.ts',
      'chime.ts',
      'chips.ts',
      'command-name.ts',
      'commands.ts',
      'config.ts',
      'cost.ts',
      'desktop-view.ts',
      'instruments.ts',
      'model.ts',
      'palette.ts',
      'pane.ts',
      'paqad-cli.ts',
      'receipt.ts',
      'ship.ts',
      'status-entry.ts',
      'shell.ts',
      'strip.ts',
      'table.ts',
      'tabs.ts',
      'visibility.ts',
    ]) {
      const text = sources.find((s) => s.name === name)!.text;
      expect(text, name).not.toContain("from 'claude-code'");
    }
  });
});
