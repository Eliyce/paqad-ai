---
name: get-connected
description: "Chat and Claude Code: Step 0 of the discover journey: confirms the repository and issue tracker are reachable, finds the evidence level and saves the connection setup. Use when the journey directs it to step 0, not directly."
compatibility: "claude.ai chat, Cowork or Claude Code; reads project docs and code through a connector, uploaded files or the open folder"
---

# get-connected

How to talk: follow `references/voice.md`. Short, answer first, plain business words, no narration,
one short sources line. Those rules win.

Step 0: get connected. Fills the `setup` block.

## When this runs

Directed by the discover journey; not started directly.

## What it does

Work out which sources can be read, the repository first and the tracker second, and record them in
order in `setup.grounding_sources` (`references/ground-from-tracker.md`).

1. Choose and reach the repository by capability (`references/connect-repository.md`), then detect
   its evidence level (`references/evidence-levels.md`) with `scripts/check_onboarded.py`. project-docs (ready): carry on from project docs.
   docs-and-code (partly ready): carry on, say its message once and name the areas without a summary
   as not documented. code-only (not set up, with reachable code): carry on from code by names, as
   what the code suggests. Stop only when nothing is readable. Store the choice in `setup.repository`, its state in `setup.repository_state`,
   and the level in `setup.evidence_level`.
2. With no readable repository, skip `scripts/check_onboarded.py` and check the tracker next. If the
   tracker is readable, set `setup.evidence_level` to `tracker-only` and say once:
   "No repository is connected, so I'll work from the tickets in your tracker. Tickets show what was planned or asked for, not what is built."
   If neither is readable, say this, invent nothing and stop:
   "I can't read a repository or the tracker from here, so there is nothing to ground this on. Attach the repository or its docs folder, or switch on the tracker connector, and I'll carry on."
3. Check the tracker for reading and for writing separately (`references/connect-tracker.md`).
   Readable: one read-only search in the target project answers. Store `setup.tracker_readable`.
   Writable: the connector offers a create action for the target project and the user can create
   issues there (PUB-7). Store the project's issue types, required fields, link types and the size
   and sprint field ids (PUB-1) in `setup`.
4. If the tracker is readable but not writable, do not stop: say once, before grounding starts,
   that the tickets will leave by export, and carry on. If it is neither, stop before drafting. Say
   plainly what is missing (connector off, no write tools, or no create permission) and who
   usually fixes it, and offer the export fallback (PUB-7, PUB-8).
5. Warn once, here, that every created issue carries a run label and run labels accumulate in the
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

With no readable repository, skip the onboarded check: follow `references/ground-from-tracker.md`
for the tracker-only sentence, or the stop sentence when the tracker cannot be read either.

Then do the tracker checks by hand (PUB-1 and PUB-7):

- Try one read-only search in the target project and record whether it answered.
- Confirm a create-issue action exists for the target project and the user can create issues there;
  if not, offer the export fallback, and stop only when the tracker cannot be read either.
- Record the issue types, required fields, link types, and the size and sprint custom field ids
  (from the issue type's full field list) in `setup`.

## Output

The `setup` block: the readable sources in order (`setup.grounding_sources`), the chosen repository
(`setup.repository`), its state (`setup.repository_state`, ready or partly-ready) and its evidence
level (`setup.evidence_level`, project-docs, docs-and-code or code-only, or tracker-only with no
repository), whether the tracker can be read (`setup.tracker_readable`), tracker kind, project key, epic and story types,
issue types, required fields, link types, size and sprint field ids, whether the user can create
issues, and the run label (the run id in lowercase).
