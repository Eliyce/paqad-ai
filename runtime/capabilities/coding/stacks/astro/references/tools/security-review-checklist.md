# Astro Security Review Checklist

- Validate Astro middleware authentication checks on server-rendered and API routes.
- Check for unsafe `set:html` directive usage that bypasses Astro's built-in HTML escaping.
- Review `astro.config.mjs` for exposed output adapters and server endpoint access controls.
- Confirm environment secrets use `import.meta.env` private variables and are never inlined into static output.
- Check dynamic route parameter handling for path traversal and injection exposure.
