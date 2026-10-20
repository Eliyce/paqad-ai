import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { InferenceMessage, InferenceProvider } from '@/context/inference-provider.js';
import { DOMAINS, STACKS, type Domain, type Stack } from '@/core/types/domain.js';
import type { DetectionReport } from '@/core/types/health.js';
import { STACK_ECOSYSTEMS, type StackEcosystem } from '@/core/types/introspection.js';

import { buildDetectionReport } from './report.js';

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

const MAX_FILE_BYTES = 4096;
const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_CONFIDENCE = 0.6;

export interface AIDetectorOptions {
  provider?: InferenceProvider | null;
  timeoutMs?: number;
  minConfidence?: number;
}

interface ParsedAIDetection {
  domain: Domain | null;
  stack: Stack | null;
  ecosystem: StackEcosystem | null;
  confidence_score: number;
}

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
    try {
      const content = readFileSync(path, 'utf8').slice(0, MAX_FILE_BYTES);
      samples.push({ file, content });
    } catch {}
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
