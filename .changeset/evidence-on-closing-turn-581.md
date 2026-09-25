---
'paqad-ai': patch
---

The turn a change passes now writes its evidence before closing it (#581 follow-up). Before, the change was closed first, so `evidence.jsonl`, the receipt, the AI-BOM, change metrics and `decisions.json` were never written on that turn, and the completeness gate never ran. A change the completeness gate fails now stays open so the next turn checks it again. The isolated-stage count also includes stages recorded before an upgrade, and the test suite no longer writes into the developer's home folder.
