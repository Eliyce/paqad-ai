# Plain language deny-list (TKT-3)

Each line below is a jargon term and the plain business replacement to use instead. The prose
checker (check_prose.py) reads this file: any line that holds `term -> replacement` is one
deny-list entry. The match is on whole words and is case-insensitive; a term ending in `*`
matches every word that starts with it. Keep this list
provider-neutral and ASCII only.

## Deny-list

- leverag* -> use
- utiliz* -> use
- utilis* -> use
- synergy -> shared benefit
- synergies -> shared benefits
- facilitate -> help
- streamline -> simplify
- optimize -> improve
- optimise -> improve
- robust -> dependable
- scalable -> able to grow
- seamless -> smooth
- frictionless -> smooth
- holistic -> complete
- bandwidth -> time
- actionable -> clear next step
- deliverable -> result
- ideate -> come up with ideas
- paradigm -> approach
- ecosystem -> set of connected parts
- idempotent -> safe to repeat
- endpoint -> connection point
- payload -> the data sent
- migrate -> move
- migration -> move
- auth -> sign-in
- authentication -> sign-in
- authorization -> permission
- authorisation -> permission
- crud -> create, read, update and delete
- backend -> the system behind the scenes
- frontend -> the screen the user sees
- cache -> stored copy
- throughput -> amount handled over time
- latency -> delay
- provision -> set up
- deprecate -> retire
- instantiate -> create
- refactor -> tidy up the code
- middleware -> connecting software
