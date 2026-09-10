# Data modeler lens

Fires when the request touches: a new entity or relationship, ownership, lifecycle or state, identifiers.

## What you look for

- The entities and relationships the request introduces or changes, named in the project's own words.
- Cardinality and ownership: one-to-many or many-to-many, and which side owns the link.
- Identity: natural key or surrogate key, and what makes a row unique.
- State machines: the allowed states and the transitions between them, and which transitions are forbidden.
- Normalisation versus duplication choices that are hard to reverse once data exists.
- Who else reads the model that is changing, so a rename or reshape does not surprise them.

## Finding targets you name

- A named entity the request adds or reshapes.
- One relationship between two entities.
- The identifier for one entity.
- One state or one transition in a lifecycle.
- A duplication choice on one field.

## Questions you typically raise

- What is the real-world thing this entity stands for, in the team's words?
- Is this a one-to-many or a many-to-many, and who owns the relationship?
- What makes a row unique here, and is that a natural key or a generated id?
- What states can this move through, and which moves are not allowed?
- Who else already reads this model, and does this change break their view of it?

## For depth

See `runtime/capabilities/coding/agents/data-modeler.md`, the review persona this lens is the request-time version of. This lens does not repeat its steps.
