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

1. Confirm the documents are reachable and onboarded. Run `scripts/check_onboarded.py`. It passes
   only when both `docs/instructions/registries/modules.md` and at least one
   `docs/modules/<module>/index/summary.md` exist. If it fails, stop with its exact message: "This
   repository isn't set up for this yet. Ask your engineering team to onboard it with paqad, then
   come back." For how to make the documents readable by capability, follow
   `references/connect-repository.md`.
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

## If the checks cannot run

When `check_onboarded.py` cannot run on this host, do the onboarded check by hand:

- Confirm `docs/instructions/registries/modules.md` exists.
- Confirm at least one `docs/modules/<module>/index/summary.md` exists.
- If either is missing, stop with the exact onboarding message above.

Then do the tracker checks by hand (PUB-1 and PUB-7):

- Confirm the connector exposes a create-issue action for the target project and that the user can
  create issues there. If not, stop and offer the export fallback.
- Read the project's issue types, required fields and link types, and find the size and sprint
  custom field ids from the issue type's full field list. Record them in `setup`.

## Output

The `setup` block: tracker kind, project key, epic and story types, issue types, required fields,
link types, size and sprint field ids, whether the user can create issues, and the run label (the
run id in lowercase).
