---
'paqad-ai': minor
---

feat: freeze a machine-checkable feature spec and define a single "done" bar before building (#102)

Non-trivial features (graduated/full lanes) now require a frozen spec carrying behaviour,
acceptance criteria (AC-n, given/when/then, proof_type), and human-confirmed invariants (INV-n),
validated by the new `feature-spec` schema. A spec freezes only with no open questions, no critical
spec-review defects, and a confirmed invariant set. "Done" becomes a checkable bar — gates pass, every
acceptance criterion is proven, and no confirmed problem remains; style/taste never blocks. Mid-build
goal changes and work-vs-spec contradictions pause via the Decision Pause Contract
(`spec.change` / `spec.contradiction`). The fast lane is unaffected — trivial work needs no spec.
