import type { BoundaryInterface, UnhandledVariant } from './types.js';

export interface ExtractionResult {
  boundary: BoundaryInterface;
  unhandled_by_consumer: Map<string, UnhandledVariant[]>;
}

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
