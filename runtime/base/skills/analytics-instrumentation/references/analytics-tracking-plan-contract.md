# Tracking-plan-as-code contract (issue #279)

The per-event docs tree is the single source of truth for what a project tracks. This skill
implements the governance triple that every tracked event carries.

## Governance triple

1. **Decision packet (who / why).** Every new event opens an `analytics.new_event` Decision
   Pause packet capturing the proposed name + normalized slug, the provider(s), the feature, and
   the rationale, with the name/casing/taxonomy/PII surfaced for a human to approve, rename, or
   decline. Resolved packets commit with the PR, so `git blame` answers who added an event and why.
2. **Per-event doc (what it means).** `docs/modules/{module}/analytics/{feature}/{event}.md`, one
   doc per event with a section per provider. The filename is a normalized slug and the exact
   event string is recorded inside, so casing-variant duplicates (`Song Played` vs `song played`)
   collapse to one doc and the conflict is caught at write time.
3. **AC + traceability (proof).** One `AC-TRACK` per event, proven against the delivering code and
   the doc; an event promised but not proven surfaces as `TR-UNTESTED-PROMISE`.

## Convention

Pick one naming convention and be 100% consistent. Object-action names and past tense are common
defaults, not rigid rules. No variable data in event names — dynamic values are properties.

## Honest limits

This is PR/review-time governance via doc + AC existence. It is not type-safe codegen, not
ingestion-time or real-time blocking, and not PII redaction at capture — those live at the CDP.
The `analytics_strictness` knob (off | warn | strict, default warn) decides what a missing event
doc means: warn flags it, strict blocks on Done, off is silent.
