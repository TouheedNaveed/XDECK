import { describe, it, expect } from 'vitest';
import en from '../i18n/en';
import es from '../i18n/es';

describe('i18n translations', () => {
  it('English and Spanish have same keys', () => {
    const enKeys = Object.keys(en).sort();
    const esKeys = Object.keys(es).sort();
    expect(esKeys).toEqual(enKeys);
  });

  it('All keys are non-empty strings', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
      expect(key).not.toBe(value); // key should not equal value (means it was translated)
    }
    for (const [, value] of Object.entries(es)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('No placeholder tokens left untranslated', () => {
    // Check that {count} placeholders exist in both locales for keys that use them
    for (const [key, value] of Object.entries(en)) {
      const placeholders = value.match(/\{(\w+)\}/g);
      if (placeholders) {
        for (const ph of placeholders) {
          expect(es[key]).toContain(ph);
        }
      }
    }
  });

  it('App name is the same in all locales', () => {
    expect(en['app.name']).toBe('XDECK');
    expect(es['app.name']).toBe('XDECK');
  });
});
