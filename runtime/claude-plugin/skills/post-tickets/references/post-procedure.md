# Posting procedure

The ordered procedure for a build hand-off. It is built from REQUIREMENTS section 9 (PUB-1 to
PUB-8) and ported from the 0.2.0 publication plan. Follow it in order; the order is what keeps a
lost reply from turning into a duplicate.

## 1. Approval

- Show the final set (epics, tickets, links, labels, assignees) and the target project as a
  compact table, with the full text in a preview file.
- Post only after an explicit "post it" or similar. "Looks good" is not approval.
- Bind the approval to the ticket-set digest. Any later edit to the set voids the approval and a
  new preview and approval are required.

## 2. Epics first

- Create each epic. Each carries the shared label `paqad-discovery`, the run label (the run ID in
  lowercase), and its item reference in the Sources section.
- Keep the created key for each epic; a ticket's parent is a result reference to its epic's key.

## 3. Tickets with their parent

- Create each ticket with its created epic as parent. If the connector refuses the parent
  parameter for an epic child, set the parent through the connector's additional fields.
- Confirm the parent on read-back.

## 4. Links

- When the connector exposes a link action, create dependency links only with it, never through an
  issue edit (an edit that sets links has been reported to succeed without creating them).
- Check the link direction against the link type's inward and outward wording.
- When the connector exposes no link action, do not drop the dependencies (U-3). Write each one as a
  "Depends on" text line in the ticket body or a comment, and ask the user to add the links by hand
  in the tracker. The plan marks this case with `links_by_hand` and renders each dependency as a
  "Depends on" text line in place of a link operation, so nothing is lost.

## 5. Read-back

- Read each created issue and compare it with the approved set after normalising title, type,
  parent, labels, links, the Sources item reference, and the body text.
- Report the links and any difference. Report a partial result as partial, never as done. When the
  links were added by hand because the connector had no link action, report that the links may be
  absent rather than as a failure.

## Receipt states (PUB-5)

| State | Meaning | What happens next |
|---|---|---|
| in flight | marked just before a write | wait for the reply |
| created | a reply arrived with the issue key | write the key into the posted block |
| uncertain | the reply was lost or timed out | stop dependent writes; reconcile |
| not applied | the write was never made | nothing was created for this item |

## Lost-reply handling (PUB-5)

1. Mark the item uncertain and stop all dependent writes.
2. Wait at least thirty seconds, then search by the run label and check the item reference.
3. If the issue is found, record it as created. Create no duplicate.
4. If it is not found, ask the user before any retry, and say that the tracker search can lag.
   Never retry an uncertain create without that answer, and never delete a created issue to roll
   back.

## Export fallback (PUB-8)

The approved set can always be downloaded as Markdown and as CSV for the tracker importer, with
columns Work type, Work item id, Summary, Description, Labels and Parent, and every epic row before
its story rows. Offer this when the connector has no create action, has no write tools, or the user
has no create permission in the project. Tell the user that importing needs create-work-item
permission in the project and the make-bulk-changes global permission.
