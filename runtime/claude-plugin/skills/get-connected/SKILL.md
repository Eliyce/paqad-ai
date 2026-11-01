---
name: get-connected
description: "Chat and Claude Code: Step 0 of the discover journey. Runs when the discover journey directs it; not started directly. It confirms the project is reachable and detects its evidence level (from project docs, from docs and code, or from code only), confirms the tracker can be written to, and reads the tracker project's setup (issue types, required fields, link types, the size and sprint field ids) into the record. If nothing is readable at all, or the tracker cannot be written to, it stops and says plainly what is needed before any drafting is wasted."
compatibility: "claude.ai chat, Cowork or Claude Code; reads project docs and code through a connector, uploaded files or the open folder"
---

# get-connected

How to talk: follow `references/voice.md`. Short, answer first, plain business words, no narration,
one short sources line. Those rules win.

Step 0: get connected. Fills the `setup` block.

## When this runs

Directed by the discover journey; not started directly.

## What it does

1. Choose and reach the repository by capability (`references/connect-repository.md`), then detect
   its evidence level (`references/evidence-levels.md`) with `scripts/check_onboarded.py`. project-docs (ready): carry on from project docs.
   docs-and-code (partly ready): carry on, say its message once and name the areas without a summary
   as not documented. code-only (not set up, with reachable code): carry on from code by names, as
   what the code suggests. Stop only when nothing is readable. Store the choice in `setup.repository`, its state in `setup.repository_state`,
   and the level in `setup.evidence_level`.
2. Confirm the tracker is writable (`references/connect-tracker.md`): the connector offers a create
   action for the target project and the user can create issues there (PUB-7). Store the project's
   issue types, required fields, link types and the size and sprint field ids (PUB-1) in `setup`.
3. If the tracker is not writable, stop before drafting. Say plainly what is missing (connector off,
   no write tools, or no create permission) and who usually fixes it, and offer the export fallback
   (PUB-7, PUB-8).
4. Warn once, here, that every created issue carries a run label and run labels accumulate in the
   site's label list (PUB-4).

Action names differ by connector version: resolve each from what the connector exposes, never a
hard-coded tool name. Jira specifics: `references/tracker-profiles-jira.md`.

GitHub follows `references/tracker-profiles-github.md`: GitHub Issues is export only (host GitHub
connectors are read only). Record the kind as GitHub, export only, and route the hand off to the
export fallback (PUB-7, PUB-8) without checking for a create action.

## If the checks cannot run

Do the onboarded check by hand:

- List the `docs/modules` folders and read each one's `index/summary.md`. Treat an empty or
  whitespace-only summary as missing.
- Look for `docs/instructions/registries/modules.md`, the modules list; empty counts as missing.
- project-docs (ready): the modules list plus at least one summary. docs-and-code (partly ready): a
  summary but no modules list; carry on as above and say the exact sentence in
  `references/connect-repository.md` once. code-only (not set up): no summary; carry on from code by
  names as what the code suggests, never stopping a readable-code repository. Record the level in
  `setup.evidence_level`.

Then do the tracker checks by hand (PUB-1 and PUB-7):

- Confirm a create-issue action exists for the target project and the user can create issues there;
  if not, stop and offer the export fallback.
- Record the issue types, required fields, link types, and the size and sprint custom field ids
  (from the issue type's full field list) in `setup`.

## Output

The `setup` block: the chosen repository (`setup.repository`), its state
(`setup.repository_state`, ready or partly-ready) and its evidence level (`setup.evidence_level`,
project-docs, docs-and-code or code-only), tracker kind, project key, epic and story types,
issue types, required fields, link types, size and sprint field ids, whether the user can create
issues, and the run label (the run id in lowercase).
