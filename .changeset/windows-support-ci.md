---
'paqad-ai': patch
---

Full Windows support. Fixed every Windows-only failure tracked in #43-#53 plus the follow-ups it surfaced: path outputs are now forward-slash everywhere (RAG file discovery, evidence retrieval, planning doc targets, pentest reports and retests, rule scripts, delivery policy, module-map snapshots, pack manifests), custom workflow execution artifacts no longer use characters that are illegal in Windows filenames, and onboarding re-runs stay byte-identical on Windows. The windows-latest leg now runs as a full CI gate.
