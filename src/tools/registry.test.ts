import { describe, expect, it } from 'vitest';
import { TOOLS, searchTools, nextTools, NEXT_TOOLS } from './registry.js';

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

describe('nextTools chaining', () => {
  it('covers every tool with valid, non-self targets', () => {
    const ids = new Set(TOOLS.map((t) => t.id));
    for (const t of TOOLS) {
      const next = nextTools(t.id);
      expect(next.length, t.id).toBeGreaterThan(0);
      expect(next.length, t.id).toBeLessThanOrEqual(3);
      for (const n of next) {
        expect(ids.has(n.id), `${t.id} → ${n.id}`).toBe(true);
        expect(n.id, `${t.id} self-link`).not.toBe(t.id);
      }
    }
    for (const [from, tos] of Object.entries(NEXT_TOOLS)) {
      expect(ids.has(from), `NEXT key ${from}`).toBe(true);
      for (const to of tos) expect(ids.has(to), `${from} → ${to}`).toBe(true);
    }
  });
});
