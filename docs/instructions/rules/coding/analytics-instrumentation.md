<!--gate: analytics_instrumentation-->
<!--trigger: **-->

# Analytics Instrumentation

Treat instrumentation as a tracking plan in code: every feature instruments its user-facing events, and every event is documented and governed. This rule loads only when `analytics_instrumentation` is on; when off, none of it applies.

- Instrument every user-facing behavior you build, using the project's detected provider and existing convention. A feature that ships untracked is incomplete.
- Follow the one naming convention already in the codebase (see `docs/instructions/stack/analytics.md`) exactly. Casing is case-sensitive, so `Song Played` and `song played` silently become two different events.
- Keep variable data out of event names. A name is a stable identifier; dynamic values are properties.
- Document each event in one per-event doc at `docs/modules/{module}/analytics/{feature}/{event}.md`, with one section per provider and the exact event string recorded. Read the per-module `analytics/index.md` before you add one, so you reuse an existing event instead of coining a duplicate.
- Route every brand-new event through the Decision Pause before it lands: the name, casing, taxonomy, and any PII or consent surfaced for a human to approve, rename, or decline. MUST NOT add a new event silently.
- Flag any event or property that would carry personal data in the event doc's PII/consent section and pause for a decision. MUST NOT invent PII capture silently.
