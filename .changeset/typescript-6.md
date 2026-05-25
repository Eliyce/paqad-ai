---
'paqad-ai': patch
---

Upgrade TypeScript from 5.9.x to 6.0.x. Adds `ignoreDeprecations: "6.0"` to `tsconfig.json` to silence the `baseUrl`-deprecation warning emitted by `tsup`'s internal dts build pipeline (TS 7.0 will remove `baseUrl` entirely; tsup needs to drop its internal use before then).
