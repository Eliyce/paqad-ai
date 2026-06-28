// Resilient changelog adapter for Changesets.
//
// `changeset version` enriches the CHANGELOG by querying GitHub's GraphQL API
// (`@changesets/changelog-github` → `@changesets/get-github-info`). That call is a
// network dependency on the release critical path, and a transient GitHub blip
// (e.g. "Invalid response body … Premature close") makes the whole release job
// fail with no version bump — exactly what happened on the F1–F27 release.
//
// This adapter keeps the rich GitHub changelog when the API is healthy, but on ANY
// error from it falls back to a git-style release line built from the changeset
// summary alone (no network), so `changeset version` can never hard-fail on an API
// flake. The fallback mirrors `@changesets/changelog-git`'s shape without adding a
// dependency.
//
// Wired via `.changeset/config.json` → `"changelog": ["./.changeset/changelog-resilient.cjs", { "repo": "Eliyce/paqad-ai" }]`.

// Mutable reference so a test can substitute a throwing/passthrough implementation
// without real network access (see tests/unit/release/changelog-resilient.test.ts).
let githubChangelog = require('@changesets/changelog-github').default;

/** Test seam: swap the GitHub changelog implementation. Not used in production. */
function _setGithubChangelogForTests(impl) {
  githubChangelog = impl;
}

/** Git-style release line from the changeset summary alone — no network. */
function fallbackReleaseLine(changeset) {
  const [firstLine, ...rest] = changeset.summary.split('\n').map((line) => line.trimEnd());
  const detail = rest.length > 0 ? `\n${rest.map((line) => `  ${line}`).join('\n')}` : '';
  return `\n\n- ${firstLine}${detail}`;
}

/** Git-style dependency release line — no network. */
function fallbackDependencyReleaseLine(_changesets, dependenciesUpdated) {
  if (dependenciesUpdated.length === 0) {
    return '';
  }
  const updates = dependenciesUpdated
    .map((dependency) => `  - ${dependency.name}@${dependency.newVersion}`)
    .join('\n');
  return `\n\n- Updated dependencies:\n${updates}`;
}

async function getReleaseLine(changeset, type, changelogOpts) {
  try {
    return await githubChangelog.getReleaseLine(changeset, type, changelogOpts);
  } catch {
    // A GitHub API flake must never fail `changeset version`.
    return fallbackReleaseLine(changeset);
  }
}

async function getDependencyReleaseLine(changesets, dependenciesUpdated, changelogOpts) {
  try {
    return await githubChangelog.getDependencyReleaseLine(
      changesets,
      dependenciesUpdated,
      changelogOpts,
    );
  } catch {
    return fallbackDependencyReleaseLine(changesets, dependenciesUpdated);
  }
}

module.exports = {
  getReleaseLine,
  getDependencyReleaseLine,
  // Exposed for tests only.
  _setGithubChangelogForTests,
  fallbackReleaseLine,
  fallbackDependencyReleaseLine,
};
