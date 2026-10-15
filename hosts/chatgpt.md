# Host harness: ChatGPT web

Not shipped in the plugin. This file is a human recording harness for the cross-host unknowns
(U-1..U-17) that apply to ChatGPT web, plus the manual install steps for this host. A person
installs the real `paqad-product-discovery` plugin, exercises it through the entry skills, runs
the checks, and records each verdict here. No automated host verdict is claimed: every Verdict
below starts as the token `pending` and a person fills it in after installing.

## Manual install

1. Build the distribution: run `python3 build/build.py` and push the generated `dist/` to the
   distribution repository.
2. Requires a Business, Enterprise, Healthcare or Edu workspace. An admin imports the
   marketplace repository into the workspace.
3. Prerequisite: an admin enables workspace skills and plugins.
4. The workspace picks up the distribution repo on daily sync, or an admin uses "Sync now" per
   release. An invalid update keeps the last working version.
5. For grounding, use the GitHub app (read-only, fetches on demand) where it is available, or
   ask the user to upload the `docs/` folder.
6. Note: Plus and Pro users can install plugins but not workspace skills. The v1 audience is
   workspace plans.
7. Exercise it: ask a question with `paqad-ask`, and start from the `/paqad` front door or start
   an idea with `paqad-discover`, to confirm the real skills load and run on this host before
   recording verdicts below. (These are the published `paqad-` names; the source folders are
   `ask-project`, `front-door` and `product-discovery`.)

## Unknowns that apply to ChatGPT web

Applies here: U-1, U-2, U-3, U-4, U-7, U-8, U-9, U-10, U-11, U-14, U-15, U-16, U-17. Shared
across more than one host: U-1, U-3, U-8, U-9, U-11, U-14, U-15, U-16.

| Unknown | What to check | How to check on this host | Verdict | Evidence | If it fails |
|---|---|---|---|---|---|
| U-1 (shared) | Do skill scripts run on this host? | Install the plugin and run `get-connected` (step 0); confirm its onboarded-check script report appears, since script execution in chat is undocumented and work runs in cloud containers. | pending |  | Checklist fallback is the main path here; scripts still run in CI. |
| U-2 | Does workspace import accept our `.claude-plugin` skills-only layout? | Import the marketplace repo and confirm the plugin installs and its skills load. | pending |  | Add `.agents/plugins/marketplace.json` from the same source. |
| U-3 (shared) | Do Jira issue links work through the connector? | Add the Atlassian app, create two linked issues, confirm the link holds. | pending |  | Write dependencies as text in a "Depends on" line and ask the user to link by hand. |
| U-4 | Can Plus or Pro users use a skills plugin? | Sign in on a Plus or Pro plan and attempt to install and run the plugin. | pending |  | The v1 audience is workspace plans; say so in the listing. |
| U-7 | Which Atlassian app is current, given the listing is labelled "Legacy"? | Check the available Atlassian apps and identify which is current versus legacy. | pending |  | Update this file and the connect reference. |
| U-8 (shared) | Which runtime version do the sandboxes run? | Run a skill script (for example `get-connected`) and read the Python runtime version reported by its environment. | pending |  | Keep 3.9 compatibility; adjust the script-tests check if a host is older. |
| U-9 (shared) | Does the connector `parent` parameter set an epic parent or only a subtask parent? | Create an epic and a child via the connector using `parent`; inspect the result. | pending |  | Use the additional-fields route (PUB-3). |
| U-10 | Is the GitHub app available in standard chat on the target workspace plans? | On each target plan, try to use the GitHub app in standard chat. | pending |  | Ask the user to upload `docs/` instead. |
| U-11 (shared) | Do plugins imported into a workspace also reach Codex for that workspace's users? | After workspace import, check whether the same users see the plugin in Codex. | pending |  | Codex users add the distribution repo as a marketplace themselves. |
| U-14 (shared) | Can the connector set the sprint field through the edit action? | Edit an issue through the connector and try to set the sprint custom field. | pending |  | plan-sprint gives the plan as a list to apply by hand (SPR-7). |
| U-15 (shared) | Can sprint IDs, the size field and past sprint totals be found through search and field metadata alone? | Query search and field metadata with no board tools; see what is reachable. | pending |  | Ask the user for the sprint name and capacity; skip derived capacity. |
| U-16 (shared) | Does an edit in the Jira document format keep images and panels intact? | Edit a rich issue description and check whether images and panels survive. | pending |  | Never replace rich descriptions; always append a marked section or comment (EDT-7). |
| U-17 | Does the Atlassian app expose edit and comment actions as well as create? | Inspect the Atlassian app's available actions for edit and comment, not only create. | pending |  | Refine and sprint changes on this host fall back to a list to apply by hand. |
