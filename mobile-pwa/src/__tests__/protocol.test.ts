import { describe, it, expect } from 'vitest';
import type { Button, Page, DeckConfig, Action, GridConfig, Background, LayoutPreference } from '../../../shared/protocol';

describe('Protocol types', () => {
  it('Action kinds include new types', () => {
    const kinds: Action['kind'][] = ['open_url', 'open_app', 'hotkey', 'media_key', 'run_command'];
    expect(kinds).toContain('open_url');
    expect(kinds).toContain('hotkey');
    expect(kinds).toContain('media_key');
    expect(kinds).toContain('run_command');
  });

  it('Button has required fields', () => {
    const btn: Button = {
      id: 'btn_001',
      position: { row: 0, col: 0 },
      label: 'Test',
      icon: '',
      iconSize: 'normal',
      action: { kind: 'open_url', target: 'https://example.com' },
    };
    expect(btn.id).toBe('btn_001');
    expect(btn.position.row).toBe(0);
    expect(btn.action.kind).toBe('open_url');
  });

  it('GridConfig has cols and rows', () => {
    const grid: GridConfig = { cols: 4, rows: 3 };
    expect(grid.cols).toBe(4);
    expect(grid.rows).toBe(3);
  });

  it('Background supports gradient, image, and color', () => {
    const gradient: Background = { type: 'gradient', value: 'linear-gradient(135deg, #000, #fff)' };
    const image: Background = { type: 'image', value: '/uploads/bg.png' };
    const color: Background = { type: 'color', value: '#1a1a2e' };
    expect(gradient.type).toBe('gradient');
    expect(image.type).toBe('image');
    expect(color.type).toBe('color');
  });

  it('LayoutPreference has orientation and area', () => {
    const layout: LayoutPreference = { orientation: 'landscape', area: 'full' };
    expect(layout.orientation).toBe('landscape');
    expect(layout.area).toBe('full');
  });

  it('DeckConfig has pages and layoutPreference', () => {
    const config: DeckConfig = {
      pages: [],
      layoutPreference: { orientation: 'auto', area: 'safe' },
    };
    expect(config.pages).toEqual([]);
    expect(config.layoutPreference.orientation).toBe('auto');
  });

  it('Page has grid with default sizes', () => {
    const page: Page = {
      id: 'p1',
      name: 'Main',
      grid: { cols: 4, rows: 5 },
      background: { type: 'gradient', value: '#000' },
      buttons: [],
    };
    expect(page.grid.cols).toBe(4);
    expect(page.grid.rows).toBe(5);
    expect(page.buttons).toHaveLength(0);
  });
});
