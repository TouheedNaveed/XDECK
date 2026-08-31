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
  backgroundColor?: string;
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
  textColor?: string;
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
  | LayoutUpdateMessage
  | FileUploadMessage
  | FileUploadResultMessage
  | ConfigRequestMessage
  | KeyboardEventMessage
  | MouseEventMessage;

export interface TriggerMessage {
  type: 'trigger';
  buttonId: string;
}

export interface ConfigSyncMessage {
  type: 'config_sync';
  pages: Page[];
  layoutPreference: LayoutPreference;
}

/** Phone → desktop: "send me the authoritative config". Sent on every (re)connect. */
export interface ConfigRequestMessage {
  type: 'config_request';
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
  /** Echoed back in the pong so a sender can measure round-trip time. */
  ts?: number;
}

export interface PongMessage {
  type: 'pong';
  ts?: number;
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

export interface FileUploadMessage {
  type: 'file_upload';
  uploadId: string;
  dir: string;
  filename: string;
  data: string;
}

export interface FileUploadResultMessage {
  type: 'file_upload_result';
  uploadId: string;
  ok: boolean;
  path?: string;
  error?: string;
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

// Keyboard input from phone → desktop
export interface KeyboardEventMessage {
  type: 'keyboard_event';
  /** 'key' for key combo press, 'text' for typing a string */
  action: 'key' | 'text';
  /** For 'key': xdotool-style combo like 'ctrl+c', 'Return', 'BackSpace' */
  /** For 'text': the literal string to type */
  value: string;
}

// Mouse/trackpad input from phone → desktop
export interface MouseEventMessage {
  type: 'mouse_event';
  action: 'move' | 'click' | 'scroll' | 'drag';
  /** For 'move'/'drag': relative delta pixels */
  dx?: number;
  dy?: number;
  /** For 'click': button number (1=left, 2=middle, 3=right) */
  button?: number;
  /** For 'scroll': vertical scroll amount */
  scrollY?: number;
  /** For 'click': true = mouseDown, false = mouseUp */
  down?: boolean;
}
