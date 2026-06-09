/**
 * paqad-ai Documentation Engine
 * Handles: routing, search, sidebar, ToC, code copy, mobile drawer, rain, scroll header
 */

import { DOCS_PAGES, DOCS_NAV } from './docs-content.js';

/* ── Utilities ───────────────────────────────────────────────────────────── */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Convert `backtick` spans in text to <code> elements */
function renderInlineCode(text) {
  return escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>');
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/* ── Rain layer (identical to main.js) ──────────────────────────────────── */

function setupRain() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = document.getElementById('rain-layer');
  if (!layer) return;
  const chars = ['0', '1', '{', '}', '/', '\\', '#', '·', '+', '<', '>', '='];
  const count = Math.min(30, Math.floor(window.innerWidth / 28));
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'rain-char';
    el.setAttribute('aria-hidden', 'true');
    el.textContent = chars[Math.floor(Math.random() * chars.length)];
    el.style.left = `${Math.random() * 100}vw`;
    el.style.animationDuration = `${6 + Math.random() * 10}s`;
    el.style.animationDelay = `${-Math.random() * 14}s`;
    layer.appendChild(el);
  }
}

/* ── Scroll header (identical to main.js) ────────────────────────────────── */

function setupScrollHeader() {
  const header = document.querySelector('.site-header');
  if (!header) return;
  const onScroll = debounce(() => {
    header.classList.toggle('is-scrolled', window.scrollY > 10);
  }, 40);
  window.addEventListener('scroll', onScroll, { passive: true });
}

/* ── Top-level mobile nav (same hamburger as index.html) ─────────────────── */

function setupMobileTopNav() {
  const toggle = document.getElementById('nav-toggle');
  const close = document.getElementById('mobile-nav-close');
  const nav = document.getElementById('mobile-nav');
  if (!toggle || !nav) return;

  function openNav() {
    nav.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }
  function closeNav() {
    nav.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  toggle.addEventListener('click', openNav);
  if (close) close.addEventListener('click', closeNav);

  nav.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') closeNav();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !nav.hidden) closeNav();
  });
}

/* ── Docs sidebar drawer (mobile) ────────────────────────────────────────── */

function setupMobileSidebar() {
  const toggleBtn = document.getElementById('docs-sidebar-toggle');
  const sidebar = document.getElementById('docs-sidebar');
  const backdrop = document.getElementById('docs-sidebar-backdrop');
  if (!toggleBtn || !sidebar || !backdrop) return;

  function openSidebar() {
    sidebar.classList.add('is-open');
    backdrop.classList.add('is-visible');
    toggleBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    sidebar.classList.remove('is-open');
    backdrop.classList.remove('is-visible');
    toggleBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  toggleBtn.addEventListener('click', openSidebar);
  backdrop.addEventListener('click', closeSidebar);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('is-open')) closeSidebar();
  });

  // Close drawer when a nav link is clicked
  sidebar.addEventListener('click', (e) => {
    if (e.target.classList.contains('docs-nav-link')) {
      if (window.innerWidth <= 767) closeSidebar();
    }
  });
}

/* ── Sidebar navigation rendering ────────────────────────────────────────── */

function renderSidebarNav() {
  const nav = document.getElementById('docs-nav');
  if (!nav) return;

  const html = DOCS_NAV.map((section) => {
    const links = section.pages
      .map((pageId) => {
        const page = DOCS_PAGES[pageId];
        if (!page) return '';
        return `<a
          class="docs-nav-link"
          href="#${pageId}"
          data-page-id="${escapeHtml(pageId)}"
          aria-label="${escapeHtml(page.title)}"
        >${escapeHtml(page.title)}</a>`;
      })
      .join('');

    return `
      <div class="docs-nav-section" data-section-id="${escapeHtml(section.id)}">
        <div
          class="docs-nav-section-label"
          role="button"
          tabindex="0"
          aria-expanded="true"
          aria-label="Toggle ${escapeHtml(section.label)} section"
        >
          <span>${escapeHtml(section.label)}</span>
          <span class="section-toggle" aria-hidden="true">▾</span>
        </div>
        <div class="docs-nav-links" role="list">
          <div class="docs-nav-links-inner">${links}</div>
        </div>
      </div>`;
  }).join('');

  nav.innerHTML = html;

  // Wire collapsible section toggles
  nav.querySelectorAll('.docs-nav-section-label').forEach((label) => {
    const section = label.closest('.docs-nav-section');
    function toggle() {
      const collapsed = section.classList.toggle('is-collapsed');
      label.setAttribute('aria-expanded', String(!collapsed));
    }
    label.addEventListener('click', toggle);
    label.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
  });
}

function updateSidebarActiveState(pageId) {
  const nav = document.getElementById('docs-nav');
  if (!nav) return;

  nav.querySelectorAll('.docs-nav-link').forEach((link) => {
    const active = link.dataset.pageId === pageId;
    link.classList.toggle('is-active', active);
    if (active) {
      link.setAttribute('aria-current', 'page');
      // Ensure the parent section is expanded
      const section = link.closest('.docs-nav-section');
      if (section && section.classList.contains('is-collapsed')) {
        section.classList.remove('is-collapsed');
        const label = section.querySelector('.docs-nav-section-label');
        if (label) label.setAttribute('aria-expanded', 'true');
      }
      // Scroll link into view within sidebar
      link.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

/* ── Breadcrumbs ─────────────────────────────────────────────────────────── */

function renderBreadcrumbs(page) {
  const html = `
    <span class="bc-section">${escapeHtml(page.section)}</span>
    <span class="bc-sep" aria-hidden="true">›</span>
    <span class="bc-page">${escapeHtml(page.title)}</span>
  `;
  const desktop = document.getElementById('docs-breadcrumbs');
  const mobile = document.getElementById('docs-breadcrumbs-mobile');
  if (desktop) desktop.innerHTML = html;
  if (mobile) mobile.innerHTML = html;
}

/* ── Content node renderers ──────────────────────────────────────────────── */

function renderInlineCodeBlock(node) {
  const langClass = node.lang ? ` lang-${escapeHtml(node.lang)}` : '';
  const copyBtn = node.copyable
    ? `<button class="docs-code-copy" type="button" data-copy="${escapeHtml(node.code)}" aria-label="Copy code">[copy]</button>`
    : '';
  const label = node.label ? `<span class="docs-code-label">${escapeHtml(node.label)}</span>` : '';
  return `
    <div class="docs-code-block${langClass}">
      <div class="docs-code-header">
        <span class="docs-code-lang">${escapeHtml(node.lang || 'bash')}</span>
        ${label}
        ${copyBtn}
      </div>
      <pre class="docs-code-body">${escapeHtml(node.code)}</pre>
    </div>`;
}

function renderCalloutBlock(node) {
  const variant = node.variant || 'note';
  const icons = { tip: '▶ tip', note: 'ℹ note', warning: '⚠ warn', danger: '✗ danger' };
  const icon = icons[variant] || icons.note;
  return `
    <div class="docs-callout docs-callout--${escapeHtml(variant)}" role="note" aria-label="${escapeHtml(variant)}">
      <span class="docs-callout-icon" aria-hidden="true">${escapeHtml(icon)}</span>
      <div class="docs-callout-body"><p>${renderInlineCode(node.text)}</p></div>
    </div>`;
}

function renderTableBlock(node) {
  const headers = node.headers.map((h) => `<th>${renderInlineCode(h)}</th>`).join('');
  const rows = node.rows
    .map((row) => {
      const cells = row.map((cell) => `<td>${renderInlineCode(cell)}</td>`).join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderDlBlock(node) {
  const items = node.items
    .map(({ term, def }) => `<dt>${renderInlineCode(term)}</dt><dd>${renderInlineCode(def)}</dd>`)
    .join('');
  return `<dl>${items}</dl>`;
}

function renderNode(node) {
  switch (node.type) {
    case 'h1':
      return `<h1>${renderInlineCode(node.text)}</h1>`;

    case 'h2': {
      const id = node.id || slugify(node.text);
      return `<h2 id="${escapeHtml(id)}">${renderInlineCode(node.text)}<a class="heading-anchor" href="#${escapeHtml(id)}" aria-label="Link to ${escapeHtml(node.text)}"> #</a></h2>`;
    }

    case 'h3': {
      const id = node.id || slugify(node.text);
      return `<h3 id="${escapeHtml(id)}">${renderInlineCode(node.text)}<a class="heading-anchor" href="#${escapeHtml(id)}" aria-label="Link to ${escapeHtml(node.text)}"> #</a></h3>`;
    }

    case 'p':
      return `<p>${renderInlineCode(node.text)}</p>`;

    case 'ul': {
      const items = node.items.map((item) => `<li>${renderInlineCode(item)}</li>`).join('');
      return `<ul>${items}</ul>`;
    }

    case 'ol': {
      const items = node.items.map((item) => `<li>${renderInlineCode(item)}</li>`).join('');
      return `<ol>${items}</ol>`;
    }

    case 'dl':
      return renderDlBlock(node);

    case 'callout':
      return renderCalloutBlock(node);

    case 'terminal':
      return renderInlineCodeBlock(node);

    case 'ascii':
      return `<pre class="docs-code-body" style="border:1px solid var(--border);border-left:3px solid var(--muted);padding:1rem .85rem;margin-bottom:1.25rem;background:var(--panel)">${escapeHtml(node.code)}</pre>`;

    case 'table':
      return renderTableBlock(node);

    case 'hr':
      return '<hr />';

    default:
      return '';
  }
}

/* ── Page rendering ──────────────────────────────────────────────────────── */

function renderPage(page) {
  const article = document.getElementById('docs-article');
  if (!article) return;

  const html = page.content.map(renderNode).join('\n');
  article.innerHTML = html;

  renderBreadcrumbs(page);
  renderPageNav(page);
  renderToC(page);
  wireCodeCopy(article);

  // Mobile inline ToC
  renderMobileToC(page);
}

/* ── Mobile inline ToC ───────────────────────────────────────────────────── */

function renderMobileToC(page) {
  // Remove existing
  const existing = document.querySelector('.docs-toc-inline');
  if (existing) existing.remove();

  const headings = page.content.filter((n) => n.type === 'h2' || n.type === 'h3');
  if (headings.length < 2) return;

  const links = headings
    .map((n) => {
      const id = n.id || slugify(n.text);
      const cls = n.type === 'h3' ? ' toc-h3' : '';
      return `<a href="#${escapeHtml(id)}" class="${cls.trim()}">${escapeHtml(n.text)}</a>`;
    })
    .join('');

  const details = document.createElement('details');
  details.className = 'docs-toc-inline';
  details.innerHTML = `<summary>on this page</summary><div class="docs-toc-inline-body">${links}</div>`;

  const article = document.getElementById('docs-article');
  if (article) article.insertAdjacentElement('beforebegin', details);
}

/* ── On-page ToC ─────────────────────────────────────────────────────────── */

let tocObserver = null;

function renderToC(page) {
  const tocNav = document.getElementById('docs-toc-nav');
  if (!tocNav) return;

  const headings = page.content.filter((n) => n.type === 'h2' || n.type === 'h3');

  if (headings.length < 2) {
    tocNav.innerHTML = '<span style="font-size:.75rem;color:var(--muted)">·</span>';
    return;
  }

  const links = headings
    .map((n) => {
      const id = n.id || slugify(n.text);
      const cls = n.type === 'h3' ? ' toc-h3' : '';
      return `<a href="#${escapeHtml(id)}" class="${cls.trim()}" data-toc-id="${escapeHtml(id)}">${escapeHtml(n.text)}</a>`;
    })
    .join('');

  tocNav.innerHTML = links;
  setupToCObserver();
}

function setupToCObserver() {
  if (tocObserver) {
    tocObserver.disconnect();
    tocObserver = null;
  }

  const tocLinks = document.querySelectorAll('#docs-toc-nav a[data-toc-id]');
  if (!tocLinks.length) return;

  tocObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          tocLinks.forEach((link) => link.classList.remove('is-active'));
          const active = document.querySelector(
            `#docs-toc-nav a[data-toc-id="${entry.target.id}"]`,
          );
          if (active) active.classList.add('is-active');
        }
      });
    },
    { rootMargin: '-5% 0px -80% 0px', threshold: 0 },
  );

  document.querySelectorAll('.docs-article h2[id], .docs-article h3[id]').forEach((el) => {
    tocObserver.observe(el);
  });
}

/* ── Prev / Next footer ──────────────────────────────────────────────────── */

function renderPageNav(page) {
  const nav = document.getElementById('docs-page-nav');
  if (!nav) return;

  let html = '';

  if (page.prev) {
    const prev = DOCS_PAGES[page.prev];
    if (prev) {
      html += `
        <a class="docs-page-nav-btn is-prev" href="#${escapeHtml(page.prev)}" aria-label="Previous: ${escapeHtml(prev.title)}">
          <span class="pnb-dir">← previous</span>
          <span class="pnb-title">${escapeHtml(prev.title)}</span>
          <span class="pnb-section">${escapeHtml(prev.section)}</span>
        </a>`;
    }
  } else {
    html += '<span></span>';
  }

  if (page.next) {
    const next = DOCS_PAGES[page.next];
    if (next) {
      html += `
        <a class="docs-page-nav-btn is-next" href="#${escapeHtml(page.next)}" aria-label="Next: ${escapeHtml(next.title)}">
          <span class="pnb-dir">next →</span>
          <span class="pnb-title">${escapeHtml(next.title)}</span>
          <span class="pnb-section">${escapeHtml(next.section)}</span>
        </a>`;
    }
  }

  nav.innerHTML = html;
}

/* ── Code copy buttons ───────────────────────────────────────────────────── */

function wireCodeCopy(container) {
  container.querySelectorAll('.docs-code-copy[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const text = btn.dataset.copy;
      navigator.clipboard.writeText(text).then(() => {
        const original = btn.textContent;
        btn.textContent = '[✓ copied]';
        btn.classList.add('is-copied');
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove('is-copied');
        }, 2000);
      });
    });
  });
}

/* ── Router ──────────────────────────────────────────────────────────────── */

const docsRouter = {
  currentPageId: null,

  init() {
    const hash = location.hash.slice(1) || 'introduction';
    this.navigate(hash, false);

    window.addEventListener('hashchange', () => {
      const id = location.hash.slice(1) || 'introduction';
      this.navigate(id, false);
    });
  },

  navigate(pageId, updateHash = true) {
    const page = DOCS_PAGES[pageId];
    if (!page) {
      this.navigate('introduction', updateHash);
      return;
    }

    this.currentPageId = pageId;

    if (updateHash) {
      history.pushState(null, '', `#${pageId}`);
    }

    document.title = `paqad-ai docs: ${page.title}`;
    renderPage(page);
    updateSidebarActiveState(pageId);
    window.scrollTo({ top: 0, behavior: 'instant' });
  },
};

/* ── Search ──────────────────────────────────────────────────────────────── */

let searchIndex = [];

function extractTextFromNodes(nodes) {
  return nodes
    .map((node) => {
      if (node.text) return node.text;
      if (node.items)
        return Array.isArray(node.items)
          ? node.items.map((i) => (typeof i === 'string' ? i : `${i.term} ${i.def}`)).join(' ')
          : '';
      if (node.code) return node.code;
      if (node.headers) return [...(node.headers || []), ...(node.rows || []).flat()].join(' ');
      return '';
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchIndex() {
  searchIndex = Object.values(DOCS_PAGES).map((page) => ({
    id: page.id,
    title: page.title,
    section: page.section,
    breadcrumb: `${page.section} / ${page.title}`,
    body: extractTextFromNodes(page.content),
    keywords: page.keywords || [],
  }));
}

function search(rawQuery) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];

  const tokens = query.split(/\s+/).filter(Boolean);

  return searchIndex
    .map((entry) => {
      const titleLower = entry.title.toLowerCase();
      const bodyLower = entry.body.toLowerCase();
      const keywordsLower = entry.keywords.map((k) => k.toLowerCase()).join(' ');

      let score = 0;
      tokens.forEach((token) => {
        if (titleLower.includes(token)) score += 3;
        if (keywordsLower.includes(token)) score += 2;
        if (bodyLower.includes(token)) score += 1;
      });

      // Find snippet: find first occurrence of any token in body
      let snippet = '';
      if (score > 0) {
        let idx = -1;
        for (const token of tokens) {
          idx = bodyLower.indexOf(token);
          if (idx !== -1) break;
        }
        if (idx !== -1) {
          const start = Math.max(0, idx - 30);
          const end = Math.min(entry.body.length, idx + 100);
          snippet =
            (start > 0 ? '...' : '') +
            entry.body.slice(start, end) +
            (end < entry.body.length ? '...' : '');
        } else {
          snippet = entry.body.slice(0, 110) + (entry.body.length > 110 ? '...' : '');
        }
      }

      return { ...entry, score, snippet };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}

function highlightQuery(text, query) {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return escapeHtml(text);
  const pattern = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`(${pattern})`, 'gi');
  return escapeHtml(text).replace(re, '<mark>$1</mark>');
}

function wireDriveSearch() {
  const input = document.getElementById('docs-search');
  const results = document.getElementById('docs-search-results');
  if (!input || !results) return;

  let selectedIndex = -1;
  let currentResults = [];

  function showResults(items) {
    currentResults = items;
    selectedIndex = -1;

    if (!items.length) {
      results.innerHTML = `<div class="docs-search-empty">No results found.</div>`;
      results.hidden = false;
      return;
    }

    const query = input.value;
    results.innerHTML = items
      .map(
        (item) => `
      <div
        class="search-result-item"
        role="option"
        data-page-id="${escapeHtml(item.id)}"
        aria-selected="false"
        tabindex="-1"
      >
        <span class="sr-title">${highlightQuery(item.title, query)}</span>
        <span class="sr-breadcrumb">${escapeHtml(item.breadcrumb)}</span>
        <span class="sr-snippet">${highlightQuery(item.snippet, query)}</span>
      </div>`,
      )
      .join('');

    results.hidden = false;

    results.querySelectorAll('.search-result-item').forEach((item) => {
      item.addEventListener('click', () => {
        docsRouter.navigate(item.dataset.pageId);
        clearSearch();
      });
    });
  }

  function clearSearch() {
    input.value = '';
    results.hidden = true;
    results.innerHTML = '';
    selectedIndex = -1;
    currentResults = [];
  }

  function updateSelection(dir) {
    const items = results.querySelectorAll('.search-result-item');
    if (!items.length) return;
    items[selectedIndex]?.setAttribute('aria-selected', 'false');
    selectedIndex = Math.max(0, Math.min(items.length - 1, selectedIndex + dir));
    items[selectedIndex]?.setAttribute('aria-selected', 'true');
    items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener(
    'input',
    debounce(() => {
      const q = input.value.trim();
      if (!q) {
        results.hidden = true;
        return;
      }
      showResults(search(q));
    }, 80),
  );

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      updateSelection(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      updateSelection(-1);
    } else if (e.key === 'Enter') {
      if (selectedIndex >= 0 && currentResults[selectedIndex]) {
        docsRouter.navigate(currentResults[selectedIndex].id);
        clearSearch();
      }
    } else if (e.key === 'Escape') {
      clearSearch();
      input.blur();
    }
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !results.contains(e.target)) {
      results.hidden = true;
    }
  });

  // Global `/` shortcut
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== input) {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
        e.preventDefault();
        input.focus();
        input.select();
      }
    }
  });
}

/* ── Boot ────────────────────────────────────────────────────────────────── */

function init() {
  setupRain();
  setupScrollHeader();
  setupMobileTopNav();
  setupMobileSidebar();
  renderSidebarNav();
  buildSearchIndex();
  wireDriveSearch();
  docsRouter.init();
}

document.addEventListener('DOMContentLoaded', init);
