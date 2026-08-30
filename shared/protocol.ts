// Shared types for XDECK communication protocol

// Action types
export type ActionKind = 'open_app' | 'open_url' | 'hotkey' | 'media_key' | 'run_command' | 'start_app';

export interface Action {
  kind: ActionKind;
  target: string;
  args?: string;
}

// Button definition
export interface Button {
  id: string;
  position: { row: number; col: number };
  label: string;
  icon: string;
  iconSize: 'normal' | 'full';
  action: Action;
}

// Background
export type BackgroundType = 'image' | 'gradient' | 'color';

export interface Background {
  type: BackgroundType;
  value: string;
}

// Grid configuration
export interface GridConfig {
  cols: number;
  rows: number;
}

// Page definition
export interface Page {
  id: string;
  name: string;
  grid: GridConfig;
  background: Background;
  buttons: Button[];
}

// Layout preference
export type LayoutOrientation = 'portrait' | 'landscape' | 'auto';
export type LayoutArea = 'safe' | 'full';

export interface LayoutPreference {
  orientation: LayoutOrientation;
  area: LayoutArea;
}

// Full deck config
export interface DeckConfig {
  pages: Page[];
  layoutPreference: LayoutPreference;
}

// WebSocket message types
export type WSMessage =
  | TriggerMessage
  | ConfigSyncMessage
  | ButtonUpdateMessage
  | TriggerResultMessage
  | PingMessage
  | PongMessage
  | PageUpdateMessage
  | PageDeleteMessage
  | ButtonDeleteMessage
  | BackgroundUpdateMessage
  | GridUpdateMessage
  | LayoutUpdateMessage;

export interface TriggerMessage {
  type: 'trigger';
  buttonId: string;
}

export interface ConfigSyncMessage {
  type: 'config_sync';
  pages: Page[];
  layoutPreference: LayoutPreference;
}

export interface ButtonUpdateMessage {
  type: 'button_update';
  pageId: string;
  button: Button;
}

export interface ButtonDeleteMessage {
  type: 'button_delete';
  pageId: string;
  buttonId: string;
}

export interface TriggerResultMessage {
  type: 'trigger_result';
  buttonId: string;
  ok: boolean;
  error?: string;
}

export interface PingMessage {
  type: 'ping';
}

export interface PongMessage {
  type: 'pong';
}

export interface PageUpdateMessage {
  type: 'page_update';
  page: Page;
}

export interface PageDeleteMessage {
  type: 'page_delete';
  pageId: string;
}

export interface BackgroundUpdateMessage {
  type: 'background_update';
  pageId: string;
  background: Background;
}

export interface GridUpdateMessage {
  type: 'grid_update';
  pageId: string;
  grid: GridConfig;
}

export interface LayoutUpdateMessage {
  type: 'layout_update';
  layoutPreference: LayoutPreference;
}

// Pairing
export interface PairingInfo {
  code: string;
  ip: string;
  port: number;
}

// Device trust
export interface TrustedDevice {
  token: string;
  name: string;
  addedAt: number;
}

// Relay connection
export type RelayMode = 'lan' | 'relay';
export const RELAY_URL = 'wss://xdeck-relay.onrender.com/relay';

export interface RelayAuthMessage {
  type: 'relay_auth';
  licenseKey: string;
  role: 'desktop' | 'phone';
  deviceName: string;
}

export interface RelayAuthOkMessage {
  type: 'relay_auth_ok';
  role: 'desktop' | 'phone';
}

export interface RelayStatusMessage {
  type: 'relay_status';
  connected: boolean;
  peer?: string;
}

export interface RelayErrorMessage {
  type: 'relay_error';
  error: string;
}
