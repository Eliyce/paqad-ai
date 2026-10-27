---
'paqad-ai': patch
---

The background RAG refresh now runs only when it can help. Task notifications, stage-agent hand-backs and `Stop hook feedback:` prompts no longer start one; a human prompt starts at most one every 2 minutes. Only one `rag refresh-context` runs at a time: it holds `.paqad/locks/refresh-context.lock` for its whole run, renews it while it runs and releases it when it ends or crashes. The refresh runs at low priority, syncs the index once instead of twice, and a CLI command loads the local embedding model once instead of once per retrieval. Each refresh start adds one line to `.paqad/logs/hooks.log`.
