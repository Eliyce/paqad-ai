import { useCallback, useEffect, useState } from 'react';

import { DashboardChrome } from '../components/DashboardChrome';
import { OwnershipBadge } from '../components/OwnershipBadge';
import { WhyDrawer } from '../components/WhyDrawer';
import { WhySentence } from '../components/WhySentence';
import { fetchDashboard, fetchInventory } from '../lib/api';
import { PAGE_WHY, WHY_DRAWER, type WhyDrawerCopy } from '../lib/copy';
import type { DashboardArea, InventoryClass, InventoryItem } from '../lib/dashboard-types';
import { useHashRoute } from '../lib/router';

interface Props {
  area: Extract<DashboardArea, 'build' | 'automation' | 'knowledge' | 'setup'>;
  title: string;
  /** Optional area-specific panel rendered after the inventory groups. */
  extra?: React.ReactNode;
}

/** Per-class caption under each card. Honest about what the page can do. */
const CLASS_CAPTION: Record<InventoryClass, string | null> = {
  web: 'Editable here soon. For now the CLI and your editor remain the path.',
  prompt: 'Lives in the conversation. This page shows status.',
  evidence: 'View only, by design.',
  operation: null,
};

interface EditAction {
  label: string;
  route: string;
}

/**
 * Web-class items with a real editor in the dashboard. A card listed here
 * swaps the "editable here soon" caption for the action; everything else
 * keeps the honest caption until its editor ships.
 */
const EDIT_ACTIONS: Record<string, EditAction> = {
  'delivery-policy': { label: 'Edit the policy', route: '#/delivery-policy' },
  instructions: { label: 'Open the editor', route: '#/instructions' },
  'module-map': { label: 'Edit the map', route: '#/module-map' },
  'design-tokens': { label: 'Open the token editor', route: '#/design-tokens' },
};

/** Exported so SetupView can render the same cards for its evidence items. */
export function ItemCard({
  item,
  onWhy,
}: {
  item: InventoryItem;
  onWhy: (item: InventoryItem) => void;
}) {
  const action = EDIT_ACTIONS[item.key];
  const caption = action ? null : CLASS_CAPTION[item.class];
  return (
    <div
      className="flex flex-col rounded-[10px] p-4"
      style={{ background: 'var(--color-surface)', color: 'var(--color-canvas-fg)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-body font-medium">{item.name}</div>
        <OwnershipBadge managedBy={item.managedBy} />
      </div>
      <WhySentence>{item.why}</WhySentence>
      <div
        className="mt-2 text-secondary"
        style={{ color: item.state.exists ? 'var(--color-canvas-fg)' : 'var(--color-muted)' }}
      >
        {item.state.detail}
      </div>
      {caption && (
        <div className="mt-2 text-caption" style={{ color: 'var(--color-muted)' }}>
          {caption}
        </div>
      )}
      {action && (
        <div className="mt-3">
          <button
            type="button"
            className="rounded-[6px] border px-3 py-1.5 text-secondary font-medium"
            style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}
            onClick={() => {
              window.location.hash = action.route.replace(/^#/, '');
            }}
          >
            {action.label}
          </button>
        </div>
      )}
      <div className="mt-3">
        <button
          type="button"
          className="text-caption"
          style={{ color: 'var(--color-accent)' }}
          onClick={() => onWhy(item)}
        >
          Why this matters
        </button>
      </div>
    </div>
  );
}

/**
 * Generic area page (issue #146) powering Build, Automation, Knowledge
 * and Setup. Inventory cards grouped by the management rule: you manage
 * the web class, Paqad runs prompt and operation, evidence is view only.
 */
export function AreaView({ area, title, extra }: Props) {
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sseLive, setSseLive] = useState(false);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [frameworkVersion, setFrameworkVersion] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ title: string; copy: WhyDrawerCopy } | null>(null);
  const { navigate } = useHashRoute();

  const loadInventory = useCallback((): void => {
    fetchInventory()
      .then((report) => {
        setItems(report.items.filter((item) => item.area === area));
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [area]);

  useEffect(() => {
    loadInventory();
    fetchDashboard()
      .then((report) => {
        setProjectName(report.projectName);
        setFrameworkVersion(report.frameworkVersion);
      })
      .catch(() => {
        // chrome placeholders are fine; the inventory error is the one that matters
      });
  }, [loadInventory]);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.addEventListener('open', () => setSseLive(true));
    source.addEventListener('error', () => setSseLive(false));
    source.addEventListener('dashboard-updated', () => loadInventory());
    return () => {
      source.close();
    };
  }, [loadInventory]);

  const openWhy = (item: InventoryItem): void => {
    const copy = WHY_DRAWER[item.key] ?? {
      problem: item.why,
      benefit: item.why,
      without: '',
    };
    setDrawer({ title: item.name, copy });
  };

  const groups: { heading: string; members: InventoryItem[] }[] = items
    ? [
        { heading: 'You manage', members: items.filter((i) => i.class === 'web') },
        {
          heading: 'Paqad runs',
          members: items.filter((i) => i.class === 'prompt' || i.class === 'operation'),
        },
        { heading: 'Evidence', members: items.filter((i) => i.class === 'evidence') },
      ].filter((group) => group.members.length > 0)
    : [];

  return (
    <DashboardChrome
      projectName={projectName}
      frameworkVersion={frameworkVersion}
      sseLive={sseLive}
    >
      <div className="mx-auto w-full max-w-4xl p-6">
        <h1 className="text-page font-semibold">{title}</h1>
        <WhySentence>{PAGE_WHY[area]}</WhySentence>

        {error && (
          <div
            className="mt-4 rounded-[10px] border p-4 text-secondary"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-mod-red)' }}
          >
            Could not load this area: {error}
          </div>
        )}

        {area === 'build' && (
          <div
            className="mt-6 flex items-center justify-between gap-3 rounded-[10px] p-4"
            style={{ background: 'var(--color-surface)' }}
          >
            <div className="min-w-0">
              <div className="text-body font-medium">Architecture graph</div>
              <WhySentence>
                Every module, file and connection, drawn from the code itself.
              </WhySentence>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-[6px] border px-3 py-1.5 text-secondary font-medium"
              style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}
              onClick={() => navigate('graph')}
            >
              Open the graph
            </button>
          </div>
        )}

        {groups.map((group) => (
          <section key={group.heading} className="mt-8">
            <h2 className="text-section font-medium">{group.heading}</h2>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {group.members.map((item) => (
                <ItemCard key={item.key} item={item} onWhy={openWhy} />
              ))}
            </div>
          </section>
        ))}

        {extra}

        {items && items.length === 0 && !error && (
          <div className="mt-6 text-secondary" style={{ color: 'var(--color-muted)' }}>
            Nothing lives in this area yet.
          </div>
        )}
        {!items && !error && (
          <div className="mt-6 text-secondary" style={{ color: 'var(--color-muted)' }}>
            Loading…
          </div>
        )}
      </div>

      {drawer && (
        <WhyDrawer
          title={drawer.title}
          problem={drawer.copy.problem}
          benefit={drawer.copy.benefit}
          without={drawer.copy.without}
          docsHref={drawer.copy.docsHref}
          onClose={() => setDrawer(null)}
        />
      )}
    </DashboardChrome>
  );
}
