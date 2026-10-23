---
'paqad-ai': patch
---

The HUD's rule stop no longer approves an edit itself. When you choose "Allow once, recorded", paqad still records your override with `paqad-ai rules override`, and then hands the edit to Claude Code's own permission step, which shows its dialog or follows your permission mode. The HUD now keeps every use of the mod API inside its one hooks file, which clears the two blocking findings from Anthropic's plugin directory. The README says what the HUD reads, writes, runs and sends.
