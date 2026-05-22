# ASP.NET Core Security Review Checklist

- Verify authentication, authorization, and policy wiring in `Program.cs`.
- Check CORS policy configuration and confirm no permissive credentialed wildcard origin.
- Confirm antiforgery or equivalent CSRF posture for state-changing browser endpoints.
- Audit `appsettings*.json` and deployment config for secrets and public listener exposure.
