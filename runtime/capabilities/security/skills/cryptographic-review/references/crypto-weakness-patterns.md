# Cryptographic Weakness Patterns

Concrete code patterns indicating cryptographic failures. Reference these when scanning source code.

## Hardcoded Secrets

Patterns to flag (by language):

```
# Generic indicators
-----BEGIN RSA PRIVATE KEY-----
-----BEGIN PRIVATE KEY-----
-----BEGIN EC PRIVATE KEY-----
AKIA[0-9A-Z]{16}           # AWS access key ID
eyJ[A-Za-z0-9_-]{10,}      # JWT token (base64url-encoded header)

# JavaScript / TypeScript
const SECRET = "mysecret"
const JWT_SECRET = 'password'
process.env.DB_PASSWORD = 'hardcoded'

# PHP
define('APP_KEY', 'hardcoded_value');
$key = 'my-static-encryption-key';

# Python
SECRET_KEY = "django-insecure-..."   # Django default key never rotated
DATABASE_URL = "postgres://user:pass@host/db"

# Go
var hmacSecret = []byte("secret")
```

**Note:** Report only the file path and line number — never include the actual secret value in the finding.

## Weak Password Hashing

**Always flag (no acceptable use case for passwords):**

```
# JavaScript
md5(password)
sha1(password)
crypto.createHash('md5').update(password)
crypto.createHash('sha1').update(password)

# PHP
md5($password)
sha1($password)
hash('sha256', $password)   # fast hash — not acceptable for passwords
password_hash($p, PASSWORD_DEFAULT)  # OK — bcrypt
password_hash($p, PASSWORD_BCRYPT)   # OK

# Python
hashlib.md5(password.encode())
hashlib.sha1(password.encode())
hashlib.sha256(password.encode())  # fast — not acceptable for passwords
bcrypt.hashpw(password, bcrypt.gensalt())  # OK

# Java
MessageDigest.getInstance("MD5")
MessageDigest.getInstance("SHA-1")
MessageDigest.getInstance("SHA-256")  # fast — not acceptable for passwords
new BCryptPasswordEncoder()  # OK
```

## Insecure Random Number Generation

**Not cryptographically secure — flag when used for tokens, session IDs, OTPs, or CSRF tokens:**

```
# JavaScript
Math.random()
Math.floor(Math.random() * 1000000)  # OTP

# PHP
rand()
mt_rand()
uniqid()   # uses microtime — predictable

# Python
random.random()
random.randint()
random.choice()

# Java
new java.util.Random()
Math.random()

# Go
rand.Intn()  # from math/rand — not crypto/rand
```

**Safe alternatives:** `crypto.randomBytes(n)` (Node), `random_bytes(n)` (PHP), `secrets.token_bytes(n)` (Python), `java.security.SecureRandom`, `crypto/rand` (Go).

## ECB Mode and Static IV

```
# Java
Cipher.getInstance("AES/ECB/PKCS5Padding")  # ECB leaks patterns
Cipher.getInstance("AES")  # defaults to ECB in some JVMs

# PHP
openssl_encrypt($data, "aes-128-ecb", $key)
openssl_encrypt($data, "aes-256-ecb", $key)

# Python
AES.new(key, AES.MODE_ECB)

# Static IV (any language)
iv = "1234567890123456"       # hardcoded string
const IV = Buffer.from('abcdefghijklmnop')  # hardcoded Buffer
byte[] iv = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}  # all-zero IV
```

**Safe pattern:** IV must be generated with a CSPRNG per encryption operation and prepended to the ciphertext.

## Disabled TLS Verification

```
# Python
requests.get(url, verify=False)
ssl._create_unverified_context()
urllib3.disable_warnings()  # combined with verify=False

# Node.js
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
https.request({ rejectUnauthorized: false })
axios.create({ httpsAgent: new https.Agent({ rejectUnauthorized: false }) })

# Go
&tls.Config{InsecureSkipVerify: true}

# PHP
CURLOPT_SSL_VERIFYPEER => false
CURLOPT_SSL_VERIFYHOST => false

# Ruby
OpenSSL::SSL::VERIFY_NONE
```

## PBKDF2 Insufficient Iterations

```
# Acceptable threshold: ≥ 100,000 iterations (NIST SP 800-132 recommendation)
# Flag when iteration count is below this:

# Python
hashlib.pbkdf2_hmac('sha256', password, salt, 10000)  # too low

# Java
new PBEKeySpec(password, salt, 1000, 256)  # too low

# PHP
hash_pbkdf2('sha256', $password, $salt, 10000)  # too low
```
