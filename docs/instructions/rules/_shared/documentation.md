# Documentation

- Keep `docs/` consistent with the code: update the affected module, flow, API, and error docs in the same change that alters behavior. <!-- @rule RL-e6b1 -->
- Validate the real stack from manifests (`package.json`, `composer.json`, and equivalents) before documenting it; fix stale stack assumptions first. <!-- @rule RL-0b31 -->
- Document specs, flows, API contracts, integrations, and error cases together so they don't drift apart. <!-- @rule RL-5fb6 -->
- Keep glossary and domain terms consistent with the language used in the code. <!-- @rule RL-e10c -->
