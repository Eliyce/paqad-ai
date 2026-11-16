---
'paqad-ai': patch
---

The dashboard's build tool moves to Vite 6.4.6, which escapes module ids in its virtual-module resolver. This affects only the dev server used to build the dashboard, not what ships.
