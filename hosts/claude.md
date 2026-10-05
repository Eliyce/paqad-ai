# Host harness: claude.ai

Not shipped in the plugin. This file is a human recording harness for the S0 unknowns that
apply to claude.ai, plus the manual install steps for this host. A person installs the plugin,
runs the checks, and records each verdict here. S0 claims no automated host verdict: every
Verdict below starts as the token `pending` and a person fills it in after installing.

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

## Unknowns that apply to claude.ai

Applies here: U-1, U-3, U-5, U-6, U-8, U-9, U-14, U-15, U-16. Shared across more than one host:
U-1, U-3, U-8, U-9, U-14, U-15, U-16.

| Unknown | What to check | How to check on this host | Verdict | Evidence | If it fails |
|---|---|---|---|---|---|
| U-1 (shared) | Do skill scripts run on this host? | Install the plugin and run the discover-probe skill; confirm its script report appears. | pending |  | Checklist fallback is the main path; scripts still run in CI. |
| U-3 (shared) | Do Jira issue links work through the connector? | Add the Atlassian connector, create two linked issues, confirm the link holds. | pending |  | Write dependencies as text in a "Depends on" line and ask the user to link by hand. |
| U-5 | How large a `docs/` folder can be added before reading degrades? | Add progressively larger `docs/` folders to a chat or project and note where reading degrades. | pending |  | Ask for only the registry and the candidate modules. |
| U-6 | Does the Atlassian connector work in web, not only desktop? | Try the Atlassian connector in the claude.ai web client and attempt a write. | pending |  | Document desktop as required for posting on this host. |
| U-8 (shared) | Which runtime version do the sandboxes run? | Read the runtime version line in the discover-probe report. | pending |  | Keep 3.9 compatibility; adjust the script-tests check if a host is older. |
| U-9 (shared) | Does the connector `parent` parameter set an epic parent or only a subtask parent? | Create an epic and a child via the connector using `parent`; inspect the result. | pending |  | Use the additional-fields route (PUB-3). |
| U-14 (shared) | Can the connector set the sprint field through the edit action? | Edit an issue through the connector and try to set the sprint custom field. | pending |  | plan-sprint gives the plan as a list to apply by hand (SPR-7). |
| U-15 (shared) | Can sprint IDs, the size field and past sprint totals be found through search and field metadata alone? | Query search and field metadata with no board tools; see what is reachable. | pending |  | Ask the user for the sprint name and capacity; skip derived capacity. |
| U-16 (shared) | Does an edit in the Jira document format keep images and panels intact? | Edit a rich issue description and check whether images and panels survive. | pending |  | Never replace rich descriptions; always append a marked section or comment (EDT-7). |
