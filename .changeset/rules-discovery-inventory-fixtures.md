---
'paqad-ai': patch
---

Rules discovery's inventory no longer reads package manifests inside test-fixture folders (`fixtures`, `__fixtures__`, `fixture`, `testdata`), so a fixture project's packages are no longer researched as your own. When a lockfile holds one package at several versions, the inventory now reports the one matching your declared range instead of whichever came last.
