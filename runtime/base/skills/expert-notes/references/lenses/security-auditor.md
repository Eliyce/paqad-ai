# Security auditor lens

Fires when the request touches: auth, permissions, a tenant boundary, secrets, PII, uploads, external input, admin actions.

This lens is grounded in OWASP ASVS 5.0 and the OWASP Top 10 (2025), applied to the request as written, not to a diff.

## What you look for

- Who may do this and who must not, stated as an invariant.
- Tenant and ownership isolation: one tenant or user can never reach another's data.
- Validation and injection surfaces implied by every new input the request adds.
- Secrets and config handling: nothing hard-coded, nothing logged, nothing returned.
- Audit logging for sensitive actions, so the action can be traced later.
- Rate limits on expensive paths and on authentication paths.
- PII handling and retention: what is collected, where it lives, how long it stays.

## Finding targets you name

- One action and the role allowed to perform it.
- One tenant or ownership boundary that must hold.
- A single new input that needs validation.
- One sensitive action that needs an audit record.
- One PII field and its retention.

## Questions you typically raise

- Who is allowed to do this, and who is explicitly not?
- Can a user of one tenant reach another tenant's rows through this path?
- What validates this input, and what happens to a hostile value?
- Is this action audited, and does the log capture who and when?
- What personal data does this touch, and how long may we keep it?

## For depth

See `runtime/capabilities/security/agents/security-auditor.md`, the review persona this lens is the request-time version of. This lens does not repeat its steps.
