/**
 * paqad-ai Documentation Content
 * All pages as structured data consumed by docs.js
 */

export const DOCS_PAGES = {
  /* ── Getting Started ─────────────────────────────────────────────────── */

  introduction: {
    id: 'introduction',
    title: 'Introduction',
    section: 'Getting Started',
    sectionId: 'getting-started',
    prev: null,
    next: 'installation',
    keywords: ['what is paqad', 'overview', 'documentation first', 'ai agent', 'framework'],
    content: [
      { type: 'h1', text: 'Introduction' },
      {
        type: 'p',
        text: 'paqad-ai is a free, open-source, spec-driven framework for AI coding agents. It reads your project, learns your stack, and turns your specs, rules, and workflows into context every AI tool has to follow. Then it proves each change with automatic checks, instead of trusting the prompt.',
      },
      {
        type: 'p',
        text: 'A prompt is the most error-prone part of AI development. When you open a project in Claude Code, Cursor, Codex, Gemini, or Copilot, those agents start cold: they do not know your stack, your layout, or the rules your project already follows, so they guess. paqad-ai fixes that with one onboarding command, a shared knowledge base every tool reads, and a verification pipeline that catches work an agent only claims to have finished.',
      },
      {
        type: 'callout',
        variant: 'tip',
        text: 'New to paqad-ai? Jump straight to the `Quick Start` guide to run your first onboarding in under two minutes with no account and no API key.',
      },
      { type: 'h2', id: 'who-it-is-for', text: 'Who it is for' },
      {
        type: 'p',
        text: 'paqad-ai is built for developers and teams who use AI coding assistants every day and want those assistants to understand their specific project instead of re-reading the same files and making the same mistakes.',
      },
      {
        type: 'ul',
        items: [
          'Solo developers who switch between AI tools and want consistent context in all of them.',
          "Teams that need every developer's AI agent to follow the same conventions.",
          'Shops running multiple agents in parallel, planning, implementing, reviewing, who need a shared ground truth.',
          'Organisations that require auditable, version-controlled AI configuration alongside their code.',
        ],
      },
      { type: 'h2', id: 'key-concepts', text: 'Key concepts' },
      {
        type: 'p',
        text: 'These five terms appear throughout the documentation. Knowing them up front will make everything else click faster.',
      },
      {
        type: 'dl',
        items: [
          {
            term: 'packs',
            def: 'Declarative YAML units that describe a framework or archetype. A pack tells paqad-ai which manifests to look for, which MCP servers to register, and what documentation to generate.',
          },
          {
            term: 'adapters',
            def: 'The thin entry files paqad-ai writes for each AI tool. Claude Code gets `CLAUDE.md`, Cursor gets `.cursorrules`, GitHub Copilot gets `.github/copilot-instructions.md`, and so on.',
          },
          {
            term: 'capabilities',
            def: 'Feature tiers you can enable on a project: `content`, `coding`, and `security`. Each tier adds a richer layer of documentation and workflow configuration.',
          },
          {
            term: 'workflows',
            def: 'Multi-phase YAML-driven execution plans that orchestrate agent roles from intake through to verified handoff.',
          },
          {
            term: 'RAG',
            def: 'Retrieval-Augmented Generation. An optional accelerator on top of the normal grep-and-read default, off until you enable it. When on, it indexes your codebase and feeds a few relevant, verify-first slices into the prompt, and falls back to plain grep whenever it is off, cold, or unsure.',
          },
        ],
      },
      { type: 'h2', id: 'how-documentation-lives', text: 'Where documentation lives' },
      {
        type: 'p',
        text: 'After onboarding, paqad-ai writes everything into your project under two top-level paths. You commit them alongside your code.',
      },
      {
        type: 'table',
        headers: ['Path', 'What lives there'],
        rows: [
          ['.paqad/', 'Framework metadata, project profile, and vector store.'],
          [
            'docs/instructions/',
            'Rules, stack docs, design system, and workflow templates, consumed by every adapter.',
          ],
          [
            'CLAUDE.md / AGENTS.md / etc.',
            'Adapter-specific entry files that point each AI tool at docs/instructions/.',
          ],
        ],
      },
    ],
  },

  installation: {
    id: 'installation',
    title: 'Installation',
    section: 'Getting Started',
    sectionId: 'getting-started',
    prev: 'introduction',
    next: 'quick-start',
    keywords: ['install', 'npm', 'node', 'setup', 'prerequisites', 'global'],
    content: [
      { type: 'h1', text: 'Installation' },
      {
        type: 'p',
        text: 'paqad-ai ships as a global npm package. Install it once and use it across all your projects.',
      },
      { type: 'h2', id: 'prerequisites', text: 'Prerequisites' },
      {
        type: 'ul',
        items: [
          'Node.js 22 or higher (`node --version` to check).',
          'npm 10 or higher, or pnpm 10 or higher.',
          'Any project directory, paqad-ai works with or without an existing `package.json`.',
        ],
      },
      { type: 'h2', id: 'global-install', text: 'Global install' },
      {
        type: 'p',
        text: 'Install paqad-ai globally so the `paqad-ai` command is available anywhere on your machine.',
      },
      {
        type: 'terminal',
        lang: 'bash',
        label: 'npm',
        copyable: true,
        code: 'npm install -g paqad-ai',
      },
      {
        type: 'terminal',
        lang: 'bash',
        label: 'pnpm',
        copyable: true,
        code: 'pnpm add -g paqad-ai',
      },
      { type: 'h2', id: 'verify', text: 'Verify the installation' },
      {
        type: 'terminal',
        lang: 'bash',
        copyable: true,
        code: 'paqad-ai --version\n# paqad-ai v1.0.1',
      },
      { type: 'h2', id: 'updating', text: 'Updating' },
      {
        type: 'p',
        text: 'To update to the latest version, re-run the install command. paqad-ai will detect the version change and prompt you to re-onboard any active projects.',
      },
      { type: 'terminal', lang: 'bash', copyable: true, code: 'npm install -g paqad-ai@latest' },
      {
        type: 'callout',
        variant: 'note',
        text: 'After a major version upgrade, run `paqad-ai update` inside each project to refresh the generated documentation and adapter files.',
      },
    ],
  },

  'quick-start': {
    id: 'quick-start',
    title: 'Quick Start',
    section: 'Getting Started',
    sectionId: 'getting-started',
    prev: 'installation',
    next: 'how-it-works',
    keywords: ['onboard', 'quick start', 'first run', 'getting started', 'setup'],
    content: [
      { type: 'h1', text: 'Quick Start' },
      {
        type: 'p',
        text: 'The fastest path from zero to a fully configured project is a single command. Here is what happens when you run it, and where the token savings come from.',
      },
      { type: 'h2', id: 'run-onboard', text: 'Step 1, Run onboard' },
      {
        type: 'p',
        text: 'Navigate to your project root, the directory that contains your `package.json`, `composer.json`, `go.mod`, or equivalent manifest, and run:',
      },
      { type: 'terminal', lang: 'bash', copyable: true, code: 'cd your-project\npaqad-ai onboard' },
      { type: 'h2', id: 'choose-adapters', text: 'Step 2, Choose adapters' },
      {
        type: 'p',
        text: 'paqad-ai asks which AI tools you use. Select one or more with the spacebar and press Enter. It will generate matching instruction files from the same source of truth.',
      },
      {
        type: 'terminal',
        lang: 'bash',
        code: '? Which AI adapters should be configured?\n❯ ◉ Claude Code\n  ◯ Cursor\n  ◯ GitHub Copilot\n  ◯ Windsurf\n  ◯ Continue\n  ◯ Codex CLI',
      },
      { type: 'h2', id: 'stack-detection', text: 'Step 3, Stack detection' },
      {
        type: 'p',
        text: 'paqad-ai scans your project, reads your lockfiles and manifests, and tells you exactly what it found. This replaces the usual “read the whole repo first” prompt spam with structured project context.',
      },
      {
        type: 'terminal',
        lang: 'bash',
        code: '✔ Detected: laravel (composer.lock)\n✔ Detected: node-pnpm (pnpm-lock.yaml)\n✔ Loaded pack: laravel\n✔ Loaded pack: node-service',
      },
      { type: 'h2', id: 'what-gets-created', text: 'Step 4, What gets created' },
      {
        type: 'p',
        text: 'paqad-ai writes all generated files into your project. Nothing is hidden in a global directory, and nothing requires a hosted account.',
      },
      {
        type: 'terminal',
        lang: 'bash',
        code: '✔ Written: CLAUDE.md\n✔ Written: .paqad/project-profile.yaml\n✔ Written: docs/instructions/rules/\n✔ Written: docs/instructions/stack/\n✔ Written: docs/instructions/design-system/\n✔ Written: .claude/settings.json (MCP defaults)',
      },
      { type: 'h2', id: 'health-check', text: 'Step 5, Health check' },
      { type: 'p', text: 'Confirm everything is in order with the `doctor` command.' },
      { type: 'terminal', lang: 'bash', copyable: true, code: 'paqad-ai doctor' },
      {
        type: 'terminal',
        lang: 'bash',
        code: '✔ schema valid\n✔ instructions present\n✔ adapter output matches\n✔ MCP config present\n✔ no duplicate rules\n\n5/10 gates checked, all pass',
      },
      {
        type: 'callout',
        variant: 'tip',
        text: 'Commit the generated files immediately. They are first-class project assets, review them, version them, and update them when your stack changes so every AI session starts with the same ground truth.',
      },
    ],
  },

  /* ── Core Concepts ───────────────────────────────────────────────────── */

  'how-it-works': {
    id: 'how-it-works',
    title: 'How It Works',
    section: 'Core Concepts',
    sectionId: 'core-concepts',
    prev: 'quick-start',
    next: 'project-profile',
    keywords: ['architecture', 'three pass', 'detection', 'resolution', 'generation', 'pipeline'],
    content: [
      { type: 'h1', text: 'How It Works' },
      {
        type: 'p',
        text: 'The landing page shows the simple version: ask, plan, verify. Under the hood, paqad-ai processes your project in three sequential passes: detect, resolve, and generate. Each pass feeds the next, which is why the resulting context is structured instead of improvised.',
      },
      { type: 'h2', id: 'pass-1-detection', text: 'Pass 1, Detection' },
      {
        type: 'p',
        text: 'The detection pass reads every manifest and lockfile in your project root. It identifies your primary language ecosystem, the frameworks and libraries in use, and produces a version-band summary for each, so the AI does not have to infer your stack from scattered files.',
      },
      {
        type: 'ascii',
        code: 'project root\n  ├── composer.lock     → php ecosystem\n  │     └── laravel/framework 11.x → laravel pack\n  ├── pnpm-lock.yaml    → node-pnpm ecosystem\n  │     └── vite 5.x, tailwindcss 3.x → traits\n  └── .paqad/           → framework metadata',
      },
      {
        type: 'p',
        text: 'Detection is lockfile-first. When a lockfile is present, paqad-ai reads pinned versions from it rather than the looser ranges in a manifest. This makes version detection deterministic across machines.',
      },
      { type: 'h2', id: 'pass-2-resolution', text: 'Pass 2, Resolution' },
      {
        type: 'p',
        text: 'The resolution pass takes the detected packs and assembles the full documentation and configuration set. It walks an inheritance chain, base layer first, then capability overlays, then stack-specific content, deduplicating rules at each step so tokens are spent on the task, not on repeated boilerplate.',
      },
      {
        type: 'table',
        headers: ['Layer', 'Source', 'Description'],
        rows: [
          ['1', 'base/', 'Always-on agents, shared rules, core checklists.'],
          ['2', 'content capability', 'Writing style, markdown conventions, attribution.'],
          ['3', 'coding capability', 'Code quality, review, architecture rules.'],
          ['4', 'security capability', 'Pentest, OWASP coverage, guardrails.'],
          ['5', 'stack pack', 'Framework-specific rules and MCP defaults.'],
          ['6', 'traits', 'Per-library overlays (e.g. tailwind, vitest).'],
          ['7', 'archetypes', 'Project shape rules (cli, library, service).'],
          ['8', 'project overrides', 'Anything in .paqad/ takes final precedence.'],
        ],
      },
      { type: 'h2', id: 'pass-3-generation', text: 'Pass 3, Generation' },
      {
        type: 'p',
        text: 'The generation pass takes the resolved content and writes adapter-specific output files. Each adapter has its own entry file format, MCP configuration path, and optional skills or agents directory. The same resolved knowledge base drives all of them, which keeps Claude Code, Codex, Cursor, Gemini, and the rest in sync.',
      },
      {
        type: 'callout',
        variant: 'note',
        text: 'Generation is idempotent. Running `paqad-ai onboard` or `paqad-ai refresh` on an already-onboarded project updates only what has changed, leaving your manual edits intact where possible.',
      },
    ],
  },

  'project-profile': {
    id: 'project-profile',
    title: 'Project Profile',
    section: 'Core Concepts',
    sectionId: 'core-concepts',
    prev: 'how-it-works',
    next: 'stack-detection',
    keywords: [
      'project profile',
      'yaml',
      'capabilities',
      'configuration',
      'model routing',
      'strictness',
    ],
    content: [
      { type: 'h1', text: 'Project Profile' },
      {
        type: 'p',
        text: 'The project profile is the single file that controls how paqad-ai behaves in your project. It lives at `.paqad/project-profile.yaml` and is committed with your code.',
      },
      { type: 'h2', id: 'anatomy', text: 'Anatomy of the profile' },
      {
        type: 'terminal',
        lang: 'yaml',
        label: '.paqad/project-profile.yaml',
        code: 'stack:\n  - laravel\n  - node-pnpm\n\ncapabilities:\n  content: true\n  coding: true\n  security: false\n\nmodel_routing:\n  default: gpt-4o\n  fast: gpt-4o-mini\n\nstrictness:\n  require_adversarial_review: true\n  block_on_stale_docs: false\n  require_db_review_for_migrations: true\n\nfeatures:\n  market_research: false\n  design_research: false\n  team_agents: true',
      },
      { type: 'h2', id: 'capabilities', text: 'Capabilities' },
      {
        type: 'p',
        text: 'Capabilities are feature tiers. Each one unlocks additional documentation, rules, and agent configuration. They are additive, enabling `security` also requires `coding` to be enabled.',
      },
      {
        type: 'dl',
        items: [
          {
            term: 'content',
            def: 'Writing style guides, markdown conventions, documentation standards. Suitable for any project.',
          },
          {
            term: 'coding',
            def: 'Code quality rules, review checklists, architecture constraints, testing standards. Requires content.',
          },
          {
            term: 'security',
            def: 'Pentest workflows, OWASP mappings, escalation guardrails, security scanning agents. Requires coding.',
          },
        ],
      },
      { type: 'h2', id: 'model-routing', text: 'Model routing' },
      {
        type: 'p',
        text: 'Model routing lets you specify which LLM each tier of agent should use. Lighter tasks (routing, linting, summarising) use the `fast` model; planning, architecture, and security tasks use the `default` model.',
      },
      { type: 'h2', id: 'strictness', text: 'Strictness flags' },
      {
        type: 'p',
        text: "Strictness flags allow you to gate certain operations. When `block_on_stale_docs` is `true`, the framework will halt a workflow if documentation staleness is detected. Set these to match your team's quality bar.",
      },
      {
        type: 'callout',
        variant: 'warning',
        text: 'Edit the profile carefully. Removing a capability that was previously enabled will remove the documentation and agent configuration that depended on it.',
      },
    ],
  },

  'stack-detection': {
    id: 'stack-detection',
    title: 'Stack Detection',
    section: 'Core Concepts',
    sectionId: 'core-concepts',
    prev: 'project-profile',
    next: 'resolution-order',
    keywords: ['detection', 'manifest', 'lockfile', 'ecosystem', 'parsers', 'version', 'stack'],
    content: [
      { type: 'h1', text: 'Stack Detection' },
      {
        type: 'p',
        text: "Stack detection is the first thing paqad-ai does when you run `onboard` or `refresh --stack`. It reads your project's manifest and lockfile files to determine what frameworks, languages, and tools you are using, without you having to tell it anything.",
      },
      { type: 'h2', id: 'supported-ecosystems', text: 'Supported ecosystems' },
      {
        type: 'p',
        text: 'paqad-ai ships with nine ecosystem parsers, each of which reads a specific set of manifest formats.',
      },
      {
        type: 'table',
        headers: ['Ecosystem', 'Files read'],
        rows: [
          ['node-npm', 'package.json, package-lock.json'],
          ['node-pnpm', 'package.json, pnpm-lock.yaml'],
          ['php', 'composer.json, composer.lock'],
          ['python', 'requirements.txt, pyproject.toml, Pipfile, poetry.lock, uv.lock'],
          ['ruby', 'Gemfile, Gemfile.lock'],
          ['jvm', 'build.gradle, pom.xml, gradle.lockfile'],
          ['go', 'go.mod, go.sum'],
          ['rust', 'Cargo.toml, Cargo.lock'],
          ['dart', 'pubspec.yaml, pubspec.lock'],
        ],
      },
      { type: 'h2', id: 'lockfile-precedence', text: 'Lockfile precedence' },
      {
        type: 'p',
        text: 'When a lockfile is present alongside a manifest, paqad-ai reads version information from the lockfile. Lockfiles contain pinned, resolved versions, not the open ranges that manifests typically declare. This makes detection consistent across environments.',
      },
      {
        type: 'callout',
        variant: 'tip',
        text: "Commit your lockfiles. paqad-ai's detection is most accurate when lockfiles are present, and consistency across developer machines depends on them.",
      },
      { type: 'h2', id: 'version-bands', text: 'Version bands' },
      {
        type: 'p',
        text: 'Detected versions are normalised into major-version bands (e.g. `laravel 11.x`, `react 18.x`). Bands are used to select the correct pack variant and to generate accurate version references in documentation.',
      },
      { type: 'h2', id: 'manual-refresh', text: 'Re-running detection' },
      {
        type: 'p',
        text: 'When you upgrade a major dependency or add a new framework, run `refresh` to update the generated documentation.',
      },
      { type: 'terminal', lang: 'bash', copyable: true, code: 'paqad-ai refresh --stack' },
    ],
  },

  'resolution-order': {
    id: 'resolution-order',
    title: 'Resolution Order',
    section: 'Core Concepts',
    sectionId: 'core-concepts',
    prev: 'stack-detection',
    next: 'cli-onboard',
    keywords: ['resolution', 'inheritance', 'layers', 'override', 'deduplication', 'conditional'],
    content: [
      { type: 'h1', text: 'Resolution Order' },
      {
        type: 'p',
        text: 'The resolver assembles the final documentation and configuration set from multiple layers. Understanding the order helps you predict what ends up in the generated files and where to make project-specific overrides.',
      },
      { type: 'h2', id: 'layer-stack', text: 'The layer stack' },
      {
        type: 'p',
        text: 'Layers are processed in order from lowest to highest precedence. Later layers can add content or override content from earlier layers. Duplicate rules, identified by their rule ID, are dropped in favour of the later version.',
      },
      {
        type: 'ol',
        items: [
          'Base layer, always-on agents, shared rules, core checklists.',
          'Content capability, writing style, markdown, attribution.',
          'Coding capability, code quality, review, architecture.',
          'Security capability, pentest, OWASP, guardrails.',
          'Stack pack, framework-specific rules and MCP defaults.',
          'Trait overlays, per-library rules (e.g. `vitest`, `tailwind`).',
          'Archetype rules, project-shape rules (cli, library, service).',
          'Project overrides, anything in `.paqad/` wins.',
        ],
      },
      { type: 'h2', id: 'stack-conditional-syntax', text: 'Stack-conditional content' },
      {
        type: 'p',
        text: 'Documentation templates can include content that is only rendered when a specific stack is active. Use the `<!-- if:stack-name -->` comment syntax within template files.',
      },
      {
        type: 'terminal',
        lang: 'bash',
        code: '<!-- if:laravel -->\nUse `php artisan` for all Artisan commands. Never invoke `artisan` directly.\n<!-- endif -->\n\n<!-- if:django -->\nUse `python manage.py` for all management commands.\n<!-- endif -->',
      },
      { type: 'h2', id: 'viewing-resolved-output', text: 'Viewing the resolved output' },
      {
        type: 'p',
        text: 'To inspect what the resolver produces for your project without writing any files, use the `--dry-run` flag on onboard or refresh.',
      },
      { type: 'terminal', lang: 'bash', copyable: true, code: 'paqad-ai onboard --dry-run' },
      {
        type: 'callout',
        variant: 'note',
        text: 'Project overrides in `.paqad/` are never overwritten by `refresh` or `update`. They are the one layer you own outright.',
      },
    ],
  },

  /* ── CLI Reference ───────────────────────────────────────────────────── */

  'cli-onboard': {
    id: 'cli-onboard',
    title: 'onboard',
    section: 'CLI Reference',
    sectionId: 'cli-reference',
    prev: 'resolution-order',
    next: 'cli-doctor',
    keywords: ['onboard', 'command', 'cli', 'setup', 'bootstrap', 'init'],
    content: [
      { type: 'h1', text: 'onboard' },
      {
        type: 'p',
        text: 'The `onboard` command is the primary entry point for paqad-ai. It runs detection, resolution, and generation in a single interactive flow, producing all adapter files and documentation for your project.',
      },
      { type: 'h2', id: 'synopsis', text: 'Synopsis' },
      { type: 'terminal', lang: 'bash', copyable: true, code: 'paqad-ai onboard [options]' },
      { type: 'h2', id: 'options', text: 'Options' },
      {
        type: 'table',
        headers: ['Flag', 'Description'],
        rows: [
          [
            '--adapters <list>',
            'Comma-separated adapter names. Skips the interactive prompt. e.g. `--adapters claude,cursor`',
          ],
          ['--dry-run', 'Show what would be written without writing any files.'],
          [
            '--skip-detection',
            'Skip stack detection and use the existing `.paqad/project-profile.yaml`.',
          ],
          ['--force', 'Overwrite existing adapter files, even if they have local modifications.'],
          ['--quiet', 'Suppress progress output. Useful in CI.'],
        ],
      },
      { type: 'h2', id: 'interactive-flow', text: 'Interactive flow' },
      {
        type: 'p',
        text: 'When run without flags, `onboard` guides you through three interactive steps: selecting adapters, confirming detected stacks, and choosing capability tiers. All selections are saved to `.paqad/project-profile.yaml`.',
      },
      { type: 'h2', id: 'output-files', text: 'Output files' },
      {
        type: 'p',
        text: 'The exact files written depend on which adapters you selected and which capabilities are enabled. At minimum, every onboarded project gets:',
      },
      {
        type: 'ul',
        items: [
          '`.paqad/project-profile.yaml`, project configuration.',
          '`docs/instructions/`, the shared documentation bundle.',
          'One entry file per selected adapter (e.g. `CLAUDE.md`, `.cursorrules`).',
          'MCP configuration files for each adapter that supports MCP.',
        ],
      },
      {
        type: 'callout',
        variant: 'tip',
        text: 'Run `paqad-ai doctor` immediately after `onboard` to confirm all quality gates pass.',
      },
    ],
  },

  'cli-doctor': {
    id: 'cli-doctor',
    title: 'doctor',
    section: 'CLI Reference',
    sectionId: 'cli-reference',
    prev: 'cli-onboard',
    next: 'cli-refresh',
    keywords: ['doctor', 'health', 'quality gates', 'validation', 'check', 'gates'],
    content: [
      { type: 'h1', text: 'doctor' },
      {
        type: 'p',
        text: "The `doctor` command runs paqad-ai's ten quality gates against your current project state. It is the fastest way to confirm that your documentation is consistent, your adapters are correct, and your configuration is valid.",
      },
      { type: 'h2', id: 'synopsis', text: 'Synopsis' },
      { type: 'terminal', lang: 'bash', copyable: true, code: 'paqad-ai doctor [--json]' },
      { type: 'h2', id: 'quality-gates', text: 'The ten quality gates' },
      {
        type: 'table',
        headers: ['Gate', 'What it checks'],
        rows: [
          ['schema valid', 'project-profile.yaml matches the current schema.'],
          ['instructions present', 'docs/instructions/ contains all required sections.'],
          ['adapter output matches', 'Adapter entry files reflect the current resolved output.'],
          ['MCP config present', 'All selected adapters have their MCP config files.'],
          ['no duplicate rules', 'The resolver found no conflicting rule IDs after deduplication.'],
          ['cache warm', 'The skill and pattern cache is not empty.'],
          [
            'context hit-rate',
            'RAG hit-rate is above the minimum threshold (when RAG is enabled).',
          ],
          ['stack drift', 'Detected stack matches what is recorded in the profile.'],
          ['skill cache warm', 'Skill trigger cache has been populated.'],
          [
            'adapter file integrity',
            'No adapter entry file has been manually truncated or corrupted.',
          ],
        ],
      },
      { type: 'h2', id: 'sample-output', text: 'Sample output' },
      {
        type: 'terminal',
        lang: 'bash',
        code: '✔ schema valid\n✔ instructions present\n✔ adapter output matches\n✔ MCP config present\n✔ no duplicate rules\n✔ cache warm\n✗ context hit-rate, RAG index is empty. Run: paqad-ai rag index\n✔ stack drift, none detected\n✔ skill cache warm\n✔ adapter file integrity\n\n9/10 gates pass · 1 warning',
      },
      { type: 'h2', id: 'json-output', text: 'JSON output' },
      {
        type: 'p',
        text: 'Pass `--json` to receive a machine-readable report. Useful for CI pipelines.',
      },
      { type: 'terminal', lang: 'bash', copyable: true, code: 'paqad-ai doctor --json' },
      {
        type: 'callout',
        variant: 'note',
        text: 'A failing gate does not break your project. It is a signal that something is out of sync. The output always includes the command needed to resolve each failure.',
      },
    ],
  },

  'cli-compliance': {
    id: 'cli-compliance',
    title: 'compliance',
    section: 'CLI Reference',
    sectionId: 'cli-reference',
    prev: 'cli-doctor',
    next: 'cli-refresh',
    keywords: [
      'compliance',
      'spec verification',
      'obligations',
      'extract',
      'review',
      'skeleton',
      'coverage',
      'boundary',
      'patterns',
    ],
    content: [
      { type: 'h1', text: 'compliance' },
      {
        type: 'p',
        text: 'The `compliance` command group turns a structured feature specification into a deterministic obligation index, checks test evidence against those obligations, generates failing test skeletons, and validates index health.',
      },
      { type: 'h2', id: 'extract', text: 'compliance extract' },
      {
        type: 'p',
        text: 'Extract obligations from a Markdown spec and persist the resulting index under `.paqad/compliance/` or a custom path.',
      },
      {
        type: 'terminal',
        lang: 'bash',
        copyable: true,
        code: 'paqad-ai compliance extract --spec docs/features/spec-compliance-verification.md',
      },
      { type: 'h2', id: 'check', text: 'compliance check' },
      {
        type: 'p',
        text: 'Scan project tests for explicit obligation evidence and emit a structured report with `covered`, `partial`, `uncovered`, and `indeterminate` states.',
      },
      {
        type: 'terminal',
        lang: 'bash',
        copyable: true,
        code: 'paqad-ai compliance check --project-root .',
      },
      { type: 'h2', id: 'skeleton', text: 'compliance skeleton' },
      {
        type: 'p',
        text: 'Generate one failing Vitest file per obligation so implementation can start from independent test pressure instead of self-authored happy paths.',
      },
      {
        type: 'terminal',
        lang: 'bash',
        copyable: true,
        code: 'paqad-ai compliance skeleton --out tests/compliance-skeletons',
      },
      { type: 'h2', id: 'review', text: 'compliance review' },
      {
        type: 'p',
        text: 'Run deterministic spec-quality review before extraction. The report is persisted per spec and tracks new/existing/resolved defects.',
      },
      {
        type: 'terminal',
        lang: 'bash',
        copyable: true,
        code: 'paqad-ai compliance review docs/features/spec-compliance-verification.md',
      },
      { type: 'h2', id: 'doctor', text: 'compliance doctor' },
      {
        type: 'p',
        text: 'Validate the obligation index before use. The doctor call catches missing files, unsupported schema versions, and duplicate obligation IDs.',
      },
      {
        type: 'terminal',
        lang: 'bash',
        copyable: true,
        code: 'paqad-ai compliance doctor',
      },
      { type: 'h2', id: 'boundary', text: 'compliance boundary' },
      {
        type: 'p',
        text: 'Analyze shared contract-state boundaries across specs and report unhandled variants; optionally generate boundary test stubs.',
      },
      {
        type: 'terminal',
        lang: 'bash',
        copyable: true,
        code: 'paqad-ai compliance boundary --generate',
      },
      { type: 'h2', id: 'patterns', text: 'compliance patterns' },
      {
        type: 'p',
        text: 'List, prune, and export recurring defect patterns recorded from prior implementation findings.',
      },
      {
        type: 'terminal',
        lang: 'bash',
        copyable: true,
        code: 'paqad-ai compliance patterns --export patterns.md --format markdown',
      },
      { type: 'h2', id: 'evidence-model', text: 'Evidence model' },
      {
        type: 'ul',
        items: [
          'Use `// @obligation <ID>` annotations for exact traceability from tests back to requirements.',
          'Generated `GEN-*` obligations are coverable the same way explicit IDs are coverable.',
          'String mentions without explicit annotations remain `partial` so reports distinguish weak from strong evidence.',
        ],
      },
    ],
  },

  'cli-refresh': {
    id: 'cli-refresh',
    title: 'refresh & update',
    section: 'CLI Reference',
    sectionId: 'cli-reference',
    prev: 'cli-compliance',
    next: 'cli-packs',
    keywords: ['refresh', 'update', 'regenerate', 'staleness', 'drift', 'upgrade'],
    content: [
      { type: 'h1', text: 'refresh & update' },
      {
        type: 'p',
        text: 'Two commands handle keeping your generated files current: `refresh` re-runs generation for your existing project, and `update` upgrades the framework itself and re-generates.',
      },
      { type: 'h2', id: 'refresh', text: 'refresh' },
      {
        type: 'p',
        text: 'Use `refresh` whenever you make a change to your project that should be reflected in the generated documentation, adding a new framework dependency, changing your design system, or enabling a new capability.',
      },
      {
        type: 'terminal',
        lang: 'bash',
        copyable: true,
        code: '# Re-run stack detection and regenerate all docs\npaqad-ai refresh --stack\n\n# Regenerate only the design system documentation\npaqad-ai refresh --design-system\n\n# Regenerate everything\npaqad-ai refresh',
      },
      { type: 'h2', id: 'idempotency', text: 'Idempotency' },
      {
        type: 'p',
        text: '`refresh` uses differential regeneration. It computes a hash of the current resolved output and compares it to the hash stored in `.paqad/`. Only files whose resolved content has changed are rewritten. Your manual edits to non-generated sections are preserved.',
      },
      { type: 'h2', id: 'update', text: 'update' },
      {
        type: 'p',
        text: '`update` installs the latest version of paqad-ai globally and then re-runs the generation pass using the new framework templates. Use it after upgrading paqad-ai to pick up changes to base rules, new MCP defaults, or updated agent configurations.',
      },
      { type: 'terminal', lang: 'bash', copyable: true, code: 'paqad-ai update' },
      {
        type: 'callout',
        variant: 'warning',
        text: "Always review the diff produced by `update` before committing. A framework update may change base rules that affect your team's workflow.",
      },
    ],
  },

  'cli-packs': {
    id: 'cli-packs',
    title: 'packs',
    section: 'CLI Reference',
    sectionId: 'cli-reference',
    prev: 'cli-refresh',
    next: 'cli-patterns',
    keywords: ['packs', 'install', 'remove', 'validate', 'create', 'custom pack', 'list'],
    content: [
      { type: 'h1', text: 'packs' },
      {
        type: 'p',
        text: 'The `packs` command group lets you inspect, install, validate, and create stack packs, the YAML units that drive detection and documentation generation.',
      },
      { type: 'h2', id: 'list', text: 'packs list' },
      {
        type: 'p',
        text: 'List all packs available to the current project: built-in packs, globally installed packs, and project-local packs.',
      },
      { type: 'terminal', lang: 'bash', copyable: true, code: 'paqad-ai packs list' },
      {
        type: 'terminal',
        lang: 'bash',
        code: 'built-in  laravel        php\nbuilt-in  react          node\nbuilt-in  vue            node\nbuilt-in  django         python\nproject   my-monorepo    node\nglobal    company-rules  *',
      },
      { type: 'h2', id: 'create', text: 'packs create' },
      {
        type: 'p',
        text: 'Scaffold a new pack interactively. paqad-ai creates a `pack.yaml` template in your project-local pack directory.',
      },
      { type: 'terminal', lang: 'bash', copyable: true, code: 'paqad-ai packs create my-stack' },
      { type: 'h2', id: 'validate', text: 'packs validate' },
      {
        type: 'p',
        text: 'Validate all project-local packs against the pack schema. Errors are reported with line numbers.',
      },
      { type: 'terminal', lang: 'bash', copyable: true, code: 'paqad-ai packs validate' },
      { type: 'h2', id: 'install-remove', text: 'packs install / remove' },
      {
        type: 'p',
        text: 'Install a pack from a registry or a local path, or remove an installed pack.',
      },
      {
        type: 'terminal',
        lang: 'bash',
        copyable: true,
        code: 'paqad-ai packs install @company/packs/rails\npaqad-ai packs remove @company/packs/rails',
      },
    ],
  },

  'cli-patterns': {
    id: 'cli-patterns',
    title: 'patterns',
    section: 'CLI Reference',
    sectionId: 'cli-reference',
    prev: 'cli-packs',
    next: 'cli-capabilities',
    keywords: ['patterns', 'solutions', 'library', 'scoring', 'export', 'prune'],
    content: [
      { type: 'h1', text: 'patterns' },
      {
        type: 'p',
        text: 'Patterns are reusable solutions captured from completed workflows. When paqad-ai solves a problem in your codebase, it can record the approach as a pattern so future tasks on similar problems can start from a proven starting point.',
      },
      { type: 'h2', id: 'list', text: 'patterns list' },
      {
        type: 'terminal',
        lang: 'bash',
        copyable: true,
        code: 'paqad-ai patterns list\npaqad-ai patterns list --tag auth\npaqad-ai patterns list --stack laravel',
      },
      { type: 'h2', id: 'prune', text: 'patterns prune' },
      { type: 'p', text: 'Remove low-scoring or outdated patterns from the library.' },
      {
        type: 'terminal',
        lang: 'bash',
        copyable: true,
        code: 'paqad-ai patterns prune --score-below 0.4',
      },
      { type: 'h2', id: 'export', text: 'patterns export' },
      {
        type: 'p',
        text: 'Export the pattern library as JSON for sharing across projects or teams.',
      },
      {
        type: 'terminal',
        lang: 'bash',
        copyable: true,
        code: 'paqad-ai patterns export --out patterns.json',
      },
      { type: 'h2', id: 'scoring', text: 'Pattern scoring' },
      {
        type: 'p',
        text: 'Each pattern is scored automatically based on how closely it matches an incoming task. The algorithm weights framework overlap at 0.4 and keyword overlap at 0.6. Patterns with a score below 0.3 are not suggested.',
      },
    ],
  },

  'cli-capabilities': {
    id: 'cli-capabilities',
    title: 'capabilities',
    section: 'CLI Reference',
    sectionId: 'cli-reference',
    prev: 'cli-patterns',
    next: 'cli-rag',
    keywords: [
      'capabilities',
      'content',
      'coding',
      'security',
      'enable',
      'disable',
      'feature tiers',
    ],
    content: [
      { type: 'h1', text: 'capabilities' },
      {
        type: 'p',
        text: 'The `capabilities` command manages which feature tiers are active in your project. Capabilities control what documentation gets generated and which agent roles are available.',
      },
      { type: 'h2', id: 'list-available', text: 'capabilities list & available' },
      {
        type: 'terminal',
        lang: 'bash',
        copyable: true,
        code: '# Show enabled capabilities\npaqad-ai capabilities list\n\n# Show all capabilities including disabled\npaqad-ai capabilities available',
      },
      {
        type: 'terminal',
        lang: 'bash',
        code: 'enabled:\n  ✔ content\n  ✔ coding\n  ✔ security\n\navailable:\n  content  : writing, markdown, attribution rules\n  coding   : code quality, review, architecture (requires: content)\n\ndependency-managed:\n  security : pentest, OWASP, guardrails (follows coding automatically)',
      },
      { type: 'h2', id: 'add-remove', text: 'capabilities add & remove' },
      {
        type: 'terminal',
        lang: 'bash',
        copyable: true,
        code: 'paqad-ai capabilities add coding\npaqad-ai capabilities remove coding',
      },
      {
        type: 'callout',
        variant: 'warning',
        text: 'Adding a capability triggers a `refresh` automatically. Removing one removes the documentation it generated, review the diff carefully before committing.',
      },
      { type: 'h2', id: 'dependencies', text: 'Capability dependencies' },
      {
        type: 'p',
        text: '`security` requires `coding` and is dependency-managed rather than toggled directly. `coding` requires `content`. Enabling or disabling `coding` automatically adds or removes `security`.',
      },
    ],
  },

  'cli-rag': {
    id: 'cli-rag',
    title: 'rag',
    section: 'CLI Reference',
    sectionId: 'cli-reference',
    prev: 'cli-capabilities',
    next: 'cli-graph',
    keywords: ['rag', 'vector store', 'index', 'search', 'embeddings', 'context'],
    content: [
      { type: 'h1', text: 'rag' },
      {
        type: 'p',
        text: 'The `rag` command manages the optional Retrieval-Augmented Generation layer, an accelerator on top of the normal grep-and-read default. When enabled, paqad-ai indexes your codebase and documentation and feeds a few relevant, verify-first slices into the prompt. It stays off until you turn it on, and falls back to plain grep whenever it is off or cold.',
      },
      { type: 'h2', id: 'init', text: 'rag init' },
      {
        type: 'p',
        text: 'Enable RAG and build the initial vector index. Pick a provider, `local` is free and runs entirely on your machine; `openai` and `voyageai` use remote APIs.',
      },
      {
        type: 'terminal',
        lang: 'bash',
        copyable: true,
        code: 'paqad-ai rag init\npaqad-ai rag init --provider local\npaqad-ai rag init --provider openai\npaqad-ai rag init --provider voyageai',
      },
      { type: 'h2', id: 'rebuild', text: 'rag rebuild' },
      { type: 'p', text: 'Force a full rebuild of the vector index.' },
      { type: 'terminal', lang: 'bash', copyable: true, code: 'paqad-ai rag rebuild' },
      { type: 'h2', id: 'status', text: 'rag status' },
      {
        type: 'p',
        text: 'Show the active provider, model, index validity, size on disk, and chunk count.',
      },
      { type: 'terminal', lang: 'bash', copyable: true, code: 'paqad-ai rag status' },
      { type: 'h2', id: 'eval', text: 'rag eval' },
      {
        type: 'p',
        text: 'Run deterministic evals against the current index. Supports `lexical-vs-rag`, `rag-vs-candidate`, and `feature-off-vs-on` comparison modes; `--model-graded` adds an optional LLM-graded lane.',
      },
      {
        type: 'terminal',
        lang: 'bash',
        copyable: true,
        code: 'paqad-ai rag eval\npaqad-ai rag eval --mode lexical-vs-rag\npaqad-ai rag eval --baseline ./baseline.json --mode rag-vs-candidate\npaqad-ai rag eval --model-graded',
      },
      { type: 'h2', id: 'clear', text: 'rag clear' },
      {
        type: 'p',
        text: 'Delete the vector index and disable RAG. Pass `--yes` to skip the confirmation prompt.',
      },
      { type: 'terminal', lang: 'bash', copyable: true, code: 'paqad-ai rag clear --yes' },
      { type: 'h2', id: 'providers', text: 'Embedding providers' },
      {
        type: 'table',
        headers: ['Provider', 'Description'],
        rows: [
          [
            'local',
            'Default. Xenova/all-MiniLM-L6-v2 runs in-process. No API key, cached under ~/.paqad/models.',
          ],
          ['openai', 'text-embedding-3-small. Requires OPENAI_API_KEY in `.paqad/secrets.env`.'],
          [
            'voyageai',
            'voyage-code-3, optimized for code. Requires VOYAGE_API_KEY in `.paqad/secrets.env`.',
          ],
        ],
      },
      {
        type: 'p',
        text: 'Provider selection persists in `.paqad/project-profile.yaml` under `intelligence.rag_*`. Project-specific include/exclude rules live in `.paqad/rag.ignore.yaml`.',
      },
    ],
  },

  'cli-graph': {
    id: 'cli-graph',
    title: 'graph',
    section: 'CLI Reference',
    sectionId: 'cli-reference',
    prev: 'cli-rag',
    next: 'packs-overview',
    keywords: [
      'graph',
      'visualization',
      'visualisation',
      'webgl',
      'sigma',
      'browser',
      'rag map',
      'project map',
      'explorer',
    ],
    content: [
      { type: 'h1', text: 'graph' },
      {
        type: 'p',
        text: 'The `graph` command opens an interactive WebGL visualization of your project in the browser. One command, no extra install, the server, frontend, and layout engine all ship inside `paqad-ai`. It reads everything paqad-ai already knows about your project from `.paqad/`, modules, files, imports, RAG chunks, symbols, health, defects, and renders it as a live, explorable map.',
      },
      { type: 'h2', id: 'synopsis', text: 'Synopsis' },
      { type: 'terminal', lang: 'bash', copyable: true, code: 'paqad-ai graph [options]' },
      { type: 'h2', id: 'quick-start', text: 'Quick start' },
      {
        type: 'terminal',
        lang: 'bash',
        copyable: true,
        code: 'cd my-project\npaqad-ai onboard            # one time per project\npaqad-ai graph              # any time after',
      },
      {
        type: 'p',
        text: 'Browser opens at `http://127.0.0.1:5371` showing the full project graph. Edit anything under `.paqad/` and the view live-reloads while preserving your zoom and selection.',
      },
      { type: 'h2', id: 'options', text: 'Options' },
      {
        type: 'table',
        headers: ['Flag', 'Description'],
        rows: [
          [
            '--port <n>',
            'Server port. Auto-increments to the next free port if taken. Default `5371`.',
          ],
          ['--host <h>', 'Bind address. Default `127.0.0.1` (loopback only, no remote exposure).'],
          ['--no-open', 'Print the URL and skip auto-opening the browser. Useful in SSH or CI.'],
          [
            '--threshold <n>',
            'Initial similarity threshold (0..1). Adjustable from the UI. Default `0.75`.',
          ],
          ['--no-watch', 'Disable live reload on `.paqad/` changes.'],
          ['--quiet', 'Suppress non-essential stdout. The URL is still printed.'],
          ['--project-root <path>', 'Run against a project root other than the current directory.'],
        ],
      },
      { type: 'h2', id: 'what-renders', text: 'What renders' },
      {
        type: 'ul',
        items: [
          '**Modules** as the largest nodes, coloured by your active overlay (health / defects / risk / complexity correction).',
          '**Files** clustered around their parent module, sized by symbol count, inheriting overlay colour at reduced saturation.',
          '**Chunks**, the AST-aware RAG chunks paqad-ai indexed, in teal.',
          '**Symbols**, every exported function, class, and constant, in purple.',
          '**Imports edges** in indigo, derived from a TS/JS import scan with `@/` alias support.',
          '**Similarity edges** in orange, resolved on demand from your vector store at any cosine threshold.',
        ],
      },
      { type: 'h2', id: 'interaction', text: 'What you can do' },
      {
        type: 'ul',
        items: [
          '**Search** modules, files, symbols, and file basenames from the top bar. Press `/` to focus, `n`/`N` to cycle matches. The camera pans to the active match.',
          '**Click** any node to open a detail panel, module file lists, file import-in/import-out neighbourhoods, chunk content with show-more, symbol metadata.',
          '**Threshold slider** rebuilds the similarity layer on commit (not on drag). Module-scoped queries return in milliseconds; full-project queries return in a few seconds.',
          '**Overlays** swap the module colour scheme between none, health, defect density (log-scaled), risk floor, and complexity correction. The legend in the bottom-left always reflects the active overlay.',
          '**Layer toggles** hide and re-show modules, files, chunks, symbols, contains/imports/similar edges client-side without re-fetching.',
          '**Live reload** picks up any `.paqad/` change within ~500ms and merges the new graph in place, your viewport and selection are preserved.',
        ],
      },
      { type: 'h2', id: 'rag-requirements', text: 'RAG and similarity' },
      {
        type: 'p',
        text: 'Similarity edges and chunk nodes need a vector store. They work with any embedding provider, `local`, `openai`, or `voyageai`. If RAG is disabled, the graph still renders fully: modules, files, imports, symbols, overlays, search, and detail panel all work normally. The similarity slider is disabled with a clear banner, and chunk nodes are hidden until you run `paqad-ai rag init`.',
      },
      {
        type: 'callout',
        variant: 'tip',
        text: 'Bind address is loopback-only by default and no telemetry leaves the process. Override with `--host` if you need to share a view across a trusted network.',
      },
      { type: 'h2', id: 'pre-conditions', text: 'Pre-conditions' },
      {
        type: 'p',
        text: 'The current directory must contain a `.paqad/` produced by onboarding. If it is missing, `paqad-ai graph` exits with code 2 and points you at `paqad-ai onboard`. All other artefacts (module health, defect store, vector index, plan history) are optional, missing pieces degrade gracefully into a banner instead of an error.',
      },
    ],
  },

  /* ── Stack Packs ─────────────────────────────────────────────────────── */

  'packs-overview': {
    id: 'packs-overview',
    title: 'What Are Packs',
    section: 'Stack Packs',
    sectionId: 'stack-packs',
    prev: 'cli-graph',
    next: 'packs-built-in',
    keywords: ['packs', 'pack yaml', 'what are packs', 'structure', 'framework pack'],
    content: [
      { type: 'h1', text: 'What Are Packs' },
      {
        type: 'p',
        text: 'A pack is a YAML file that teaches paqad-ai about a specific framework or project archetype. Every built-in stack, Laravel, React, Django, Rails, and so on, is defined by a pack. You can create your own packs for internal frameworks or custom project shapes.',
      },
      { type: 'h2', id: 'pack-anatomy', text: 'Anatomy of a pack' },
      {
        type: 'terminal',
        lang: 'yaml',
        label: 'pack.yaml',
        code: 'name: my-framework\necosystem: node          # which parser reads this project\nmanifests:              # files that signal this framework\n  - package.json\n\ndetect:                 # presence of these packages = this pack\n  dependencies:\n    - my-framework-core\n\ntraits:                 # optional sub-library overlays\n  - name: my-plugin\n    detect:\n      dependencies: [my-framework-plugin]\n\nmcp:\n  servers:\n    - name: my-framework-docs\n      command: npx\n      args: ["-y", "my-framework-mcp"]\n\ndocs:\n  stack_guide: docs/stack.md    # path relative to pack root\n  design_system: docs/design.md\n\narchetypes: []          # optional: cli, library, service',
      },
      { type: 'h2', id: 'what-packs-drive', text: 'What packs drive' },
      {
        type: 'ul',
        items: [
          'Detection, which manifest files and dependency names trigger this pack.',
          'Documentation, which stack-specific doc templates to include in the resolved output.',
          'MCP servers, which Model Context Protocol servers to register for this stack.',
          'Traits, sub-library overlays (e.g. a `vitest` trait within a `node` pack).',
          'Archetypes, project-shape rules that apply on top of the stack rules.',
          'Pentest maps, OWASP attack surface hints for the security capability.',
          'Testing metadata, test runner, coverage thresholds, and test file patterns.',
        ],
      },
    ],
  },

  'packs-built-in': {
    id: 'packs-built-in',
    title: 'Built-in Packs',
    section: 'Stack Packs',
    sectionId: 'stack-packs',
    prev: 'packs-overview',
    next: 'packs-custom',
    keywords: [
      'built-in packs',
      'supported frameworks',
      'laravel',
      'react',
      'vue',
      'django',
      'rails',
    ],
    content: [
      { type: 'h1', text: 'Built-in Packs' },
      {
        type: 'p',
        text: 'paqad-ai ships with twenty-two built-in packs: nineteen for popular frameworks and three archetypes for common project shapes.',
      },
      { type: 'h2', id: 'framework-packs', text: 'Framework packs' },
      {
        type: 'table',
        headers: ['Pack', 'Ecosystem', 'Key traits'],
        rows: [
          ['laravel', 'php', 'Eloquent, Artisan, Blade, queues, policies'],
          ['react', 'node', 'JSX, hooks, component patterns, state management'],
          ['vue', 'node', 'Options API, Composition API, Pinia, Vue Router'],
          ['angular', 'node', 'Modules, DI, RxJS, Angular CLI'],
          ['svelte', 'node', 'Stores, reactive declarations, SvelteKit'],
          ['astro', 'node', 'Islands, content collections, adapters'],
          ['nextjs', 'node', 'App Router, Server Components, API routes'],
          ['django', 'python', 'ORM, views, forms, middleware, settings'],
          ['fastapi', 'python', 'Pydantic, dependency injection, async routes'],
          ['rails', 'ruby', 'ActiveRecord, ActionController, Hotwire'],
          ['spring-boot', 'jvm', 'Spring MVC, JPA, security, actuator'],
          ['express', 'node', 'Middleware, routing, REST conventions'],
          ['nestjs', 'node', 'Modules, decorators, guards, pipes, DTOs'],
          ['flutter', 'dart', 'Widgets, state management, platform channels'],
          ['dotnet', 'dotnet', 'Controllers, minimal APIs, EF Core, Razor'],
          ['flask', 'python', 'Blueprints, extensions, request handlers, Jinja'],
          ['go-web', 'go', 'net/http, chi/gin/echo, middleware'],
          ['rust-web', 'rust', 'Axum/Actix routes, extractors, async services'],
          ['kotlin-android', 'jvm', 'Activities, Compose, Room, navigation'],
        ],
      },
      { type: 'h2', id: 'archetype-packs', text: 'Archetype packs' },
      {
        type: 'table',
        headers: ['Archetype', 'Ecosystem', 'Description'],
        rows: [
          [
            'node-cli',
            'node',
            'Command-line tools. Includes Commander conventions, bin packaging, and E2E test patterns.',
          ],
          [
            'node-library',
            'node',
            'Publishable npm packages. Includes tsup build rules, exports map, and changeset workflow.',
          ],
          [
            'node-service',
            'node',
            'Background services and APIs. Includes health-check, graceful shutdown, and observability patterns.',
          ],
        ],
      },
    ],
  },

  'packs-custom': {
    id: 'packs-custom',
    title: 'Creating Custom Packs',
    section: 'Stack Packs',
    sectionId: 'stack-packs',
    prev: 'packs-built-in',
    next: 'packs-precedence',
    keywords: ['custom pack', 'create pack', 'pack create', 'custom framework', 'internal stack'],
    content: [
      { type: 'h1', text: 'Creating Custom Packs' },
      {
        type: 'p',
        text: 'If your project uses an internal framework or a stack that paqad-ai does not recognise out of the box, you can create a custom pack. It takes about five minutes.',
      },
      { type: 'h2', id: 'scaffold', text: 'Scaffold with the CLI' },
      { type: 'terminal', lang: 'bash', copyable: true, code: 'paqad-ai packs create my-stack' },
      {
        type: 'p',
        text: 'This creates `.paqad/packs/my-stack/pack.yaml` with a commented template. Fill in the fields that apply to your framework.',
      },
      { type: 'h2', id: 'minimal-pack', text: 'Minimal pack example' },
      {
        type: 'terminal',
        lang: 'yaml',
        label: '.paqad/packs/my-stack/pack.yaml',
        code: 'name: my-stack\necosystem: node\nmanifests:\n  - package.json\ndetect:\n  dependencies:\n    - my-stack-core\ndocs:\n  stack_guide: docs/my-stack-guide.md',
      },
      { type: 'h2', id: 'placement', text: 'Pack placement' },
      {
        type: 'table',
        headers: ['Location', 'Scope'],
        rows: [
          ['.paqad/packs/', 'Project-local. Only applies in this project.'],
          ['~/.paqad/packs/', 'Global. Available in all projects on this machine.'],
        ],
      },
      { type: 'h2', id: 'validate', text: 'Validate your pack' },
      { type: 'terminal', lang: 'bash', copyable: true, code: 'paqad-ai packs validate' },
      {
        type: 'callout',
        variant: 'tip',
        text: 'You can include a `docs/` subdirectory alongside your `pack.yaml` with markdown templates. paqad-ai will merge them into the resolved documentation bundle.',
      },
    ],
  },

  'packs-precedence': {
    id: 'packs-precedence',
    title: 'Pack Precedence',
    section: 'Stack Packs',
    sectionId: 'stack-packs',
    prev: 'packs-custom',
    next: 'adapters-overview',
    keywords: ['precedence', 'override', 'pack order', 'conflict', 'resolution'],
    content: [
      { type: 'h1', text: 'Pack Precedence' },
      {
        type: 'p',
        text: 'When multiple packs provide the same rule ID or documentation section, the resolver uses a defined precedence order to decide which version wins.',
      },
      { type: 'h2', id: 'order', text: 'Precedence order' },
      {
        type: 'ol',
        items: [
          'Built-in packs, lowest precedence.',
          'Globally installed packs (`~/.paqad/packs/`).',
          'Project-local packs (`.paqad/packs/`), highest precedence.',
        ],
      },
      {
        type: 'p',
        text: 'This means a project-local pack can always override a built-in rule or template. Useful for teams that need to adapt framework defaults to internal conventions.',
      },
      { type: 'h2', id: 'invalid-overrides', text: 'Invalid overrides' },
      {
        type: 'p',
        text: 'If a pack declares a rule with an ID that conflicts with a higher-precedence pack, the lower-precedence version is silently dropped. The `doctor` command reports any unexpected drops under the `no duplicate rules` gate.',
      },
      {
        type: 'callout',
        variant: 'note',
        text: 'Use unique, namespaced rule IDs in custom packs (`my-stack/auth-rule` rather than just `auth-rule`) to avoid unintentional conflicts with built-in content.',
      },
    ],
  },

  /* ── Adapters ────────────────────────────────────────────────────────── */

  'adapters-overview': {
    id: 'adapters-overview',
    title: 'Overview',
    section: 'AI Agent Adapters',
    sectionId: 'adapters',
    prev: 'packs-precedence',
    next: 'adapters-claude-code',
    keywords: ['adapters', 'overview', 'entry files', 'MCP', 'supported tools'],
    content: [
      { type: 'h1', text: 'AI Agent Adapters' },
      {
        type: 'p',
        text: "An adapter is the bridge between paqad-ai's shared documentation bundle and a specific AI coding tool. paqad-ai supports eleven adapters, each of which writes the entry file(s) that the tool looks for when it opens your project.",
      },
      { type: 'h2', id: 'how-adapters-work', text: 'How adapters work' },
      {
        type: 'p',
        text: "All adapters read from the same resolved documentation bundle in `docs/instructions/`. The adapter's job is to produce the tool-specific entry file, MCP configuration, and any lightweight provider config the tool expects. Runtime agents and skills stay in the installed paqad-ai package instead of being copied into each project.",
      },
      { type: 'h2', id: 'adapter-table', text: 'Supported adapters' },
      {
        type: 'table',
        headers: ['Adapter', 'Entry file', 'MCP config', 'Extras'],
        rows: [
          ['claude-code', 'CLAUDE.md', '.claude/settings.mcp.json', 'Hooks, cache, memory'],
          ['cursor', '.cursor/rules/paqad.mdc', '.cursor/mcp.json', 'Cache, memory'],
          ['github-copilot', '.github/copilot-instructions.md', '.vscode/mcp.json', ', '],
          ['windsurf', '.windsurfrules', '.windsurf/mcp.json', 'Cache, memory'],
          ['continue', '.continue/rules/paqad.md', '.continue/mcp.json', ', '],
          ['codex-cli', 'AGENTS.md', '.codex/mcp.json', 'Hooks, cache, memory'],
          ['gemini-cli', 'GEMINI.md', '.gemini/mcp.json', 'Hooks, cache, memory'],
          ['antigravity', 'ANTIGRAVITY.md', '.antigravity/mcp.json', 'Hooks, cache, memory'],
          ['junie', '.junie/AGENTS.md', '.junie/mcp/mcp.json', ', '],
          ['aider', '.aider.conf.yml', ', ', 'Conventions only'],
          ['aiassistant', '.aiassistant/rules/guidelines.md', ', ', 'Rules only'],
        ],
      },
      { type: 'h2', id: 'selecting-adapters', text: 'Selecting adapters' },
      {
        type: 'p',
        text: 'Choose your adapters during `paqad-ai onboard`. You can add or remove adapters at any time by re-running `paqad-ai onboard` or editing `.paqad/project-profile.yaml` and running `paqad-ai refresh`.',
      },
    ],
  },

  'adapters-claude-code': {
    id: 'adapters-claude-code',
    title: 'Claude Code',
    section: 'AI Agent Adapters',
    sectionId: 'adapters',
    prev: 'adapters-overview',
    next: 'adapters-cursor',
    keywords: ['claude', 'claude code', 'CLAUDE.md', 'anthropic', 'MCP'],
    content: [
      { type: 'h1', text: 'Claude Code' },
      {
        type: 'p',
        text: 'The Claude Code adapter writes `CLAUDE.md` at your project root and configures the `.claude/` directory with MCP defaults plus lightweight local settings such as hooks, cache, and memory.',
      },
      { type: 'h2', id: 'entry-file', text: 'Entry file, CLAUDE.md' },
      {
        type: 'p',
        text: '`CLAUDE.md` is the first file Claude Code reads when it opens your project. paqad-ai keeps it lean: it declares the framework entry path and defers all detail to `docs/instructions/`.',
      },
      {
        type: 'terminal',
        lang: 'bash',
        label: 'CLAUDE.md (generated)',
        code: '# Claude Entry Framework:\n\n.paqad/framework-path.txt\nRules:\ndocs/instructions/rules\nStack Docs:\ndocs/instructions/stack\nDesign System:\ndocs/instructions/design-system',
      },
      { type: 'h2', id: 'mcp-config', text: 'MCP configuration' },
      {
        type: 'p',
        text: 'MCP server defaults for your detected stack are written to `.claude/settings.json`. Claude Code reads this file automatically and registers the servers on startup.',
      },
      { type: 'h2', id: 'runtime-skills', text: 'Runtime skills' },
      {
        type: 'p',
        text: 'Claude Code uses the shared paqad-ai runtime skills and agents from the installed package. Onboarding does not copy those bundles into `.claude/skills/` or `.claude/agents/`; the project only keeps the thin entry file and local config needed to point Claude Code at the shared runtime.',
      },
      {
        type: 'callout',
        variant: 'tip',
        text: 'After onboarding, open your project in Claude Code and use the generated `CLAUDE.md` plus MCP config to load the shared paqad-ai runtime context.',
      },
    ],
  },

  'adapters-cursor': {
    id: 'adapters-cursor',
    title: 'Cursor',
    section: 'AI Agent Adapters',
    sectionId: 'adapters',
    prev: 'adapters-claude-code',
    next: 'adapters-copilot',
    keywords: ['cursor', 'cursorrules', 'cursor mcp', '.cursor'],
    content: [
      { type: 'h1', text: 'Cursor' },
      {
        type: 'p',
        text: 'The Cursor adapter writes `.cursorrules` at the project root and populates `.cursor/rules/` with stack-specific rule fragments. MCP configuration goes to `.cursor/mcp.json`.',
      },
      { type: 'h2', id: 'entry-file', text: 'Entry file, .cursorrules' },
      {
        type: 'p',
        text: "`.cursorrules` is a markdown file Cursor loads as persistent context for all AI interactions in your project. paqad-ai writes a structured summary of your project's conventions, referencing the full rule set in `.cursor/rules/`.",
      },
      { type: 'h2', id: 'rules-directory', text: 'Rules directory' },
      {
        type: 'p',
        text: 'Cursor supports scoped rule files in `.cursor/rules/`. paqad-ai writes one `.mdc` file per documentation category (architecture, testing, security, etc.) so Cursor can apply rules contextually based on which files are open.',
      },
      { type: 'h2', id: 'mcp', text: 'MCP, .cursor/mcp.json' },
      {
        type: 'terminal',
        lang: 'json',
        label: '.cursor/mcp.json (example)',
        code: '{\n  "mcpServers": {\n    "laravel-docs": {\n      "command": "npx",\n      "args": ["-y", "laravel-mcp-docs"]\n    }\n  }\n}',
      },
    ],
  },

  'adapters-copilot': {
    id: 'adapters-copilot',
    title: 'GitHub Copilot',
    section: 'AI Agent Adapters',
    sectionId: 'adapters',
    prev: 'adapters-cursor',
    next: 'adapters-windsurf',
    keywords: ['github copilot', 'copilot instructions', 'vscode', 'github'],
    content: [
      { type: 'h1', text: 'GitHub Copilot' },
      {
        type: 'p',
        text: 'The GitHub Copilot adapter writes `.github/copilot-instructions.md`, the standard file GitHub Copilot and Copilot Chat read for repository-level context.',
      },
      { type: 'h2', id: 'entry-file', text: 'Entry file, copilot-instructions.md' },
      {
        type: 'p',
        text: 'GitHub Copilot reads `.github/copilot-instructions.md` automatically for any repository it is active in. paqad-ai generates a comprehensive markdown document covering your stack, conventions, and team rules.',
      },
      { type: 'h2', id: 'mcp-vscode', text: 'MCP via VS Code settings' },
      {
        type: 'p',
        text: 'MCP servers for the Copilot adapter are registered in `.vscode/settings.json` under `github.copilot.mcp.servers`. This is the standard VS Code MCP configuration location.',
      },
      {
        type: 'callout',
        variant: 'note',
        text: 'The Copilot adapter does not support skills or agents directories. It produces documentation only. For richer agent configuration, consider Claude Code or Cursor alongside Copilot.',
      },
    ],
  },

  'adapters-windsurf': {
    id: 'adapters-windsurf',
    title: 'Windsurf',
    section: 'AI Agent Adapters',
    sectionId: 'adapters',
    prev: 'adapters-copilot',
    next: 'adapters-continue',
    keywords: ['windsurf', 'windsurfrules', 'codeium', 'cascade'],
    content: [
      { type: 'h1', text: 'Windsurf' },
      {
        type: 'p',
        text: 'The Windsurf adapter produces `.windsurfrules` for the Windsurf editor plus MCP, cache, and memory configuration for Cascade. Runtime skills and agents remain in the installed paqad-ai package.',
      },
      { type: 'h2', id: 'entry-file', text: 'Entry file, .windsurfrules' },
      {
        type: 'p',
        text: 'Windsurf reads `.windsurfrules` to set persistent project context for all Cascade sessions. The generated file is structured with clearly labelled sections: Stack, Rules, Design System, and Testing.',
      },
      { type: 'h2', id: 'runtime-agents', text: 'Runtime agents' },
      {
        type: 'p',
        text: 'Cascade uses the shared runtime agents shipped with paqad-ai. Onboarding keeps the project-local output thin and does not create `.windsurf/agents/` or `.windsurf/skills/` directories.',
      },
      { type: 'h2', id: 'mcp', text: 'MCP, .windsurf/mcp.json' },
      {
        type: 'p',
        text: 'Stack-specific MCP servers are registered in `.windsurf/mcp.json`. Cascade loads these automatically at session start.',
      },
    ],
  },

  'adapters-continue': {
    id: 'adapters-continue',
    title: 'Continue',
    section: 'AI Agent Adapters',
    sectionId: 'adapters',
    prev: 'adapters-windsurf',
    next: 'adapters-codex',
    keywords: ['continue', 'continue.dev', 'config.json', 'prompts'],
    content: [
      { type: 'h1', text: 'Continue' },
      {
        type: 'p',
        text: 'The Continue adapter writes `.continue/config.json` with project context, custom prompts, and MCP server registration. Continue is an open-source VS Code and JetBrains extension.',
      },
      { type: 'h2', id: 'config', text: 'Configuration, .continue/config.json' },
      {
        type: 'p',
        text: 'paqad-ai writes the system prompt, custom slash commands, and context providers into `.continue/config.json`. The file is merged carefully, existing user customisations are preserved.',
      },
      { type: 'h2', id: 'prompts', text: 'Custom prompts' },
      {
        type: 'p',
        text: "The Continue adapter generates slash-command prompts for common tasks: `/review`, `/document`, `/test`. These surface in the Continue chat panel and are pre-seeded with your project's conventions.",
      },
      {
        type: 'callout',
        variant: 'tip',
        text: "Continue's context provider system is powerful. After onboarding, add your own context providers alongside the paqad-ai defaults in `.continue/config.json`.",
      },
    ],
  },

  'adapters-codex': {
    id: 'adapters-codex',
    title: 'Codex CLI',
    section: 'AI Agent Adapters',
    sectionId: 'adapters',
    prev: 'adapters-continue',
    next: 'adapters-gemini',
    keywords: ['codex', 'codex cli', 'openai codex', 'AGENTS.md'],
    content: [
      { type: 'h1', text: 'Codex CLI' },
      {
        type: 'p',
        text: "The Codex CLI adapter writes `AGENTS.md` at your project root, the standard file that OpenAI's Codex CLI reads for project context, alongside an MCP configuration file.",
      },
      { type: 'h2', id: 'entry-file', text: 'Entry file, AGENTS.md' },
      {
        type: 'p',
        text: '`AGENTS.md` follows the same structure as `CLAUDE.md`: a brief framework header pointing to `docs/instructions/`. Codex CLI reads this file before any agent task begins.',
      },
      { type: 'h2', id: 'mcp', text: 'MCP configuration' },
      {
        type: 'p',
        text: 'MCP defaults are written to `codex-mcp.json`. Pass the file path to Codex CLI with the `--mcp-config` flag when starting a session.',
      },
      { type: 'terminal', lang: 'bash', copyable: true, code: 'codex --mcp-config codex-mcp.json' },
    ],
  },

  'adapters-gemini': {
    id: 'adapters-gemini',
    title: 'Gemini CLI',
    section: 'AI Agent Adapters',
    sectionId: 'adapters',
    prev: 'adapters-codex',
    next: 'adapters-antigravity',
    keywords: ['gemini', 'gemini cli', 'google gemini', 'GEMINI.md'],
    content: [
      { type: 'h1', text: 'Gemini CLI' },
      {
        type: 'p',
        text: 'The Gemini CLI adapter writes `GEMINI.md` and `gemini-mcp.json`. Gemini CLI reads `GEMINI.md` as its project context file at the start of every session.',
      },
      { type: 'h2', id: 'entry-file', text: 'Entry file, GEMINI.md' },
      {
        type: 'p',
        text: '`GEMINI.md` follows the same lean framework-entry structure used by all paqad-ai adapters: a header block pointing to `docs/instructions/`. This keeps the entry file short and the detail centralised.',
      },
      { type: 'h2', id: 'mcp', text: 'MCP configuration' },
      {
        type: 'p',
        text: 'Stack-specific MCP servers are registered in `gemini-mcp.json`. Refer to the Gemini CLI documentation for how to load a custom MCP config file.',
      },
    ],
  },

  'adapters-antigravity': {
    id: 'adapters-antigravity',
    title: 'Google Antigravity',
    section: 'AI Agent Adapters',
    sectionId: 'adapters',
    prev: 'adapters-gemini',
    next: 'adapters-junie',
    keywords: ['antigravity', 'google antigravity', 'ANTIGRAVITY.md'],
    content: [
      { type: 'h1', text: 'Google Antigravity' },
      {
        type: 'p',
        text: 'The Google Antigravity adapter writes `ANTIGRAVITY.md` and `antigravity-mcp.json`, following the same pattern as other CLI adapters.',
      },
      { type: 'h2', id: 'entry-file', text: 'Entry file, ANTIGRAVITY.md' },
      {
        type: 'p',
        text: 'Google Antigravity reads `ANTIGRAVITY.md` as its project context entry point. paqad-ai keeps the file minimal and forwards all documentation to `docs/instructions/`.',
      },
      {
        type: 'callout',
        variant: 'note',
        text: "Google Antigravity is an emerging tool. paqad-ai will update this adapter as the tool's configuration format stabilises.",
      },
    ],
  },

  'adapters-junie': {
    id: 'adapters-junie',
    title: 'Junie',
    section: 'AI Agent Adapters',
    sectionId: 'adapters',
    prev: 'adapters-antigravity',
    next: 'adapters-aider',
    keywords: ['junie', 'jetbrains', 'guidelines', 'junie mcp'],
    content: [
      { type: 'h1', text: 'Junie' },
      {
        type: 'p',
        text: 'Junie is the JetBrains AI agent. The paqad-ai adapter writes `.junie/guidelines.md`, the file Junie reads for project context, and an MCP configuration file.',
      },
      { type: 'h2', id: 'guidelines', text: 'Entry file, .junie/guidelines.md' },
      {
        type: 'p',
        text: 'Junie reads `.junie/guidelines.md` at session start. paqad-ai generates a structured guidelines document that covers your stack conventions, testing rules, and architecture constraints.',
      },
      { type: 'h2', id: 'mcp', text: 'MCP configuration' },
      {
        type: 'p',
        text: "MCP defaults are written to `junie-mcp.json`. Junie's MCP integration uses a JSON format compatible with the official MCP client specification.",
      },
    ],
  },

  'adapters-aider': {
    id: 'adapters-aider',
    title: 'Aider',
    section: 'AI Agent Adapters',
    sectionId: 'adapters',
    prev: 'adapters-junie',
    next: 'workflow-overview',
    keywords: ['aider', 'aider.conf.yml', 'conventions', 'git'],
    content: [
      { type: 'h1', text: 'Aider' },
      {
        type: 'p',
        text: 'Aider is a command-line AI coding assistant that works directly with your git history. The paqad-ai adapter produces `.aider.conf.yml`, a conventions configuration file, and a `CONVENTIONS.md` that Aider can reference.',
      },
      { type: 'h2', id: 'config', text: 'Configuration, .aider.conf.yml' },
      {
        type: 'p',
        text: "Aider reads `.aider.conf.yml` for persistent settings. paqad-ai writes your detected stack's model preference, convention file path, and git commit message style into this file.",
      },
      {
        type: 'terminal',
        lang: 'yaml',
        label: '.aider.conf.yml (example)',
        code: 'model: gpt-4o\nread: CONVENTIONS.md\nauto-commits: false\ngit: true',
      },
      {
        type: 'callout',
        variant: 'note',
        text: 'Aider does not support MCP. The paqad-ai adapter provides conventions configuration only, no MCP or skills output is generated for this adapter.',
      },
    ],
  },

  /* ── Workflow Engine ─────────────────────────────────────────────────── */

  'workflow-overview': {
    id: 'workflow-overview',
    title: 'Overview',
    section: 'Workflow Engine',
    sectionId: 'workflow-engine',
    prev: 'adapters-aider',
    next: 'workflow-yaml',
    keywords: ['workflow', 'engine', 'phases', 'orchestration', 'multi-agent'],
    content: [
      { type: 'h1', text: 'Workflow Engine' },
      {
        type: 'p',
        text: 'The workflow engine orchestrates multi-phase AI operations across your project. A workflow is a YAML-defined sequence of steps, each assigned to an agent role with a specific model tier and token budget. Workflows can run phases sequentially or in parallel.',
      },
      { type: 'h2', id: 'when-to-use', text: 'When to use workflows' },
      {
        type: 'p',
        text: 'Use a workflow when a task spans multiple agent roles. A feature delivery workflow might run requirement analysis, then solution architecture, then implementation, then security review, then documentation, each as a named step with its own context and success criteria.',
      },
      { type: 'h2', id: 'phases', text: 'Standard phases' },
      {
        type: 'table',
        headers: ['Phase', 'Typical agents'],
        rows: [
          ['intake', 'router, requirement-analyst, gap-detector'],
          ['planning', 'product-owner, story-designer, test-planner, context-curator'],
          ['design', 'solution-architect, data-modeler, ux-ui-analyst'],
          ['implementation', 'implementer, db-expert, devops-engineer'],
          ['review', 'adversarial-reviewer, security-auditor, performance-analyst'],
          ['handoff', 'doc-maintainer, verifier, final-reviewer'],
        ],
      },
      { type: 'h2', id: 'failure-modes', text: 'Failure modes' },
      {
        type: 'ul',
        items: [
          '`abort`, stop the workflow and report the failure. Default for security and verification steps.',
          '`skip`, log the failure and continue to the next step.',
          '`retry`, retry the step up to the configured retry limit before aborting.',
        ],
      },
    ],
  },

  'workflow-yaml': {
    id: 'workflow-yaml',
    title: 'Workflow YAML',
    section: 'Workflow Engine',
    sectionId: 'workflow-engine',
    prev: 'workflow-overview',
    next: 'workflow-routing',
    keywords: ['workflow yaml', 'yaml format', 'workflow template', 'steps', 'parallel'],
    content: [
      { type: 'h1', text: 'Workflow YAML Format' },
      {
        type: 'p',
        text: 'Workflow templates live in `docs/instructions/workflows/`. Each file defines a named workflow with a sequence of steps, optional parallel groups, conditions, and failure handlers.',
      },
      { type: 'h2', id: 'annotated-example', text: 'Annotated example' },
      {
        type: 'terminal',
        lang: 'yaml',
        label: 'docs/instructions/workflows/feature.yaml',
        code: 'name: feature-delivery\ndescription: Full feature delivery from intake to verified handoff\n\nsteps:\n  - id: route\n    agent: router\n    model: fast\n    on_failure: abort\n\n  - id: requirements\n    agent: requirement-analyst\n    model: default\n    depends_on: [route]\n\n  - id: review-parallel\n    parallel:\n      - agent: security-auditor\n        model: default\n      - agent: performance-analyst\n        model: fast\n    depends_on: [implement]\n\n  - id: verify\n    agent: verifier\n    model: fast\n    on_failure: abort\n    depends_on: [review-parallel]',
      },
      { type: 'h2', id: 'fields', text: 'Field reference' },
      {
        type: 'table',
        headers: ['Field', 'Description'],
        rows: [
          ['name', 'Unique identifier for the workflow.'],
          ['steps[].id', 'Step identifier. Used in `depends_on` references.'],
          ['steps[].agent', 'Agent role to run. Must match a registered agent slug.'],
          [
            'steps[].model',
            '`fast`, `default`, or `reasoning`. Maps to the profile model routing.',
          ],
          ['steps[].on_failure', '`abort`, `skip`, or `retry`. Default: `abort`.'],
          ['steps[].depends_on', 'Array of step IDs that must complete before this step starts.'],
          ['steps[].parallel', 'Array of agents to run concurrently. Replaces `agent` field.'],
        ],
      },
    ],
  },

  'workflow-routing': {
    id: 'workflow-routing',
    title: 'Routing & Lanes',
    section: 'Workflow Engine',
    sectionId: 'workflow-engine',
    prev: 'workflow-yaml',
    next: 'workflow-agents',
    keywords: ['routing', 'lanes', 'fast lane', 'full lane', 'graduated', 'router'],
    content: [
      { type: 'h1', text: 'Routing & Lanes' },
      {
        type: 'p',
        text: 'The `router` agent classifies each incoming task into one of three execution lanes before the workflow begins. The lane determines which steps are included and which agents run.',
      },
      { type: 'h2', id: 'lanes', text: 'The three lanes' },
      {
        type: 'dl',
        items: [
          {
            term: 'fast',
            def: 'Typo fixes, documentation-only changes, single-file edits with no logic change. Skips planning, architecture, and review phases.',
          },
          {
            term: 'graduated',
            def: 'Standard feature work. Runs intake, planning, implementation, and a lightweight review.',
          },
          {
            term: 'full',
            def: 'High-complexity or high-risk tasks (e.g. schema migrations, auth changes, security-sensitive code). Runs all phases including adversarial review and security audit.',
          },
        ],
      },
      { type: 'h2', id: 'routing-conditions', text: 'Routing conditions' },
      {
        type: 'p',
        text: 'The router evaluates signals from the task description: keywords, file paths, complexity estimates, and risk markers. You can also set explicit routing in the task prompt.',
      },
      {
        type: 'terminal',
        lang: 'bash',
        code: '# Force a specific lane\n/task --lane full\n\n# Let the router decide (default)\n/task',
      },
      { type: 'h2', id: 'capability-gap', text: 'Capability gap signaling' },
      {
        type: 'p',
        text: 'If the router detects that a task requires a capability that is not enabled (e.g. a security audit when the `security` capability is off), it emits a capability gap signal and halts before the step that would fail.',
      },
    ],
  },

  'workflow-agents': {
    id: 'workflow-agents',
    title: 'Runtime Agents',
    section: 'Workflow Engine',
    sectionId: 'workflow-engine',
    prev: 'workflow-routing',
    next: 'rag-context-intelligence',
    keywords: ['agents', '20 agents', 'roles', 'model tier', 'token budget', 'runtime'],
    content: [
      { type: 'h1', text: 'Runtime Agents' },
      {
        type: 'p',
        text: 'paqad-ai ships twenty runtime agents organised across four phases. Each agent has a designated role, a default model tier, and a task-specific prompt contract.',
      },
      { type: 'h2', id: 'intake-planning', text: 'Intake & Planning' },
      {
        type: 'table',
        headers: ['Agent', 'Role'],
        rows: [
          ['router', 'Classifies the task and selects an execution lane.'],
          [
            'requirement-analyst',
            'Decomposes ambiguous requests into structured, unambiguous specs.',
          ],
          ['product-owner', 'Protects MVP scope, story order, and value delivery.'],
          [
            'story-designer',
            'Breaks requirements into sequenced, independently verifiable stories.',
          ],
          ['gap-detector', 'Finds missing requirements, undocumented assumptions, and edge cases.'],
          ['test-planner', 'Maps acceptance criteria to concrete, stack-aware test cases.'],
          [
            'context-curator',
            'Loads the highest-value context for the current phase and budget tier.',
          ],
          [
            'market-researcher',
            'Gathers dated external references, benchmarks, and competitive context.',
          ],
        ],
      },
      { type: 'h2', id: 'design-implementation', text: 'Design & Implementation' },
      {
        type: 'table',
        headers: ['Agent', 'Role'],
        rows: [
          ['solution-architect', 'Designs the implementation approach and reuse strategy.'],
          ['implementer', 'Writes and ships production-ready code.'],
          ['db-expert', 'Optimises queries, indexes, and migrations.'],
          ['data-modeler', 'Designs schemas, entity relationships, and migration-safe data flow.'],
          ['ux-ui-analyst', 'Analyses UX flows, accessibility, and design patterns.'],
          [
            'devops-engineer',
            'Reviews CI/CD, containers, environment drift, and deployment readiness.',
          ],
        ],
      },
      { type: 'h2', id: 'review-risk', text: 'Review & Risk' },
      {
        type: 'table',
        headers: ['Agent', 'Role'],
        rows: [
          [
            'adversarial-reviewer',
            'Challenges assumptions, regressions, and security weaknesses before merge.',
          ],
          [
            'security-auditor',
            'Scans changed code for injection, auth flaws, disclosure, and secrets exposure.',
          ],
          [
            'performance-analyst',
            'Catches query anti-patterns, dependency bloat, caching gaps, and async waste.',
          ],
          [
            'integration-architect',
            'Reasons about external APIs, webhooks, MCP contracts, and failure modes.',
          ],
        ],
      },
      { type: 'h2', id: 'docs-verification-handoff', text: 'Docs, Verification & Handoff' },
      {
        type: 'table',
        headers: ['Agent', 'Role'],
        rows: [
          [
            'doc-maintainer',
            'Owns the documentation-to-code consistency contract and patches drift surgically.',
          ],
          ['verifier', 'Runs deterministic gates in order and preserves first-failure evidence.'],
          ['final-reviewer', 'Confirms gate status, residual risk, and readiness for handoff.'],
        ],
      },
    ],
  },

  /* ── Context & RAG ───────────────────────────────────────────────────── */

  'rag-context-intelligence': {
    id: 'rag-context-intelligence',
    title: 'Context Intelligence',
    section: 'Context & RAG',
    sectionId: 'context-and-rag',
    prev: 'workflow-agents',
    next: 'rag-overview',
    keywords: ['context', 'budget', 'token budget', 'context window', 'hit tracking'],
    content: [
      { type: 'h1', text: 'Context Intelligence' },
      {
        type: 'p',
        text: "Context intelligence is paqad-ai's system for deciding what information to load into an AI agent's context window for each task. Loading too much wastes tokens and degrades response quality. Loading too little leaves the agent guessing.",
      },
      { type: 'h2', id: 'budget-tiers', text: 'Budget tiers' },
      {
        type: 'table',
        headers: ['Tier', 'Token limit', 'When used'],
        rows: [
          ['minimal', '4 K', 'Routing, classification, fast-lane tasks.'],
          ['standard', '32 K', 'Planning, implementation, most graduated-lane tasks.'],
          ['deep', '128 K', 'Architecture review, security audit, full-lane tasks.'],
        ],
      },
      { type: 'h2', id: 'hit-tracking', text: 'Hit tracking' },
      {
        type: 'p',
        text: 'The framework tracks which documentation sections are actually used by agents during each session. Over time, low-hit sections are flagged for review, they may be redundant, out of date, or simply not relevant to your current work.',
      },
      {
        type: 'callout',
        variant: 'tip',
        text: 'Run `paqad-ai doctor` to see the current context hit-rate across your documentation. A rate below 40% suggests your documentation has grown stale or oversized.',
      },
    ],
  },

  'rag-overview': {
    id: 'rag-overview',
    title: 'RAG Overview',
    section: 'Context & RAG',
    sectionId: 'context-and-rag',
    prev: 'rag-context-intelligence',
    next: 'rag-adaptive-depth',
    keywords: ['RAG', 'retrieval', 'vector store', 'embeddings', 'chunks', 'semantic search'],
    content: [
      { type: 'h1', text: 'RAG Overview' },
      {
        type: 'p',
        text: 'Retrieval-Augmented Generation gives AI agents access to the specific parts of your codebase and documentation that are relevant to the current task, without loading everything into every prompt.',
      },
      { type: 'h2', id: 'how-rag-works', text: 'How it works' },
      {
        type: 'ol',
        items: [
          '`paqad-ai rag index` chunks your code and documentation, embeds each chunk, and stores the vectors in `.paqad/vectors/`.',
          'When an agent starts a task, the context curator runs a semantic similarity search against the vector store using the task description.',
          "The top-ranked chunks are injected into the agent's context window before the prompt is sent.",
          'The agent answers with access to exactly the right code and documentation, not a full repository dump.',
        ],
      },
      { type: 'h2', id: 'what-gets-indexed', text: 'What gets indexed' },
      {
        type: 'ul',
        items: [
          "All source files matching your stack's include patterns.",
          'All files under `docs/instructions/`.',
          'Your `CHANGELOG.md` and `README.md` if present.',
          'Files listed in `.paqad/rag-include.txt` (custom inclusions).',
        ],
      },
      { type: 'h2', id: 'vector-store', text: 'Vector store location' },
      {
        type: 'p',
        text: 'The vector store lives in `.paqad/vectors/`. It is gitignored by default. Each developer on your team builds their own index locally.',
      },
    ],
  },

  'rag-adaptive-depth': {
    id: 'rag-adaptive-depth',
    title: 'Adaptive Depth',
    section: 'Context & RAG',
    sectionId: 'context-and-rag',
    prev: 'rag-overview',
    next: 'rag-reranking',
    keywords: ['adaptive depth', 'packing strategy', 'aggressive', 'balanced', 'conservative'],
    content: [
      { type: 'h1', text: 'Adaptive Depth' },
      {
        type: 'p',
        text: 'Adaptive depth controls how aggressively paqad-ai fills the context window with RAG results. Three packing strategies let you tune the balance between breadth and precision.',
      },
      { type: 'h2', id: 'strategies', text: 'Packing strategies' },
      {
        type: 'dl',
        items: [
          {
            term: 'aggressive',
            def: 'Pack as many chunks as the budget allows. Best for exploration tasks where broad context is valuable.',
          },
          {
            term: 'balanced',
            def: 'Pack up to the top 10 chunks with a relevance score above 0.6. Default strategy.',
          },
          {
            term: 'conservative',
            def: 'Pack only the top 3 chunks with a score above 0.8. Best for precise code generation tasks.',
          },
        ],
      },
      { type: 'h2', id: 'configure', text: 'Configuration' },
      {
        type: 'terminal',
        lang: 'yaml',
        label: '.paqad/project-profile.yaml',
        code: 'rag:\n  backend: local\n  packing_strategy: balanced\n  min_score: 0.6\n  max_chunks: 10',
      },
    ],
  },

  'rag-reranking': {
    id: 'rag-reranking',
    title: 'Reranking',
    section: 'Context & RAG',
    sectionId: 'context-and-rag',
    prev: 'rag-adaptive-depth',
    next: 'rag-metadata-filters',
    keywords: ['reranking', 'cross-encoder', 'relevance', 'cohere rerank'],
    content: [
      { type: 'h1', text: 'Reranking' },
      {
        type: 'p',
        text: 'Vector similarity search is fast but imprecise. Reranking adds a second pass using a cross-encoder model that reads both the query and the candidate chunk together, producing a more accurate relevance score.',
      },
      { type: 'h2', id: 'how-reranking-works', text: 'How reranking works' },
      {
        type: 'ol',
        items: [
          'Vector search retrieves the top 50 candidates by cosine similarity.',
          'The cross-encoder scores each candidate in the context of the full query.',
          'The top N results by cross-encoder score are packed into the context window.',
        ],
      },
      { type: 'h2', id: 'enable-reranking', text: 'Enabling reranking' },
      {
        type: 'terminal',
        lang: 'yaml',
        label: '.paqad/project-profile.yaml',
        code: 'rag:\n  reranker: cohere   # options: none, cohere\n  rerank_top_k: 10',
      },
      {
        type: 'callout',
        variant: 'note',
        text: 'Reranking with Cohere requires a `COHERE_API_KEY` environment variable. The reranker adds ~200ms of latency per query.',
      },
    ],
  },

  'rag-metadata-filters': {
    id: 'rag-metadata-filters',
    title: 'Metadata Filters',
    section: 'Context & RAG',
    sectionId: 'context-and-rag',
    prev: 'rag-reranking',
    next: 'rag-action-routing',
    keywords: ['metadata', 'filters', 'file type', 'scope', 'include', 'exclude'],
    content: [
      { type: 'h1', text: 'Metadata Filters' },
      {
        type: 'p',
        text: 'Metadata filters let you restrict RAG retrieval to specific parts of your codebase. When an agent is working on a database migration, for example, you can instruct it to retrieve only chunks from migration files and the ORM documentation.',
      },
      { type: 'h2', id: 'filter-types', text: 'Filter types' },
      {
        type: 'table',
        headers: ['Filter', 'Description'],
        rows: [
          ['file_type', 'Restrict to files matching a glob pattern, e.g. `**/*.migration.ts`.'],
          ['directory', 'Restrict to files within a directory, e.g. `src/database/`.'],
          ['doc_section', 'Restrict to documentation in a specific instructions section.'],
          ['recency', 'Prefer chunks from files modified in the last N days.'],
        ],
      },
      { type: 'h2', id: 'applying-filters', text: 'Applying filters in workflows' },
      {
        type: 'p',
        text: "Filters are applied per-step in a workflow YAML or per-agent in the agent's system prompt contract. They are combined with AND logic by default.",
      },
      {
        type: 'terminal',
        lang: 'yaml',
        code: 'steps:\n  - id: db-review\n    agent: db-expert\n    rag_filters:\n      directory: src/database/\n      doc_section: stack/orm',
      },
    ],
  },

  'rag-action-routing': {
    id: 'rag-action-routing',
    title: 'Action Routing',
    section: 'Context & RAG',
    sectionId: 'context-and-rag',
    prev: 'rag-metadata-filters',
    next: 'project-knowledge-answers',
    keywords: ['action routing', 'query routing', 'intent', 'retrieval routing'],
    content: [
      { type: 'h1', text: 'Action Routing' },
      {
        type: 'p',
        text: 'Action routing classifies each RAG query by intent before retrieval begins. This allows the system to apply different retrieval strategies to different kinds of questions, code lookup, documentation lookup, and cross-cutting searches each benefit from different approaches.',
      },
      { type: 'h2', id: 'intent-types', text: 'Intent types' },
      {
        type: 'dl',
        items: [
          {
            term: 'code_lookup',
            def: 'Searching for an existing implementation. Routes to source file chunks. Uses conservative packing.',
          },
          {
            term: 'doc_lookup',
            def: 'Searching for a convention, rule, or guideline. Routes to documentation chunks. Uses balanced packing.',
          },
          {
            term: 'cross_cutting',
            def: 'Searching for how code and docs relate. Routes to both stores. Uses aggressive packing.',
          },
        ],
      },
      {
        type: 'callout',
        variant: 'tip',
        text: 'Action routing is automatic. If you notice that retrieval quality is poor for a specific task type, you can override the intent with a `rag_intent` annotation in the workflow step.',
      },
    ],
  },

  'project-knowledge-answers': {
    id: 'project-knowledge-answers',
    title: 'Project Knowledge Answers',
    section: 'Context & RAG',
    sectionId: 'context-and-rag',
    prev: 'rag-action-routing',
    next: 'security-break-locally',
    keywords: [
      'project questions',
      'knowledge',
      'grounded answers',
      'citations',
      'freshness',
      'contradictions',
      'observed',
      'inferred',
      'missing evidence',
    ],
    content: [
      { type: 'h1', text: 'Project Knowledge Answers' },
      {
        type: 'p',
        text: "After onboarding and documentation generation, you can ask project-specific questions and receive grounded answers built from the repository's own canonical docs, framework state, generated artifacts, and manifests.",
      },
      {
        type: 'p',
        text: 'Every answer carries a grounding state, file-level citations, freshness metadata, and contradiction detection, so you always know how trustworthy the answer is and where it came from.',
      },
      {
        type: 'callout',
        variant: 'tip',
        text: 'Project knowledge answering is triggered automatically when the pipeline routes a request to the `project-question` workflow.',
      },
      { type: 'h2', id: 'grounding-states', text: 'Grounding states' },
      { type: 'p', text: 'Every answer is assigned one of three grounding states:' },
      {
        type: 'dl',
        items: [
          {
            term: 'observed',
            def: 'The answer is directly supported by canonical module docs under docs/modules/**. Highest confidence.',
          },
          {
            term: 'inferred',
            def: 'The answer is a reasoned conclusion from framework state, manifests, or generated instructions. Treat with caution.',
          },
          {
            term: 'missing-evidence',
            def: 'The repository does not contain enough evidence to answer the question. Run paqad-ai onboard to generate canonical documentation.',
          },
        ],
      },
      { type: 'h2', id: 'evidence-priority', text: 'Evidence priority order' },
      {
        type: 'p',
        text: 'The answerer retrieves evidence in priority order, always preferring canonical docs over secondary sources:',
      },
      {
        type: 'ol',
        items: [
          'Canonical module docs, docs/modules/**/*.md',
          'Generated instructions, docs/instructions/**/*.md',
          'Framework state, .paqad/**/*.{json,yaml,yml}',
          'Manifests, package.json, composer.json, go.mod, and equivalents',
          'Workflow files, .github/workflows/**/*.{yml,yaml}',
        ],
      },
      { type: 'h2', id: 'answer-modes', text: 'Answer modes' },
      {
        type: 'table',
        headers: ['Mode', 'Output'],
        rows: [
          ['quick', 'One sentence, evidence count and top match.'],
          [
            'explain',
            'Multi-sentence with all citation paths named. Default mode used by the pipeline.',
          ],
          ['trace', 'Full evidence trail, one entry per citation with excerpt.'],
        ],
      },
      { type: 'h2', id: 'freshness', text: 'Freshness signaling' },
      {
        type: 'p',
        text: 'When .paqad/doc-progress.json is present, the answerer compares evidence file modification times against the documentation baseline. Files that predate the baseline by more than 24 hours appear in stale_sources. Stack drift detected in .paqad/stack-drift.json sets drift_detected: true.',
      },
      {
        type: 'callout',
        variant: 'note',
        text: 'A missing doc-progress.json is treated as unknown freshness, not as fresh. The answer will always surface this so you can decide whether to run paqad-ai update.',
      },
      { type: 'h2', id: 'contradictions', text: 'Contradiction handling' },
      {
        type: 'p',
        text: 'The answerer compares claims extracted from different evidence files. If two files make conflicting assertions about the same key, for example, different node engine requirements in package.json versus the framework profile, both sources are named and the conflict is described.',
      },
      {
        type: 'p',
        text: 'Contradictions never suppress the answer. They appear alongside it in contradictions[] so you can investigate before acting.',
      },
      { type: 'h2', id: 'citations', text: 'Citations' },
      {
        type: 'p',
        text: 'Every answer includes a citations[] array. Each citation carries the file path, source class (canonical-doc, generated-instruction, framework-state, manifest, workflow, or code), and an excerpt from the matched content.',
      },
    ],
  },

  /* ── Security ────────────────────────────────────────────────────────── */

  'security-break-locally': {
    id: 'security-break-locally',
    title: 'Break Locally First',
    section: 'Security',
    sectionId: 'security',
    prev: 'project-knowledge-answers',
    next: 'security-pentest',
    keywords: ['security', 'break locally', 'philosophy', 'pentest trigger', 'local scan'],
    content: [
      { type: 'h1', text: 'Break Locally First' },
      {
        type: 'p',
        text: "paqad-ai's security philosophy is simple: find vulnerabilities in your local environment before they reach CI or production. The pentest workflow is designed to run fast, give actionable output, and block only when it finds something real.",
      },
      { type: 'h2', id: 'when-it-runs', text: 'When the pentest workflow runs' },
      { type: 'p', text: 'The pentest workflow is triggered in two situations:' },
      {
        type: 'ul',
        items: [
          'Automatically, when the `full` routing lane is selected for a task that touches security-sensitive files (auth, payments, user data).',
          'Manually, via `paqad-ai doctor` or by invoking the `security-auditor` agent directly.',
        ],
      },
      { type: 'h2', id: 'local-vs-ci', text: 'Local vs CI' },
      {
        type: 'p',
        text: 'The local pentest is fast and incremental, it scans only the files changed in the current task. The CI pentest runs the full OWASP surface scan. Both produce the same evidence format, so failures are reproducible.',
      },
      {
        type: 'callout',
        variant: 'danger',
        text: 'When the `security` capability is enabled and `require_adversarial_review` is `true` in your profile, the workflow will not proceed to the implementation phase without a clean security gate. This is intentional.',
      },
    ],
  },

  'security-pentest': {
    id: 'security-pentest',
    title: 'Pentest Workflow',
    section: 'Security',
    sectionId: 'security',
    prev: 'security-break-locally',
    next: 'security-owasp',
    keywords: ['pentest', 'workflow', 'security scan', 'OWASP', 'incremental'],
    content: [
      { type: 'h1', text: 'Pentest Workflow' },
      {
        type: 'p',
        text: 'The pentest workflow is an incremental security scan driven by the `security-auditor` and `adversarial-reviewer` agents. It focuses on the files changed in the current task, producing a structured evidence report.',
      },
      { type: 'h2', id: 'phases', text: 'Scan phases' },
      {
        type: 'ol',
        items: [
          'Identify changed files and classify them by security risk category.',
          'Apply OWASP check rules for each risk category.',
          'Collect first-failure evidence for any finding.',
          'Emit a structured report with severity, location, and remediation hint.',
          'Block the workflow if any finding is severity High or Critical.',
        ],
      },
      { type: 'h2', id: 'report-format', text: 'Report format' },
      {
        type: 'terminal',
        lang: 'bash',
        code: 'security-audit report\n────────────────────────────\nfile: src/auth/login.ts\nrule: A07-identification-auth-failures\nseverity: HIGH\nfinding: Missing brute-force protection on login endpoint\nremediation: Add rate limiting middleware before the login handler',
      },
      {
        type: 'callout',
        variant: 'warning',
        text: 'Severity HIGH and CRITICAL findings block the workflow by default. You can override this on a per-task basis with `--allow-security-warnings`, but this should be a deliberate exception, not a habit.',
      },
    ],
  },

  'security-owasp': {
    id: 'security-owasp',
    title: 'OWASP Coverage',
    section: 'Security',
    sectionId: 'security',
    prev: 'security-pentest',
    next: 'security-guardrails',
    keywords: ['OWASP', 'top 10', 'injection', 'auth', 'XSS', 'coverage'],
    content: [
      { type: 'h1', text: 'OWASP Coverage' },
      {
        type: 'p',
        text: 'The security capability maps to the OWASP Top 10 (2021). Each category has a set of check rules that are applied based on the file types and frameworks in scope.',
      },
      { type: 'h2', id: 'coverage-table', text: 'Coverage table' },
      {
        type: 'table',
        headers: ['OWASP category', 'Status'],
        rows: [
          ['A01, Broken Access Control', 'Covered'],
          ['A02, Cryptographic Failures', 'Covered'],
          ['A03, Injection (SQL, NoSQL, command)', 'Covered'],
          ['A04, Insecure Design', 'Partial, architecture review only'],
          ['A05, Security Misconfiguration', 'Covered'],
          ['A06, Vulnerable & Outdated Components', 'Covered, reads lockfile'],
          ['A07, Identification & Auth Failures', 'Covered'],
          ['A08, Software & Data Integrity Failures', 'Partial, CI config review only'],
          ['A09, Security Logging & Monitoring Failures', 'Covered'],
          ['A10, Server-Side Request Forgery', 'Covered'],
        ],
      },
      {
        type: 'callout',
        variant: 'note',
        text: 'OWASP coverage is continuously improved. Check `CHANGELOG.md` in each paqad-ai release for new rules added to the security capability.',
      },
    ],
  },

  'security-guardrails': {
    id: 'security-guardrails',
    title: 'Guardrails',
    section: 'Security',
    sectionId: 'security',
    prev: 'security-owasp',
    next: 'patterns-overview',
    keywords: ['guardrails', 'escalation', 'block', 'destructive operations', 'override'],
    content: [
      { type: 'h1', text: 'Guardrails' },
      {
        type: 'p',
        text: 'Guardrails are hard stops that prevent dangerous operations from proceeding automatically. They are configured in your project profile and apply to all workflows.',
      },
      { type: 'h2', id: 'escalation-conditions', text: 'Escalation conditions' },
      { type: 'p', text: 'The following conditions trigger a guardrail halt by default:' },
      {
        type: 'ul',
        items: [
          'Any security finding at severity HIGH or CRITICAL.',
          'A database migration that has not been reviewed by the `db-expert` agent.',
          'An operation on a file matching the destructive operations pattern (DROP, DELETE, TRUNCATE).',
          'A detected secret (API key, password, token) in a file staged for commit.',
        ],
      },
      { type: 'h2', id: 'override', text: 'Overriding a guardrail' },
      {
        type: 'p',
        text: 'Guardrails can be overridden per-task by a developer with explicit acknowledgement. This is logged and traceable.',
      },
      {
        type: 'terminal',
        lang: 'bash',
        copyable: true,
        code: 'paqad-ai task --override-guardrail "dropping unused table after backup confirmed"',
      },
      {
        type: 'callout',
        variant: 'danger',
        text: 'Guardrail overrides are permanent for the task they are applied to. They are written to the task evidence log. Never override a guardrail without understanding the specific finding it is blocking on.',
      },
    ],
  },

  /* ── Patterns Library ────────────────────────────────────────────────── */

  'patterns-overview': {
    id: 'patterns-overview',
    title: 'Overview',
    section: 'Patterns Library',
    sectionId: 'patterns-library',
    prev: 'security-guardrails',
    next: 'patterns-recording',
    keywords: ['patterns', 'solutions library', 'reusable', 'pattern data structure'],
    content: [
      { type: 'h1', text: 'Patterns Library' },
      {
        type: 'p',
        text: 'The patterns library is a collection of proven solutions captured from completed workflows in your project. When paqad-ai encounters a task similar to a recorded pattern, it surfaces the pattern to the agent as a starting point, saving time and reducing the chance of reimplementing something incorrectly.',
      },
      { type: 'h2', id: 'pattern-structure', text: 'Pattern structure' },
      {
        type: 'table',
        headers: ['Field', 'Description'],
        rows: [
          ['id', 'Unique identifier for the pattern.'],
          ['source', 'The workflow run that produced this pattern.'],
          ['problem', 'A concise description of the problem this pattern solves.'],
          ['solution', 'The approach taken. May include code snippets.'],
          ['files', 'The files that were created or modified.'],
          ['verification', 'How to confirm the solution is working correctly.'],
          ['tags', 'Keywords for search and filtering.'],
          ['stack', 'The stack this pattern was recorded for.'],
          ['score', 'Relevance score (0-1) updated each time the pattern is suggested.'],
        ],
      },
      { type: 'h2', id: 'where-stored', text: 'Where patterns are stored' },
      {
        type: 'p',
        text: 'Patterns are stored in `.paqad/patterns/`. Each pattern is a YAML file. The directory is gitignored by default but you can opt in to committing patterns for team sharing.',
      },
    ],
  },

  'patterns-recording': {
    id: 'patterns-recording',
    title: 'Recording Patterns',
    section: 'Patterns Library',
    sectionId: 'patterns-library',
    prev: 'patterns-overview',
    next: 'patterns-scoring',
    keywords: ['recording patterns', 'capture', 'auto-capture', 'manual pattern'],
    content: [
      { type: 'h1', text: 'Recording Patterns' },
      {
        type: 'p',
        text: 'Patterns can be captured automatically at the end of a successful workflow run, or recorded manually when you identify a reusable solution.',
      },
      { type: 'h2', id: 'auto-capture', text: 'Automatic capture' },
      {
        type: 'p',
        text: 'When a workflow completes successfully and the `final-reviewer` agent confirms handoff readiness, paqad-ai asks whether to record the solution as a pattern. Answering yes creates a YAML pattern file automatically.',
      },
      { type: 'h2', id: 'manual-recording', text: 'Manual recording' },
      { type: 'p', text: 'You can record any completed task as a pattern at any time.' },
      {
        type: 'terminal',
        lang: 'bash',
        copyable: true,
        code: 'paqad-ai patterns record --from-last-task',
      },
      { type: 'h2', id: 'sharing', text: 'Sharing patterns with your team' },
      {
        type: 'p',
        text: 'To share patterns across your team, add `.paqad/patterns/` to your `.gitignore` exclusion list (i.e. stop ignoring it) and commit the directory. Teammates who run `paqad-ai onboard` or `paqad-ai refresh` will pull the patterns into their local library.',
      },
    ],
  },

  'patterns-scoring': {
    id: 'patterns-scoring',
    title: 'Pattern Scoring',
    section: 'Patterns Library',
    sectionId: 'patterns-library',
    prev: 'patterns-recording',
    next: 'health-doctor',
    keywords: ['scoring', 'algorithm', 'framework overlap', 'keyword overlap', 'relevance'],
    content: [
      { type: 'h1', text: 'Pattern Scoring' },
      {
        type: 'p',
        text: 'When paqad-ai searches the patterns library for a task, it scores each pattern and suggests only those above a relevance threshold. The scoring algorithm balances two signals: framework overlap and keyword overlap.',
      },
      { type: 'h2', id: 'algorithm', text: 'Scoring algorithm' },
      { type: 'p', text: 'For each pattern, paqad-ai computes:' },
      {
        type: 'terminal',
        lang: 'bash',
        code: 'score = (framework_overlap × 0.4) + (keyword_overlap × 0.6)',
      },
      {
        type: 'dl',
        items: [
          {
            term: 'framework_overlap',
            def: "The Jaccard similarity between the pattern's stack tags and the current project's detected stack. 0 if no overlap, 1 if identical.",
          },
          {
            term: 'keyword_overlap',
            def: "The proportion of the task's significant terms (nouns, verbs) that appear in the pattern's tags, problem, and solution fields.",
          },
        ],
      },
      { type: 'h2', id: 'thresholds', text: 'Thresholds' },
      {
        type: 'table',
        headers: ['Score', 'Action'],
        rows: [
          ['≥ 0.7', 'Pattern is suggested with high confidence.'],
          ['0.4 - 0.69', 'Pattern is offered as a lower-confidence suggestion.'],
          ['< 0.4', 'Pattern is not suggested for this task.'],
        ],
      },
    ],
  },

  /* ── Health & Maintenance ────────────────────────────────────────────── */

  'health-doctor': {
    id: 'health-doctor',
    title: 'Doctor Command',
    section: 'Health & Maintenance',
    sectionId: 'health-and-maintenance',
    prev: 'patterns-scoring',
    next: 'health-structured-test-output',
    keywords: ['doctor', 'health check', 'gates', 'fixing', 'troubleshoot'],
    content: [
      { type: 'h1', text: 'Doctor Command' },
      {
        type: 'p',
        text: 'The `doctor` command is your first stop when something feels off. It runs all ten quality gates and gives you a clear, actionable report, each failure includes the exact command to fix it.',
      },
      { type: 'h2', id: 'reading-the-output', text: 'Reading the output' },
      {
        type: 'p',
        text: 'Each gate displays a `✔` (pass) or `✗` (fail), followed by the gate name and, for failures, a short explanation and the remediation command.',
      },
      {
        type: 'p',
        text: 'Efficiency metrics in the JSON output are based on observed runtime artifacts only. Configuration preferences or the mere existence of cache directories do not count as usage.',
      },
      { type: 'h2', id: 'common-fixes', text: 'Common fixes' },
      {
        type: 'table',
        headers: ['Failing gate', 'Likely cause', 'Fix'],
        rows: [
          [
            'schema valid',
            'You edited project-profile.yaml manually and introduced a typo.',
            '`paqad-ai onboard --skip-detection` to regenerate the profile.',
          ],
          [
            'adapter output matches',
            'An adapter entry file was edited manually.',
            '`paqad-ai refresh` to regenerate adapter files.',
          ],
          [
            'stack drift',
            'You added a new dependency since the last onboard.',
            '`paqad-ai refresh --stack` to re-run detection.',
          ],
          [
            'context hit-rate',
            'RAG index is empty or stale.',
            '`paqad-ai rag index` to rebuild the index.',
          ],
          [
            'no duplicate rules',
            'A custom pack declares a conflicting rule ID.',
            'Rename the rule ID in your custom pack.',
          ],
        ],
      },
      {
        type: 'callout',
        variant: 'tip',
        text: 'Add `paqad-ai doctor` to your CI pipeline. A clean doctor report is a reliable signal that your AI agent configuration is in sync with your codebase.',
      },
    ],
  },

  'health-structured-test-output': {
    id: 'health-structured-test-output',
    title: 'Structured Test Output',
    section: 'Health & Maintenance',
    sectionId: 'health-and-maintenance',
    prev: 'health-doctor',
    next: 'health-refresh',
    keywords: ['test output', 'structured results', 'verification', 'test runners', 'parsing'],
    content: [
      { type: 'h1', text: 'Structured Test Output' },
      {
        type: 'p',
        text: 'paqad-ai can normalize noisy runner output into one compact result shape before verification reads it. This keeps large test logs from dominating context and gives verification gates a runner-agnostic contract.',
      },
      { type: 'h2', id: 'why-it-exists', text: 'Why it exists' },
      {
        type: 'p',
        text: 'Raw test output mixes failures with spinner noise, ANSI codes, boot logs, coverage tables, and passing-test confirmations. Structured extraction keeps the useful diagnostics while preserving summary counts and parse warnings.',
      },
      { type: 'h2', id: 'how-it-is-enabled', text: 'How it is enabled' },
      {
        type: 'p',
        text: 'This behavior is driven by stack packs. A pack can declare one or more `test_runners` entries with the runner name, structured format, output source, and any result-file glob that should be read.',
      },
      {
        type: 'table',
        headers: ['Format', 'Typical runner', 'Notes'],
        rows: [
          [
            '`jest-json`',
            'Jest / Vitest-style JSON',
            'Parses structured JSON directly from stdout.',
          ],
          [
            '`junit-xml`',
            'PHPUnit and other JUnit emitters',
            'Can merge multiple XML files into one result.',
          ],
          ['`pytest-json`', 'pytest-json-report', 'Uses the plugin JSON payload.'],
          ['`go-json`', 'Go test', 'Consumes `go test -json` event output.'],
          ['`rspec-json`', 'RSpec', 'Consumes JSON formatter output.'],
          ['`tap`', 'TAP-compatible runners', 'Parses TAP plans and failures.'],
          [
            '`none`',
            'Plain terminal output',
            'Skips structured parsing and uses the fallback parser.',
          ],
        ],
      },
      { type: 'h2', id: 'what-verification-uses', text: 'What verification uses' },
      {
        type: 'p',
        text: 'When structured results are present, the `code-tests-lint` and `behavioral-correctness` gates prefer them over legacy boolean flags. Any failed or errored test fails the gate. Any degraded parse makes the gate inconclusive instead of pretending the build is green.',
      },
      {
        type: 'callout',
        variant: 'note',
        text: 'Projects that do not declare test runners keep the older behavior. Structured test output is additive, not a breaking requirement.',
      },
      { type: 'h2', id: 'what-the-result-contains', text: 'What the result contains' },
      {
        type: 'ul',
        items: [
          'A `summary` block with pass, fail, skip, error, duration, timestamp, and runner ID fields.',
          'Separate `failures` and `errors` arrays so assertion failures do not get mixed with runner or runtime errors.',
          'A `warnings` array for non-fatal parse or runner notices.',
          'A `parse_metadata` block with raw size, structured size, compression ratio, parse strategy, and warnings.',
        ],
      },
    ],
  },

  'health-refresh': {
    id: 'health-refresh',
    title: 'Refresh Workflow',
    section: 'Health & Maintenance',
    sectionId: 'health-and-maintenance',
    prev: 'health-structured-test-output',
    next: 'health-drift',
    keywords: ['refresh', 'workflow', 'regenerate', 'when to refresh', 'differential'],
    content: [
      { type: 'h1', text: 'Refresh Workflow' },
      {
        type: 'p',
        text: 'Documentation staleness is the most common source of confusion in AI-assisted development. paqad-ai catches it automatically and makes refreshing painless.',
      },
      { type: 'h2', id: 'when-to-refresh', text: 'When to refresh' },
      {
        type: 'ul',
        items: [
          'You upgraded a major framework dependency.',
          'You enabled or disabled a capability.',
          'You edited `pack.yaml` or added a new pack.',
          'You changed your design system or coding conventions.',
          'The `stack drift` doctor gate fails.',
        ],
      },
      { type: 'h2', id: 'what-refresh-does', text: 'What refresh does' },
      {
        type: 'ol',
        items: [
          'Re-runs the detection pass (if `--stack` is specified).',
          'Re-runs the resolution pass to rebuild the documentation set.',
          'Computes content hashes and compares to the stored `.paqad/content-hashes.json`.',
          'Rewrites only the files whose resolved content has changed.',
          'Updates `.paqad/content-hashes.json` with the new hashes.',
        ],
      },
      {
        type: 'callout',
        variant: 'note',
        text: 'Files that you have manually edited are handled carefully. If a file was generated by paqad-ai but has been edited since, `refresh` will warn you and ask before overwriting.',
      },
    ],
  },

  'health-drift': {
    id: 'health-drift',
    title: 'Drift Detection',
    section: 'Health & Maintenance',
    sectionId: 'health-and-maintenance',
    prev: 'health-refresh',
    next: 'mcp-overview',
    keywords: ['drift', 'detection', 'staleness', 'hash', 'invalidation'],
    content: [
      { type: 'h1', text: 'Drift Detection' },
      {
        type: 'p',
        text: "Drift is the gap between your project's actual state and what paqad-ai's generated documentation says it is. paqad-ai detects drift automatically and reports it through the `doctor` command and the `stack drift` quality gate.",
      },
      { type: 'h2', id: 'how-drift-is-detected', text: 'How drift is detected' },
      {
        type: 'p',
        text: 'paqad-ai stores a content hash of each generated file in `.paqad/content-hashes.json` at the time of generation. On each `doctor` run, it recomputes the hash of what the current resolver would produce and compares it to the stored hash.',
      },
      { type: 'h2', id: 'hash-invalidation', text: 'Hash invalidation triggers' },
      {
        type: 'ul',
        items: [
          'A dependency version in a lockfile has changed.',
          'A new manifest file has appeared in the project root.',
          'The project profile has been edited.',
          'A pack file has been updated.',
        ],
      },
      { type: 'h2', id: 'reporting', text: 'Drift reporting' },
      {
        type: 'p',
        text: 'When drift is detected, `doctor` shows which files are out of sync and the estimated scope of the change (minor, moderate, major). The remediation command is always `paqad-ai refresh`.',
      },
    ],
  },

  /* ── MCP Integration ─────────────────────────────────────────────────── */

  'mcp-overview': {
    id: 'mcp-overview',
    title: 'Overview',
    section: 'MCP Integration',
    sectionId: 'mcp-integration',
    prev: 'health-drift',
    next: 'mcp-defaults',
    keywords: ['MCP', 'model context protocol', 'servers', 'tools', 'integration'],
    content: [
      { type: 'h1', text: 'MCP Integration' },
      {
        type: 'p',
        text: 'Model Context Protocol (MCP) is a standard for connecting AI agents to external tools and data sources. paqad-ai manages your MCP server configuration automatically, registering the right servers for your stack and writing the correct config file for each adapter.',
      },
      { type: 'h2', id: 'what-mcp-does', text: 'What MCP enables' },
      {
        type: 'p',
        text: "MCP servers expose tools that AI agents can call during a session. A Laravel MCP server might expose tools to look up Eloquent model definitions, inspect migration history, or run Artisan commands. Registering the right servers gives your AI agent real-time access to your framework's live context.",
      },
      { type: 'h2', id: 'how-paqad-manages', text: 'How paqad-ai manages MCP' },
      {
        type: 'p',
        text: 'paqad-ai maintains a registry of MCP server defaults keyed by stack. When it detects Laravel, for example, it adds the Laravel MCP server to the configuration for all adapters that support MCP. You can add, remove, or override servers in `.paqad/project-profile.yaml`.',
      },
    ],
  },

  'mcp-defaults': {
    id: 'mcp-defaults',
    title: 'Global Defaults',
    section: 'MCP Integration',
    sectionId: 'mcp-integration',
    prev: 'mcp-overview',
    next: 'mcp-stack-scoped',
    keywords: ['MCP defaults', 'global MCP', 'built-in servers', 'override'],
    content: [
      { type: 'h1', text: 'Global MCP Defaults' },
      {
        type: 'p',
        text: 'paqad-ai ships with a set of global MCP server defaults that are registered for every project regardless of stack. These servers provide universally useful tools.',
      },
      { type: 'h2', id: 'built-in-globals', text: 'Built-in global servers' },
      {
        type: 'table',
        headers: ['Server', 'Tools it exposes'],
        rows: [
          ['filesystem', 'Read, write, list files. Sandboxed to the project root.'],
          ['git', 'Commit history, diff, blame, branch info.'],
          ['shell', 'Safe shell commands (allowlist-based).'],
          ['docs-search', 'Full-text search across docs/instructions/.'],
        ],
      },
      { type: 'h2', id: 'overriding-globals', text: 'Overriding or disabling globals' },
      {
        type: 'terminal',
        lang: 'yaml',
        label: '.paqad/project-profile.yaml',
        code: 'mcp:\n  disable_globals:\n    - shell    # disable the shell server for this project\n  add_globals:\n    - name: my-custom-server\n      command: npx\n      args: ["-y", "my-custom-mcp-server"]',
      },
    ],
  },

  'mcp-stack-scoped': {
    id: 'mcp-stack-scoped',
    title: 'Stack-Scoped Servers',
    section: 'MCP Integration',
    sectionId: 'mcp-integration',
    prev: 'mcp-defaults',
    next: 'session-handoff',
    keywords: ['stack MCP', 'scoped servers', 'laravel MCP', 'django MCP', 'framework tools'],
    content: [
      { type: 'h1', text: 'Stack-Scoped MCP Servers' },
      {
        type: 'p',
        text: 'Stack-scoped MCP servers are registered only when a specific stack is detected. They provide framework-specific tools that would be irrelevant in other projects.',
      },
      { type: 'h2', id: 'examples', text: 'Examples' },
      {
        type: 'table',
        headers: ['Stack', 'MCP server', 'Key tools'],
        rows: [
          ['laravel', 'laravel-mcp-docs', 'Artisan command reference, Eloquent docs, route list.'],
          ['react', 'react-mcp', 'Component props explorer, hooks reference.'],
          ['django', 'django-mcp', 'Model inspector, URL pattern browser, settings explorer.'],
          ['rails', 'rails-mcp', 'Route helper, ActiveRecord association explorer.'],
        ],
      },
      { type: 'h2', id: 'custom-stack-server', text: 'Adding a custom stack-scoped server' },
      {
        type: 'terminal',
        lang: 'yaml',
        label: 'pack.yaml (custom pack)',
        code: 'mcp:\n  servers:\n    - name: my-stack-docs\n      command: npx\n      args: ["-y", "my-stack-mcp-server"]\n      scope: project   # only register in projects using this pack',
      },
    ],
  },

  /* ── Session Continuity ──────────────────────────────────────────────── */

  'session-handoff': {
    id: 'session-handoff',
    title: 'Handoff System',
    section: 'Session Continuity',
    sectionId: 'session-continuity',
    prev: 'mcp-stack-scoped',
    next: 'session-skills',
    keywords: ['handoff', 'session continuity', 'resume', 'context', 'next session'],
    content: [
      { type: 'h1', text: 'Handoff System' },
      {
        type: 'p',
        text: 'The handoff system solves one of the most frustrating problems with AI coding agents: every session starts from zero. paqad-ai writes a structured handoff document at the end of each completed workflow that the next session can read to resume exactly where the previous one left off.',
      },
      { type: 'h2', id: 'handoff-document', text: 'The handoff document' },
      {
        type: 'p',
        text: 'The handoff document is written to `.paqad/handoff.md` at the end of each workflow. It contains:',
      },
      {
        type: 'ul',
        items: [
          'A summary of the work completed in the previous session.',
          'The current state of in-progress tasks.',
          'Open questions and decisions deferred to the next session.',
          'Files modified and their status.',
          'The next recommended action.',
        ],
      },
      { type: 'h2', id: 'resuming', text: 'Resuming a session' },
      {
        type: 'p',
        text: 'When you start a new session in any supported adapter, include the handoff document in your opening prompt.',
      },
      {
        type: 'terminal',
        lang: 'bash',
        copyable: true,
        code: '# Claude Code, include handoff automatically via CLAUDE.md\n# The framework path in CLAUDE.md references .paqad/handoff.md',
      },
      {
        type: 'callout',
        variant: 'tip',
        text: 'The `context-curator` agent reads `.paqad/handoff.md` automatically at the start of each workflow. You do not need to paste it manually.',
      },
    ],
  },

  'session-skills': {
    id: 'session-skills',
    title: 'Skill Cache',
    section: 'Session Continuity',
    sectionId: 'session-continuity',
    prev: 'session-handoff',
    next: 'planning-overview',
    keywords: ['skills', 'skill cache', 'trigger', 'cache warmth', 'skill loading'],
    content: [
      { type: 'h1', text: 'Skill Cache' },
      {
        type: 'p',
        text: 'Skills are short, named prompt fragments that agents can invoke during a session to perform specific tasks, running tests, generating a migration, creating a component, and so on. The skill cache pre-loads and validates the shared paqad-ai runtime skills so they are available instantly when needed.',
      },
      { type: 'h2', id: 'warming', text: 'Cache warming' },
      {
        type: 'p',
        text: 'The skill cache is warmed automatically during `onboard` and `refresh`. You can also warm it manually.',
      },
      {
        type: 'terminal',
        lang: 'bash',
        copyable: true,
        code: 'paqad-ai doctor  # reports skill-cache-warm gate\npaqad-ai refresh  # re-warms the cache as part of refresh',
      },
      { type: 'h2', id: 'trigger-evaluation', text: 'Trigger evaluation' },
      {
        type: 'p',
        text: 'Each skill has a trigger condition, a keyword or phrase pattern that, when detected in a user prompt, causes the agent to consider invoking the skill. Trigger evaluation runs at session start and is cached for the duration of the session.',
      },
      { type: 'h2', id: 'invalidation', text: 'Cache invalidation' },
      { type: 'p', text: 'The skill cache is invalidated when:' },
      {
        type: 'ul',
        items: [
          'The installed paqad-ai runtime skill bundle changes.',
          'A new adapter is added and its runtime-facing config is generated.',
          'The `paqad-ai refresh` command is run.',
        ],
      },
      {
        type: 'callout',
        variant: 'note',
        text: 'The `skill cache warm` doctor gate fails when the cache is empty or stale. A cold cache does not break anything, but skill invocation will be slower on the first use of each skill.',
      },
    ],
  },

  'planning-overview': {
    id: 'planning-overview',
    title: 'Planning Overview',
    section: 'Planning',
    sectionId: 'planning',
    prev: 'session-skills',
    next: 'planning-manifest-schema',
    keywords: ['planning manifest', 'yaml plan', 'execution slices', 'verification matrix'],
    content: [
      { type: 'h1', text: 'Planning Overview' },
      {
        type: 'p',
        text: 'The Planning Manifest System replaces prose-first feature planning with one structured YAML manifest that downstream systems can consume directly.',
      },
      {
        type: 'p',
        text: 'Instead of generating stories, acceptance-criteria tables, and review prose across multiple model calls, paqad-ai emits one planning contract, requirement graph, execution slices, verification matrix, decision log, doc targets, and regression watch, all before any implementation begins.',
      },
      { type: 'h2', id: 'key-terms', text: 'Key terms' },
      {
        type: 'dl',
        items: [
          {
            term: 'manifest',
            def: 'The canonical YAML planning artifact stored under `.paqad/specs/{slug}.yaml`.',
          },
          {
            term: 'slice',
            def: 'The smallest independently verifiable implementation unit, with an explicit `touches` file list and a `rollback_class`.',
          },
          {
            term: 'criterion',
            def: 'A Given/When/Then test contract in the verification matrix. Automated criteria with a `proof_target` deterministically generate failing test skeletons.',
          },
          {
            term: 'doc target',
            def: 'A deterministic documentation update contract resolved from slice file scopes via the stale-doc detector.',
          },
          {
            term: 'regression watch',
            def: 'Existing tests that guard files in the slice scope. The implementing agent must keep them passing.',
          },
          {
            term: 'intelligence context',
            def: 'Eight data sources assembled before the manifest generation call: module health, compiled rules, inherited constraints, coverage overlay, defect patterns, selective docs, existing code matches, and token ceiling prediction.',
          },
        ],
      },
      { type: 'h2', id: 'pipeline-summary', text: 'Pipeline summary' },
      {
        type: 'table',
        headers: ['Phase', 'Output'],
        rows: [
          [
            '0, Classify',
            'Three-stage classification: workflow, modules, scope, impacts, delta overlap, confidence',
          ],
          [
            '1, Assemble intelligence',
            'Module health, compiled rules, coverage overlay, defect patterns, selective docs, code matches, token ceiling',
          ],
          ['1, Generate manifest', 'Single YAML planning artifact (one model call)'],
          [
            '2, Validate and inject',
            'Schema checks, cycle detection, compiled-rule and defect-pattern criteria injection, coverage overlay marking',
          ],
          [
            '3, Emit deterministic outputs',
            'Test skeletons at `proof_target` paths, doc targets, regression watch entries',
          ],
          [
            '4, Execute',
            'Implementing agent makes failing skeletons pass, updates docs, respects scope',
          ],
          ['5, Verify', 'Compliance system reads verification matrix directly as obligation index'],
          [
            '6, Post-execution learning',
            'Module health update, plan-vs-actual diff, planning cost log',
          ],
        ],
      },
      {
        type: 'callout',
        variant: 'note',
        text: 'Phases 0, 2, 3, and 6 are all deterministic and consume zero model tokens. Only phase 1 (manifest generation) invokes the model.',
      },
    ],
  },

  'planning-manifest-schema': {
    id: 'planning-manifest-schema',
    title: 'Manifest Schema',
    section: 'Planning',
    sectionId: 'planning',
    prev: 'planning-overview',
    next: 'planning-pipeline',
    keywords: ['manifest schema', 'requirement graph', 'execution slices', 'verification matrix'],
    content: [
      { type: 'h1', text: 'Manifest Schema' },
      {
        type: 'p',
        text: 'A planning manifest is a single YAML document with six planning sections plus classification metadata. It is the source of truth for planning. Human-readable markdown is optional and derived from the YAML, never the other way around.',
      },
      {
        type: 'terminal',
        lang: 'yaml',
        code: `plan_version: 1
plan_mode: full           # full | delta
feature_id: feat-auth-refresh
slug: auth-refresh
created_at: "2026-04-11T09:00:00Z"
base_manifest_hash: null  # set when plan_mode is delta
classification:
  workflow: feature-development
  complexity: medium
  risk: low
  lane: graduated
  domain: node-cli
  stack: node-cli
  scope: single-module
  affected_modules: ["src/auth"]
  api_impact: additive-endpoint
  ui_impact: none
requirement_graph: []
execution_slices: []
verification_matrix: []
decision_log: []
doc_targets: []
regression_watch: []`,
      },
      {
        type: 'table',
        headers: ['Section', 'Purpose'],
        rows: [
          [
            'requirement_graph',
            'Obligation nodes typed as functional, non-functional, constraint, or edge-case',
          ],
          [
            'execution_slices',
            'Ordered change units with `touches` file list and `rollback_class`',
          ],
          [
            'verification_matrix',
            'Given/When/Then contracts with `proof_type`, `proof_target`, and `status`',
          ],
          ['decision_log', 'Non-obvious design choices, rejected alternatives, and reversibility'],
          ['doc_targets', 'Canonical documentation updates resolved from slice file scopes'],
          ['regression_watch', 'Existing tests that guard files in the slice scope'],
        ],
      },
      { type: 'h2', id: 'id-schemes', text: 'ID schemes' },
      {
        type: 'p',
        text: 'IDs are validated by the manifest validator. Invalid IDs are rejected before any execution begins.',
      },
      {
        type: 'table',
        headers: ['Artifact', 'Pattern', 'Example'],
        rows: [
          ['Requirements', '`FR-N`, `NFR-N`, `EC-N`, `CONSTRAINT-N`', '`FR-1`, `NFR-3`, `EC-2`'],
          ['Slices', '`SL-N`', '`SL-1`, `SL-2`'],
          ['Criteria', '`AC-N`', '`AC-1`, `AC-12`'],
          ['Decisions', '`D-N`', '`D-1`'],
        ],
      },
      { type: 'h2', id: 'rollback-classes', text: 'Rollback classes' },
      {
        type: 'p',
        text: '`rollback_class` is required on every slice in graduated and full lanes. Fast-lane slices may omit it.',
      },
      {
        type: 'table',
        headers: ['Class', 'Meaning'],
        rows: [
          ['`safe`', 'Change can be reverted cleanly with no side effects'],
          ['`needs-migration`', 'Revert requires a compensating migration or data cleanup'],
          ['`destructive`', 'Revert is not possible or would cause data loss'],
        ],
      },
    ],
  },

  'planning-pipeline': {
    id: 'planning-pipeline',
    title: 'Planning Pipeline',
    section: 'Planning',
    sectionId: 'planning',
    prev: 'planning-manifest-schema',
    next: 'classification-system',
    keywords: [
      'planning pipeline',
      'intelligence assembly',
      'fast lane',
      'graduated lane',
      'full lane',
    ],
    content: [
      { type: 'h1', text: 'Planning Pipeline' },
      {
        type: 'p',
        text: 'The pipeline combines one model generation step with deterministic enrichment and validation stages. Only the manifest generation call consumes tokens, every other stage is zero-token.',
      },
      { type: 'h2', id: 'lanes', text: 'Lanes' },
      {
        type: 'table',
        headers: ['Lane', 'Depth', 'rollback_class on slices'],
        rows: [
          ['fast', 'Minimal manifest, primary proof path only', 'Optional'],
          [
            'graduated',
            'Execution slices, negative cases, doc targets, regression watch',
            'Required',
          ],
          [
            'full',
            'Edge cases, adversarial criteria, broader auto-injection, richer decision records',
            'Required',
          ],
        ],
      },
      { type: 'h2', id: 'intelligence-groups', text: 'Intelligence assembly groups' },
      {
        type: 'p',
        text: 'The three groups run in parallel. Target total assembly time is under 500ms.',
      },
      {
        type: 'ul',
        items: [
          'Group A: module health + compiled rules + inherited constraints from prior manifests.',
          'Group B: coverage overlay + defect patterns + selective module docs + existing code matches.',
          'Group C: token ceiling prediction from historical planning cost log.',
        ],
      },
      {
        type: 'ascii',
        code: `enhanced classification (Phase 0)
      ↓
intelligence assembly (parallel, < 500ms)
  A: health + rules + constraints
  B: coverage + defects + docs + code
  C: token ceiling
      ↓
single manifest generation (one model call)
      ↓
validation + injection (deterministic)
  schema · cycles · cross-refs · path safety
  compiled-rule criteria
  defect-pattern criteria
  contract-boundary criteria
  coverage overlay marking
      ↓
skeletons + doc targets + regression watch`,
      },
      { type: 'h2', id: 'delta-mode', text: 'Delta mode' },
      {
        type: 'p',
        text: 'When an existing manifest covers the affected scope, the generator runs in delta mode and emits only added, changed, and removed elements. The manifest carries a `base_manifest_hash` and a top-level `changes` section with per-section diff arrays.',
      },
    ],
  },

  'classification-system': {
    id: 'classification-system',
    title: 'Classification System',
    section: 'Planning',
    sectionId: 'planning',
    prev: 'planning-pipeline',
    next: 'planning-module-health',
    keywords: [
      'classification system',
      'deterministic classification',
      'resolution map',
      'delta candidate',
    ],
    content: [
      { type: 'h1', text: 'Classification System' },
      {
        type: 'p',
        text: 'Classification is a three-stage pipeline that resolves as many dimensions as possible from project evidence before any fallback inference runs. The result feeds directly into intelligence assembly and manifest generation.',
      },
      {
        type: 'ascii',
        code: `request
  ↓
Stage 1: pre-classification (deterministic, 300ms timeout)
  workflow + modules + scope + impacts
  delta overlap + context budget + rule triggers
  ↓
Stage 2: reduced-scope fallback (model)
  complexity + risk + certainty
  confirms or overrides pre-classifier hints
  ↓
Stage 3: post-classification adjustment (deterministic)
  health overrides + defect floors + history correction`,
      },
      { type: 'h2', id: 'stage-1', text: 'Stage 1, Deterministic pre-classification' },
      {
        type: 'p',
        text: 'All operations run in parallel within a 300ms timeout. If the timeout fires, unresolved dimensions fall back to defaults and classification continues.',
      },
      {
        type: 'ul',
        items: [
          'Workflow resolved from a priority-ordered pattern table (pentest-retest 250 → pentest 240 → rca 230 → docs 200 → research 180 → cleanup 170 → bug-fix 160 → feature-development 140).',
          'Affected modules resolved from explicit file paths in the request text, AST chunk-index symbol matches, RAG hits, MCP queries, and stack heuristics, in that order.',
          'Scope derived from import graph depth over resolved modules.',
          'Impact dimensions (database, API, UI, compliance, reversibility, data sensitivity) inferred from paths and request text.',
          'Delta candidate detected by scanning `.paqad/specs/*.yaml` for 50%+ manifest overlap with the affected scope.',
          'Context budget hint (`minimal`, `standard`, `deep`) computed from scope, delta status, and workflow.',
          'Compiled rule triggers matched against affected module paths.',
        ],
      },
      { type: 'h2', id: 'stage-2', text: 'Stage 2, Reduced-scope fallback' },
      {
        type: 'p',
        text: 'Only unresolved or interpretation-heavy dimensions reach this stage. The model receives pre-classifier results as structured hints and may confirm, override with justification, or defer to the hint. Each dimension carries a `resolution_source` tag in the final `resolution_map`.',
      },
      { type: 'h2', id: 'stage-3', text: 'Stage 3, Post-classification adjustment' },
      {
        type: 'ul',
        items: [
          'Fragile module health raises risk to `high` and sets `resolution_map.risk: "health-override"`.',
          'Defect history exceeding 10 recurrences sets a `high` risk floor; exceeding 5 or having 3+ open patterns sets `medium`. Floor is tagged `"defect-floor"` in the resolution map.',
          'Plan-vs-actual history showing 3+ consecutive under-scoped tasks shifts complexity up by one tier. Over-estimation shifts it down. Tagged `"history-corrected"`.',
          'A high override rate (> 30% of dimensions overridden by the model) is recorded to `.paqad/cache/classification-history.json` and surfaced as a `doctor` warning.',
        ],
      },
      { type: 'h2', id: 'confidence', text: 'Confidence and resolution map' },
      {
        type: 'p',
        text: 'Every result includes `classification_confidence` (0.0-1.0, ratio of deterministically resolved dimensions) and a per-field `resolution_map` with one of: `deterministic`, `deterministic:rag`, `deterministic:graph`, `deterministic:manifest`, `llm-confirmed`, `llm-overridden`, `llm-guessed`, `health-override`, `history-corrected`, `defect-floor`, or `default`.',
      },
    ],
  },

  'planning-module-health': {
    id: 'planning-module-health',
    title: 'Module Health',
    section: 'Planning',
    sectionId: 'planning',
    prev: 'classification-system',
    next: null,
    keywords: [
      'module health',
      'health tier',
      'coverage',
      'defect frequency',
      'contract stability',
    ],
    content: [
      { type: 'h1', text: 'Module Health' },
      {
        type: 'p',
        text: 'Module health records the stability of each module so planning depth adapts to local risk rather than treating every change equally. Profiles are stored under `.paqad/module-health/{module}.json` and updated after every verification gate.',
      },
      { type: 'h2', id: 'tiers', text: 'Tiers' },
      {
        type: 'table',
        headers: ['Tier', 'Conditions', 'Planning effect'],
        rows: [
          [
            'stable',
            'coverage >= 80% AND defect_frequency <= 2 AND contract_stability >= 0.85',
            'Allows fast-depth planning even in graduated tasks',
          ],
          [
            'moderate',
            'coverage >= 50% AND defect_frequency <= 5',
            'Standard planning depth for the lane',
          ],
          [
            'fragile',
            'coverage < 50% OR defect_frequency > 5 OR contract_stability < 0.85',
            'Forces full-depth planning even in fast tasks; raises risk to `high` in post-classifier',
          ],
          [
            'unknown',
            'All metrics are null (first touch, no history)',
            'Standard planning depth for the lane',
          ],
        ],
      },
      { type: 'h2', id: 'metrics', text: 'Metrics' },
      {
        type: 'table',
        headers: ['Metric', 'Definition'],
        rows: [
          [
            'coverage_pct',
            'Percentage of obligations in `status: covered` from the most recent compliance check touching this module',
          ],
          [
            'defect_frequency',
            'Count of defect pattern occurrences for this module in the last 90 days',
          ],
          [
            'contract_stability',
            'Ratio of obligations not modified in the last 90 days to total obligations (0-1)',
          ],
          [
            'change_velocity',
            'Number of distinct specs that modified this module in the last 90 days',
          ],
        ],
      },
      {
        type: 'callout',
        variant: 'tip',
        text: 'The health ledger is seeded during onboarding. Run `paqad-ai doctor` to validate ledger freshness. The post-classifier reads ledger entries for every module in `affected_modules` before adjusting risk and lane.',
      },
    ],
  },
};

/* ── Sidebar navigation structure ───────────────────────────────────────── */

export const DOCS_NAV = [
  {
    id: 'getting-started',
    label: '// getting-started',
    pages: ['introduction', 'installation', 'quick-start'],
  },
  {
    id: 'core-concepts',
    label: '// core-concepts',
    pages: ['how-it-works', 'project-profile', 'stack-detection', 'resolution-order'],
  },
  {
    id: 'cli-reference',
    label: '// cli-reference',
    pages: [
      'cli-onboard',
      'cli-doctor',
      'cli-compliance',
      'cli-refresh',
      'cli-packs',
      'cli-patterns',
      'cli-capabilities',
      'cli-rag',
      'cli-graph',
    ],
  },
  {
    id: 'stack-packs',
    label: '// stack-packs',
    pages: ['packs-overview', 'packs-built-in', 'packs-custom', 'packs-precedence'],
  },
  {
    id: 'adapters',
    label: '// ai-agent-adapters',
    pages: [
      'adapters-overview',
      'adapters-claude-code',
      'adapters-cursor',
      'adapters-copilot',
      'adapters-windsurf',
      'adapters-continue',
      'adapters-codex',
      'adapters-gemini',
      'adapters-antigravity',
      'adapters-junie',
      'adapters-aider',
    ],
  },
  {
    id: 'workflow-engine',
    label: '// workflow-engine',
    pages: ['workflow-overview', 'workflow-yaml', 'workflow-routing', 'workflow-agents'],
  },
  {
    id: 'context-and-rag',
    label: '// context-and-rag',
    pages: [
      'rag-context-intelligence',
      'rag-overview',
      'rag-adaptive-depth',
      'rag-reranking',
      'rag-metadata-filters',
      'rag-action-routing',
      'project-knowledge-answers',
    ],
  },
  {
    id: 'security',
    label: '// security',
    pages: ['security-break-locally', 'security-pentest', 'security-owasp', 'security-guardrails'],
  },
  {
    id: 'patterns-library',
    label: '// patterns-library',
    pages: ['patterns-overview', 'patterns-recording', 'patterns-scoring'],
  },
  {
    id: 'health-and-maintenance',
    label: '// health-and-maintenance',
    pages: ['health-doctor', 'health-structured-test-output', 'health-refresh', 'health-drift'],
  },
  {
    id: 'mcp-integration',
    label: '// mcp-integration',
    pages: ['mcp-overview', 'mcp-defaults', 'mcp-stack-scoped'],
  },
  {
    id: 'session-continuity',
    label: '// session-continuity',
    pages: ['session-handoff', 'session-skills'],
  },
  {
    id: 'planning',
    label: '// planning',
    pages: [
      'planning-overview',
      'planning-manifest-schema',
      'planning-pipeline',
      'classification-system',
      'planning-module-health',
    ],
  },
];
