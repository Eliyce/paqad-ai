# Spring Boot Conventions

- Use constructor injection (a single constructor needs no `@Autowired`) and `final` fields; avoid field injection with `@Autowired` on fields.
- Layer by responsibility: `@RestController` handles HTTP only, `@Service` holds business logic, `@Repository`/Spring Data interfaces handle persistence — do not put queries or business rules in controllers.
- Accept and return DTOs from controllers, not JPA entities; map between them (manually or with MapStruct) so the persistence model is not exposed over the wire.
- Validate request bodies with Jakarta Bean Validation annotations (`@Valid` + `@NotNull`, `@Size`, `@Email`, etc.) and handle failures in a `@RestControllerAdvice` `@ExceptionHandler`; do not validate by hand in handlers.
- Mark service methods that perform multiple writes `@Transactional`; keep transactions at the service layer, not the controller.
- Avoid N+1 queries from lazy associations: use fetch joins (`JOIN FETCH` / `@EntityGraph`) or projections for read paths; do not set relations to `EAGER` to mask the problem.
- Keep configuration in `application.yml`/`application.properties` with profile-specific files (`application-prod.yml`); inject values via `@ConfigurationProperties` (preferred) or `@Value`.
- Keep secrets out of committed config — supply them via environment variables or a secrets manager, and never commit credentials in `application.yml`.
- Configure security with a `SecurityFilterChain` bean (the component-based config; `WebSecurityConfigurerAdapter` is removed); secure endpoints by default and authorize with method security (`@PreAuthorize`) where needed.
- Use Spring Data repository methods or `@Query` with bound parameters (`:name`) for queries; never concatenate user input into JPQL or native SQL.
- Return proper status codes via `ResponseEntity` and a consistent error body; do not leak stack traces or exception messages to clients.
- Run long or external work asynchronously with `@Async` (on an explicitly configured executor) or a message queue rather than blocking the request thread.
