# Check documents and tracker are ready: API

This feature has no network or HTTP API. It sets up the tracker connection and checks the
project is paqad-onboarded, but every tracker read and write goes through the host's own
connector; the plugin ships no integration code of its own (D-4, PLG-2).

Its one script, `scripts/check_onboarded.py`, is the shared onboarded check
(`shared/scripts/check_onboarded.py`, owned by project-grounding and copied into this skill at
build time). Its full contract, with the three states, the JSON output and the exit codes, is in
[Get the project documents: API](../../../project-grounding/features/get-the-documents/api.md).

At step 0 this feature uses it as follows:

| Exit | State | What step 0 does |
|---|---|---|
| 0 | `ready` | Carries on and stores `setup.repository_state` as `ready` |
| 0 | `partly-ready` | Carries on, says the message once, names the unknown areas as not documented, stores `partly-ready` |
| 1 | `not-set-up` | Stops with the exact message, offers any repository marked ready or partly ready, drafts nothing |
