import type { DesignTokensDocument } from '@/core/types/design-tokens.js';

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
