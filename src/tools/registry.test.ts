import { describe, expect, it } from 'vitest';
import { searchTools } from './registry.js';

describe('searchTools', () => {
  it('returns nothing for blank queries', () => {
    expect(searchTools('')).toEqual([]);
    expect(searchTools('   ')).toEqual([]);
  });

  it('ranks exact and prefix title matches first', () => {
    const top = searchTools('merge pdfs')[0];
    expect(top?.id).toBe('merge');
    expect(searchTools('sign')[0]?.id).toBe('sign');
    expect(searchTools('compress')[0]?.id).toBe('compress');
  });

  it('understands synonyms users actually type', () => {
    const ppt = searchTools('ppt').map((t) => t.id);
    expect(ppt).toContain('pdf-to-pptx');
    expect(ppt).toContain('pptx-to-pdf');
    expect(searchTools('esign')[0]?.id).toBe('sign');
    expect(searchTools('grayscale')[0]?.id).toBe('invert');
    expect(searchTools('spreadsheet').map((t) => t.id)).toContain('excel-to-pdf');
  });

  it('is case-insensitive and respects the limit', () => {
    expect(searchTools('PDF').length).toBeGreaterThan(5);
    expect(searchTools('pdf', 3)).toHaveLength(3);
  });

  it('finds tools by description words', () => {
    expect(searchTools('password').map((t) => t.id)).toContain('encrypt');
    expect(searchTools('camera').map((t) => t.id)).toContain('scan');
  });
});
