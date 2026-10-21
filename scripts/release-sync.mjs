#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PACKAGE_NAME = 'paqad-ai';
export const PLUGIN_REMOTE = 'https://github.com/Eliyce/paqad-claude-plugin.git';

const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;

function exec(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function mustExec(command, args) {
  const result = exec(command, args);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (exit ${result.status}): ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

function sleep(seconds) {
  if (seconds > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}

export function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

export function releaseRef() {
  return process.env.GITHUB_SHA || 'HEAD';
}

export function packageVersion(ref = releaseRef()) {
  const version = JSON.parse(mustExec('git', ['show', `${ref}:package.json`])).version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`package.json at ${ref} has no version`);
  }
  return version;
}

export function versionCommits(ref = releaseRef()) {
  const shas = mustExec('git', ['log', '--format=%H', ref, '--', 'package.json']).split('\n');
  const firstCommit = new Map();
  for (const sha of shas.filter(Boolean)) {
    const version = exec('git', ['show', `${sha}:package.json`]);
    if (version.status !== 0) continue;
    const parsed = JSON.parse(version.stdout).version;
    if (typeof parsed === 'string' && RELEASE_VERSION.test(parsed)) firstCommit.set(parsed, sha);
  }
  return firstCommit;
}

export function tagNames(remote) {
  const out = mustExec('git', ['ls-remote', '--tags', '--refs', remote, 'v*']);
  return new Set(
    out
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('refs/tags/')[1]),
  );
}

export function remoteHasTag(remote, tag) {
  const result = exec('git', ['ls-remote', '--exit-code', '--tags', remote, `refs/tags/${tag}`]);
  if (result.status === 0) return true;
  if (result.status === 2) return false;
  throw new Error(`Could not read tags from ${remote} (exit ${result.status}): ${result.stderr}`);
}

export function npmHasVersion(version) {
  const result = exec('npm', ['view', `${PACKAGE_NAME}@${version}`, 'version']);
  if (result.status === 0) return result.stdout.split('\n').includes(version);
  if (/E404/.test(result.stderr)) return false;
  throw new Error(`npm view ${PACKAGE_NAME}@${version} failed: ${result.stderr}`);
}

export function npmVersions() {
  return new Set(JSON.parse(mustExec('npm', ['view', PACKAGE_NAME, 'versions', '--json'])));
}

export function npmLatest() {
  const latest = mustExec('npm', ['view', PACKAGE_NAME, 'dist-tags.latest']);
  if (!RELEASE_VERSION.test(latest))
    throw new Error(`npm returned no latest version for ${PACKAGE_NAME}`);
  return latest;
}

export function changelogSection(ref, version) {
  const changelog = exec('git', ['show', `${ref}:CHANGELOG.md`]);
  if (changelog.status !== 0) return '';
  const lines = changelog.stdout.split('\n');
  const start = lines.indexOf(`## ${version}`);
  if (start === -1) return '';
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
}

function writeOutputs(outputs) {
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  for (const line of lines) console.log(line);
}

export function releaseState({ waitSeconds = 10, attempts = 6 } = {}) {
  const version = packageVersion();
  const sha = versionCommits().get(version);
  if (!sha) throw new Error(`No commit in history sets package.json to ${version}`);
  let published = npmHasVersion(version);
  for (let attempt = 1; !published && attempt < attempts; attempt++) {
    sleep(waitSeconds);
    published = npmHasVersion(version);
  }
  const pluginTagged = remoteHasTag(PLUGIN_REMOTE, `v${version}`);
  return { version, sha, published, pluginTagged, pluginNeeded: published && !pluginTagged };
}

export function syncTags({ remote = 'origin' } = {}) {
  const current = packageVersion();
  const onNpm = npmVersions();
  const tags = tagNames(remote);
  const newestTag = [...tags]
    .map((tag) => tag.slice(1))
    .filter((version) => RELEASE_VERSION.test(version))
    .sort(compareVersions)
    .at(-1);
  const releases = new Set(
    JSON.parse(mustExec('gh', ['release', 'list', '--limit', '1000', '--json', 'tagName'])).map(
      (release) => release.tagName,
    ),
  );
  const pending = [...versionCommits()]
    .filter(([version]) => onNpm.has(version))
    .filter(([version]) => !newestTag || compareVersions(version, newestTag) >= 0)
    .sort(([a], [b]) => compareVersions(a, b));
  const actions = [];
  for (const [version, sha] of pending) {
    const tag = `v${version}`;
    if (!tags.has(tag)) {
      mustExec('git', ['push', remote, `${sha}:refs/tags/${tag}`]);
      actions.push(`tagged ${tag} at ${sha}`);
    }
    if (!releases.has(tag)) {
      const notes = changelogSection(sha, version);
      mustExec('gh', [
        'release',
        'create',
        tag,
        '--verify-tag',
        '--title',
        tag,
        `--latest=${version === current}`,
        ...(notes ? ['--notes', notes] : ['--generate-notes']),
      ]);
      actions.push(`released ${tag}`);
    }
  }
  return actions;
}

export function pluginLag() {
  const latest = npmLatest();
  const newest = [...tagNames(PLUGIN_REMOTE)]
    .map((tag) => tag.slice(1))
    .filter((version) => RELEASE_VERSION.test(version))
    .sort(compareVersions)
    .at(-1);
  return { latest, newest: newest ?? null, behind: !newest || compareVersions(latest, newest) > 0 };
}

function isDirectRun() {
  return (
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  );
}

function main(command) {
  if (command === 'state') {
    const state = releaseState({
      waitSeconds: Number(process.env.RELEASE_SYNC_NPM_WAIT_SECONDS ?? 10),
    });
    console.log(
      `${PACKAGE_NAME}@${state.version} (release commit ${state.sha}): ` +
        `${state.published ? 'on npm' : 'not on npm'}, ` +
        `plugin tag v${state.version} ${state.pluginTagged ? 'exists' : 'missing'}.`,
    );
    writeOutputs({ version: state.version, sha: state.sha, plugin_needed: state.pluginNeeded });
    return 0;
  }
  if (command === 'tags') {
    const actions = syncTags();
    console.log(
      actions.length > 0
        ? actions.join('\n')
        : 'Every published version has its tag and GitHub Release.',
    );
    return 0;
  }
  if (command === 'check') {
    const lag = pluginLag();
    if (lag.behind) {
      console.log(
        `::error::The Claude Code plugin is behind npm: npm latest is ${lag.latest}, ` +
          `the newest tag in Eliyce/paqad-claude-plugin is ${lag.newest ?? 'none'}. ` +
          'Run the Release workflow on main to publish it.',
      );
      return 1;
    }
    console.log(`The plugin is at ${lag.newest}, matching npm latest ${lag.latest}.`);
    return 0;
  }
  console.error('Usage: node scripts/release-sync.mjs <state|tags|check>');
  return 1;
}

if (isDirectRun()) {
  try {
    process.exit(main(process.argv[2]));
  } catch (error) {
    console.log(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
