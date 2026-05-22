# Flutter UI Platform Behavior

- Keep platform-specific branching centralized in adaptive widgets or shared helpers.
- Screens should stay thin and delegate reusable UI into shared or feature-local widgets deliberately.
- Use route constants/builders instead of hard-coded navigation strings.
- Validate browser-visible behavior for Flutter web targets with `docs/tools/flutter/playwright.md` when web is in scope.
- Treat permissions, storage access, and deep-link behavior as explicit review items for platform-facing changes.
