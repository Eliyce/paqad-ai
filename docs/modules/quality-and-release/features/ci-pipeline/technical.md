# CI and release workflows: technical

## Module Boundaries

| Path | Owned content |
|---|---|
| `.github/workflows/ci.yml` | Jobs `pr-checks` and `coverage` |
| `.github/workflows/verify.yml` | Job `evals` (CI-12 structural half, CI-13) |
| `.github/workflows/release.yml` | Job `release` (CI-14, CI-15, CI-16) |
| `tests/ci/` | `check_forbidden.py` (CI-3), `check_secrets.py` (CI-6), `check_budget.py` (CI-10), `check_host_verdicts.py` (CI-19), `check_scenarios.py` (CI-13) |
| `build/bump_version.py` | CI-14 version bump of the one `version` scalar in `build/skills.yml` |
| `build/package_chatgpt.py`, `build/check_chatgpt_submission.py` | CI-16 ChatGPT directory submission zip and its pre-submission check (owned by plugin-build, assemble-dist) |
| `.changeset/README.md` | Changeset folder notes |

## Data Contracts

None. Workflow YAML only.

## Script Interfaces

`ci.yml`, job `pr-checks` (`ubuntu-latest`, `actions/checkout@v4`, `actions/setup-python@v5` with Python `3.9`):

| Step | Command |
|---|---|
| Build dist once | `python build/build.py --dist dist` |
| CI-16 ChatGPT submission zip is deterministic and passes the pre-submission check | `python build/package_chatgpt.py --dist dist --out /tmp/chatgpt-a.zip`, the same with `/tmp/chatgpt-b.zip`, `cmp /tmp/chatgpt-a.zip /tmp/chatgpt-b.zip`, then `python build/check_chatgpt_submission.py --zip /tmp/chatgpt-a.zip` |
| CI-1 CI-2 CI-4 CI-5 CI-11 CI-20 authoring and script unit tests | `python -m unittest discover -s tests/scripts -p "test_*.py" -v` |
| CI-3 | `python tests/ci/check_forbidden.py --dist dist` |
| CI-6 | `python tests/ci/check_secrets.py` |
| CI-10 | `python tests/ci/check_budget.py --dist dist` |
| CI-19 | `python tests/ci/check_host_verdicts.py` |
| CI-8 | `python build/build.py --dist /tmp/dist-a`, `python build/build.py --dist /tmp/dist-b`, `diff -r /tmp/dist-a /tmp/dist-b` |
| CI-9 Claude (if `ENABLE_PLUGIN_VALIDATORS`) | `actions/setup-node@v4` (Node 20), then `npx -y @anthropic-ai/claude-code@2.1.300 plugin validate --strict dist/hosts/claude` and `... --strict dist/hosts/claude/plugins/paqad-product-discovery` |
| CI-9 skills-ref (if `ENABLE_PLUGIN_VALIDATORS`) | Placeholder install, then `skills-ref validate dist` |

`ci.yml`, job `coverage` (matrix Python `3.9` and `3.12`): installs `coverage==7.6.1`, runs the unittest discover under `coverage run --branch --source=build,shared/scripts,skills,tests/ci`, then `coverage report --fail-under=90` (CI-7). The two ChatGPT zip scripts are inside `build`, so they count toward the bar; tests for them and for the older scripts keep it at or above 90 percent.

`verify.yml`, job `evals`: build once, `python tests/evals/run_parity.py --dist dist` (CI-12 structural), `python tests/ci/check_scenarios.py` (CI-13).

`release.yml`, job `release`:

| Step | Guard | What it does |
|---|---|---|
| CI-14 install changesets | none | Named placeholder |
| CI-14 bump and rebuild | none | `python build/bump_version.py --dist dist`; the version is then read through `build.load_config` |
| CI-15 tag, release zip | `ENABLE_RELEASE` | Tags `vX.Y.Z`, `gh release create` with a zip of `dist/` |
| CI-15 private push | `ENABLE_RELEASE` and `DISTRIBUTION_REPO` | Copies `dist/` into the private distribution repo |
| CI-16 build and check the ChatGPT directory submission zip | `ENABLE_PUBLIC_RELEASE` | `python build/package_chatgpt.py --dist dist --out paqad-product-discovery-chatgpt-vX.Y.Z.zip`, then `python build/check_chatgpt_submission.py --zip` on that file; any error fails the release. The zip holds only the plugin root of `dist/hosts/chatgpt-directory` (a zip of the whole `dist/` was rejected shape, `plugin_root_ambiguous`) |
| CI-16 upload the ChatGPT directory submission zip artifact | `ENABLE_PUBLIC_RELEASE` | `actions/upload-artifact@v4`, artifact `chatgpt-directory-submission-zip`, for the manual upload (`hosts/chatgpt.md`, Directory submission) |
| CI-16 public push | `ENABLE_PUBLIC_RELEASE` and `PUBLIC_DISTRIBUTION_REPO` | Clones the public repo with `PUBLIC_DISTRIBUTION_TOKEN`, deletes every top-level entry except `.git`, `cp -R dist/hosts/claude/. public-distribution/`, `git checkout -B main`, `git add -A`, commits `public release vX.Y.Z` only when the index changed, tags `vX.Y.Z` only when the tag is new, pushes `HEAD:main` and the tag |

The public repo is `Eliyce/paqad-product-discovery-plugin`; its root is the Claude branch (marketplace, `README.md`, `LICENSE`, `PRIVACY.md`, `plugins/paqad-product-discovery`). Submission to both directories stays manual (`hosts/claude.md` and `hosts/chatgpt.md`, Directory submission). The ChatGPT check covers only OpenAI's documented rules: it is necessary, not sufficient.

Exit: a step fails the job on a non-zero exit.

## State Management

None: stateless. CI-8 and the CI-16 pull request step write to `/tmp` on the runner; release steps write the ChatGPT zip in the workspace and otherwise only to the cloned repos.

## Error Codes

None of its own. Failures surface as `unittest` output, `build failed: <message>`, `diff` or `cmp` output, the check scripts' findings (for the ChatGPT check, a JSON report whose `errors` name the rule, the path and the fix), or validator errors and warnings.

## Dependencies

| Kind | Detail |
|---|---|
| Other modules | plugin-build (`build/build.py`, `build/skills.yml`, `build/package_chatgpt.py`, `build/check_chatgpt_submission.py`, `publish/claude/`, `publish/chatgpt/`); unit-tests (`tests/scripts/`) |
| Pinned tools | `actions/checkout@v4`, `actions/setup-python@v5`, `actions/setup-node@v4` (Node 20), `actions/upload-artifact@v4`, `coverage==7.6.1`, `@anthropic-ai/claude-code@2.1.300` (older CLIs have no `--strict` and reject the listing fields) |
| Not pinned yet | `skills-ref` install and the changeset tool (named placeholders) |

## Configuration

| Item | Value |
|---|---|
| `ci.yml` triggers | `pull_request`, `workflow_dispatch` |
| `verify.yml` triggers | `schedule` cron `0 3 * * *`, `workflow_dispatch` |
| `release.yml` triggers | `workflow_dispatch` |
| Python | `3.9` (coverage also `3.12`) |
| Version | `3.2.0` from `build/skills.yml` |
| Switches | `ENABLE_PLUGIN_VALIDATORS`, `ENABLE_RELEASE`, `DISTRIBUTION_REPO`, `ENABLE_PUBLIC_RELEASE`, `PUBLIC_DISTRIBUTION_REPO`; secrets `DISTRIBUTION_TOKEN`, `PUBLIC_DISTRIBUTION_TOKEN` |

## Testing Entry Points

The workflows are themselves the entry points. The check scripts are unit-tested by `tests/scripts/test_ci_checks.py`, `build/bump_version.py` by `tests/scripts/test_bump_version.py`, and the ChatGPT zip scripts by `tests/scripts/test_chatgpt_submission.py`. Local equivalents are in `docs/instructions/registries/commands.md`.
