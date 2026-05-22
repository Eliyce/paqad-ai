---
name: input-validation-review
description: Reason about SSRF, IDOR, mass assignment, injection vectors, file upload abuse, prototype pollution, and ReDoS from code and docs evidence.
model_tier: reasoning
triggers:
  - workflow:
      - pentest
cacheable: false
cache_key_inputs:
  - docs/modules/**
  - tests/**
output_format: markdown
input_schema:
  module_doc_paths:
    type: path[]
    required: true
    description: Module docs describing endpoints, data flows, and external integrations.
  test_paths:
    type: path[]
    required: false
    description: Tests that may prove input validation and abuse-path coverage.
---

## What It Does

Reviews all code paths where user-supplied input reaches security-sensitive operations — outbound HTTP calls, database lookups, ORM constructors, shell commands, template renderers, deserializers, file operations, and regex evaluations — and produces findings for each category that lacks proof of safe handling.

## Use This When

Use this when module docs or route inventories describe endpoints that accept URLs, resource IDs, request body fields, file uploads, or any user-controlled parameter that flows into a downstream system call.

## Inputs

- Read the module docs to identify data flow surfaces.
- Read `references/input-attack-patterns.md` before scanning for each category.
- Read tests and code evidence that could confirm or refute safe handling.

## Procedure

1. **SSRF scan**: Find all code paths that accept a URL, IP, or hostname and make an outbound request. Check for an explicit allowlist or blocked private-range validation (127.x, 10.x, 169.254.x, 172.16–31.x, `::1`, fd00::/8, AWS metadata `169.254.169.254`).

2. **IDOR scan**: Find resource lookups keyed by a user-controlled ID. Verify an authorization check exists **between** ID resolution and data return — not just at the route level.

3. **Mass assignment scan**: Find ORM fill calls, model constructors, or serializers that accept the full request body. Verify an explicit allowlist (`$fillable`, `attr_accessible`, `schema.pick()`) or blocklist exists.

4. **Injection vectors**: Identify:
   - Raw SQL construction or string interpolation in queries
   - Shell exec with user input (`exec`, `system`, `passthru`, `child_process.exec`, `subprocess.run(shell=True)`)
   - Template rendering with unsanitized data (`{!! !!}`, `|raw`, `dangerouslySetInnerHTML`, `render_template_string`)
   - Deserialization of untrusted data (`unserialize()`, `pickle.loads()`, `yaml.load()` without `Loader=SafeLoader`)
   - LDAP injection in directory lookups
   - XPath injection in XML processing

5. **File upload abuse**: Check MIME type validation, file extension allowlist, path traversal in the filename, storage isolation from the web root, and max-file-size enforcement.

6. **Prototype pollution (JS/Node)**: Find deep merges of user input into objects without property filtering — `lodash.merge`, `Object.assign`, `_.defaults` from untrusted source with `__proto__` or `constructor.prototype` keys.

7. **ReDoS**: Find user input fed into regex patterns that could cause catastrophic backtracking. Look for patterns of the form `(a+)+`, `(a|a)+`, or `.*.*` applied to unbounded input.

## Output Contract

- Match `assets/output.template.md`: severity, WSTG id (from `assets/wstg-mapping.txt`), category, Evidence: `file:line`, Reproduction (endpoint + parameter + expected vs observed), Required action.
- Output must pass `scripts/lint-findings.sh` (exit 0).

## Escalate / Stop Conditions

- Ask when module docs describe external integrations but do not name the parameters or protocol used.
- Warn when deserialization of complex objects (PHP `unserialize`, Python `pickle`) is found without a safe alternative.
- Do not flag a finding purely because a URL parameter exists — only when there is no evidence of safe handling.

## Resources

- `references/input-attack-patterns.md`
- `scripts/scan-injection-smells.sh` — pre-investigation grep for known sinks
- `scripts/lint-findings.sh` — enforces WSTG id + Evidence:file:line per finding
- `assets/output.template.md`
- `assets/wstg-mapping.txt`
