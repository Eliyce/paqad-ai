# Rate Limit Signals

Per-framework patterns that indicate rate limiting is present or absent.

## Laravel

**Present (safe):**

```php
Route::post('/login', [AuthController::class, 'login'])
    ->middleware('throttle:10,1');  // 10 requests per minute

Route::middleware(['auth:sanctum', 'throttle:60,1'])->group(function () {
    Route::post('/api/export', [ExportController::class, 'export']);
});

RateLimiter::for('login', function (Request $request) {
    return Limit::perMinute(5)->by($request->ip());
});
```

**Absent (flag):**

```php
Route::post('/login', [AuthController::class, 'login']);  // no throttle middleware
Route::post('/reset-password', [PasswordController::class, 'reset']);  // no throttle
Route::post('/api/export', [ExportController::class, 'export']);  // no throttle on bulk export
```

## Express.js

**Present (safe):**

```javascript
const rateLimit = require('express-rate-limit');
const loginLimiter = rateLimit({ windowMs: 60000, max: 10 });
app.post('/api/login', loginLimiter, authController.login);
```

**Absent (flag):**

```javascript
app.post('/api/login', authController.login); // no rate limit
app.post('/api/reset-password', resetController.reset); // no rate limit
app.post('/api/export', exportController.export); // no rate limit on bulk
```

## Django / Django REST Framework

**Present (safe):**

```python
# settings.py
REST_FRAMEWORK = {
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '10/minute',
        'user': '100/minute',
    }
}

# view
class LoginView(APIView):
    throttle_classes = [AnonRateThrottle]
```

**Absent (flag):**

```python
REST_FRAMEWORK = {}  # no DEFAULT_THROTTLE_CLASSES

class LoginView(APIView):
    pass  # no throttle_classes
```

## FastAPI

**Present (safe):**

```python
from slowapi import Limiter
limiter = Limiter(key_func=get_remote_address)

@app.post("/login")
@limiter.limit("10/minute")
async def login(request: Request, ...):
    ...
```

**Absent (flag):**

```python
@app.post("/login")
async def login(credentials: LoginSchema):
    ...  # no @limiter.limit decorator, no SlowAPI middleware

@app.post("/export")
async def export(request: Request):
    ...  # no rate limit on bulk export
```

## Rails

**Present (safe):**

```ruby
# config/initializers/rack_attack.rb
Rack::Attack.throttle('login/ip', limit: 5, period: 60) do |request|
  request.ip if request.path == '/users/sign_in' && request.post?
end
```

**Absent (flag):**

```ruby
# No Rack::Attack configuration for auth routes
# No throttle blocks in config/initializers/rack_attack.rb
```

## Spring Boot

**Present (safe):**

```java
@RestController
public class AuthController {
    @RateLimiter(name = "loginRateLimiter", fallbackMethod = "loginFallback")
    @PostMapping("/api/login")
    public ResponseEntity<?> login(...) { ... }
}
```

**Absent (flag):**

```java
@PostMapping("/api/login")
public ResponseEntity<?> login(@RequestBody LoginRequest request) {
    // no @RateLimiter annotation, no custom rate limit filter
}
```

## General Red Flags (All Frameworks)

- Authentication endpoint has no per-IP or per-account request limit
- OTP/MFA verification endpoint has no attempt limit (6-digit OTP = 1,000,000 guesses)
- Password reset endpoint has no rate limit (enables reset token enumeration)
- List endpoint accepts unlimited `per_page` / `limit` values
- File upload endpoint has no per-user daily quota
- Unauthenticated endpoint triggers expensive DB query or external API call without throttling
- WebSocket `message` handler has no per-connection message rate counter
