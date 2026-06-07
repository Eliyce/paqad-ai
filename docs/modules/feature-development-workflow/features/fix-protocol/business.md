# Fix Protocol — Prove Before Fixing

> **Layer:** `agent-workflows` · **Slug:** `fix-protocol` · **Issue:** #103

## What it is

A four-step discipline the agent follows whenever it changes behaviour to fix a confirmed problem:

1. **Prove broken** — capture a small automated check that fails *because of this specific problem*.
2. **Fix** — make the change.
3. **Prove fixed** — the once-failing check now passes.
4. **Prove nothing else broke** — the full existing check set still passes; a fix that breaks any
   previously-passing check is rejected.

The proof check is then **kept** as a durable regression guard so the same problem cannot silently
return.

## Why it matters

Fixing is itself change, and change injects defects. In a pilot study of bug-fixing changes, roughly
half broke regression testing on the first run, and a meaningful share of fixes were outright wrong
(the "bad-fix injection" rate). Reproducing a bug with a failing test *before* fixing — and keeping that
test — is the recognised cure for the whack-a-mole "fix one thing, break another" loop.

## How it behaves

- A behaviour-affecting fix **cannot be marked done** without a proof that failed before and passes
  after.
- The proof is validated as **genuine**: it is re-run against the unfixed tree and must genuinely fail
  (and, when a failure signal is declared, fail for the reported reason). A trivially-passing or
  side-stepping proof is rejected.
- After the fix, the full check set runs; any newly-failing previously-passing check **rejects** the
  fix.
- The proof is persisted as a regression guard linked to a stable `defect_id`.
- Some real problems (timing, visual appearance) cannot be auto-checked. These open a single
  `fix.proof_method` Decision Pause — asked **once**, then reused for the same *kind* of problem (no
  re-ask).
- Proof-first is **skipped only** when the change genuinely cannot affect behaviour (comments, blank
  lines, documentation). When in doubt, the change is treated as behaviour-affecting. Cosmetic edits on
  the `fast` lane stay light.

## Boundaries

This feature owns the **content of one fix** (the prove → fix → prove → prove-no-regression protocol and
the kept proof). It does **not** own:

- the outer round loop / stop rule around repeated fixes → #108;
- deciding whether a finding is a confirmed problem → #107;
- judging whether the tests themselves are strong enough (mutation/flaky) → #105 / #106. A proof is only
  as trustworthy as the suite — this feature does not re-solve that.
