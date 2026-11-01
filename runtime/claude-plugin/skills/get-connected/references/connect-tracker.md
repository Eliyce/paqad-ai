# Connecting the tracker

Confirm the tracker can be written to, and read the project's setup, by capability (PLG-7). Resolve
each action from what the connector exposes; do not hard-code a tool name. This skill handles no
credentials and no connector authorization: those stay with the user or their admin.

## Confirm write access first (PUB-7)

Check that the connector offers a create-issue action for the target project and that the user can
create issues there. If any of these is true, stop before drafting is wasted, say which in plain
words, name who usually fixes it, and offer the export fallback (PUB-8):

- the connector is not switched on
- the connector exposes read tools but no write tools
- the user has no permission to create issues in that project

Do not assert a specific admin scope. The export fallback is always available: the approved set can
be downloaded as a tracker-importer file, which needs the project's create and bulk-change
permissions to import.

## Read the project setup (PUB-1)

Read these through the connector and store them in the `setup` block:

- issue types for the project, and which is the epic type and which is the story type
- required fields per issue type
- link types (the actions that list them differ by connector version)
- the size field id (story points or similar) and the sprint field id: these are custom fields
  whose ids differ per site, found from the issue type's full field list

## Actions, not tool names (PUB-1)

Tracker profiles name actions; the right tool for each action is found at runtime from the
connector. For example, link creation is exposed under different names in different connector
versions, so pick whichever the connector offers. The Jira action names are in
`tracker-profiles-jira.md`.

## Warn about run labels once (PUB-4)

Every created issue will carry the shared discovery label and a run label (the run id in lowercase).
Run labels accumulate in the site's label list over time. Tell the user this once, here at step 0.
