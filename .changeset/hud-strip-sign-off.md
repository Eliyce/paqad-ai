---
'paqad-ai': minor
---

The Desktop HUD strip says more in less room, counts changed lines from the first edit, and shows design sign-off.

- The header reads `Feature`, keeps the cost on the right and drops the cost, then the lane, then
  the workflow when the band is narrow. The flag mark and words are one control.
- The strip shows only the working stages. High Table is a fixed 150 px and Delivery a fixed
  190 px; narrow bands hide High Table first, then Delivery. Delivery is two lines of text: the
  state (`Not pushed`, `PR #823 · CI running`) and the commits and line figures.
- The HUD snapshot gains `ship.diff`: lines added and removed by the change, counted from local git
  before any PR exists, new files included.
- When design sign-off applies, a `Sign-off` stage sits between Spec and Build with coloured
  status words and a `Check`, `View` or `Copy design` button. `paqad-ai hld check-approval` now
  records when it last ran.
