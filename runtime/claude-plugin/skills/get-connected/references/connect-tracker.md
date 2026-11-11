# Connecting the tracker

verified: 2026-11-02

Confirm whether the tracker can be read and whether it can be written to, as two separate checks,
and read the project's setup, by capability (PLG-7). Resolve
each action from what the connector exposes; do not hard-code a tool name. This skill handles no
credentials and no connector authorization: those stay with the user or their admin.

## Check read access for grounding

Run one read-only search in the target project. If it answers, the tracker is readable: store
`setup.tracker_readable` as true and add the tracker to `setup.grounding_sources`. If the read is
refused or the connector is off, store false and try no other route. Never create, edit or delete
an issue to test access. A tracker that answers the read but refuses the write still grounds the
idea; say once, before grounding starts, that the tickets will leave by export.

## Confirm write access (PUB-7)

Check that the connector offers a create-issue action for the target project and that the user can
create issues there. If any of these is true, say which in plain words, name who usually fixes it,
and offer the export fallback (PUB-8). Stop before drafting is wasted only when the tracker cannot
be read as well:

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
