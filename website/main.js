const desktopLogo = `██████╗  █████╗  ██████╗  █████╗ ██████╗
██╔══██╗██╔══██╗██╔═══██╗██╔══██╗██╔══██╗
██████╔╝███████║██║   ██║███████║██║  ██║
██╔═══╝ ██╔══██║██║▄▄ ██║██╔══██║██║  ██║
██║     ██║  ██║╚██████╔╝██║  ██║██████╔╝
╚═╝     ╚═╝  ╚═╝ ╚══▀▀═╝ ╚═╝  ╚═╝╚═════╝`;

const mobileLogo = `██████╗  █████╗  ██████╗  █████╗ ██████╗
██╔══██╗██╔══██╗██╔═══██╗██╔══██╗██╔══██╗
██████╔╝███████║██║   ██║███████║██║  ██║
██╔═══╝ ██╔══██║██║▄▄ ██║██╔══██║██║  ██║
██║     ██║  ██║╚██████╔╝██║  ██║██████╔╝
╚═╝     ╚═╝  ╚═╝ ╚══▀▀═╝ ╚═╝  ╚═╝╚═════╝

paqad-ai`;

const comparisonCards = [
  {
    title: 'WITHOUT PAQAD',
    tone: 'negative',
    items: [
      'Guesses your folder structure and drops files in the wrong place',
      'Rebuilds a component that already exists, because it never knew',
      'Writes code that quietly breaks tests it never ran',
      'Tells you it is done when it is not',
      'Burns tokens re-reading the same files every turn',
    ],
  },
  {
    title: 'WITH PAQAD',
    tone: 'positive',
    items: [
      'Knows your stack, layout, and conventions before it writes a line',
      'Finds the existing component and extends it',
      'Writes the failing test first, then makes it pass without breaking others',
      'Cannot mark work done until the checks actually pass',
      'Cuts token use by 60-85% by loading only what the task needs',
    ],
  },
];

const demoLines = [
  { type: 'command', text: '$ paqad-ai onboard' },
  { type: 'muted', text: 'Scanning project...' },
  {
    type: 'success',
    text: '✓ Detected: Laravel + React (inertia, tailwind, pest)',
    highlights: ['Laravel', 'React', 'inertia', 'tailwind', 'pest'],
  },
  {
    type: 'annotation',
    text: 'Read from composer.json, package.json, and your lockfiles',
  },
  {
    type: 'success',
    text: '✓ Generated: CLAUDE.md, AGENTS.md, GEMINI.md',
    highlights: ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'],
  },
  { type: 'annotation', text: 'Your AI agents now have project-specific instructions' },
  {
    type: 'success',
    text: '✓ Generated: docs/instructions/stack/* (8 files)',
    highlights: ['docs/instructions/stack/*'],
  },
  {
    type: 'annotation',
    text: 'Stack conventions, testing rules, and folder structure, all documented',
  },
  { type: 'success', text: '✓ Generated: docs/instructions/rules/*' },
  {
    type: 'success',
    text: '✓ Configured: MCP servers (laravel-boost, tailwind-mcp, figma)',
    highlights: ['laravel-boost', 'tailwind-mcp', 'figma'],
  },
  {
    type: 'annotation',
    text: 'Your AI can now query your routes, models, and design tokens directly',
  },
  { type: 'success', text: '✓ Created: .paqad/project-profile.yaml' },
  { type: 'info', text: 'Ready. Your AI agents now understand your project.' },
  { type: 'muted', text: 'Total time: 4.2s' },
];

const howCards = [
  {
    number: '1',
    accent: 'amber',
    title: 'Codify',
    body: 'Your stack, rules, and spec become version-controlled context every agent reads. Written once, reused everywhere.',
  },
  {
    number: '2',
    accent: 'cyan',
    title: 'Follow',
    body: 'The agent runs your workflow, not an improvised prompt. It routes the task, plans it, writes the tests, then builds. Same process every time.',
  },
  {
    number: '3',
    accent: 'green',
    title: 'Prove',
    body: 'Automatic checks confirm the tests pass, the spec is met, the docs are in sync, and nothing else broke. Code does the checking, not another AI.',
  },
];

const problemPairs = [
  {
    title: '"My AI says it is done when it is not"',
    description:
      'paqad-ai checks the work instead of taking its word for it. Tests, spec coverage, docs, and security all have to pass before a change counts as done. The checks are plain code, so the AI cannot talk its way past them.',
    visual: [
      'Verification log:',
      '✓ SL-1: API search params      3 tests pass',
      '✓ SL-2: SearchInput component  4 tests pass',
      '✓ SL-3: Wire to products page  2 tests pass',
      '✓ Full suite: 247 tests, 0 failures',
      '✓ Docs updated: api.md, components.md',
    ],
    emphasis: '✓ Full suite: 247 tests, 0 failures',
  },
  {
    title: '"My AI rewrites code that already exists"',
    description:
      'paqad-ai indexes your codebase and loads the relevant pieces with every message, using 60-85% fewer tokens than letting the AI read everything itself. It sees the components, hooks, and routes you already have, and extends them instead of reinventing them.',
    visual: [
      'Context loaded for this task:',
      '→ ProductCard.tsx (existing)',
      '→ useProducts.ts (existing hook)',
      '→ /api/products (existing route)',
      '',
      "AI decision: extend, don't rebuild",
      'Tokens saved: ~4,200',
    ],
    emphasis: 'Tokens saved: ~4,200',
  },
  {
    title: '"My AI forgets everything between sessions"',
    description:
      'paqad-ai compresses each session into a short, structured handoff: the decisions made, the files touched, and the next steps. When you come back, your AI picks up where you left off, with no re-explaining and no wasted tokens rebuilding context.',
    visual: [
      'handoff.json',
      '"active_task": "adding search..."',
      '"decisions": [',
      '  "debounce user input",',
      '  "reuse ProductCard component"',
      ']',
      '"next_steps": [',
      '  "wire search to API"',
      ']',
    ],
    emphasis: '  "wire search to API"',
  },
  {
    title: '"I have to write CLAUDE.md by hand, for every tool"',
    description:
      'One command generates the config for every AI tool you use: Claude Code, Codex, Gemini, Cursor, Copilot, Windsurf, and more. They all read from the same source of truth, they stay in sync, and it is completely free.',
    visual: [
      'Generated automatically:',
      'CLAUDE.md          for Claude Code',
      'AGENTS.md          for Codex CLI',
      'GEMINI.md          for Gemini CLI',
      '.cursor/rules/     for Cursor',
      '.github/copilot-instructions.md',
      '.windsurfrules     for Windsurf',
      '',
      'All pointing to the same shared knowledge base',
    ],
    emphasis: 'All pointing to the same shared knowledge base',
  },
];

const ragCards = [
  {
    title: 'What it loads',
    body: 'For each request, paqad-ai pulls the most relevant code, docs, and project rules first. Your AI sees what it needs without re-reading everything.',
    lines: [
      'Task: add product search',
      '',
      'Loaded context:',
      '→ ProductCard.tsx',
      '→ useProducts.ts',
      '→ routes/api.php',
      '→ docs/instructions/stack/',
    ],
  },
  {
    title: 'Why it saves tokens',
    body: 'Instead of stuffing whole folders into every prompt, paqad-ai ranks and packs only the useful pieces. That is where the 60-85% token saving comes from.',
    lines: [
      'Whole-repo dump:',
      'one huge prompt',
      '',
      'With paqad-ai:',
      'top-ranked pieces only',
      '',
      'Tokens saved:',
      '60-85%',
    ],
  },
  {
    title: 'Why the answers improve',
    body: 'Because the AI sees what already exists first, it extends what is there, follows your conventions, and stops inventing duplicate code. Less context also means a sharper model.',
    lines: [
      'AI decision:',
      "extend, don't rebuild",
      '',
      'Existing route found',
      'Existing hook found',
      'Existing component found',
      '',
      'Safer output, fewer regressions',
    ],
  },
];

const proofCards = [
  {
    filename: 'Agent instruction layer',
    callout: 'Generated from your lockfiles. Shared across every supported AI tool.',
    code: `CLAUDE.md   → Claude Code
AGENTS.md   → Codex CLI
GEMINI.md   → Gemini CLI
.cursor/    → Cursor
copilot     → GitHub Copilot
...
Read: docs/instructions/ for full context`,
  },
  {
    filename: 'Planning manifest',
    callout: 'Exact plan with tests before any code is written.',
    code: `requirement_graph:
  FR-1: search params on API
  FR-2: SearchInput component
verification_matrix:
  AC-1: "shirt" → only shirts
  AC-2: empty → all products
execution_slices: [SL-1, SL-2, SL-3]`,
  },
  {
    filename: 'Test skeleton',
    callout: "The AI's job: make this test pass.",
    code: `// @obligation AC-1
test('search by name returns
  matching products', () => {
  throw new Error(
    'Not implemented'
  );
});`,
  },
  {
    filename: 'Session handoff',
    callout: 'Tomorrow, your AI resumes from here.',
    code: `completed: [SL-1, SL-2]
current: SL-3
decisions:
  - "reuse ProductCard"
  - "debounce 300ms"
next: "wire filter to API"`,
  },
];

const stacks = [
  'Laravel',
  'React',
  'Vue',
  'Flutter',
  'Django',
  'FastAPI',
  'Rails',
  'Spring Boot',
  'Express',
  'ASP.NET Core',
  'Next.js',
  'Flask',
  'NestJS',
  'Kotlin Android',
  'Angular',
  'Svelte',
  'Astro',
  'Go',
  'Rust',
  'Node CLI',
  'Node Library',
  'Node Service',
];

const adapters = [
  'Claude Code',
  'Codex CLI',
  'Gemini CLI',
  'Cursor',
  'GitHub Copilot',
  'Windsurf',
  'Junie',
  'Continue',
  'Aider',
  'Antigravity',
];

const pillars = [
  {
    kicker: 'Workflows, not prompts',
    title: 'Your process, run the same way every time',
    body: 'Write your team workflow and rules down once. Every agent follows them, instead of improvising from a prompt.',
  },
  {
    kicker: 'Proof, not promises',
    title: 'Checks that confirm the work is done',
    body: 'Tests, spec coverage, docs, and quality all have to pass. The checks are code, not another AI grading itself.',
  },
  {
    kicker: 'Security workflow',
    title: 'A full OWASP pentest pass, with retests',
    body: 'Find issues, prove them with a local playbook, fix them, then replay the findings to confirm. Built in, not bolted on.',
  },
  {
    kicker: 'Design workflow',
    title: 'Your UI, audited against your design system',
    body: 'design-test checks the interface for token, component, accessibility, and responsive drift, the way pentest checks the code.',
  },
  {
    kicker: 'Living docs',
    title: 'Documentation that keeps itself current',
    body: 'The framework re-reads your stack and updates the docs when the code changes, so they never fall out of date.',
  },
  {
    kicker: 'Runs locally',
    title: 'Your code stays on your machine',
    body: 'Analysis and embeddings run on-device by default, with an audit trail you can keep. No SaaS, no lock-in.',
  },
];

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function renderComparison() {
  const root = document.getElementById('comparison-grid');
  if (!root) return;
  root.innerHTML = comparisonCards
    .map((card, index) => {
      const icon = card.tone === 'positive' ? '✓' : '✕';
      return `
        <article class="comparison-card comparison-card--${card.tone} reveal-item" style="--reveal-delay:${index * 80}ms">
          <span class="comparison-tag comparison-tag--${card.tone}">${card.title}</span>
          <ul class="comparison-list">
            ${card.items
              .map(
                (item) => `
                  <li>
                    <span class="comparison-icon comparison-icon--${card.tone}" aria-hidden="true">${icon}</span>
                    <span>${escapeHtml(item)}</span>
                  </li>
                `,
              )
              .join('')}
          </ul>
        </article>
      `;
    })
    .join('');
}

function renderDemo() {
  const root = document.getElementById('terminal-demo');
  if (!root) return;
  root.innerHTML = `
    <div class="terminal-chrome">
      <div class="terminal-dots" aria-hidden="true">
        <span class="dot dot-red"></span>
        <span class="dot dot-yellow"></span>
        <span class="dot dot-green"></span>
      </div>
      <span class="terminal-title">~/my-saas-app</span>
    </div>
    <div class="terminal-body">
      ${demoLines
        .map((line) => {
          if (line.type === 'annotation') {
            return `<div class="terminal-annotation">↑ ${escapeHtml(line.text)}</div>`;
          }
          let text = escapeHtml(line.text);
          if (line.highlights) {
            line.highlights.forEach((token) => {
              text = text.replaceAll(
                token,
                `<span class="token-highlight">${escapeHtml(token)}</span>`,
              );
            });
          }
          return `<div class="terminal-line terminal-line--${line.type}">${text}</div>`;
        })
        .join('')}
    </div>
  `;
}

function renderHow() {
  const root = document.getElementById('how-grid');
  if (!root) return;
  root.innerHTML = howCards
    .map(
      (card, index) => `
        <article class="how-card reveal-item" style="--reveal-delay:${index * 80}ms">
          <span class="how-number how-number--${card.accent}">${card.number}</span>
          <h3>${card.title}</h3>
          <p>${card.body}</p>
        </article>
      `,
    )
    .join('');
}

function renderPillars() {
  const root = document.getElementById('pillars-grid');
  if (!root) return;
  root.innerHTML = pillars
    .map(
      (card, index) => `
        <article class="how-card reveal-item" style="--reveal-delay:${index * 60}ms">
          <div class="how-kicker">${escapeHtml(card.kicker)}</div>
          <h3>${escapeHtml(card.title)}</h3>
          <p>${escapeHtml(card.body)}</p>
        </article>
      `,
    )
    .join('');
}

function renderProblems() {
  const root = document.getElementById('problem-list');
  if (!root) return;
  root.innerHTML = problemPairs
    .map((pair, index) => {
      const visual = `
        <div class="code-visual">
          ${pair.visual
            .map((line) => {
              const safe = line ? escapeHtml(line) : '&nbsp;';
              if (line === pair.emphasis) {
                return `<div class="code-line code-line--accent">${safe}</div>`;
              }
              if (!line) {
                return '<div class="code-line code-line--blank">&nbsp;</div>';
              }
              return `<div class="code-line">${safe}</div>`;
            })
            .join('')}
        </div>
      `;
      const copy = `
        <div class="problem-copy">
          <span class="problem-pain">✕ The pain you know</span>
          <h3>${pair.title}</h3>
          <p>${pair.description}</p>
        </div>
      `;
      return `
        <article class="problem-row reveal-item ${index % 2 === 1 ? 'problem-row--reverse' : ''}" style="--reveal-delay:${(index % 2) * 80}ms">
          ${index % 2 === 1 ? `${visual}${copy}` : `${copy}${visual}`}
        </article>
      `;
    })
    .join('');
}

function renderRag() {
  const root = document.getElementById('rag-grid');
  if (!root) return;
  root.innerHTML = ragCards
    .map(
      (card, index) => `
        <article class="rag-card reveal-item" style="--reveal-delay:${index * 80}ms">
          <h3>${card.title}</h3>
          <pre>${escapeHtml(card.lines.join('\n'))}</pre>
          <p>${card.body}</p>
        </article>
      `,
    )
    .join('');
}

function renderProof() {
  const root = document.getElementById('proof-grid');
  if (!root) return;
  root.innerHTML = proofCards
    .map(
      (card, index) => `
        <article class="proof-card reveal-item" style="--reveal-delay:${index * 60}ms">
          <span class="proof-label">AUTO-GENERATED</span>
          <h3>${card.filename}</h3>
          <pre>${escapeHtml(card.code)}</pre>
          <p>↑ ${card.callout}</p>
        </article>
      `,
    )
    .join('');
}

function renderPills() {
  const stackRoot = document.getElementById('stack-pills');
  const adapterRoot = document.getElementById('adapter-pills');
  if (stackRoot) {
    stackRoot.innerHTML = stacks
      .map((item) => `<span class="pill pill-stack">${item}</span>`)
      .join('');
  }
  if (adapterRoot) {
    adapterRoot.innerHTML = adapters
      .map((item) => `<span class="pill pill-adapter">${item}</span>`)
      .join('');
  }
}

function animateHeroLogo() {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const desktopNode = document.getElementById('hero-logo-desktop');
  const mobileNode = document.getElementById('hero-logo-mobile');
  if (!desktopNode || !mobileNode) return;

  if (reduceMotion) {
    desktopNode.textContent = desktopLogo;
    mobileNode.textContent = mobileLogo;
    return;
  }

  desktopNode.textContent = '';
  mobileNode.textContent = '';

  const desktopChars = [...desktopLogo];
  const mobileChars = [...mobileLogo];
  let desktopIndex = 0;
  let mobileIndex = 0;

  const desktopTimer = window.setInterval(() => {
    desktopNode.textContent += desktopChars[desktopIndex] ?? '';
    desktopIndex += 1;
    if (desktopIndex >= desktopChars.length) {
      window.clearInterval(desktopTimer);
    }
  }, 8);

  const mobileTimer = window.setInterval(() => {
    mobileNode.textContent += mobileChars[mobileIndex] ?? '';
    mobileIndex += 1;
    if (mobileIndex >= mobileChars.length) {
      window.clearInterval(mobileTimer);
    }
  }, 8);
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}

function setupRain() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = document.getElementById('rain-layer');
  if (!layer) return;
  layer.innerHTML = '';
  const chars = ['0', '1', '{', '}', '/', '\\', '#', '·', '=', '<', '>'];
  const count = Math.min(22, Math.floor(window.innerWidth / 56));
  for (let i = 0; i < count; i += 1) {
    const el = document.createElement('span');
    el.className = 'rain-char';
    el.textContent = chars[Math.floor(Math.random() * chars.length)];
    el.style.left = `${Math.random() * 100}vw`;
    el.style.animationDuration = `${9 + Math.random() * 10}s`;
    el.style.animationDelay = `${-Math.random() * 16}s`;
    el.style.opacity = `${0.04 + Math.random() * 0.04}`;
    layer.appendChild(el);
  }
}

function setupScrollHeader() {
  const header = document.querySelector('.site-header');
  if (!header) return;
  const onScroll = debounce(() => {
    header.classList.toggle('is-scrolled', window.scrollY > 12);
  }, 30);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function setupMobileNav() {
  const toggle = document.getElementById('nav-toggle');
  const close = document.getElementById('mobile-nav-close');
  const nav = document.getElementById('mobile-nav');
  if (!toggle || !nav) return;

  function closeNav() {
    nav.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('nav-open');
  }

  function openNav() {
    nav.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('nav-open');
  }

  toggle.addEventListener('click', () => {
    if (nav.hidden) openNav();
    else closeNav();
  });

  if (close) {
    close.addEventListener('click', closeNav);
  }

  nav.addEventListener('click', (event) => {
    if (event.target instanceof HTMLElement && event.target.tagName === 'A') {
      closeNav();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !nav.hidden) closeNav();
  });
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const input = document.createElement('textarea');
  input.value = text;
  document.body.appendChild(input);
  input.select();
  const success = document.execCommand('copy');
  input.remove();
  return success;
}

function wireCopyButtons() {
  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const hint = button.querySelector('.copy-command-hint');
      const original = hint?.textContent ?? '';
      try {
        await copyToClipboard(button.getAttribute('data-copy') ?? '');
        if (hint) {
          hint.textContent = '✓ copied';
          hint.classList.add('is-success');
          window.setTimeout(() => {
            hint.textContent = original;
            hint.classList.remove('is-success');
          }, 2000);
        }
      } catch {
        if (hint) {
          hint.textContent = 'copy failed';
          window.setTimeout(() => {
            hint.textContent = original;
          }, 2000);
        }
      }
    });
  });
}

function setupReveals() {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sections = document.querySelectorAll('.reveal-section');
  const items = document.querySelectorAll('.reveal-item');

  if (reduceMotion) {
    sections.forEach((section) => section.classList.add('is-visible'));
    items.forEach((item) => item.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          obs.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.16 },
  );

  sections.forEach((section) => observer.observe(section));
  items.forEach((item) => observer.observe(item));
}

function setupActiveNav() {
  const sectionIds = ['difference', 'how', 'stacks'];
  const navMap = new Map();
  document.querySelectorAll('.nav-links a, .mobile-nav-links a').forEach((link) => {
    const href = link.getAttribute('href') ?? '';
    if (!href.startsWith('#')) return;
    const key = href.slice(1);
    const current = navMap.get(key) ?? [];
    current.push(link);
    navMap.set(key, current);
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navMap.forEach((links, key) => {
          links.forEach((link) => link.classList.toggle('is-active', key === entry.target.id));
        });
      });
    },
    { rootMargin: '-35% 0px -55% 0px', threshold: 0.01 },
  );

  sectionIds.forEach((id) => {
    const section = document.getElementById(id);
    if (section) observer.observe(section);
  });
}

function init() {
  renderComparison();
  renderDemo();
  renderHow();
  renderPillars();
  renderProblems();
  renderRag();
  renderProof();
  renderPills();
  animateHeroLogo();
  setupRain();
  setupScrollHeader();
  setupMobileNav();
  setupReveals();
  setupActiveNav();
  wireCopyButtons();
}

window.addEventListener('DOMContentLoaded', init);
