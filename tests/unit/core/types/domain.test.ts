import { DOMAIN_STACK_MAP, DOMAINS, STACK_CAPABILITIES_MAP, STACKS } from '@/core/types/domain';

describe('domain mappings', () => {
  it('keeps supported domains and stacks aligned', () => {
    expect(DOMAINS).toEqual(['coding', 'content']);
    expect(STACKS).toEqual([
      'laravel',
      'flutter',
      'react',
      'vue',
      'django',
      'fastapi',
      'rails',
      'spring-boot',
      'express',
      'angular',
      'svelte',
      'astro',
      'go-web',
      'rust-web',
      'dotnet',
      'nextjs',
      'flask',
      'nestjs',
      'kotlin-android',
      'node-cli',
      'node-library',
      'node-service',
      'short-video',
    ]);
    expect(DOMAIN_STACK_MAP.coding).toEqual([
      'laravel',
      'flutter',
      'react',
      'vue',
      'django',
      'fastapi',
      'rails',
      'spring-boot',
      'express',
      'angular',
      'svelte',
      'astro',
      'go-web',
      'rust-web',
      'dotnet',
      'nextjs',
      'flask',
      'nestjs',
      'kotlin-android',
    ]);
    expect(DOMAIN_STACK_MAP.content).toEqual(['short-video']);
  });

  it('defines stack capabilities correctly', () => {
    expect(STACK_CAPABILITIES_MAP.laravel).toEqual([
      'inertia',
      'vue',
      'react',
      'tailwind',
      'boost',
      'pest',
      'phpunit',
      'docker',
      'compose',
      'sail',
    ]);
    expect(STACK_CAPABILITIES_MAP.flutter).toEqual(['docker', 'compose']);
    expect(STACK_CAPABILITIES_MAP.react).toEqual([
      'next',
      'remix',
      'vite-spa',
      'gatsby',
      'tailwind',
      'docker',
      'compose',
    ]);
    expect(STACK_CAPABILITIES_MAP.vue).toEqual([
      'nuxt',
      'vite-spa',
      'quasar',
      'tailwind',
      'docker',
      'compose',
    ]);
    expect(STACK_CAPABILITIES_MAP.django).toEqual(['docker', 'compose']);
    expect(STACK_CAPABILITIES_MAP.fastapi).toEqual(['docker', 'compose']);
    expect(STACK_CAPABILITIES_MAP.rails).toEqual(['docker', 'compose']);
    expect(STACK_CAPABILITIES_MAP['spring-boot']).toEqual(['docker', 'compose']);
    expect(STACK_CAPABILITIES_MAP.express).toEqual(['docker', 'compose']);
    expect(STACK_CAPABILITIES_MAP.angular).toEqual(['docker', 'compose']);
    expect(STACK_CAPABILITIES_MAP.svelte).toEqual(['docker', 'compose']);
    expect(STACK_CAPABILITIES_MAP.astro).toEqual(['docker', 'compose']);
    expect(STACK_CAPABILITIES_MAP['go-web']).toEqual(['docker', 'compose']);
    expect(STACK_CAPABILITIES_MAP['rust-web']).toEqual(['docker', 'compose']);
    expect(STACK_CAPABILITIES_MAP.dotnet).toEqual([
      'blazor',
      'ef-core',
      'minimal-api',
      'mvc',
      'razor-pages',
      'signalr',
      'identity',
      'azure',
      'docker',
    ]);
    expect(STACK_CAPABILITIES_MAP.nextjs).toEqual([
      'app-router',
      'pages-router',
      'tailwind',
      'prisma',
      'trpc',
      'next-auth',
      'docker',
    ]);
    expect(STACK_CAPABILITIES_MAP.flask).toEqual([
      'sqlalchemy',
      'celery',
      'blueprints',
      'flask-login',
      'flask-restx',
      'gunicorn',
      'docker',
    ]);
    expect(STACK_CAPABILITIES_MAP.nestjs).toEqual([
      'prisma',
      'typeorm',
      'graphql',
      'microservices',
      'swagger',
      'passport',
      'fastify',
      'docker',
    ]);
    expect(STACK_CAPABILITIES_MAP['kotlin-android']).toEqual([
      'jetpack-compose',
      'room',
      'hilt',
      'retrofit',
      'coroutines',
      'navigation',
      'datastore',
      'docker',
    ]);
    expect(STACK_CAPABILITIES_MAP['node-cli']).toEqual(['docker', 'compose']);
    expect(STACK_CAPABILITIES_MAP['node-library']).toEqual(['docker', 'compose']);
    expect(STACK_CAPABILITIES_MAP['node-service']).toEqual(['docker', 'compose']);
    expect(STACK_CAPABILITIES_MAP['short-video']).toEqual(['docker', 'compose']);
  });
});
