# Kotlin Android Security Review Checklist

- Audit `AndroidManifest.xml` for exported components and excessive permissions.
- Review storage of tokens, PII, and cached API data.
- Check `network_security_config.xml`, certificate pinning, and WebView configuration.
- Validate deep-link and Intent payload parsing paths.
