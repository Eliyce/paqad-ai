# Boundary Checklist

## Object-Level Authorization — BOLA (OWASP API #1)

- Are resource IDs sequential integers? If so, can user A read/mutate user B's resource by incrementing the ID by 1?
- Are IDs UUIDs? UUID v1 contains timestamp + MAC address — verify they are not predictable.
- Cross-user resource access: can user A access user B's resource by changing a path param or body field?
- **Nested resource authorization**: user can access `/org/1` — can they also access `/org/1/users/999` where user 999 belongs to org 2?
- Horizontal vs vertical privilege escalation — test both independently; finding one does not rule out the other.

## Function-Level Authorization (OWASP API #5)

- Probe admin surfaces: `/admin`, `/internal`, `/backstage`, `/manage`, `/debug`, `/staff`, `/graphql` (introspection)
- **HTTP method tampering**: change GET to PUT/DELETE/PATCH on read-only endpoints — does the server reject unexpected methods?
- Role-switching mid-transaction: does a role change during an active session affect in-flight requests?
- Verify authentication and authorization separately — a route can authenticate a caller but still fail to authorize the specific action.

## Mass Assignment — Broken Object Property Level Auth (OWASP API #3)

- Are unintended fields accepted in request bodies? Test: `is_admin`, `role`, `price`, `balance`, `verified`, `email_verified_at`, `confirmed`
- Check ORM `$fillable`/`$guarded` config — does the model use `$guarded = []` or an overly broad `$fillable` list?
- **GraphQL mutation inputs**: are non-UI fields writable through mutations (discoverable via introspection)?

## Unrestricted Resource Consumption (OWASP API #4)

- No pagination limit on list endpoints: does `?per_page=999999` return all records?
- File upload without size limits: is there a `MAX_FILE_SIZE` enforcement?
- Batch operations without throttling: can bulk create/delete endpoints be called without a concurrency cap?
- Missing rate limiting on authentication endpoints: `/login`, `/register`, `/reset-password`, `/verify-otp`

## General

- Check tenant isolation, admin-only paths, and export/delete flows.
- Treat missing negative-path tests as evidence gaps, not proof of safety.
- Do not mark a boundary as safe purely because authentication exists — authorization must also be verified.
