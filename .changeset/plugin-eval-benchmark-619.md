---
'paqad-ai': patch
---

Add a repeatable benchmark for the paqad plugin, built on `claude plugin eval`. Three suites run inside real Claude Code sessions, each case once with paqad and once without, against a small fixture project: routing (did the request reach the right workflow), firewall (was a rule-breaking edit stopped, while allowed edits still land) and receipt (did the final message carry an honest verdict). A weekly and on-demand GitHub workflow runs them and fails when the routing or firewall score with paqad drops below 0.9. Nothing in the installed package changes; the suites live in `evals/` and are not published.
