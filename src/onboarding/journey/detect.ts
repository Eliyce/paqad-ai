import {
  STACK_CAPABILITIES_MAP,
  STACKS,
  isStack,
  validateCapabilitiesForStack,
} from '@/core/types/domain.js';
import { Detector } from '@/detection/detector.js';

import { JourneyRefusal } from './errors.js';
import type { DetectionRecord, JourneyRun } from './types.js';

export interface DetectOutcome {
  needs_ai_choice: boolean;
  detection: DetectionRecord | null;
  candidates: Array<{ stack: string; capabilities: readonly string[] }>;
  report: unknown;
}

export async function detectProject(projectRoot: string, now: Date): Promise<DetectOutcome> {
  const report = await new Detector().detect(projectRoot, { persist: false });
  const stack = report.detected_stack;
  const unsure = stack === null || report.confidence === 'low';
  if (unsure || stack === null) {
    return {
      needs_ai_choice: true,
      detection: null,
      candidates: STACKS.map((id) => ({ stack: id, capabilities: STACK_CAPABILITIES_MAP[id] })),
      report,
    };
  }
  const signals = report.signals.map((signal) => JSON.stringify(signal)).slice(0, 3);
  return {
    needs_ai_choice: false,
    detection: {
      stack,
      capabilities: validCapabilities(stack, report.detected_capabilities),
      source: 'detector',
      reason: `detected with ${report.confidence} confidence${signals.length > 0 ? ` from ${signals.join(', ')}` : ''}`,
      detected_at: now.toISOString(),
    },
    candidates: [],
    report,
  };
}

function validCapabilities(stack: string, capabilities: readonly string[]): string[] {
  if (!isStack(stack)) return [];
  const invalid = new Set(validateCapabilitiesForStack(stack, capabilities));
  return capabilities.filter((capability) => !invalid.has(capability));
}

export function chooseStack(
  run: JourneyRun,
  input: { stack: string; capabilities: string[]; reason: string },
  now: Date,
): DetectionRecord {
  if (run.stages.setup.status !== 'not_started') {
    throw new JourneyRefusal('The stack cannot change after step 2 (Set up paqad) has started.');
  }
  if (!isStack(input.stack)) {
    throw new JourneyRefusal(
      `"${input.stack}" is not a known stack. Pick one of: ${STACKS.join(', ')}`,
    );
  }
  const invalid = validateCapabilitiesForStack(input.stack, input.capabilities);
  if (invalid.length > 0) {
    throw new JourneyRefusal(`These capabilities do not fit ${input.stack}: ${invalid.join(', ')}`);
  }
  if (input.reason.trim() === '')
    throw new JourneyRefusal('Say in one line why this stack fits (--reason).');
  return {
    stack: input.stack,
    capabilities: input.capabilities,
    source: 'ai',
    reason: input.reason.trim(),
    detected_at: now.toISOString(),
  };
}
