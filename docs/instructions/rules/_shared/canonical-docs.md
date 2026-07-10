# Canonical Docs

`docs/` is the source of truth for how the system behaves today. These always load. The obligation to update docs in the same change lives in the constitution; this rule is about which docs win and how they are scoped.

<!-- trigger: ** -->

- Treat `docs/` as the authoritative description of current behavior. When code and docs disagree, resolve it in this change. Fix whichever is wrong, and MUST NOT leave the mismatch for later.
- Keep each module's docs scoped to that module and complete enough to act on without reading the source.
