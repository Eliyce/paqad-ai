import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Detector } from '@/detection/detector';

describe('Detector', () => {
  let fixturesRoot: string;
  let detector: Detector;

  beforeEach(() => {
    fixturesRoot = mkdtempSync(join(tmpdir(), 'paqad-ai-detection-'));
    seedDetectionFixtures(fixturesRoot);
    detector = new Detector();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(fixturesRoot, { recursive: true, force: true });
  });

  it('detects globally installed packs in the core runtime path', async () => {
    const runtimeRoot = join(fixturesRoot, 'runtime-root');
    const globalRoot = join(fixturesRoot, 'global-packs');
    const projectRoot = join(fixturesRoot, 'global-pack-project');
    mkdirSync(join(runtimeRoot, 'capabilities', 'coding', 'stacks'), { recursive: true });
    mkdirSync(globalRoot, { recursive: true });
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'demo', dependencies: { 'custom-stack-runtime': '^1.0.0' } }, null, 2),
    );
    mkdirSync(join(globalRoot, 'custom-stack', 'rules'), { recursive: true });
    writeFileSync(join(globalRoot, 'custom-stack', 'rules', 'conventions.md'), '# conventions\n');
    writeFileSync(
      join(globalRoot, 'custom-stack', 'pack.yaml'),
      [
        'name: custom-stack',
        'display_name: Custom Stack',
        'ecosystem: node',
        'version: 1.0.0',
        'description: Global custom stack',
        'maintainer: test',
        'detection:',
        '  manifests:',
        '    - file: package.json',
        '      packages: [custom-stack-runtime]',
        'docs:',
        '  conventions_template: rules/conventions.md',
      ].join('\n'),
    );

    const runtimePaths = await import('@/core/runtime-paths.js');
    const originalGlobalRoot = process.env.PAQAD_GLOBAL_PACKS_ROOT;
    vi.spyOn(runtimePaths, 'getRuntimeRoot').mockReturnValue(runtimeRoot);
    process.env.PAQAD_GLOBAL_PACKS_ROOT = globalRoot;

    try {
      const report = await detector.detect(projectRoot);

      expect(report.detected_stack).toBe('custom-stack');
      expect(report.matched_packs).toEqual(['custom-stack']);
    } finally {
      if (originalGlobalRoot === undefined) {
        delete process.env.PAQAD_GLOBAL_PACKS_ROOT;
      } else {
        process.env.PAQAD_GLOBAL_PACKS_ROOT = originalGlobalRoot;
      }
    }
  });

  it('detects a minimal Laravel project', async () => {
    const report = await detector.detect(join(fixturesRoot, 'new-laravel'));

    expect(report.detected_domain).toBe('coding');
    expect(report.detected_stack).toBe('laravel');
    expect(report.detected_capabilities).toEqual([]);
    expect(report.matched_packs).toEqual(['laravel']);
    expect(report.recommended_capabilities).toEqual(['content', 'coding', 'security']);
    expect(report.confidence).toBe('high');
  });

  it('detects Laravel with Inertia and React capabilities', async () => {
    const report = await detector.detect(join(fixturesRoot, 'existing-laravel'));

    expect(report.detected_stack).toBe('laravel');
    expect(report.detected_capabilities).toEqual(['inertia', 'react']);
    expect(report.detected_traits).toEqual(['inertia', 'react']);
    expect(report.signals.map((signal) => signal.implies)).toContain('inertia');
    expect(report.signals.map((signal) => signal.implies)).toContain('react');
  });

  it('detects Flutter projects from pubspec', async () => {
    const report = await detector.detect(join(fixturesRoot, 'new-flutter'));

    expect(report.detected_domain).toBe('coding');
    expect(report.detected_stack).toBe('flutter');
    expect(report.matched_packs).toEqual(['flutter']);
    expect(report.confidence).toBe('low');
  });

  it('detects standalone React projects and preserves sub-stack capabilities', async () => {
    const report = await detector.detect(join(fixturesRoot, 'new-react'));

    expect(report.detected_domain).toBe('coding');
    expect(report.detected_stack).toBe('react');
    expect(report.matched_packs).toEqual(['react']);
    expect(report.detected_capabilities).toContain('vite-spa');
    expect(report.detected_capabilities).toContain('compose');
    expect(report.confidence).toBe('high');
  });

  it('detects Next.js as a first-class stack instead of react', async () => {
    const report = await detector.detect(join(fixturesRoot, 'new-nextjs'));

    expect(report.detected_domain).toBe('coding');
    expect(report.detected_stack).toBe('nextjs');
    expect(report.matched_packs).toEqual(['nextjs']);
    expect(report.detected_capabilities).toContain('app-router');
    expect(report.detected_capabilities).toContain('tailwind');
    expect(report.detected_capabilities).toContain('prisma');
  });

  it('detects laravel sail environments without confusing them with plain compose', async () => {
    const report = await detector.detect(join(fixturesRoot, 'new-laravel-sail'));

    expect(report.detected_domain).toBe('coding');
    expect(report.detected_stack).toBe('laravel');
    expect(report.detected_capabilities).toContain('sail');
    expect(report.detected_capabilities).toContain('compose');
    expect(report.signals.map((signal) => signal.implies)).toContain('sail');
  });

  it('detects standalone Vue projects and preserves sub-stack capabilities', async () => {
    const report = await detector.detect(join(fixturesRoot, 'new-vue'));

    expect(report.detected_domain).toBe('coding');
    expect(report.detected_stack).toBe('vue');
    expect(report.matched_packs).toEqual(['vue']);
    expect(report.detected_capabilities).toContain('nuxt');
    expect(report.confidence).toBe('high');
  });

  it('detects short-video projects from the framework profile', async () => {
    const report = await detector.detect(join(fixturesRoot, 'new-short-video'));

    expect(report.detected_domain).toBe('content');
    expect(report.detected_stack).toBe('short-video');
    expect(report.matched_packs).toEqual([]);
    expect(report.recommended_capabilities).toEqual(['content']);
    expect(report.confidence).toBe('low');
  });

  it('returns null and low confidence for empty projects', async () => {
    const report = await detector.detect(join(fixturesRoot, 'empty'));

    expect(report.detected_domain).toBeNull();
    expect(report.detected_stack).toBeNull();
    expect(report.matched_packs).toEqual([]);
    expect(report.recommended_capabilities).toEqual(['content']);
    expect(report.confidence).toBe('low');
    expect(report.signals).toEqual([]);
  });

  it('preserves environment-only signals without inventing a framework', async () => {
    const composeOnlyRoot = join(fixturesRoot, 'compose-only');
    mkdirSync(composeOnlyRoot, { recursive: true });
    writeFileSync(join(composeOnlyRoot, 'compose.yaml'), 'services:\n  app:\n    image: node:20\n');

    const report = await detector.detect(composeOnlyRoot);

    expect(report.detected_domain).toBeNull();
    expect(report.detected_stack).toBeNull();
    expect(report.recommended_capabilities).toEqual(['content']);
    expect(report.detected_capabilities).toContain('compose');
    expect(report.signals.map((signal) => signal.implies)).toContain('compose');
  });

  it('returns an ambiguous result for multi-stack projects', async () => {
    const report = await detector.detect(join(fixturesRoot, 'multi-stack'));

    expect(report.detected_domain).toBeNull();
    expect(report.detected_stack).toBeNull();
    expect(report.matched_packs).toEqual(['flutter', 'laravel']);
    expect(report.recommended_capabilities).toEqual(['content', 'coding', 'security']);
    expect(report.confidence).toBe('low');
    expect(report.signals.map((signal) => signal.implies).sort()).toEqual(['flutter', 'laravel']);
  });

  it('detects sibling application roots under an otherwise empty repository root', async () => {
    const report = await detector.detect(join(fixturesRoot, 'split-repo'));

    expect(report.detected_domain).toBe('coding');
    expect(report.detected_stack).toBe('laravel');
    expect(report.matched_packs).toEqual(['flutter', 'laravel']);
    expect(report.repository?.projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ root: 'backend', role: 'standalone' }),
        expect.objectContaining({ root: 'mobile', role: 'standalone' }),
      ]),
    );
    expect(report.repository?.primary_project_root).toBe('backend');
  });

  it('treats a nested frontend package as a component of a laravel app', async () => {
    const report = await detector.detect(join(fixturesRoot, 'laravel-with-frontend'));

    expect(report.detected_stack).toBe('laravel');
    expect(report.detected_capabilities).toContain('react');
    expect(report.repository?.projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ root: '.', role: 'standalone' }),
        expect.objectContaining({ root: 'frontend', role: 'component', parent_root: '.' }),
      ]),
    );
  });

  it('still detects Laravel when docs already exist', async () => {
    const report = await detector.detect(join(fixturesRoot, 'existing-with-docs'));

    expect(report.detected_stack).toBe('laravel');
    expect(report.detected_domain).toBe('coding');
  });

  it('detects node-cli archetype when bin field present and no framework matched', async () => {
    const report = await detector.detect(join(fixturesRoot, 'new-node-cli'));

    expect(report.detected_domain).toBe('coding');
    expect(report.detected_stack).toBe('node-cli');
    expect(report.matched_packs).toEqual(['node-cli']);
    expect(report.detection_phase).toBe('archetype');
    expect(report.recommended_capabilities).toEqual(['content', 'coding', 'security']);
    expect(report.confidence).toBe('high');
  });

  it('detects node-library archetype when main field present without bin', async () => {
    const report = await detector.detect(join(fixturesRoot, 'new-node-library'));

    expect(report.detected_domain).toBe('coding');
    expect(report.detected_stack).toBe('node-library');
    expect(report.matched_packs).toEqual(['node-library']);
    expect(report.detection_phase).toBe('archetype');
    expect(report.recommended_capabilities).toEqual(['content', 'coding', 'security']);
  });

  it('detects node-service archetype when scripts.start present without bin', async () => {
    const report = await detector.detect(join(fixturesRoot, 'new-node-service'));

    expect(report.detected_domain).toBe('coding');
    expect(report.detected_stack).toBe('node-service');
    expect(report.matched_packs).toEqual(['node-service']);
    expect(report.detection_phase).toBe('archetype');
  });

  it('framework pack wins over archetype — express project does not match node-service', async () => {
    const report = await detector.detect(join(fixturesRoot, 'new-express'));

    expect(report.detected_stack).toBe('express');
    expect(report.matched_packs).toEqual(['express']);
    expect(report.detection_phase).toBe('framework');
  });

  it('framework pack wins when project has both bin field and express dependency', async () => {
    const report = await detector.detect(join(fixturesRoot, 'express-with-bin'));

    expect(report.detected_stack).toBe('express');
    expect(report.detection_phase).toBe('framework');
    expect(report.matched_packs).toEqual(['express']);
  });

  it('detects Flask, NestJS, ASP.NET Core, and Kotlin Android packs', async () => {
    await expect(detector.detect(join(fixturesRoot, 'new-flask'))).resolves.toMatchObject({
      detected_stack: 'flask',
      matched_packs: ['flask'],
    });
    await expect(detector.detect(join(fixturesRoot, 'new-nestjs'))).resolves.toMatchObject({
      detected_stack: 'nestjs',
      matched_packs: ['nestjs'],
    });
    await expect(detector.detect(join(fixturesRoot, 'new-dotnet'))).resolves.toMatchObject({
      detected_stack: 'dotnet',
      matched_packs: ['dotnet'],
    });
    await expect(detector.detect(join(fixturesRoot, 'new-kotlin-android'))).resolves.toMatchObject({
      detected_stack: 'kotlin-android',
      matched_packs: ['kotlin-android'],
    });
  });

  it('sets detection_phase to none for empty projects', async () => {
    const report = await detector.detect(join(fixturesRoot, 'empty'));

    expect(report.detection_phase).toBe('none');
    expect(report.detected_domain).toBeNull();
  });

  it('detects typescript and vitest traits on node-cli project', async () => {
    const report = await detector.detect(join(fixturesRoot, 'new-node-cli'));

    expect(report.detected_traits).toContain('typescript');
    expect(report.detected_traits).toContain('vitest');
  });

  it('detects representative built-in packs across the new ecosystem families', async () => {
    await expect(detector.detect(join(fixturesRoot, 'new-django'))).resolves.toMatchObject({
      detected_stack: 'django',
      matched_packs: ['django'],
    });
    await expect(detector.detect(join(fixturesRoot, 'new-fastapi'))).resolves.toMatchObject({
      detected_stack: 'fastapi',
      matched_packs: ['fastapi'],
    });
    await expect(detector.detect(join(fixturesRoot, 'new-rails'))).resolves.toMatchObject({
      detected_stack: 'rails',
      matched_packs: ['rails'],
    });
    await expect(detector.detect(join(fixturesRoot, 'new-spring-boot'))).resolves.toMatchObject({
      detected_stack: 'spring-boot',
      matched_packs: ['spring-boot'],
    });
    await expect(detector.detect(join(fixturesRoot, 'new-express'))).resolves.toMatchObject({
      detected_stack: 'express',
      matched_packs: ['express'],
    });
    await expect(detector.detect(join(fixturesRoot, 'new-angular'))).resolves.toMatchObject({
      detected_stack: 'angular',
      matched_packs: ['angular'],
    });
    await expect(detector.detect(join(fixturesRoot, 'new-svelte'))).resolves.toMatchObject({
      detected_stack: 'svelte',
      matched_packs: ['svelte'],
    });
    await expect(detector.detect(join(fixturesRoot, 'new-astro'))).resolves.toMatchObject({
      detected_stack: 'astro',
      matched_packs: ['astro'],
    });
    await expect(detector.detect(join(fixturesRoot, 'new-go-web'))).resolves.toMatchObject({
      detected_stack: 'go-web',
      matched_packs: ['go-web'],
    });
    await expect(detector.detect(join(fixturesRoot, 'new-rust-web'))).resolves.toMatchObject({
      detected_stack: 'rust-web',
      matched_packs: ['rust-web'],
    });
  });
});

function seedDetectionFixtures(root: string): void {
  const fixtures: Record<string, string> = {
    'new-laravel/artisan': '',
    'new-laravel/composer.json': JSON.stringify({
      require: {
        'laravel/framework': '^12.0',
      },
    }),
    'new-laravel/app/.gitkeep': '',
    'new-laravel/routes/.gitkeep': '',
    'existing-laravel/artisan': '',
    'existing-laravel/composer.json': JSON.stringify({
      require: {
        'laravel/framework': '^12.0',
        'inertiajs/inertia-laravel': '^2.0',
      },
    }),
    'existing-laravel/package.json': JSON.stringify({
      dependencies: {
        react: '^19.0.0',
      },
    }),
    'existing-laravel/app/.gitkeep': '',
    'existing-laravel/routes/.gitkeep': '',
    'existing-laravel/resources/js/App.tsx': 'export default function App() {}',
    'new-react/package.json': JSON.stringify({
      dependencies: {
        react: '^19.0.0',
        'react-dom': '^19.0.0',
        '@vitejs/plugin-react': '^5.0.0',
        vite: '^7.0.0',
      },
    }),
    'new-react/src/App.tsx': 'export default function App() { return null; }',
    'new-react/vite.config.ts':
      'import react from "@vitejs/plugin-react"; export default { plugins: [react()] };',
    'new-react/tsconfig.json': JSON.stringify({
      compilerOptions: {
        jsx: 'react-jsx',
      },
    }),
    'new-react/compose.yaml': 'services:\n  web:\n    image: node:25\n',
    'new-vue/package.json': JSON.stringify({
      dependencies: {
        vue: '^3.5.0',
        nuxt: '^4.0.0',
      },
      devDependencies: {
        '@vitejs/plugin-vue': '^6.0.0',
      },
    }),
    'new-vue/src/App.vue': '<template><div>App</div></template>',
    'new-vue/nuxt.config.ts': 'export default defineNuxtConfig({});',
    'new-nextjs/package.json': JSON.stringify({
      dependencies: {
        next: '^16.0.0',
        react: '^19.0.0',
        'react-dom': '^19.0.0',
        tailwindcss: '^4.0.0',
        '@prisma/client': '^6.0.0',
      },
    }),
    'new-nextjs/app/page.tsx': 'export default function Page() { return null; }',
    'new-nextjs/next.config.ts': 'export default {}',
    'new-flutter/pubspec.yaml': 'dependencies:\n  flutter:\n    sdk: flutter\n',
    'new-flask/requirements.txt': 'flask==3.1.0\nsqlalchemy==2.0.0\n',
    'new-flask/app.py':
      'from flask import Flask\napp = Flask(__name__)\n@app.route("/")\ndef home():\n    return "ok"\n',
    'new-short-video/.paqad/project-profile.yaml':
      'routing:\n  domain: content\n  stack: short-video\n',
    'multi-stack/artisan': '',
    'multi-stack/pubspec.yaml': 'dependencies:\n  flutter:\n    sdk: flutter\n',
    'split-repo/backend/artisan': '',
    'split-repo/backend/composer.json': JSON.stringify({
      require: {
        'laravel/framework': '^12.0',
      },
    }),
    'split-repo/mobile/pubspec.yaml': 'dependencies:\n  flutter:\n    sdk: flutter\n',
    'laravel-with-frontend/artisan': '',
    'laravel-with-frontend/composer.json': JSON.stringify({
      require: {
        'laravel/framework': '^12.0',
      },
    }),
    'laravel-with-frontend/frontend/package.json': JSON.stringify({
      dependencies: {
        react: '^19.0.0',
      },
    }),
    'existing-with-docs/artisan': '',
    'existing-with-docs/composer.json': JSON.stringify({
      require: {
        'laravel/framework': '^12.0',
      },
    }),
    'existing-with-docs/app/.gitkeep': '',
    'existing-with-docs/routes/.gitkeep': '',
    'existing-with-docs/docs/modules/users/index/summary.md': '# users',
    'new-laravel-sail/artisan': '',
    'new-laravel-sail/composer.json': JSON.stringify({
      require: {
        'laravel/framework': '^12.0',
        'laravel/sail': '^1.0',
      },
    }),
    'new-laravel-sail/compose.yaml': 'services:\n  laravel.test:\n    image: sail\n',
    'new-laravel-sail/app/.gitkeep': '',
    'new-laravel-sail/routes/.gitkeep': '',
    'new-django/requirements.txt': 'django==5.1.0\n',
    'new-django/manage.py': 'print("django")\n',
    'new-fastapi/requirements.txt': 'fastapi==0.115.0\n',
    'new-fastapi/main.py': 'from fastapi import FastAPI\napp = FastAPI()\n',
    'new-rails/Gemfile': 'gem "rails", "~> 8.0"\n',
    'new-rails/config.ru': 'run Rails.application\n',
    'new-spring-boot/pom.xml':
      '<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId><version>3.4.0</version></dependency></dependencies></project>',
    'new-express/package.json': JSON.stringify({
      dependencies: {
        express: '^5.0.0',
      },
    }),
    'new-express/src/server.ts': 'import express from "express";\n',
    'new-nestjs/package.json': JSON.stringify({
      dependencies: {
        '@nestjs/core': '^11.0.0',
        '@nestjs/common': '^11.0.0',
        '@nestjs/platform-express': '^11.0.0',
        '@prisma/client': '^6.0.0',
      },
    }),
    'new-nestjs/src/app.controller.ts':
      'import { Controller, Get } from "@nestjs/common";\n@Controller()\nexport class AppController { @Get() list() { return []; } }\n',
    'new-nestjs/src/app.module.ts': 'export class AppModule {}\n',
    'new-angular/package.json': JSON.stringify({
      dependencies: {
        '@angular/core': '^19.0.0',
      },
    }),
    'new-angular/src/app/app.component.ts': 'export class AppComponent {}',
    'new-svelte/package.json': JSON.stringify({
      dependencies: {
        svelte: '^5.0.0',
      },
    }),
    'new-svelte/src/routes/+page.svelte': '<h1>Hello</h1>',
    'new-astro/package.json': JSON.stringify({
      dependencies: {
        astro: '^5.0.0',
      },
    }),
    'new-astro/src/pages/index.astro': '---\nconst title = "Hello";\n---\n<h1>{title}</h1>',
    'new-go-web/go.mod': 'module example.com/demo\n\nrequire github.com/gin-gonic/gin v1.10.0\n',
    'new-go-web/main.go': 'package main\nfunc main() {}\n',
    'new-rust-web/Cargo.toml': '[dependencies]\naxum = "0.8"\n',
    'new-rust-web/src/main.rs': 'fn main() {}\n',
    'new-dotnet/Program.cs':
      'var builder = WebApplication.CreateBuilder(args);\nvar app = builder.Build();\napp.MapGet("/", () => "ok");\napp.Run();\n',
    'new-dotnet/WebApp.csproj':
      '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>',
    'new-kotlin-android/build.gradle.kts':
      'plugins { id("com.android.application") }\ndependencies { implementation("androidx.room:room-runtime:2.6.1") implementation("androidx.compose.ui:ui:1.7.0") }\n',
    'new-kotlin-android/app/src/main/AndroidManifest.xml':
      '<manifest package="com.example.app"><application><activity android:name=".MainActivity" android:exported="true"/></application></manifest>',
    'new-kotlin-android/app/src/main/java/com/example/app/MainActivity.kt': 'class MainActivity\n',
    'new-node-cli/package.json': JSON.stringify({
      bin: { mytool: 'dist/cli.js' },
      dependencies: { commander: '^12.0.0' },
      devDependencies: { vitest: '^2.0.0' },
    }),
    'new-node-cli/tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022' } }),
    'new-node-cli/src/cli/index.ts': 'export {}',
    'new-node-library/package.json': JSON.stringify({
      main: 'dist/index.js',
      types: 'dist/index.d.ts',
      devDependencies: { tsup: '^8.0.0', vitest: '^2.0.0' },
    }),
    'new-node-library/src/index.ts': 'export const version = "1.0.0"',
    'new-node-service/package.json': JSON.stringify({
      scripts: { start: 'node dist/server.js', build: 'tsc' },
      dependencies: { dotenv: '^16.0.0' },
    }),
    'new-node-service/src/server.ts': 'import http from "http"',
    'express-with-bin/package.json': JSON.stringify({
      bin: { mytool: 'dist/cli.js' },
      dependencies: { express: '^5.0.0' },
    }),
    'express-with-bin/src/server.ts': 'import express from "express"',
  };

  for (const [relativePath, content] of Object.entries(fixtures)) {
    const absolutePath = join(root, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }

  mkdirSync(join(root, 'empty'), { recursive: true });
}
