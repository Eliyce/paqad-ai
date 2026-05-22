# Laravel UI Safety

- Every user-facing flow must handle loading, empty, success, and failure states explicitly.
- Destructive actions require visible confirmation and must prevent duplicate submits while pending.
- Navigation changes must preserve valid back paths, breadcrumbs, and route protection behavior.
- When UI changes touch authorization or signed flows, validate the browser-visible behavior with `docs/tools/laravel/playwright.md` when appropriate.
- Keep module UI docs in sync with screen, state, and error behavior changes.
