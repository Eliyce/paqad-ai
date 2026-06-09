// PQD-169: chat-completion abstraction for the rolling summariser.
//
// `TurnSummarizer.summarise` needs to call an LLM but must stay decoupled from
// any concrete SDK. A consumer (the desktop, an API layer, a test) supplies an
// `InferenceProvider`; the engine ships only the interface and a stub for tests.
// A concrete provider (Anthropic SDK, local model adapter, …) is a follow-up.

/** A single chat message passed to {@link InferenceProvider.complete}. */
export interface InferenceMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Options for a single completion call. */
export interface InferenceCompleteOptions {
  /** Soft deadline in milliseconds; the engine also enforces its own timeout. */
  timeoutMs?: number;
  /** Cancellation signal; aborted before/while running yields no result. */
  signal?: AbortSignal;
}

/** Minimal chat-completion provider the summariser calls. */
export interface InferenceProvider {
  complete(messages: InferenceMessage[], opts?: InferenceCompleteOptions): Promise<string>;
}
