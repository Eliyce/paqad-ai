export const DOMAINS = ['coding', 'content'] as const;
export type Domain = (typeof DOMAINS)[number];

export const STACKS = [
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
] as const;
export type Stack = (typeof STACKS)[number];

export const CAPABILITIES = [
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
  'next',
  'remix',
  'vite-spa',
  'gatsby',
  'nuxt',
  'quasar',
  'blazor',
  'ef-core',
  'minimal-api',
  'mvc',
  'razor-pages',
  'signalr',
  'azure',
  'identity',
  'app-router',
  'pages-router',
  'prisma',
  'trpc',
  'next-auth',
  'sqlalchemy',
  'celery',
  'blueprints',
  'flask-login',
  'flask-restx',
  'gunicorn',
  'typeorm',
  'graphql',
  'microservices',
  'swagger',
  'passport',
  'fastify',
  'jetpack-compose',
  'room',
  'hilt',
  'retrofit',
  'coroutines',
  'navigation',
  'datastore',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const ACTIVE_CAPABILITIES = ['content', 'coding', 'planning', 'security'] as const;
export type ActiveCapability = (typeof ACTIVE_CAPABILITIES)[number];

export interface DomainStackMapping {
  coding:
    | 'laravel'
    | 'flutter'
    | 'react'
    | 'vue'
    | 'django'
    | 'fastapi'
    | 'rails'
    | 'spring-boot'
    | 'express'
    | 'angular'
    | 'svelte'
    | 'astro'
    | 'go-web'
    | 'rust-web'
    | 'dotnet'
    | 'nextjs'
    | 'flask'
    | 'nestjs'
    | 'kotlin-android';
  content: 'short-video';
}

export const DOMAIN_STACK_MAP: Record<Domain, readonly Stack[]> = {
  coding: [
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
  ],
  content: ['short-video'],
};

export const STACK_CAPABILITIES_MAP: Record<Stack, readonly Capability[]> = {
  laravel: [
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
  ],
  flutter: ['docker', 'compose'],
  react: ['next', 'remix', 'vite-spa', 'gatsby', 'tailwind', 'docker', 'compose'],
  vue: ['nuxt', 'vite-spa', 'quasar', 'tailwind', 'docker', 'compose'],
  django: ['docker', 'compose'],
  fastapi: ['docker', 'compose'],
  rails: ['docker', 'compose'],
  'spring-boot': ['docker', 'compose'],
  express: ['docker', 'compose'],
  angular: ['docker', 'compose'],
  svelte: ['docker', 'compose'],
  astro: ['docker', 'compose'],
  'go-web': ['docker', 'compose'],
  'rust-web': ['docker', 'compose'],
  dotnet: [
    'blazor',
    'ef-core',
    'minimal-api',
    'mvc',
    'razor-pages',
    'signalr',
    'identity',
    'azure',
    'docker',
  ],
  nextjs: ['app-router', 'pages-router', 'tailwind', 'prisma', 'trpc', 'next-auth', 'docker'],
  flask: ['sqlalchemy', 'celery', 'blueprints', 'flask-login', 'flask-restx', 'gunicorn', 'docker'],
  nestjs: [
    'prisma',
    'typeorm',
    'graphql',
    'microservices',
    'swagger',
    'passport',
    'fastify',
    'docker',
  ],
  'kotlin-android': [
    'jetpack-compose',
    'room',
    'hilt',
    'retrofit',
    'coroutines',
    'navigation',
    'datastore',
    'docker',
  ],
  'node-cli': ['docker', 'compose'],
  'node-library': ['docker', 'compose'],
  'node-service': ['docker', 'compose'],
  'short-video': ['docker', 'compose'],
};
