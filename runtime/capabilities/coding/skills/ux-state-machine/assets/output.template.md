## State Inventory

- **{{state-name}}** — {{visible UI condition}} — {{entered when ...}}
- **idle / loading / success / empty / error / disabled / stale** ...

## Transitions

| From        | Trigger                                                      | To          | Notes                                      |
| ----------- | ------------------------------------------------------------ | ----------- | ------------------------------------------ |
| {{state-a}} | {{user click / async resolve / timeout / permission denied}} | {{state-b}} | {{retry semantics; permission constraint}} |

## Gaps

- {{state, transition, or trigger not yet documentable from evidence}}

<!-- "Gaps: none" allowed in place of bullets. -->
