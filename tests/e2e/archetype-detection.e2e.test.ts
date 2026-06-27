import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { execa } from 'execa';
import YAML from 'yaml';

const cliPath = join(process.cwd(), 'dist/cli/index.js');
const buildLockRoot = join(process.cwd(), '.tmp');
const buildLockDir = join(process.cwd(), '.tmp', 'built-cli.lock');

async function ensureBuiltCli(): Promise<void> {
  if (existsSync(cliPath) && !existsSync(buildLockDir)) {
    return;
  }

  mkdirSync(buildLockRoot, { recursive: true });

  while (true) {
    try {
      mkdirSync(buildLockDir, { recursive: false });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
      if (existsSync(cliPath) && !existsSync(buildLockDir)) {
        return;
      }
      await sleep(100);
    }
  }

  try {
    if (!existsSync(cliPath)) {
      await execa('pnpm', ['run', 'build'], {
        cwd: process.cwd(),
      });
    }
  } finally {
    rmSync(buildLockDir, { recursive: true, force: true });
  }
}

describe('archetype pack detection (E2E)', () => {
  let projectRoot: string;

  beforeAll(async () => {
    await ensureBuiltCli();
  });

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-arch-e2e-'));
    process.env.PAQAD_FRAMEWORK_HOME = join(projectRoot, '.framework-home');
  });

  afterEach(() => {
    delete process.env.PAQAD_FRAMEWORK_HOME;
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('onboards a CLI project and activates coding + security via node-cli archetype', async () => {
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({
        name: 'my-cli',
        version: '1.0.0',
        bin: { mycli: 'dist/index.js' },
        dependencies: { commander: '^12.0.0' },
        devDependencies: { vitest: '^2.0.0' },
      }),
    );
    writeFileSync(
      join(projectRoot, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2022' } }),
    );

    await execa('node', [cliPath, 'install', '--project-root', projectRoot], {
      cwd: projectRoot,
    });
    await execa('node', [cliPath, 'onboard', '--project-root', projectRoot], {
      cwd: projectRoot,
    });

    const profilePath = join(projectRoot, '.paqad', 'project-profile.yaml');
    const profile = YAML.parse(readFileSync(profilePath, 'utf8')) as {
      active_capabilities: string[];
      stack_profile?: { frameworks?: string[] };
    };

    expect(profile.active_capabilities).toContain('coding');
    expect(profile.active_capabilities).toContain('security');
    expect(profile.stack_profile?.frameworks).toContain('node-cli');
  });

  it('onboards a library project and activates coding via node-library archetype', async () => {
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({
        name: 'my-lib',
        version: '1.0.0',
        main: 'dist/index.js',
        types: 'dist/index.d.ts',
        devDependencies: { tsup: '^8.0.0' },
      }),
    );
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    writeFileSync(join(projectRoot, 'src', 'index.ts'), 'export const version = "1.0.0"');

    await execa('node', [cliPath, 'install', '--project-root', projectRoot], {
      cwd: projectRoot,
    });
    await execa('node', [cliPath, 'onboard', '--project-root', projectRoot], {
      cwd: projectRoot,
    });

    const profilePath = join(projectRoot, '.paqad', 'project-profile.yaml');
    const profile = YAML.parse(readFileSync(profilePath, 'utf8')) as {
      active_capabilities: string[];
      stack_profile?: { frameworks?: string[] };
    };

    expect(profile.active_capabilities).toContain('coding');
    expect(profile.stack_profile?.frameworks).toContain('node-library');
  });

  it('onboards an express project to express framework (not node-service)', async () => {
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({
        name: 'my-api',
        version: '1.0.0',
        scripts: { start: 'node dist/server.js' },
        dependencies: { express: '^5.0.0' },
      }),
    );

    await execa('node', [cliPath, 'install', '--project-root', projectRoot], {
      cwd: projectRoot,
    });
    await execa('node', [cliPath, 'onboard', '--project-root', projectRoot], {
      cwd: projectRoot,
    });

    const profilePath = join(projectRoot, '.paqad', 'project-profile.yaml');
    const profile = YAML.parse(readFileSync(profilePath, 'utf8')) as {
      stack_profile?: { frameworks?: string[] };
    };

    expect(profile.stack_profile?.frameworks).toContain('express');
    expect(profile.stack_profile?.frameworks).not.toContain('node-service');
  });

  it('prefers first-class framework packs for nextjs, nestjs, flask, dotnet, and kotlin-android', async () => {
    const fixtures: Array<{
      files: Record<string, string>;
      expected: string;
      absent?: string;
    }> = [
      {
        expected: 'nextjs',
        absent: 'react',
        files: {
          'package.json': JSON.stringify({
            dependencies: { next: '^16.0.0', react: '^19.0.0', 'react-dom': '^19.0.0' },
          }),
          'app/page.tsx': 'export default function Page() { return null; }',
        },
      },
      {
        expected: 'nestjs',
        absent: 'express',
        files: {
          'package.json': JSON.stringify({
            dependencies: {
              '@nestjs/core': '^11.0.0',
              '@nestjs/common': '^11.0.0',
              '@nestjs/platform-express': '^11.0.0',
              express: '^5.0.0',
            },
          }),
          'src/app.controller.ts':
            'import { Controller, Get } from "@nestjs/common";\n@Controller()\nexport class AppController { @Get() list() { return []; } }\n',
        },
      },
      {
        expected: 'flask',
        files: {
          'requirements.txt': 'flask>=3.0\n',
          'app.py': 'from flask import Flask\napp = Flask(__name__)\n',
        },
      },
      {
        expected: 'dotnet',
        files: {
          'Program.cs':
            'var builder = WebApplication.CreateBuilder(args);\nvar app = builder.Build();\napp.MapGet("/", () => "ok");\napp.Run();\n',
          'WebApp.csproj':
            '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>',
        },
      },
      {
        expected: 'kotlin-android',
        files: {
          'build.gradle.kts': 'plugins { id("com.android.application") }\n',
          'app/src/main/AndroidManifest.xml':
            '<manifest package="com.example.app"><application /></manifest>',
        },
      },
    ];

    for (const fixture of fixtures) {
      const caseRoot = mkdtempSync(join(tmpdir(), `paqad-framework-e2e-${fixture.expected}-`));
      try {
        process.env.PAQAD_FRAMEWORK_HOME = join(caseRoot, '.framework-home');
        for (const [relativePath, content] of Object.entries(fixture.files)) {
          mkdirSync(join(caseRoot, relativePath.split('/').slice(0, -1).join('/')), {
            recursive: true,
          });
          writeFileSync(join(caseRoot, relativePath), content);
        }

        await execa('node', [cliPath, 'install', '--project-root', caseRoot], { cwd: caseRoot });
        await execa('node', [cliPath, 'onboard', '--project-root', caseRoot], { cwd: caseRoot });

        const profile = YAML.parse(
          readFileSync(join(caseRoot, '.paqad', 'project-profile.yaml'), 'utf8'),
        ) as {
          stack_profile?: { frameworks?: string[] };
        };

        expect(profile.stack_profile?.frameworks).toContain(fixture.expected);
        if (fixture.absent) {
          expect(profile.stack_profile?.frameworks).not.toContain(fixture.absent);
        }
      } finally {
        rmSync(caseRoot, { recursive: true, force: true });
      }
    }
    // Five full onboards in one test; the slow Windows CI runner lands just over the
    // 20s default, so give it headroom (it is slow, not hung).
  }, 60000);

  it('packs list shows archetype tier for node-cli and framework tier for laravel', async () => {
    await execa('node', [cliPath, 'install', '--project-root', projectRoot], {
      cwd: projectRoot,
    });

    const result = await execa(
      'node',
      [cliPath, 'packs', 'list', '--project-root', projectRoot, '--json'],
      { cwd: projectRoot },
    );

    const packs = JSON.parse(result.stdout) as Array<{ name: string; tier: string }>;

    const nodeCli = packs.find((p) => p.name === 'node-cli');
    expect(nodeCli?.tier).toBe('archetype');

    const laravel = packs.find((p) => p.name === 'laravel');
    expect(laravel?.tier).toBe('framework');
  });

  it('packs create --tier archetype scaffolds with tier: archetype and fields stub', async () => {
    const { stdout } = await execa(
      'node',
      [
        cliPath,
        'packs',
        'create',
        'my-archetype-pack',
        '--destination',
        projectRoot,
        '--tier',
        'archetype',
      ],
      { cwd: projectRoot },
    );

    const packYamlPath = join(stdout.trim(), 'pack.yaml');
    const content = readFileSync(packYamlPath, 'utf8');

    expect(content).toContain('tier: archetype');
    expect(content).toContain('fields:');
  });
});
