---
'paqad-ai': patch
---

The plugin ships a smaller package manifest and no type files, and its search engines install at exact versions.

- The plugin's `package.json` is now generated with only the keys it needs, and the tree no longer carries `.d.ts` files from its build.
- The optional search engines install at the exact versions the release was built with, from a script you can read at `runtime/scripts/install-engine.mjs`. Provider API keys are not passed to npm, and failures land in the install log.
- That install now works on Windows: it starts npm through Node, with no shell.
- Assembled scripts no longer hold a raw 0x7F byte.
- Allow once now works without a global `paqad-ai`, because it starts the plugin's own program. If that program is missing, nothing is recorded and the edit stays blocked.
- The README says what the HUD does with your prompt, and what the engine install runs and leaves unfixed.
