---
'paqad-ai': minor
---

Security reviews and design reviews now show their progress in the HUD. Each review has eight stages, and the band, the terminal card and `paqad-ai status` show which stage it is in, how it ended, and a Resume button when it stopped. A review that confirmed nothing is never shown as green, and leads that were not confirmed never raise the alarm. The workflow band now says Security review and Design review instead of Pentest and Design test. New commands `paqad-ai security-review` and `paqad-ai design-review` record the stages, findings and gaps.
