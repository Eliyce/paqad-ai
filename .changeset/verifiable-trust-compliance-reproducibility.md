---
'paqad-ai': minor
---

Complete the verifiable-trust receipt with two optional, additive fields (#122,
#123). Both fold into the existing #118 receipt + #146 Trust dashboard the same
way #120 authorship did, and are omitted when absent so receipts for projects
without them stay byte-identical.

**#122 — gate→clause compliance citations.** A new `compliance-pack` kind (its
own registered schema, `kind` discriminator, OSCAL relation vocabulary,
`evidence_strength` that rejects `full`) maps verification gates to legal-
framework clauses. At verification time, a clause is cited only when every gate
it depends on **passed** (never inconclusive/blocked), so a green gate can cite
which EU AI Act / NIST / ISO clause it produces _evidence toward_ — never a
claim of compliance. Ships an honest built-in EU AI Act pack and surfaces clause
chips + the pack's disclaimer on the receipt, the Trust dashboard, and the PR
comment. Project packs override built-ins via the usual precedence.

**#123 — reproducibility stamp.** Promote paqad's deterministic context rebuild
hash into `computeContextHash`: a SHA-256 over a canonical, key-ordered,
explicitly-versioned preimage (lineage, classifier output, retrieved-chunk
digests, budget, summariser mode, truncation), exposed as `contextHash` on the
rebuild result and recorded in a durable `context-stamp.json`. The receipt then
asserts `determinism: 'input-replay'` — the context an agent saw is replayable
from these exact inputs. It deliberately does **not** claim bit-identical LLM
regeneration (hosted models expose no stable seed; temperature 0 is still
non-deterministic).
