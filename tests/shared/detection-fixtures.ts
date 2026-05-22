import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function seedDetectionFixtures(root: string): void {
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
      },
      devDependencies: {
        '@prisma/client': '^6.0.0',
      },
    }),
    'new-nextjs/app/page.tsx': 'export default function Page() { return null; }',
    'new-nextjs/app/api/health/route.ts':
      'export async function GET() { return Response.json({ ok: true }); }',
    'new-nextjs/next.config.ts': 'export default {}',
    'new-flutter/pubspec.yaml': 'dependencies:\n  flutter:\n    sdk: flutter\n',
    'new-flask/requirements.txt': 'flask>=3.0\nsqlalchemy>=2.0\ngunicorn>=21.0\n',
    'new-flask/app.py':
      'from flask import Flask\napp = Flask(__name__)\n@app.route("/")\ndef index():\n    return "ok"\n',
    'new-nestjs/package.json': JSON.stringify({
      dependencies: {
        '@nestjs/core': '^11.0.0',
        '@nestjs/common': '^11.0.0',
        '@nestjs/platform-express': '^11.0.0',
        '@prisma/client': '^6.0.0',
      },
      devDependencies: {
        '@nestjs/swagger': '^11.0.0',
      },
    }),
    'new-nestjs/src/app.controller.ts':
      'import { Controller, Get } from "@nestjs/common";\n@Controller()\nexport class AppController { @Get() list() { return []; } }\n',
    'new-nestjs/src/app.module.ts': 'export class AppModule {}\n',
    'new-dotnet/Program.cs':
      'var builder = WebApplication.CreateBuilder(args);\nvar app = builder.Build();\napp.MapGet("/", () => "ok");\napp.Run();\n',
    'new-dotnet/WebApp.csproj':
      '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>',
    'new-dotnet/Controllers/UsersController.cs':
      'using Microsoft.AspNetCore.Mvc;\n[ApiController]\n[Route("api/users")]\npublic class UsersController : ControllerBase {}\n',
    'new-kotlin-android/build.gradle.kts':
      'plugins { id("com.android.application") }\ndependencies { implementation("androidx.room:room-runtime:2.6.1") implementation("androidx.compose.ui:ui:1.7.0") }\n',
    'new-kotlin-android/app/src/main/AndroidManifest.xml':
      '<manifest package="com.example.app"><application><activity android:name=".MainActivity" android:exported="true"/></application></manifest>',
    'new-kotlin-android/app/src/main/java/com/example/app/MainActivity.kt': 'class MainActivity\n',
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
        vite: '^7.0.0',
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
    'new-django/requirements.txt': 'django>=5.0\n',
    'new-django/manage.py': '#!/usr/bin/env python\nimport sys\n',
    'new-fastapi/requirements.txt': 'fastapi>=0.111.0\nuvicorn>=0.29.0\n',
    'new-fastapi/main.py': 'from fastapi import FastAPI\napp = FastAPI()\n',
    'new-rails/Gemfile': 'source "https://rubygems.org"\ngem "rails", "~> 7.2"\n',
    'new-rails/Gemfile.lock':
      'GEM\n  remote: https://rubygems.org/\n  specs:\n    rails (7.2.0)\n\nBUNDLED WITH\n   2.5.0\n',
    'new-spring-boot/pom.xml': `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>demo</artifactId>
  <version>0.0.1-SNAPSHOT</version>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
  </dependencies>
</project>`,
    'new-express/package.json': JSON.stringify({
      dependencies: { express: '^4.21.0' },
    }),
    'new-angular/package.json': JSON.stringify({
      dependencies: { '@angular/core': '^19.0.0', '@angular/common': '^19.0.0' },
    }),
    'new-svelte/package.json': JSON.stringify({
      dependencies: { svelte: '^5.0.0' },
    }),
    'new-astro/package.json': JSON.stringify({
      dependencies: { astro: '^5.0.0' },
    }),
    'new-go-web/go.mod':
      'module example.com/app\n\ngo 1.23\n\nrequire github.com/gin-gonic/gin v1.10.0\n',
    'new-go-web/go.sum': '',
    'new-rust-web/Cargo.toml': `[package]
name = "app"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
`,
    'new-rust-web/src/main.rs': 'fn main() {}\n',
  };

  for (const [relativePath, content] of Object.entries(fixtures)) {
    const absolutePath = join(root, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }

  mkdirSync(join(root, 'empty'), { recursive: true });
}
