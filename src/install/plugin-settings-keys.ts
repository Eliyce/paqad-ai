import { PLUGIN_ID } from '@/health/plugin-install.js';

export const PLUGIN_MARKETPLACE_REPO = 'Eliyce/paqad-claude-plugin';
export const PLUGIN_MARKETPLACE_KEY = 'eliyce';

// FR-31, FR-33: autoUpdate comes from the resolved team policy. No `ref` is
// written: the D4 check could not confirm that Claude Code honours a ref on an
// extraKnownMarketplaces GitHub source, so a pin is expressed as autoUpdate false.
export function pluginSettingsKeys(autoUpdate: boolean): {
  extraKnownMarketplaces: Record<string, unknown>;
  enabledPlugins: Record<string, boolean>;
} {
  return {
    extraKnownMarketplaces: {
      [PLUGIN_MARKETPLACE_KEY]: {
        source: { source: 'github', repo: PLUGIN_MARKETPLACE_REPO },
        autoUpdate,
      },
    },
    enabledPlugins: { [PLUGIN_ID]: true },
  };
}
