# Laravel Security Review Checklist

- Validate authorization, policy coverage, and tenant boundaries for privileged routes.
- Check debug, Telescope, Horizon, and sensitive-file paths on the running local app.
- Review queued side effects, exports, and destructive actions for replay or duplicate execution.
- Confirm secrets stay in environment configuration rather than repository-tracked code.
