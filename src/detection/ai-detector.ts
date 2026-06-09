import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { InferenceMessage, InferenceProvider } from '@/context/inference-provider.js';
import { DOMAINS, STACKS, type Domain, type Stack } from '@/core/types/domain.js';
import type { DetectionReport } from '@/core/types/health.js';
import { STACK_ECOSYSTEMS, type StackEcosystem } from '@/core/types/introspection.js';

import { buildDetectionReport } from './report.js';

/** Top-level manifest files the AI path samples to compose its prompt. */
const MANIFEST_FILES = [
  'package.json',
  'pubspec.yaml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'Gemfile',
  'composer.json',
] as const;

/** Per-file read cap (bytes) — keeps the prompt small and bounded. */
const MAX_FILE_BYTES = 4096;
/** Hard wall-clock timeout for the inference call. */
const DEFAULT_TIMEOUT_MS = 10_000;
/** Reports below this score are discarded so the static fallback runs instead. */
const MIN_CONFIDENCE = 0.6;

export interface AIDetectorOptions {
  /**
   * Inference provider that performs the actual LLM call. When omitted the AI path
   * is considered unavailable and {@link AIDetector.detect} always returns `null`,
   * so the engine falls through to static detection (AC2).
   */
  provider?: InferenceProvider | null;
  /** Override the hard timeout (ms). Defaults to 10s. */
  timeoutMs?: number;
  /** Override the minimum accepted confidence. Defaults to 0.6. */
  minConfidence?: number;
}

interface ParsedAIDetection {
  domain: Domain | null;
  stack: Stack | null;
  ecosystem: StackEcosystem | null;
  confidence_score: number;
}

/**
 * PQD-423: the AI-first stack detection path. Reads the project's top-level
 * manifests, asks an injected {@link InferenceProvider} to classify the stack, and
 * returns a {@link DetectionReport} tagged `source: 'ai'` — or `null` on any
 * failure (no provider, no manifests, call/parse error, timeout, or low
 * confidence), in which case the {@link Detector} runs its static fallback.
 *
 * Failure isolation is total: this class never throws. The static path therefore
 * remains the guaranteed last resort.
 */
export class AIDetector {
  private readonly provider: InferenceProvider | null;
  private readonly timeoutMs: number;
  private readonly minConfidence: number;

  constructor(options: AIDetectorOptions = {}) {
    this.provider = options.provider ?? null;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.minConfidence = options.minConfidence ?? MIN_CONFIDENCE;
  }

  async detect(projectRoot: string): Promise<DetectionReport | null> {
    const provider = this.provider;
    if (provider === null) {
      return null;
    }

    const manifests = readManifestSamples(projectRoot);
    if (manifests.length === 0) {
      return null;
    }

    let raw: string;
    try {
      raw = await this.completeWithTimeout(provider, buildPrompt(manifests));
    } catch {
      return null;
    }

    const parsed = parseResponse(raw);
    if (parsed === null || parsed.confidence_score < this.minConfidence) {
      return null;
    }

    return buildDetectionReport({
      domain: parsed.domain,
      stack: parsed.stack,
      ecosystem: parsed.ecosystem,
      confidence: scoreToCategorical(parsed.confidence_score),
      confidenceScore: parsed.confidence_score,
      source: 'ai',
      detectionPhase: parsed.stack === null ? 'none' : 'framework',
      recommendedCapabilities:
        parsed.domain === 'coding' ? ['content', 'coding', 'security'] : ['content'],
      signals: [],
    });
  }

  /**
   * Run the provider call under a hard timeout. If the provider ignores the
   * abort signal, the timer still rejects so the caller is never blocked past
   * {@link timeoutMs}.
   */
  private completeWithTimeout(
    provider: InferenceProvider,
    messages: InferenceMessage[],
  ): Promise<string> {
    const controller = new AbortController();
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort();
        reject(new Error('ai-detection-timeout'));
      }, this.timeoutMs);

      provider.complete(messages, { timeoutMs: this.timeoutMs, signal: controller.signal }).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }
}

function readManifestSamples(projectRoot: string): Array<{ file: string; content: string }> {
  const samples: Array<{ file: string; content: string }> = [];
  for (const file of MANIFEST_FILES) {
    const path = join(projectRoot, file);
    if (!existsSync(path)) {
      continue;
    }
    try {
      const content = readFileSync(path, 'utf8').slice(0, MAX_FILE_BYTES);
      samples.push({ file, content });
    } catch {
      // Unreadable file — skip it; other manifests may still carry signal.
    }
  }
  return samples;
}

function buildPrompt(manifests: Array<{ file: string; content: string }>): InferenceMessage[] {
  const manifestBlock = manifests
    .map((manifest) => `### ${manifest.file}\n${manifest.content}`)
    .join('\n\n');

  return [
    {
      role: 'system',
      content:
        "You classify a software project's stack from its manifest files. " +
        'Respond with a single JSON object and nothing else, using exactly these keys: ' +
        '"domain" (one of "coding", "content", or null), ' +
        '"stack" (one of the known stack slugs or null), ' +
        '"ecosystem" (one of "node", "php", "python", "ruby", "jvm", "go", "rust", "dart", or null), ' +
        '"confidence_score" (a number between 0 and 1). ' +
        `Known stack slugs: ${STACKS.join(', ')}.`,
    },
    {
      role: 'user',
      content: `Classify this project from its manifests:\n\n${manifestBlock}`,
    },
  ];
}

function parseResponse(raw: string): ParsedAIDetection | null {
  const json = extractJsonObject(raw);
  if (json === null) {
    return null;
  }

  const confidenceRaw = json.confidence_score;
  if (typeof confidenceRaw !== 'number' || !Number.isFinite(confidenceRaw)) {
    return null;
  }
  const confidence_score = Math.min(1, Math.max(0, confidenceRaw));

  return {
    domain: isDomain(json.domain) ? json.domain : null,
    stack: isStack(json.stack) ? json.stack : null,
    ecosystem: isEcosystem(json.ecosystem) ? json.ecosystem : null,
    confidence_score,
  };
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isDomain(value: unknown): value is Domain {
  return typeof value === 'string' && (DOMAINS as readonly string[]).includes(value);
}

function isStack(value: unknown): value is Stack {
  return typeof value === 'string' && (STACKS as readonly string[]).includes(value);
}

function isEcosystem(value: unknown): value is StackEcosystem {
  return typeof value === 'string' && (STACK_ECOSYSTEMS as readonly string[]).includes(value);
}

function scoreToCategorical(score: number): DetectionReport['confidence'] {
  if (score >= 0.85) {
    return 'high';
  }
  if (score >= 0.6) {
    return 'medium';
  }
  return 'low';
}
