import type { DesignTokensDocument } from '@/core/types/design-tokens.js';

// A neutral, schema-valid *scaffold* — not a brand. `seed()` writes this so a
// project has a tokens file to fill in, but the values are deliberately generic
// placeholders, not invented brand colours/fonts. The documentation workflow
// refuses to generate design-system docs from this scaffold (see
// `DesignTokensPlaceholderError`) so it never ships docs describing a design
// system that does not exist. Replace these values, delete the `$comment`
// placeholder marker, then re-run the documentation workflow.
export const PLACEHOLDER_DESIGN_TOKENS: DesignTokensDocument = {
  color: {
    primary: {
      $value: '#000000',
      $type: 'color',
      $description: 'PLACEHOLDER — replace with your primary brand color.',
    },
    secondary: {
      $value: '#000000',
      $type: 'color',
      $description: 'PLACEHOLDER — replace with your secondary brand color.',
    },
    surface: {
      $value: '#FFFFFF',
      $type: 'color',
      $description: 'PLACEHOLDER — replace with your default surface color.',
    },
    text: {
      default: {
        $value: '#000000',
        $type: 'color',
        $description: 'PLACEHOLDER — replace with your default text color.',
      },
    },
  },
  typography: {
    fontFamily: {
      body: {
        $value: 'system-ui, sans-serif',
        $type: 'fontFamily',
        $description: 'PLACEHOLDER — replace with your body font stack.',
      },
      display: {
        $value: 'system-ui, sans-serif',
        $type: 'fontFamily',
        $description: 'PLACEHOLDER — replace with your display font stack.',
      },
    },
  },
  spacing: {
    sm: { $value: '0.5rem', $type: 'dimension', $description: 'PLACEHOLDER spacing step.' },
    md: { $value: '1rem', $type: 'dimension', $description: 'PLACEHOLDER spacing step.' },
    lg: { $value: '1.5rem', $type: 'dimension', $description: 'PLACEHOLDER spacing step.' },
  },
  radius: {
    md: { $value: '0.5rem', $type: 'dimension', $description: 'PLACEHOLDER corner radius.' },
  },
};
