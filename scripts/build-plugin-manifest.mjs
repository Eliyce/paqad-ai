#!/usr/bin/env node
// Generate the Claude Code plugin's shipped artifacts (issue #616), run after tsup in `pnpm build`.
//
// Writes, from the one builder in dist/plugin/manifest-build.js (which reuses the real hook renderer
// and stage-agent template — no second copy):
//   - .claude-plugin/plugin.json          — manifest, version taken from package.json
//   - runtime/claude-plugin/hooks.json     — the plugin hook chain, ${CLAUDE_PLUGIN_ROOT}-rooted
//   - runtime/claude-plugin/agents/*.md    — the six stage agents the plugin ships
// The committed copies are kept in sync by tests/unit/plugin/manifest.test.ts, which regenerates
// from the same builder and asserts a byte match (the AGENT-ROUTER.md golden pattern).

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  renderClaudePluginStageAgents,
  serializePluginHooksJson,
  serializePluginManifest,
} from '../dist/plugin/manifest-build.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function write(relPath, content) {
  const full = join(repoRoot, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
  return relPath;
}

const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;

const written = [];
written.push(write('.claude-plugin/plugin.json', serializePluginManifest(version)));
written.push(write('runtime/claude-plugin/hooks.json', serializePluginHooksJson()));

// Regenerate agents/ from scratch so a renamed/removed stage never leaves a stale file behind.
const agentsDir = join(repoRoot, 'runtime', 'claude-plugin', 'agents');
rmSync(agentsDir, { recursive: true, force: true });
mkdirSync(agentsDir, { recursive: true });
for (const agent of renderClaudePluginStageAgents()) {
  writeFileSync(join(agentsDir, agent.name), agent.content, 'utf8');
  written.push(`runtime/claude-plugin/agents/${agent.name}`);
}

console.log(`[paqad] plugin manifest generated (v${version}):\n  ${written.join('\n  ')}`);
