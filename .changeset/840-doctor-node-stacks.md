---
'paqad-ai': patch
---

`paqad-ai doctor` no longer fails the detection report and manifest checks on `node-cli`, `node-library` and `node-service` projects. When one of those checks does fail, it now names the field and value, such as `detected_stack: not-a-stack isn't an allowed value`.
