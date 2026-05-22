# STRIDE Checklist

One concrete question per STRIDE letter per surface type. Answer each — if the answer is "unknown" or "not covered", flag it as a threat.

## Surface: API Endpoint

| Threat                     | Check                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **S**poofing               | Can the caller forge or steal an auth token to impersonate another user? Is the token verified on every request?               |
| **T**ampering              | Can request body parameters (price, role, status) be manipulated without the server rejecting them? Can a request be replayed? |
| **R**epudiation            | Is this action written to an audit log with caller identity, IP, and timestamp?                                                |
| **I**nformation Disclosure | Does the error response for a missing or forbidden resource leak data (e.g., "user not found" vs "invalid token")?             |
| **D**enial of Service      | Is this endpoint rate-limited? Can an unbounded query or pagination bypass exhaust the database?                               |
| **E**levation of Privilege | Does calling this endpoint require a specific role check, not just authentication? Can a regular user reach admin actions?     |

## Surface: Background Job / Queue

| Threat                     | Check                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| **S**poofing               | Can an unauthorized actor enqueue or trigger this job? Is job source verified?                          |
| **T**ampering              | Can the job payload be modified while sitting in the queue? Is the payload schema-validated on dequeue? |
| **R**epudiation            | Is job execution logged with the actor who triggered it and the input it received?                      |
| **I**nformation Disclosure | Do job failure logs or error messages expose internal state, file paths, or credentials?                |
| **D**enial of Service      | Can malicious input cause an infinite retry loop? Is there a dead-letter queue with a retry cap?        |
| **E**levation of Privilege | Does the job run with elevated DB permissions? Can the payload escalate what the job does?              |

## Surface: File Upload Endpoint

| Threat                     | Check                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| **S**poofing               | Can the MIME type be spoofed (Content-Type: image/png + PHP body)?                                  |
| **T**ampering              | Can an uploaded file be modified or swapped between upload and virus/validation scan?               |
| **R**epudiation            | Is the upload event logged with uploader identity, filename, and file hash?                         |
| **I**nformation Disclosure | Can the storage path be enumerated via the upload response? Are uploaded files publicly browseable? |
| **D**enial of Service      | Is there a max file size? Is there a per-user upload quota? Can a zip bomb pass validation?         |
| **E**levation of Privilege | Can an uploaded file overwrite application code (e.g., if storage is in the web root)?              |

## Surface: Webhook

| Threat                     | Check                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **S**poofing               | Is the webhook source verified with HMAC signature validation? Is the signing secret rotated?                      |
| **T**ampering              | Can a webhook payload be replayed with a valid signature from a previous request? Is a timestamp or nonce checked? |
| **R**epudiation            | Is webhook receipt logged with payload hash and delivery timestamp?                                                |
| **I**nformation Disclosure | Do webhook error responses leak internal system details to the sender?                                             |
| **D**enial of Service      | Can rapid webhook delivery cause queue exhaustion or DB write saturation? Is there backpressure?                   |
| **E**levation of Privilege | Can a webhook payload trigger a privileged action (e.g., account promotion, data export)?                          |

## Surface: Admin Panel / Dashboard

| Threat                     | Check                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **S**poofing               | Is the admin session protected against XSS-based cookie theft? Is MFA enforced for admin accounts?                             |
| **T**ampering              | Are admin actions protected against CSRF? Are all mutations require a re-auth or confirmation step for destructive operations? |
| **R**epudiation            | Are all admin operations attributed to a specific admin user with full context? Is the audit log tamper-resistant?             |
| **I**nformation Disclosure | Is the admin panel IP-restricted or behind a VPN? Does the panel URL appear in `robots.txt` or error messages?                 |
| **D**enial of Service      | Can bulk admin operations (mass delete, mass export) be triggered without a concurrency cap?                                   |
| **E**levation of Privilege | Can a non-admin reach the admin panel via path traversal or missing middleware? Is the admin route applied to all sub-routes?  |

## Surface: GraphQL Endpoint

| Threat                     | Check                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **S**poofing               | Can introspection reveal hidden types that expose private fields to unauthenticated callers?                               |
| **T**ampering              | Can mutation inputs include undocumented fields not validated by the schema resolver?                                      |
| **R**epudiation            | Are mutations logged with the caller identity and full input?                                                              |
| **I**nformation Disclosure | Do resolver errors expose DB schema, table names, or stack traces in the `errors` array?                                   |
| **D**enial of Service      | Is there a query depth limit and a query complexity budget? Can aliased or batched queries bypass per-request rate limits? |
| **E**levation of Privilege | Does each field resolver enforce authorization independently, not just the root query resolver?                            |
