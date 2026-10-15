# Check documents and tracker are ready: API

This feature has no network or HTTP API. It sets up the tracker connection and detects the
repository's evidence level, but every tracker read and write goes through the host's own
connector; the plugin ships no integration code of its own (D-4, PLG-2).

Its one script, `scripts/check_onboarded.py`, is the shared readiness check
(`shared/scripts/check_onboarded.py`, owned by project-grounding and copied into this skill at
build time). The script is byte-identical (GM-8); the instructions read its three states as the
three evidence levels (`references/evidence-levels.md`, GRD-12). Its full contract, with the three
states, the JSON output and the exit codes, is in
[Get the project documents: API](../../../project-grounding/features/get-the-documents/api.md).

At step 0 this feature uses it as follows:

| Exit | State | Level | What step 0 does |
|---|---|---|---|
| 0 | `ready` | project-docs | Carries on and stores `setup.repository_state` `ready` and `setup.evidence_level` `project-docs` |
| 0 | `partly-ready` | docs-and-code | Carries on, says the message once, names the unknown areas as not documented, stores `partly-ready` and `docs-and-code` |
| 1 | `not-set-up` | code-only | Carries on from the code by names with the "paqad, from code only" source line, stores `setup.evidence_level` `code-only`; the exact message appears only as the optional at-most-once nudge, never as a stop |
