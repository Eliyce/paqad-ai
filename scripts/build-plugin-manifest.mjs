#!/usr/bin/env node

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

const agentsDir = join(repoRoot, 'runtime', 'claude-plugin', 'agents');
rmSync(agentsDir, { recursive: true, force: true });
mkdirSync(agentsDir, { recursive: true });
for (const agent of renderClaudePluginStageAgents()) {
  writeFileSync(join(agentsDir, agent.name), agent.content, 'utf8');
  written.push(`runtime/claude-plugin/agents/${agent.name}`);
}

console.log(`[paqad] plugin manifest generated (v${version}):\n  ${written.join('\n  ')}`);
