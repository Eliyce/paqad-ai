/**
 * FR-BT2: State Set Extraction
 *
 * Given a BoundaryInterface, determines which states are "handled" by each
 * consumer spec by scanning the consumer spec's Markdown text for mentions
 * of each state value.
 *
 * Returns the set of unhandled variants — states in the producer's output set
 * that never appear in the consumer spec.
 */

import type { BoundaryInterface, UnhandledVariant } from './types.js';

export interface ExtractionResult {
  boundary: BoundaryInterface;
  /** Per-consumer map from consumer_spec → array of unhandled states. */
  unhandled_by_consumer: Map<string, UnhandledVariant[]>;
}

/**
 * Compute unhandled variants for one BoundaryInterface.
 *
 * @param boundary   The detected boundary.
 * @param specTexts  Map from spec-slug to the spec's full Markdown text.
 */
export function extractUnhandledVariants(
  boundary: BoundaryInterface,
  specTexts: Map<string, string>,
): ExtractionResult {
  const unhandledByConsumer = new Map<string, UnhandledVariant[]>();

  for (const consumerSpec of boundary.consumer_specs) {
    const specText = specTexts.get(consumerSpec) ?? '';
    const specLower = specText.toLowerCase();

    const unhandled: UnhandledVariant[] = boundary.output_states
      .filter((state) => !specLower.includes(state.toLowerCase()))
      .map((state) => ({
        type_name: boundary.type_name,
        state,
        producer_spec: boundary.producer_spec,
        consumer_spec: consumerSpec,
      }));

    unhandledByConsumer.set(consumerSpec, unhandled);
  }

  return { boundary, unhandled_by_consumer: unhandledByConsumer };
}
