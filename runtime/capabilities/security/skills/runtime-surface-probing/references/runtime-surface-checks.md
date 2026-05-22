# Runtime Surface Checks

Always confirm base reachability first. Treat blocked runtime access as a coverage gap, not a clean result.

## Security Headers (OWASP 2025 A02)

- `Strict-Transport-Security` — missing or short `max-age`
- `X-Frame-Options` or CSP `frame-ancestors` — clickjacking protection
- `X-Content-Type-Options: nosniff` — MIME sniffing prevention
- `Content-Security-Policy` — present and non-trivial (not `default-src *`)
- `Referrer-Policy`, `Permissions-Policy`
- `X-Powered-By` / `Server` — information disclosure via server identity headers

## CORS Misconfiguration

- `Access-Control-Allow-Origin: *` on authenticated or state-changing endpoints?
- Server reflects `Origin` header value without validation?
- `Access-Control-Allow-Credentials: true` combined with a wildcard or reflected origin?

## Error Disclosure

- Do 500 errors return stack traces, file paths, SQL queries, or environment variables?
- Debug pages reachable: `/debug`, `/_debugbar`, `/telescope`, `/horizon`, `/__profiler`, `/actuator`
- GraphQL errors expose internal resolver names, DB table names, or stack traces?

## Open Redirect

- Test `?redirect=https://evil.com`, `?next=//@evil.com`, `?return_url=//evil.com%2F..`
- Protocol-relative bypass: `//evil.com`
- URL-encoded bypass: `%2F%2Fevil.com`

## Sensitive File Exposure

- `.env`, `.env.local`, `.env.production`, `.env.example` (may contain real secrets)
- `.git/config`, `.git/HEAD`
- `phpinfo.php`, `info.php`, `wp-config.php`, `debug.log`, `error.log`
- `composer.json`, `package.json` (version/dependency disclosure)
- `/server-status`, `/server-info` (Apache)
- `robots.txt`, `sitemap.xml` (hidden path information gathering)

## Directory Listing

- Check if `/uploads/`, `/storage/`, `/public/`, `/media/`, `/static/` serve directory listings.

## SSRF Surface

- Identify endpoints accepting a URL, IP, or hostname parameter — probe with:
  `127.0.0.1`, `0x7f000001`, `[::1]`, `169.254.169.254` (AWS metadata)

## API Documentation Exposure

- `/swagger`, `/api-docs`, `/openapi.json`, `/graphql` (run introspection: `{ __schema { types { name } } }`), `/redoc`

## TLS / Cryptographic Surface (OWASP 2025 A04)

- TLS version: reject connections on TLS 1.0/1.1; accept only TLS 1.2+ (prefer 1.3)
- Weak cipher suites: RC4, DES, 3DES, NULL, EXPORT, anonymous ciphers
- Certificate validity: expired, self-signed, or mismatched CN/SAN
- HSTS preload eligibility
