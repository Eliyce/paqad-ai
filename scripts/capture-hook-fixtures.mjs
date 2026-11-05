#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const AGENT_TYPE = 'paqad-planning';
const REPORT = 'Captured for the paqad hook fixtures.\nStatus: DONE';
const LOGGER = `import { appendFileSync } from 'node:fs';
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const parsed = JSON.parse(input);
  appendFileSync(new URL('./hook-log.jsonl', import.meta.url), JSON.stringify(parsed) + '\\n');
  if (parsed.hook_event_name === 'SubagentStart' && process.env.PROBE_START_CHARS) {
    const size = Number(process.env.PROBE_START_CHARS);
    const body = 'x'.repeat(Math.max(0, size - 12)) + ' TAIL-CANARY';
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: body },
    }));
  }
});
`;

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function makeProject(startChars) {
  const root = mkdtempSync(join(process.env.PROBE_TMP ?? tmpdir(), 'paqad-hook-capture-'));
  mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(root, 'log-hook.mjs'), LOGGER);
  const hook = (matcher) => ({
    ...(matcher ? { matcher } : {}),
    hooks: [{ type: 'command', command: `node "${join(root, 'log-hook.mjs')}"` }],
  });
  writeFileSync(
    join(root, '.claude', 'settings.json'),
    JSON.stringify({
      hooks: {
        SessionStart: [hook()],
        PreToolUse: [hook('SubagentHandback|Agent|Task|Skill')],
        SubagentStart: [hook(AGENT_TYPE)],
        SubagentStop: [hook(AGENT_TYPE)],
      },
      env: startChars ? { PROBE_START_CHARS: String(startChars) } : {},
    }),
  );
  mkdirSync(join(root, '.claude', 'skills', 'capture-probe'), { recursive: true });
  writeFileSync(
    join(root, '.claude', 'skills', 'capture-probe', 'SKILL.md'),
    '---\nname: capture-probe\ndescription: Hook capture probe. Use when asked to run the capture probe.\n---\nSay done.\n',
  );
  writeFileSync(
    join(root, '.claude', 'agents', `${AGENT_TYPE}.md`),
    [
      '---',
      `name: ${AGENT_TYPE}`,
      'description: Hook capture probe. Use when asked to run the capture.',
      'tools: Read, Bash',
      'maxTurns: 5',
      '---',
      'You run one short capture, then return your report as the brief or the task asks.',
    ].join('\n'),
  );
  return root;
}

function runClaude(root, mode, prompt) {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  const result = spawnSync(
    'claude',
    [
      '-p',
      prompt,
      '--permission-mode',
      mode,
      '--setting-sources',
      'project',
      '--max-turns',
      '6',
      '--allowedTools',
      'Bash(node emit.mjs)',
    ],
    { cwd: root, env, encoding: 'utf8', timeout: 240_000 },
  );
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function readLog(root) {
  const file = join(root, 'hook-log.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readAgentTranscript(entry) {
  try {
    return readFileSync(entry.agent_transcript_path, 'utf8');
  } catch {
    return '';
  }
}

function scrub(payload, root) {
  const text = JSON.stringify(payload, null, 2)
    .split(root.replace(/^\/private/, ''))
    .join('/capture/project')
    .split(root)
    .join('/capture/project')
    .split(homedir())
    .join('/capture/home')
    .replace(
      /\/capture\/home\/\.claude\/projects\/[^/"]+/gu,
      '/capture/home/.claude/projects/capture-project',
    )
    .replaceAll('"/private/capture/project', '"/capture/project');
  return `${text}\n`;
}

const DISPATCH = `Dispatch the ${AGENT_TYPE} agent once. Tell it: make no tool calls except what is needed to return, and return exactly this report:\n${REPORT}`;

function capture(outDir) {
  const version = spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout.trim();
  const auto = makeProject();
  const autoRun = runClaude(auto, 'auto', DISPATCH);
  const autoLog = readLog(auto);
  const handback = autoLog.find((e) => e.tool_name === 'SubagentHandback');
  const autoStop = autoLog.find((e) => e.hook_event_name === 'SubagentStop');
  const sessionStart = autoLog.find((e) => e.hook_event_name === 'SessionStart');
  const subagentStart = autoLog.find((e) => e.hook_event_name === 'SubagentStart');
  const agentCall = autoLog.find((e) => e.tool_name === 'Agent' || e.tool_name === 'Task');
  const plain = makeProject();
  const plainRun = runClaude(plain, 'default', DISPATCH);
  const plainStop = readLog(plain).find((e) => e.hook_event_name === 'SubagentStop');
  const skilled = makeProject();
  runClaude(
    skilled,
    'auto',
    'Use the capture-probe skill once with the Skill tool, then say done.',
  );
  const skillCall = readLog(skilled).find((e) => e.tool_name === 'Skill');
  const missing = [
    !handback && `auto mode gave no SubagentHandback: ${autoRun.stderr.slice(0, 300)}`,
    !autoStop && 'auto mode gave no SubagentStop',
    !sessionStart && 'auto mode gave no SessionStart',
    !subagentStart && 'auto mode gave no SubagentStart',
    !agentCall && 'auto mode gave no PreToolUse for the agent call',
    !skillCall && 'auto mode gave no PreToolUse for the skill call',
    !plainStop && `default mode gave no SubagentStop: ${plainRun.stderr.slice(0, 300)}`,
  ].filter(Boolean);
  if (missing.length > 0) {
    console.error(missing.join('\n'));
    process.exitCode = 1;
    return;
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'subagent-handback.json'), scrub(handback, auto));
  writeFileSync(join(outDir, 'subagent-stop.json'), scrub(autoStop, auto));
  writeFileSync(join(outDir, 'subagent-stop-text.json'), scrub(plainStop, plain));
  writeFileSync(join(outDir, 'session-start.json'), scrub(sessionStart, auto));
  writeFileSync(join(outDir, 'subagent-start.json'), scrub(subagentStart, auto));
  writeFileSync(join(outDir, 'pre-tool-agent.json'), scrub(agentCall, auto));
  writeFileSync(join(outDir, 'pre-tool-skill.json'), scrub(skillCall, skilled));
  console.log(
    JSON.stringify({
      host: version,
      fixtures: {
        'subagent-handback.json': { permission_mode: handback.permission_mode },
        'subagent-stop.json': {
          permission_mode: autoStop.permission_mode,
          last_assistant_message: typeof autoStop.last_assistant_message,
        },
        'subagent-stop-text.json': {
          permission_mode: plainStop.permission_mode,
          last_assistant_message: typeof plainStop.last_assistant_message,
        },
      },
    }),
  );
  rmSync(auto, { recursive: true, force: true });
  rmSync(plain, { recursive: true, force: true });
  rmSync(skilled, { recursive: true, force: true });
}

function probeStart(size) {
  const root = makeProject(size);
  runClaude(
    root,
    'default',
    `Dispatch the ${AGENT_TYPE} agent once. Tell it: reply with CANARY-SEEN if the literal text TAIL-CANARY is in your context, else CANARY-MISSING, then Status: DONE.`,
  );
  const stop = readLog(root).find((e) => e.hook_event_name === 'SubagentStop');
  const seen = stop?.last_assistant_message ?? readAgentTranscript(stop ?? {});
  const arrived = /CANARY-SEEN/u.test(String(seen));
  rmSync(root, { recursive: true, force: true });
  return { event: 'SubagentStart', chars: size, tail_arrived: arrived };
}

function probeBash(size) {
  const root = makeProject();
  writeFileSync(
    join(root, 'emit.mjs'),
    `process.stdout.write('y'.repeat(${size - 12}) + ' TAIL-CANARY');`,
  );
  runClaude(
    root,
    'default',
    `Dispatch the ${AGENT_TYPE} agent once. Tell it: run the Bash command \`node emit.mjs\` once and do not read any other file. Reply with CANARY-SEEN if the result you were shown contains TAIL-CANARY directly, or CANARY-PREVIEW if it was replaced by a preview and a saved file path, then Status: DONE.`,
  );
  const stop = readLog(root).find((e) => e.hook_event_name === 'SubagentStop');
  const text = readAgentTranscript(stop ?? {});
  const replaced = /persisted-output|saved to|Output too large/iu.test(text);
  const reply = String(stop?.last_assistant_message ?? '');
  rmSync(root, { recursive: true, force: true });
  return { event: 'Bash', chars: size, replaced_by_preview: replaced, reply: reply.slice(0, 120) };
}

const outDir = argValue('--out');
if (process.argv.includes('--probe')) {
  const sizes = (argValue('--start-sizes') ?? '9700,10001').split(',').map(Number);
  const bashSizes = (argValue('--bash-sizes') ?? '29000,31000,40000').split(',').map(Number);
  for (const size of sizes) console.log(JSON.stringify(probeStart(size)));
  for (const size of bashSizes) console.log(JSON.stringify(probeBash(size)));
} else if (outDir) {
  capture(resolve(outDir));
} else {
  console.error('usage: capture-hook-fixtures.mjs --out <dir> | --probe');
  process.exitCode = 1;
}
