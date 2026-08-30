import { get, set } from 'idb-keyval';
import type { DeckConfig, RelayMode } from '@shared/protocol';

const CONFIG_KEY = 'xdeck-config';
const CONNECTION_KEY = 'xdeck-connection';

export interface ConnectionInfo {
  ip: string;
  port: number;
  code: string;
  mode: RelayMode;
  licenseKey?: string;
}

const DEFAULT_CONFIG: DeckConfig = {
  pages: [
    {
      id: 'p1',
      name: 'Main',
      grid: { cols: 4, rows: 5 },
      background: { type: 'gradient', value: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)' },
      buttons: [],
    },
  ],
  layoutPreference: { orientation: 'auto', area: 'safe' },
};

export const store = {
  async getConfig(): Promise<DeckConfig> {
    const config = await get<DeckConfig>(CONFIG_KEY);
    return config || DEFAULT_CONFIG;
  },

  async saveConfig(config: DeckConfig): Promise<void> {
    await set(CONFIG_KEY, config);
  },

  async getConnection(): Promise<ConnectionInfo | null> {
    return (await get<ConnectionInfo>(CONNECTION_KEY)) || null;
  },

  async saveConnection(info: ConnectionInfo): Promise<void> {
    await set(CONNECTION_KEY, info);
  },

  async clearConnection(): Promise<void> {
    await set(CONNECTION_KEY, null);
  },
};
