# Angular Security Review Checklist

- Validate route guards (`CanActivate`, `CanActivateChild`) on all protected navigation paths.
- Check for unsafe `[innerHTML]` bindings and `DomSanitizer.bypassSecurity*` bypasses.
- Review HTTP interceptors for correct auth header attachment and token refresh handling.
- Confirm sensitive data is not persisted to `localStorage` or `sessionStorage` without encryption.
- Check Angular environment files: secrets must not be compiled into the client bundle.
