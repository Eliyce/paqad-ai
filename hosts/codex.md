# Host harness: Codex

Not shipped in the plugin. This file is a human recording harness for the S0 unknowns that
apply to Codex, plus the manual install steps for this host. A person installs the plugin, runs
the checks, and records each verdict here. S0 claims no automated host verdict: every Verdict
below starts as the token `pending` and a person fills it in after installing.

## Manual install

1. Build the distribution: run `python3 build/build.py` and push the generated `dist/` to the
   distribution repository.
2. Prerequisite: Codex installed and signed in.
3. Each user (or their admin) adds the distribution repo as a local marketplace in Codex, read
   through `.agents/plugins/marketplace.json`; or installs from the shared plugin directory.
4. Codex works inside a local checkout, so it reads `docs/` from disk. The plugin only reads
   the repository; it never edits it.
5. For posting, the user adds an Atlassian connection to Codex.
6. Updates reach users per install source; local marketplaces update when re-synced.

## Unknowns that apply to Codex

Applies here: U-1, U-3, U-8, U-9, U-11, U-12, U-13, U-14, U-15, U-16. Shared across more than
one host: U-1, U-3, U-8, U-9, U-11, U-14, U-15, U-16.

| Unknown | What to check | How to check on this host | Verdict | Evidence | If it fails |
|---|---|---|---|---|---|
| U-1 (shared) | Do skill scripts run on this host? | Install the plugin and run the discover-probe skill; confirm its script report appears (scripts run locally, subject to approval settings). | pending |  | Checklist fallback is the main path where scripts cannot run; scripts still run in CI. |
| U-3 (shared) | Do Jira issue links work through the connector? | Add the Atlassian connection, create two linked issues, confirm the link holds. | pending |  | Write dependencies as text in a "Depends on" line and ask the user to link by hand. |
| U-8 (shared) | Which runtime version do the sandboxes run? | Read the runtime version line in the discover-probe report. | pending |  | Keep 3.9 compatibility; adjust the script-tests check if a host is older. |
| U-9 (shared) | Does the connector `parent` parameter set an epic parent or only a subtask parent? | Create an epic and a child via the connector using `parent`; inspect the result. | pending |  | Use the additional-fields route (PUB-3). |
| U-11 (shared) | Do plugins imported into a workspace also reach Codex for that workspace's users? | As a workspace user, check whether a workspace-imported plugin appears in Codex. | pending |  | Codex users add the distribution repo as a marketplace themselves. |
| U-12 | Does Codex accept our manifests (root `plugin.json`, `.claude-plugin/plugin.json`, and `.agents/plugins/marketplace.json`) from one distribution repo? | Add the distribution repo as a marketplace and confirm the plugin installs and its skills load. | pending |  | Emit a Codex-specific distribution branch (PLG-12). |
| U-13 | Can a user connect Atlassian with write tools without our package declaring an MCP server? | Connect Atlassian in Codex and attempt a write without any MCP server declared in the package. | pending |  | Codex posting falls back to export (PUB-8); document how to connect in this file. |
| U-14 (shared) | Can the connector set the sprint field through the edit action? | Edit an issue through the connector and try to set the sprint custom field. | pending |  | plan-sprint gives the plan as a list to apply by hand (SPR-7). |
| U-15 (shared) | Can sprint IDs, the size field and past sprint totals be found through search and field metadata alone? | Query search and field metadata with no board tools; see what is reachable. | pending |  | Ask the user for the sprint name and capacity; skip derived capacity. |
| U-16 (shared) | Does an edit in the Jira document format keep images and panels intact? | Edit a rich issue description and check whether images and panels survive. | pending |  | Never replace rich descriptions; always append a marked section or comment (EDT-7). |
