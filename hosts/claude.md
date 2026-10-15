# Host harness: claude.ai

Not shipped in the plugin. This file is a human recording harness for the cross-host unknowns
(U-1..U-17) that apply to claude.ai, plus the manual install steps for this host. A person
installs the real `paqad-product-discovery` plugin, exercises it through the entry skills, runs
the checks, and records each verdict here. No automated host verdict is claimed: every Verdict
below starts as the token `pending` and a person fills it in after installing.

## Manual install

1. Build the distribution: run `python3 build/build.py` and push the generated `dist/` to the
   private distribution repository.
2. One-time, as an org owner (Team or Enterprise): in org settings, add the distribution
   repository and set its availability level. Owners may turn off member self-add and
   distribute centrally.
3. Prerequisite: enable code execution. On Team and Enterprise, enable skills in org settings.
4. As a user without central distribution: open Customize > Plugins, add the marketplace, or
   upload the plugin zip.
5. Add the plugin from the marketplace so its skills load into chat.
6. For grounding, add the target repository to the chat, or pick the `docs/` files into a
   private project.
7. Updates reach users automatically after org sync, which runs on push to the default branch.
8. Exercise it: ask a question with `paqad-ask`, and start from the `/paqad` front door or start
   an idea with `paqad-discover`, to confirm the real skills load and run on this host before
   recording verdicts below. (These are the published `paqad-` names; the source folders are
   `ask-project`, `front-door` and `product-discovery`.)

## Directory submission

The Claude plugin directory takes a "Plugin bundle" from a public GitHub repo. The public repo is
`Eliyce/paqad-product-discovery-plugin`. Its root is the content of `dist/hosts/claude` (the
marketplace, `README.md`, `LICENSE`, `PRIVACY.md`) and the plugin path is
`plugins/paqad-product-discovery`. The listing icon is `.claude-plugin/icon.png` in the plugin folder;
the directory takes it only on the first save or submit, so push it before saving the listing. Steps 1 and 6 are owner steps; do them in this order:

1. Owner: create the public repo `Eliyce/paqad-product-discovery-plugin` on GitHub, with `main` as
   its default branch (the privacy policy link points at `blob/main`, and CI-16 pushes to `main`).
2. Push the built Claude branch to its root. Either set the `ENABLE_PUBLIC_RELEASE` repository
   variable, the `PUBLIC_DISTRIBUTION_REPO` variable (`Eliyce/paqad-product-discovery-plugin`) and
   the `PUBLIC_DISTRIBUTION_TOKEN` secret and run `release.yml` (CI-16), or run
   `python3 build/build.py` and push the contents of `dist/hosts/claude` to the repo root by hand.
3. Validate both levels with the pinned CLI; both must pass with no error and no warning:
   `npx -y @anthropic-ai/claude-code@2.1.300 plugin validate --strict dist/hosts/claude` and
   `npx -y @anthropic-ai/claude-code@2.1.300 plugin validate --strict dist/hosts/claude/plugins/paqad-product-discovery`.
   Older CLIs have no `--strict` and reject the listing fields.
4. Check the links: the homepage and documentation (the repo README), the repository, the support
   link (the repo Issues), the privacy policy (`PRIVACY.md` in the repo) and the nudge information
   page `https://paqad.ai/?src=discovery-plugin` must each open a working page.
5. Check the bundle: no `.DS_Store`, `__pycache__` or `.pyc` file, every file under 256 KiB, and
   fewer than 512 files (the build and `tests/scripts/test_build.py` enforce this).
6. Owner: at claude.ai/directory/manage, submit a Plugin bundle from
   `https://github.com/Eliyce/paqad-product-discovery-plugin` with the plugin path
   `plugins/paqad-product-discovery`.

## Unknowns that apply to claude.ai

Applies here: U-1, U-3, U-5, U-6, U-8, U-9, U-14, U-15, U-16. Shared across more than one host:
U-1, U-3, U-8, U-9, U-14, U-15, U-16.

| Unknown | What to check | How to check on this host | Verdict | Evidence | If it fails |
|---|---|---|---|---|---|
| U-1 (shared) | Do skill scripts run on this host? | Install the plugin and run `get-connected` (step 0); confirm its onboarded-check script report appears. | pending |  | Checklist fallback is the main path; scripts still run in CI. |
| U-3 (shared) | Do Jira issue links work through the connector? | Add the Atlassian connector, create two linked issues, confirm the link holds. | pending |  | Write dependencies as text in a "Depends on" line and ask the user to link by hand. |
| U-5 | How large a `docs/` folder can be added before reading degrades? | Add progressively larger `docs/` folders to a chat or project and note where reading degrades. | pending |  | Ask for only the registry and the candidate modules. |
| U-6 | Does the Atlassian connector work in web, not only desktop? | Try the Atlassian connector in the claude.ai web client and attempt a write. | pending |  | Document desktop as required for posting on this host. |
| U-8 (shared) | Which runtime version do the sandboxes run? | Run a skill script (for example `get-connected`) and read the Python runtime version reported by its environment. | pending |  | Keep 3.9 compatibility; adjust the script-tests check if a host is older. |
| U-9 (shared) | Does the connector `parent` parameter set an epic parent or only a subtask parent? | Create an epic and a child via the connector using `parent`; inspect the result. | pending |  | Use the additional-fields route (PUB-3). |
| U-14 (shared) | Can the connector set the sprint field through the edit action? | Edit an issue through the connector and try to set the sprint custom field. | pending |  | plan-sprint gives the plan as a list to apply by hand (SPR-7). |
| U-15 (shared) | Can sprint IDs, the size field and past sprint totals be found through search and field metadata alone? | Query search and field metadata with no board tools; see what is reachable. | pending |  | Ask the user for the sprint name and capacity; skip derived capacity. |
| U-16 (shared) | Does an edit in the Jira document format keep images and panels intact? | Edit a rich issue description and check whether images and panels survive. | pending |  | Never replace rich descriptions; always append a marked section or comment (EDT-7). |
