import type { DesignTokensDocument } from '@/core/types/design-tokens.js';

export const DEFAULT_DESIGN_TOKENS: DesignTokensDocument = {
  color: {
    primary: { $value: '#0F766E', $type: 'color', $description: 'Primary brand color.' },
    secondary: { $value: '#0F172A', $type: 'color', $description: 'Secondary brand color.' },
    accent: { $value: '#F59E0B', $type: 'color', $description: 'Accent color.' },
    surface: { $value: '#FFFFFF', $type: 'color', $description: 'Default surface color.' },
    text: {
      default: { $value: '#0F172A', $type: 'color', $description: 'Default text color.' },
      muted: { $value: '#475569', $type: 'color', $description: 'Muted text color.' },
    },
    semantic: {
      success: { $value: '#16A34A', $type: 'color' },
      warning: { $value: '#EAB308', $type: 'color' },
      error: { $value: '#DC2626', $type: 'color' },
      info: { $value: '#2563EB', $type: 'color' },
    },
  },
  typography: {
    fontFamily: {
      body: { $value: 'Inter, system-ui, sans-serif', $type: 'fontFamily' },
      display: { $value: 'Satoshi, system-ui, sans-serif', $type: 'fontFamily' },
      mono: { $value: 'JetBrains Mono, monospace', $type: 'fontFamily' },
    },
    heading: {
      h1: {
        $value: {
          fontFamily: '{typography.fontFamily.display.$value}',
          fontSize: '3rem',
          fontWeight: 700,
          lineHeight: 1.1,
        },
        $type: 'typography',
      },
      h2: {
        $value: {
          fontFamily: '{typography.fontFamily.display.$value}',
          fontSize: '2.25rem',
          fontWeight: 600,
          lineHeight: 1.2,
        },
        $type: 'typography',
      },
      body: {
        $value: {
          fontFamily: '{typography.fontFamily.body.$value}',
          fontSize: '1rem',
          fontWeight: 400,
          lineHeight: 1.5,
        },
        $type: 'typography',
      },
    },
  },
  spacing: {
    xs: { $value: '0.25rem', $type: 'dimension' },
    sm: { $value: '0.5rem', $type: 'dimension' },
    md: { $value: '1rem', $type: 'dimension' },
    lg: { $value: '1.5rem', $type: 'dimension' },
    xl: { $value: '2rem', $type: 'dimension' },
  },
  radius: {
    sm: { $value: '0.25rem', $type: 'dimension' },
    md: { $value: '0.5rem', $type: 'dimension' },
    lg: { $value: '1rem', $type: 'dimension' },
    full: { $value: '9999px', $type: 'dimension' },
  },
  shadow: {
    sm: {
      $value: { color: '#0000001a', offsetX: '0px', offsetY: '1px', blur: '2px', spread: '0px' },
      $type: 'shadow',
    },
    md: {
      $value: {
        color: '#0000001a',
        offsetX: '0px',
        offsetY: '4px',
        blur: '6px',
        spread: '-1px',
      },
      $type: 'shadow',
    },
  },
  motion: {
    duration: {
      fast: { $value: '150ms', $type: 'duration' },
      normal: { $value: '300ms', $type: 'duration' },
    },
    easing: {
      emphasis: { $value: [0.2, 0, 0, 1], $type: 'cubicBezier' },
    },
  },
  components: {
    button: {
      radius: { $value: '{radius.md.$value}', $type: 'dimension' },
      paddingX: { $value: '{spacing.md.$value}', $type: 'dimension' },
      paddingY: { $value: '{spacing.sm.$value}', $type: 'dimension' },
    },
    card: {
      radius: { $value: '{radius.lg.$value}', $type: 'dimension' },
      shadow: { $value: '{shadow.md.$value}', $type: 'shadow' },
    },
  },
  accessibility: {
    contrast: { $value: 'WCAG 2.1 AA', $type: 'string' },
    focusRing: { $value: '2px solid {color.accent.$value}', $type: 'string' },
    reduceMotion: { $value: true, $type: 'boolean' },
  },
};
