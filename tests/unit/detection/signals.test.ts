import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  detectFlutterSignals,
  detectLaravelSignals,
  detectReactSignals,
  detectShortVideoSignals,
  detectSvelteSignals,
  detectVueSignals,
} from '@/detection/index.js';

describe('framework signal detectors', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-signals-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('detects React signals and inferred capabilities from package and config files', () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        dependencies: {
          react: '^19.0.0',
          'react-dom': '^19.0.0',
          next: '^15.0.0',
          tailwindcss: '^4.0.0',
          vite: '^5.0.0',
          '@vitejs/plugin-react': '^4.0.0',
        },
        devDependencies: {
          eslint: '^9.0.0',
        },
      }),
    );
    writeFileSync(join(root, 'vite.config.ts'), "import react from '@vitejs/plugin-react';");
    writeFileSync(join(root, 'tsconfig.json'), '{ "compilerOptions": { "jsx": "react-jsx" } }');
    writeFileSync(join(root, '.eslintrc.json'), '{ "plugins": ["react"] }');
    writeFileSync(join(root, 'src', 'App.tsx'), 'export default function App() {}');
    writeFileSync(join(root, 'src', 'main.tsx'), 'import App from "./App";');

    const result = detectReactSignals(root);

    expect(result.capabilities.sort()).toEqual(['next', 'tailwind', 'vite-spa']);
    expect(result.signals.map((entry) => entry.signal)).toEqual(
      expect.arrayContaining([
        'package dependency react',
        'package dependency react-dom',
        'package dependency next',
        'package dependency @vitejs/plugin-react',
        'vite config uses @vitejs/plugin-react',
        'React App entrypoint found',
        'React main entrypoint found',
        'tsconfig jsx runtime set to react-jsx',
        'ESLint React plugin configuration found',
      ]),
    );
  });

  it('falls back to vite-spa for React projects without an explicit framework capability', () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        dependencies: {
          vite: '^5.0.0',
        },
      }),
    );
    writeFileSync(join(root, 'vite.config.ts'), 'import { defineConfig } from "vite";');

    const result = detectReactSignals(root);
    expect(result.capabilities).toEqual(['vite-spa']);
  });

  it('detects additional React framework variants and jsx entrypoint paths', () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        dependencies: {
          react: '^19.0.0',
          gatsby: '^5.0.0',
          remix: '^2.0.0',
        },
      }),
    );
    writeFileSync(join(root, 'src', 'App.jsx'), 'export default function App() {}');
    writeFileSync(join(root, 'src', 'index.jsx'), 'import App from "./App";');

    const result = detectReactSignals(root);

    expect(result.capabilities.sort()).toEqual(['gatsby', 'remix']);
    expect(result.signals.map((entry) => entry.signal)).toEqual(
      expect.arrayContaining([
        'package dependency react',
        'package dependency gatsby',
        'Remix dependency detected',
        'React App entrypoint found',
        'React main entrypoint found',
      ]),
    );
  });

  it('detects Vue signals and Nuxt/Vite/Quasar capabilities', () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        dependencies: {
          vue: '^3.5.0',
          nuxt: '^3.0.0',
          pinia: '^3.0.0',
          tailwindcss: '^4.0.0',
          'vue-router': '^4.0.0',
          '@vitejs/plugin-vue': '^5.0.0',
          quasar: '^2.0.0',
        },
      }),
    );
    writeFileSync(join(root, 'vite.config.ts'), 'import { pluginVue } from "vite";');
    writeFileSync(join(root, 'nuxt.config.ts'), 'export default defineNuxtConfig({});');
    writeFileSync(join(root, 'src', 'App.vue'), '<template />');

    const result = detectVueSignals(root);

    expect(result.capabilities.sort()).toEqual(['nuxt', 'quasar', 'tailwind', 'vite-spa']);
    expect(result.signals.map((entry) => entry.signal)).toEqual(
      expect.arrayContaining([
        'package dependency vue',
        'package dependency nuxt',
        'Quasar dependency detected',
        'package dependency @vitejs/plugin-vue',
        'package dependency vue-router',
        'Vue state library detected',
        'Vue App entrypoint found',
        'Nuxt config found',
        'vite config uses Vue plugin',
      ]),
    );
  });

  it('falls back to vite-spa for Vue projects without explicit framework capabilities', () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        dependencies: {
          vite: '^5.0.0',
        },
      }),
    );
    writeFileSync(join(root, 'vite.config.ts'), 'import { defineConfig } from "vite";');

    const result = detectVueSignals(root);

    expect(result.capabilities).toEqual(['vite-spa']);
    expect(result.signals).toEqual([]);
  });

  it('detects Laravel signals from composer, frontend, and framework files', () => {
    mkdirSync(join(root, 'app'), { recursive: true });
    mkdirSync(join(root, 'routes'), { recursive: true });
    mkdirSync(join(root, 'resources', 'js'), { recursive: true });
    mkdirSync(join(root, 'config'), { recursive: true });
    writeFileSync(join(root, 'artisan'), '');
    writeFileSync(
      join(root, 'composer.json'),
      JSON.stringify({
        require: {
          'laravel/framework': '^12.0',
          'inertiajs/inertia-laravel': '^2.0.0',
          'laravel/boost': '^1.0.0',
          'laravel/sail': '^1.0.0',
        },
      }),
    );
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        dependencies: {
          react: '^19.0.0',
          vue: '^3.5.0',
        },
      }),
    );
    writeFileSync(join(root, 'resources', 'js', 'App.tsx'), 'export default function App() {}');
    writeFileSync(join(root, 'config', 'boost.php'), '<?php');

    const result = detectLaravelSignals(root);

    expect(result.capabilities.sort()).toEqual(['boost', 'inertia', 'react', 'sail', 'vue']);
    expect(result.signals.map((entry) => entry.signal)).toEqual(
      expect.arrayContaining([
        'artisan file exists',
        'composer dependency laravel/framework',
        'composer dependency inertiajs/inertia-laravel',
        'composer dependency laravel/boost',
        'composer dependency laravel/sail',
        'app directory exists',
        'routes directory exists',
        'package dependency react',
        'package dependency vue',
        'React entrypoint found',
        'boost config exists',
      ]),
    );
  });

  it('detects Flutter only when pubspec declares flutter', () => {
    writeFileSync(join(root, 'pubspec.yaml'), 'dependencies:\n  flutter:\n    sdk: flutter\n');

    expect(detectFlutterSignals(root)).toEqual([
      {
        signal: 'pubspec.yaml declares flutter dependency',
        file: 'pubspec.yaml',
        implies: 'flutter',
        confidence: 'high',
      },
    ]);

    writeFileSync(join(root, 'pubspec.yaml'), 'dependencies:\n  dio: ^5.0.0\n');
    expect(detectFlutterSignals(root)).toEqual([]);

    rmSync(join(root, 'pubspec.yaml'));
    expect(detectFlutterSignals(root)).toEqual([]);
  });

  it('detects short-video projects from either the profile or marker file', () => {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, '.paqad', 'project-profile.yaml'),
      'routing:\n  domain: content\n  stack: short-video\n',
    );
    writeFileSync(join(root, '.short-video-project'), '');

    expect(detectShortVideoSignals(root)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signal: 'project profile declares content/short-video',
          file: '.paqad/project-profile.yaml',
          implies: 'short-video',
          confidence: 'high',
        }),
        expect.objectContaining({
          signal: 'short-video marker file exists',
          file: '.short-video-project',
          implies: 'short-video',
          confidence: 'medium',
        }),
      ]),
    );
  });

  it('detects Svelte signals and capabilities from package and project files', () => {
    mkdirSync(join(root, 'src', 'routes'), { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        dependencies: {
          svelte: '^5.0.0',
          '@sveltejs/kit': '^2.0.0',
          '@sveltejs/vite-plugin-svelte': '^4.0.0',
          tailwindcss: '^4.0.0',
        },
      }),
    );
    writeFileSync(join(root, 'svelte.config.js'), 'export default {};');
    writeFileSync(join(root, 'src', 'app.html'), '<div id="app"></div>');
    writeFileSync(
      join(root, 'vite.config.ts'),
      "import { sveltekit } from '@sveltejs/vite-plugin-svelte';",
    );

    const result = detectSvelteSignals(root);

    expect(result.capabilities).toEqual(['tailwind']);
    expect(result.signals.map((entry) => entry.signal)).toEqual(
      expect.arrayContaining([
        'package dependency svelte',
        'package dependency @sveltejs/kit',
        'package dependency @sveltejs/vite-plugin-svelte',
        'Svelte config found',
        'SvelteKit routes directory found',
        'SvelteKit app.html found',
        'vite config uses Svelte plugin',
      ]),
    );
  });

  it('supports Svelte detection via vite.config.js and returns empty when no Svelte signals exist', () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        dependencies: {
          lodash: '^4.0.0',
        },
      }),
    );
    writeFileSync(
      join(root, 'vite.config.js'),
      "import { sveltekit } from '@sveltejs/vite-plugin-svelte';",
    );

    const withViteOnly = detectSvelteSignals(root);
    expect(withViteOnly.capabilities).toEqual([]);
    expect(withViteOnly.signals.map((entry) => entry.signal)).toContain(
      'vite config uses Svelte plugin',
    );

    rmSync(join(root, 'package.json'));
    rmSync(join(root, 'vite.config.js'));
    expect(detectSvelteSignals(root)).toEqual({ signals: [], capabilities: [] });
  });
});
