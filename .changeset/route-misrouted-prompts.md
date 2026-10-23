---
'paqad-ai': patch
---

The prompt router now sends more everyday phrasings to the right workflow. "run a security review" goes to pentest, "audit the UI against the design system" to design-test, "map the app's surfaces, navigation and journeys" to site-map, "analyze which of our rules can become scripts" to rules-analyze, and a rough idea you want help shaping goes to discovery instead of being read as a question. A request that names a source file and says what to change in it, such as a refactor or "make X fall back to Y", is now treated as a code change.
