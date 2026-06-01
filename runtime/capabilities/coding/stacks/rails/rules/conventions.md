# Rails Conventions

- Permit attributes for mass assignment with strong parameters (`params.require(:model).permit(...)`); never pass raw `params` to `create`/`update`.
- Keep controllers thin: extract multi-step or cross-model logic into service objects (`app/services`) or model methods, and use named scopes for reusable queries instead of repeating `where` chains.
- Prevent N+1 queries with `includes` (or `preload`/`eager_load`); verify with the `bullet` gem or query logs on index/show actions.
- Treat `db/schema.rb` (or `structure.sql`) as generated — change the schema only via migrations (`rails g migration`, `rails db:migrate`) and commit both the migration and the regenerated schema file; never hand-edit the schema.
- Use the query interface / parameterized conditions (`where("name = ?", name)` or hash conditions) for all SQL; never interpolate request values into a query string.
- Run slow or external work in Active Job (`perform_later`) backed by a real adapter (Sidekiq/GoodJob); do not call third-party APIs or send mail synchronously in a request.
- Authorize every action with Pundit or CanCanCan (or explicit checks); scope queries to `current_user` rather than exposing global collections.
- Validate data with model validations and enforce critical invariants at the database level too (NOT NULL, unique indexes, FK constraints).
- Keep secrets in encrypted credentials (`rails credentials:edit`) or environment variables; never commit secrets or `master.key`.
- Keep CSRF protection on (`protect_from_forgery` / default in `ActionController::Base`); use `protect_from_forgery with: :null_session` only for token-authenticated API controllers.
- Use callbacks sparingly for persistence-related concerns; move side effects with external dependencies (emails, API calls) out of model callbacks into jobs or service objects.
- Reference routes with named path helpers (`users_path`) and define them in `config/routes.rb` with `resources`; do not hardcode URLs.
