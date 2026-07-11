# Documentation

What to write down when you document an area, and how to keep it true. These always load. Whether docs win over code is in `canonical-docs.md`; the same-change update obligation is in the constitution.

<!-- trigger: ** -->

- Validate the real stack from its manifests (`package.json`, `composer.json`, lockfiles) before you describe it, and fix a stale stack claim first. <!-- @rule RL-4a10 -->
- Document a feature's spec, flows, API contract, integrations, and error cases together, in one place, so they cannot drift apart. <!-- @rule RL-8813 -->
- Keep glossary and domain terms identical to the names the code uses. <!-- @rule RL-6e53 -->
