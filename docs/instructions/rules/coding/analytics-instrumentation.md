<!--gate: analytics_instrumentation-->
<!--trigger: **-->

# Analytics Instrumentation

Analytics is enabled for this project, so treat instrumentation as a tracking plan as code:
every feature instruments its user-facing events, and every event is documented and governed.
This rule only loads when `analytics_instrumentation` is on; when off, none of it applies.

- Instrument every feature. When you build a user-facing behavior, add the analytics event(s)
  for it using the project's detected provider and existing convention. A feature that ships
  untracked is incomplete.
- One convention, 100% consistent. Follow the naming convention already observed in the
  codebase (see `docs/instructions/stack/analytics.md`). Object-action names and past tense are
  common defaults, not rigid rules; the load-bearing rule is consistency, because casing is
  case-sensitive and silently splits data (`Song Played` and `song played` are two events).
- No variable data in event names. Names are stable identifiers; dynamic values are properties.
- Document each event. Every event has one per-event doc at
  `docs/modules/{module}/analytics/{feature}/{event}.md`, one doc per event with a section per
  provider, the exact event string recorded inside. Read the per-module `analytics/index.md`
  before adding a new event so you reuse an existing one rather than coining a duplicate.
- Govern every new event. A brand-new event is a decision, not a silent addition: it must go
  through the Decision Pause (who proposed it and why, with the name, casing, taxonomy, and any
  PII/consent surfaced for a human to approve, rename, or decline) before it lands.
- Never invent PII capture silently. If an event or property would carry personal data, flag it
  in the event doc's PII/consent section and pause for a decision. This is review-time
  governance, not redaction at capture.
