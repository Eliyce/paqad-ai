---
'paqad-ai': minor
---

feat: quality ratchet — record four quality measures at today's real level and only ever allow equal-or-better (#110)

Captures tangledness, dead/unused code, risky patterns, and strictness into
`.paqad/quality-baseline.json` (per module + project), then a verification gate
refuses any change that worsens a measure — the recorded level only tightens.
Dead code is consumed from #109's reachability output (one solver, two uses);
the baseline starts from reality so day one is no clean-up; a legitimate
regression opens a reused-by-kind `quality.ratchet_exception` Decision Pause.
The fast lane isn't blocked by measure noise but still cannot loosen the
baseline.
