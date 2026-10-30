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
  const result = exec('npm', ['view', `${PACKAGE_NAME}@${version}`, 'version', '--prefer-online']);
  if (result.status === 0) return result.stdout.split('\n').includes(version);
  if (/E404/.test(result.stderr)) return false;
  throw new Error(`npm view ${PACKAGE_NAME}@${version} failed: ${result.stderr}`);
}

export function npmVersions() {
  return new Set(
    JSON.parse(mustExec('npm', ['view', PACKAGE_NAME, 'versions', '--json', '--prefer-online'])),
  );
}

export function npmLatest() {
  const latest = mustExec('npm', ['view', PACKAGE_NAME, 'dist-tags.latest', '--prefer-online']);
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

export const REQUIRED_CHECKS = [
  'Node 22 / ubuntu-latest',
  'Node 24 / ubuntu-latest',
  'Node 22 / macos-latest',
  'Node 22 / windows-latest',
];

const CI_WORKFLOW = '.github/workflows/ci.yml';
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function repository() {
  return process.env.GITHUB_REPOSITORY || 'Eliyce/paqad-ai';
}

function ghPages(path, jq) {
  return mustExec('gh', ['api', '--paginate', path, '--jq', `${jq} | @json`])
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function objectId(value, what) {
  if (typeof value !== 'string' || !OBJECT_ID.test(value)) {
    throw new Error(`${what} is not a git object id: ${String(value)}`);
  }
  return value;
}

function judgeCheck(name, runs) {
  const attempts = runs.filter((run) => run.name === name).sort((a, b) => b.id - a.id);
  const earlierFailures = attempts
    .slice(1)
    .filter((run) => run.status === 'completed' && run.conclusion !== 'success');
  const newest = attempts[0];
  if (!newest) return { name, ok: false, result: 'missing', url: null, earlierFailures };
  const result = newest.status === 'completed' ? newest.conclusion : newest.status;
  return { name, ok: result === 'success', result, url: newest.html_url, earlierFailures };
}

export function greenTreeProof(ref) {
  const repo = repository();
  const commit = objectId(mustExec('git', ['rev-parse', `${ref}^{commit}`]), `${ref}`);
  const tree = objectId(mustExec('git', ['rev-parse', `${commit}^{tree}`]), `tree of ${commit}`);
  const proof = { ok: false, commit, tree, pr: null, head: null, checks: [], reason: '' };
  const fail = (reason) => ({ ...proof, reason });
  const base = exec('git', ['rev-parse', '--verify', '--quiet', `${commit}^1`]);
  if (base.status !== 0) return fail(`${commit} has no parent, so no pull request merged it`);
  const pulls = ghPages(
    `repos/${repo}/commits/${commit}/pulls?per_page=100`,
    `map(select(.merged_at != null and .merge_commit_sha == "${commit}") | {number, url: .html_url, head: .head.sha})`,
  ).flat();
  if (pulls.length !== 1) {
    return fail(
      pulls.length === 0
        ? `no merged pull request has ${commit} as its merge commit`
        : `${pulls.length} merged pull requests have ${commit} as their merge commit`,
    );
  }
  proof.pr = pulls[0];
  proof.head = objectId(proof.pr.head, `head of pull request ${proof.pr.number}`);
  const head = proof.head;
  const headTree = ghPages(`repos/${repo}/git/commits/${head}`, '.tree.sha')[0];
  if (headTree !== tree) {
    return fail(
      `tree mismatch: pull request ${proof.pr.number} head ${head} has tree ${headTree}, ${commit} has tree ${tree}`,
    );
  }
  const behind = ghPages(`repos/${repo}/compare/${base.stdout}...${head}`, '.behind_by')[0];
  if (behind !== 0) {
    return fail(
      `pull request ${proof.pr.number} head ${head} does not contain the base ${base.stdout} it merged into`,
    );
  }
  const suites = new Set(
    ghPages(
      `repos/${repo}/actions/runs?head_sha=${head}&per_page=100`,
      `.workflow_runs | map(select(.path == "${CI_WORKFLOW}") | .check_suite_id)`,
    ).flat(),
  );
  const runs = ghPages(
    `repos/${repo}/commits/${head}/check-runs?filter=all&per_page=100`,
    '.check_runs | map({id, name, status, conclusion, html_url, app: .app.slug, suite: .check_suite.id})',
  )
    .flat()
    .filter((run) => run.app === 'github-actions' && suites.has(run.suite));
  proof.checks = REQUIRED_CHECKS.map((name) => judgeCheck(name, runs));
  const red = proof.checks.find((check) => !check.ok);
  if (red) return fail(`required check "${red.name}" is ${red.result} on ${head}`);
  return { ...proof, ok: true };
}

function printProof(proof) {
  if (proof.pr) {
    console.log(
      `Pull request ${proof.pr.number} (${proof.pr.url}), head ${proof.head}, tree ${proof.tree}.`,
    );
  }
  for (const check of proof.checks) {
    console.log(`  ${check.name}: ${check.result}${check.url ? ` ${check.url}` : ''}`);
    for (const earlier of check.earlierFailures) {
      console.log(
        `  earlier attempt of ${check.name} was ${earlier.conclusion}: ${earlier.html_url}`,
      );
    }
  }
}

export function ciGreen() {
  const ref = releaseRef();
  let proof;
  try {
    proof = greenTreeProof(ref);
  } catch (error) {
    console.log(
      `::error::Nothing is published: the CI lookup for ${ref} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
  printProof(proof);
  if (!proof.ok) {
    console.log(
      `::error::Nothing is published: CI is not proven green on ${proof.commit}: ${proof.reason}. ` +
        'Re-run the Release workflow once the required checks are green.',
    );
    return 1;
  }
  if (process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_ENV, `PAQAD_RELEASE_VERIFIED_TREE=${proof.tree}\n`);
  }
  console.log(`CI is green on tree ${proof.tree}; publishing may skip the repeat suite run.`);
  return 0;
}

export function prepublishDecision(env = process.env) {
  if (env.GITHUB_ACTIONS !== 'true')
    return { skip: false, reason: 'not running in GitHub Actions' };
  const verified = env.PAQAD_RELEASE_VERIFIED_TREE ?? '';
  if (!OBJECT_ID.test(verified)) {
    return { skip: false, reason: 'no verified green tree in PAQAD_RELEASE_VERIFIED_TREE' };
  }
  const head = exec('git', ['rev-parse', 'HEAD^{tree}']);
  if (head.status !== 0) {
    return { skip: false, reason: `git rev-parse HEAD^{tree} failed: ${head.stderr}` };
  }
  if (head.stdout !== verified) {
    return { skip: false, reason: `HEAD tree ${head.stdout} is not the verified tree ${verified}` };
  }
  return { skip: true, reason: `HEAD tree ${verified} is the tree CI proved green` };
}

export function prepublish() {
  const decision = prepublishDecision();
  if (decision.skip) {
    console.log(`Not running pnpm run ci again: ${decision.reason}.`);
    return 0;
  }
  console.log(`Running pnpm run ci before publishing: ${decision.reason}.`);
  const result = spawnSync('pnpm', ['run', 'ci'], { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

export function npmAttempts(value) {
  const attempts = Number(value);
  return Number.isInteger(attempts) && attempts > 0 ? attempts : 90;
}

export function waitForNpm(version, { waitSeconds = 10, attempts = 90 } = {}) {
  let published = npmHasVersion(version);
  if (!published && attempts > 1) {
    const spec = `${PACKAGE_NAME}@${version}`;
    const minutes = Math.round(((attempts - 1) * waitSeconds) / 60);
    console.log(`Waiting for npm to list ${spec} (up to ${minutes} min)...`);
    let waited = 0;
    for (let attempt = 1; !published && attempt < attempts; attempt++) {
      sleep(waitSeconds);
      waited += waitSeconds;
      published = npmHasVersion(version);
    }
    console.log(
      published
        ? `npm lists ${spec} after ${waited} s.`
        : `npm still does not list ${spec} after ${minutes} min.`,
    );
  }
  return published;
}

export function hasReleaseTag(version, commits) {
  const tagged = exec('git', [
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/tags/v${version}^{commit}`,
  ]);
  return tagged.status === 0 && commits.includes(tagged.stdout);
}

export function releaseState(poll = {}) {
  const version = packageVersion();
  const sha = versionCommits().get(version);
  if (!sha) throw new Error(`No commit in history sets package.json to ${version}`);
  const ref = mustExec('git', ['rev-parse', `${releaseRef()}^{commit}`]);
  const tagged = hasReleaseTag(version, [ref, sha]);
  if (tagged) console.log(`Release tag v${version} is on the release commit, so npm has it.`);
  const published = tagged || waitForNpm(version, poll);
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

function npmPoll() {
  return {
    waitSeconds: Number(process.env.RELEASE_SYNC_NPM_WAIT_SECONDS ?? 10),
    attempts: npmAttempts(process.env.RELEASE_SYNC_NPM_ATTEMPTS),
  };
}

function main(command) {
  if (command === 'state') {
    const state = releaseState(npmPoll());
    console.log(
      `${PACKAGE_NAME}@${state.version} (release commit ${state.sha}): ` +
        `${state.published ? 'on npm' : 'not on npm'}, ` +
        `plugin tag v${state.version} ${state.pluginTagged ? 'exists' : 'missing'}.`,
    );
    writeOutputs({ version: state.version, sha: state.sha, plugin_needed: state.pluginNeeded });
    return 0;
  }
  if (command === 'ci-green') return ciGreen();
  if (command === 'prepublish') return prepublish();
  if (command === 'tags') {
    const version = packageVersion();
    if (!waitForNpm(version, npmPoll())) {
      console.log(
        `::error::npm does not list ${PACKAGE_NAME}@${version}, so its tag and GitHub Release wait for the next run.`,
      );
      return 1;
    }
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
  console.error('Usage: node scripts/release-sync.mjs <state|tags|check|ci-green|prepublish>');
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
