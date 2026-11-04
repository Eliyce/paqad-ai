---
'paqad-ai': minor
---

Every team file under .paqad/configs/ now lists every setting it can hold, commented out with paqad's default and a one-line note. Remove the `#` in front of a setting (and its group name) to change it; a setting left commented out keeps paqad's default, so a better default in a later version still reaches you.

Expect a one-time change in all 13 files on your first `paqad-ai update`: it rewrites each file in this layout and names every file it rewrote. Your values and your comments are kept, a setting paqad doesn't know moves under a "Not a paqad setting" line, and other notes move to a notes section at the end. The setting notes were also rewritten in plain language.
