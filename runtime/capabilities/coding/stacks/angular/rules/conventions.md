# Angular Conventions

- Write standalone components, directives, and pipes (the default since v19); do not declare new `NgModule`s. Provide app-wide services with `bootstrapApplication(AppComponent, { providers: [...] })` and route-level providers via `provideRouter`, `provideHttpClient`.
- Set `changeDetection: ChangeDetectionStrategy.OnPush` on components and drive updates through signals or immutable inputs, not in-place mutation.
- Declare inputs and outputs with the signal APIs `input()`, `input.required()`, `output()`, and two-way state with `model()` — not the `@Input()`/`@Output()` decorators in new code.
- Hold component state in `signal()`, derive with `computed()`, and read async sources with `toSignal()`; reach for `effect()` only for side effects, never to set other signals.
- Use built-in control flow `@if`, `@for` (with a `track` expression), `@switch`, and `@defer` in templates instead of `*ngIf`/`*ngFor`/`*ngSwitch`.
- Query the DOM and children with `viewChild()`/`viewChildren()`/`contentChild()` signal queries, not `@ViewChild` decorators, in new components.
- Build forms with typed reactive forms (`FormGroup`/`FormControl`/`NonNullableFormBuilder`); avoid `FormControl` without a type and avoid template-driven `ngModel` for non-trivial forms.
- Inject dependencies with the `inject()` function in field initializers rather than constructor parameter injection; mark cross-cutting services `providedIn: 'root'`.
- Unsubscribe from manual `Observable` subscriptions with `takeUntilDestroyed()`; prefer the `async` pipe or `toSignal()` so subscriptions are torn down automatically.
- Lazy-load feature areas with `loadComponent`/`loadChildren` in the route config, and protect routes with functional guards (`CanActivateFn`) using `inject()`.
- Make HTTP calls through `HttpClient` from `provideHttpClient(withInterceptors(...))`; do not call `fetch` directly when interceptors handle auth, retries, or base URLs.
