export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StructuredLogRecord {
  level: LogLevel;
  timestamp: string;
  runtime: string;
  event: string;
  correlation_id?: string;
  [key: string]: unknown;
}

export type RedactionAllowlist = readonly string[];

export interface RedactionEvent {
  field: string;
  placeholder: string;
  timestamp: string;
}
