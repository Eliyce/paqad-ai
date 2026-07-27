# Modeling judgment

Modeling is where the map earns its meaning. A scanner can prove a route exists; only judgment
can say it is the checkout screen, that it is an entry point, and that it belongs to the payments
module. That judgment must stay tied to evidence.

## Slugs and titles

- The slug is a stable, semantic identifier derived from the surface's evidence and purpose, not
  a restatement of the file path and not an invention. `checkout-review`, not `page-42`.
- The title is what a human would call the surface. Keep it identical to the language the product
  and code already use, so the map and the app agree.

## Kinds

- Pick the kind from the closed vocabulary: `page | screen | modal | action | api | cli-command |
job | external-system | router | terminal | …`. The kind shapes how the surface renders in the
  overview, so a wrong kind is a wrong map.
- When a surface could be two kinds, choose the one its evidence supports and note the ambiguity
  rather than silently picking.

## Entries, exits, and modules

- An entry point is a surface a user can reach from outside the app (a deep link, a landing route,
  a CLI command). Mark it only when evidence shows it is reachable from outside.
- Attribute each surface to the module that owns its code, joined through the module map. A
  surface with no module is a gap to note, not a blank to leave.

## Accounting discipline

- Every extracted surface must be accounted for: modeled, or excluded with a stated reason. A
  surface that silently disappears between extraction and the map is a defect the accounting lint
  is designed to catch.
- Do not model a surface the extractor never produced. The map never contains a surface the code
  cannot prove.
