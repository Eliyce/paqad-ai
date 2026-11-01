import { PLUGIN_ID } from '@/health/plugin-install.js';

export const PLUGIN_MARKETPLACE_REPO = 'Eliyce/paqad-claude-plugin';
export const PLUGIN_MARKETPLACE_KEY = 'eliyce';

export function pluginSettingsKeys(): {
  extraKnownMarketplaces: Record<string, unknown>;
  enabledPlugins: Record<string, boolean>;
} {
  return {
    extraKnownMarketplaces: {
      [PLUGIN_MARKETPLACE_KEY]: {
        source: { source: 'github', repo: PLUGIN_MARKETPLACE_REPO },
        autoUpdate: true,
      },
    },
    enabledPlugins: { [PLUGIN_ID]: true },
  };
}
