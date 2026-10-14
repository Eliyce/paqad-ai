---
name: get-connected
description: Step 0 of the product-discovery journey. Runs when the product-discovery journey directs it; not started directly. It confirms the project documents are reachable and onboarded, confirms the tracker can be written to, and reads the tracker project's setup (issue types, required fields, link types, the size and sprint field ids) into the record. If the documents are missing or not onboarded, or the tracker cannot be written to, it stops and says plainly what is needed before any drafting is wasted.
---

# get-connected

How to talk: before replying, follow `references/voice.md`. Short by default, lead with the answer,
plain business words, no narration, one short sources line at the end. Those rules win over
everything else here.

This skill is step 0: get connected. It fills the `setup` block.

## When this runs

Runs when the product-discovery journey directs it; not started directly.

## What it does

1. Choose the repository and confirm it is onboarded. Choose and reach it by capability as in
   `references/connect-repository.md`, then run `scripts/check_onboarded.py` on it. Ready: carry on.
   Partly ready: carry on, say its message once and name the areas without a summary as unknown.
   Not set up: stop with its exact message, "This repository isn't set up for this yet. Ask your
   engineering team to onboard it with paqad, then come back.", then offer any repositories marked
   ready or partly ready, and draft nothing. Store the choice in `setup.repository` and its state in
   `setup.repository_state`.
2. Confirm the tracker can be written to and read its setup. Follow `references/connect-tracker.md`:
   check the connector offers a create action for the target project and that the user can create
   issues there (PUB-7). Read the project's issue types, required fields, link types, and the size
   and sprint field ids (PUB-1), and store them in the `setup` block.
3. If the tracker cannot be written to, stop before drafting. Say plainly what is missing (connector
   not switched on, connector without write tools, or no create permission in that project) and who
   usually fixes it, and offer the export fallback (PUB-7, PUB-8).
4. Warn once that every created issue carries a run label and that run labels accumulate in the
   site's label list (PUB-4). Say this once, here.

The tracker action names differ by connector version, so resolve each action from what the
connector exposes rather than hard-coding a tool name. The Jira specifics are in
`references/tracker-profiles-jira.md`.

When the tracker is GitHub, follow `references/tracker-profiles-github.md` instead: GitHub Issues is
export only, because the host GitHub connectors are read only. Record the tracker kind as GitHub,
note it is export only, and route the hand off to the export fallback (PUB-7, PUB-8) rather than
checking for a create action.

## If the checks cannot run

When `check_onboarded.py` cannot run on this host, do the onboarded check by hand:

- List the `docs/modules` folders and read each one's `index/summary.md`. Treat an empty or
  whitespace-only summary as missing.
- Look for `docs/instructions/registries/modules.md`, the modules list; empty counts as missing.
- Ready: the modules list plus at least one summary. Partly ready: a summary but no modules list;
  carry on as above and say the exact sentence in `references/connect-repository.md` once.
  Not set up: no summary; stop with the exact onboarding message above.

Then do the tracker checks by hand (PUB-1 and PUB-7):

- Confirm the connector exposes a create-issue action for the target project and that the user can
  create issues there. If not, stop and offer the export fallback.
- Read the project's issue types, required fields and link types, and find the size and sprint
  custom field ids from the issue type's full field list. Record them in `setup`.

## Output

The `setup` block: the chosen repository (`setup.repository`) and its state
(`setup.repository_state`, ready or partly-ready), tracker kind, project key, epic and story types,
issue types, required fields, link types, size and sprint field ids, whether the user can create
issues, and the run label (the run id in lowercase).
