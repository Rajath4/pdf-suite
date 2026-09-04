import { describe, expect, it } from 'vitest';
import { TOOLS, TOOL_SLUGS } from '../tools/registry.js';
import SEO from '../seo/content.json';

interface ToolEntry {
  id: string;
  slug: string;
  title: string;
  description: string;
  h1: string;
  intro: string;
  steps: string[];
  faqs: [string, string][];
}

const tools = SEO.tools as ToolEntry[];

describe('SEO content library', () => {
  it('covers every registered tool exactly once', () => {
    const ids = tools.map((t) => t.id).sort();
    expect(ids).toEqual(TOOLS.map((t) => t.id).sort());
  });

  it('uses the canonical slugs from the router', () => {
    for (const t of tools) {
      expect(t.slug, t.id).toBe(TOOL_SLUGS[t.id]);
    }
    expect(new Set(tools.map((t) => t.slug)).size).toBe(tools.length);
    for (const t of tools) {
      expect(t.slug, t.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('keeps titles unique and within SERP length', () => {
    const titles = tools.map((t) => t.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const t of tools) {
      expect(t.title.length, t.id).toBeLessThanOrEqual(65);
      expect(t.title.length, t.id).toBeGreaterThan(20);
    }
  });

  it('keeps descriptions unique and snippet-sized', () => {
    const descs = tools.map((t) => t.description);
    expect(new Set(descs).size).toBe(descs.length);
    for (const t of tools) {
      expect(t.description.length, t.id).toBeGreaterThanOrEqual(100);
      expect(t.description.length, t.id).toBeLessThanOrEqual(170);
    }
  });

  it('guarantees substantive bodies (anti-thin-content gate)', () => {
    for (const t of tools) {
      expect(t.h1.length, t.id).toBeGreaterThan(15);
      expect(t.intro.length, t.id).toBeGreaterThanOrEqual(100);
      expect(t.steps.length, t.id).toBeGreaterThanOrEqual(3);
      expect(t.faqs.length, t.id).toBeGreaterThanOrEqual(3);
      for (const [q, a] of t.faqs) {
        expect(q.endsWith('?'), `${t.id}: ${q}`).toBe(true);
        expect(a.length, `${t.id}: ${q}`).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it('has a valid home entry', () => {
    const home = SEO.home as unknown as { title: string; description: string; h1: string; intro: string; faqs: [string, string][]; points: [string, string, string][] };
    expect(home.title.length).toBeLessThanOrEqual(65);
    expect(home.description.length).toBeGreaterThanOrEqual(100);
    expect(home.faqs.length).toBeGreaterThanOrEqual(3);
    expect(home.points.length).toBeGreaterThanOrEqual(4);
    for (const [label, typical, ours] of home.points) {
      expect(label.length).toBeGreaterThan(3);
      expect(typical.length).toBeGreaterThan(10);
      expect(ours.length).toBeGreaterThan(5);
    }
  });
});
