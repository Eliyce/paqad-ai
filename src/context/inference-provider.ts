export interface InferenceMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface InferenceCompleteOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface InferenceProvider {
  complete(messages: InferenceMessage[], opts?: InferenceCompleteOptions): Promise<string>;
}
