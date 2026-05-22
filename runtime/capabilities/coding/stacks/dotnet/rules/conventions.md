# ASP.NET Core Conventions

- Prefer `Program.cs` as the composition root for service registration and middleware ordering.
- Keep API controllers in `Controllers/`, minimal API handlers in `Endpoints/`, and reusable business logic in `Services/`.
- Persist data-access types under `Data/`, `Models/`, or `Entities/` and keep raw SQL parameterized.
- Treat `appsettings*.json` as non-secret defaults only; production secrets belong in environment-specific secret stores.
