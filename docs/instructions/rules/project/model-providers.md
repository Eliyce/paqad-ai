# Model Providers

How the openai and @huggingface/transformers clients are set up, retried and cached. Found by rules discovery from each package's own docs.

<!-- trigger: ** -->

- Any code that wraps an openai SDK call in its own retry loop constructs the client with maxRetries: 0 (or drops the custom loop), so 429/5xx/connection errors are not retried by both layers. <!-- @rule RL-0fcf discovered:rd-20261116-061901 -->
- Every new OpenAI({...}) client sets an explicit timeout suited to the call (for example tens of seconds for embeddings), never relying on the 10-minute default. <!-- @rule RL-1ae2 discovered:rd-20261116-061901 -->
- openai errors are classified with the SDK error classes (OpenAI.APIError and subclasses such as AuthenticationError, PermissionDeniedError, RateLimitError, APIConnectionError) from the loaded module, not by duck-typing a status property or matching the message text. <!-- @rule RL-bdd4 discovered:rd-20261116-061901 -->
- When an openai call fails, the surfaced EmbeddingProviderError message or log includes the SDK's err.requestID (x-request-id) so failures can be reported to OpenAI. <!-- @rule RL-033a discovered:rd-20261116-061901 -->
- Every pipeline() and AutoTokenizer.from_pretrained() call that may download from the Hub passes a pinned revision (a commit SHA), not the default 'main'. <!-- @rule RL-c813 discovered:rd-20261116-061901 -->
- Every load of @huggingface/transformers models or tokenizers (embeddings, reranker, tokenizer cache) points the cache at ~/.paqad/models, via env.cacheDir set in one shared loader or the per-call cache_dir option, never relying on whichever caller happened to load first. <!-- @rule RL-b588 discovered:rd-20261116-061901 -->
- Every pipeline() call passes an explicit dtype (the repo's 'q8'), so the quantization never falls back to environment defaults. <!-- @rule RL-d254 discovered:rd-20261116-061901 -->
- A cached transformers pipeline that is evicted or reset (provider cache clear, load failure) is released with await pipeline.dispose() before its reference is dropped. <!-- @rule RL-fff5 discovered:rd-20261116-061901 -->
