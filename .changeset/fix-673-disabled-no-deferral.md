---
'paqad-ai': patch
---

Fixed a disabled project writing a "completion deferred" row when a turn ended while a paqad stage agent was still running in the background. A disabled project now writes only its one disabled-session audit row, as it does on every other turn.
