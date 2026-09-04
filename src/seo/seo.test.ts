import { describe, expect, it } from 'vitest';
import { TOOLS, TOOL_SLUGS } from '../tools/registry.js';
import SEO from '../seo/content.json';
import GUIDES_JSON from '../seo/guides.json';

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

interface GuideEntry {
  slug: string;
  title: string;
  description: string;
  h1: string;
  category: string;
  updated: string;
  intro: string[];
  sections: { h2: string; body: string[] }[];
  steps: string[];
  tips: string[];
  faqs: [string, string][];
  relatedTools: string[];
  relatedGuides: string[];
}

const guides = (GUIDES_JSON as unknown as { guides: GuideEntry[] }).guides;

describe('Guides library (content velocity)', () => {
  it('has a healthy cluster size with unique slugs/titles/descriptions', () => {
    expect(guides.length).toBeGreaterThanOrEqual(10);
    expect(new Set(guides.map((g) => g.slug)).size).toBe(guides.length);
    expect(new Set(guides.map((g) => g.title)).size).toBe(guides.length);
    expect(new Set(guides.map((g) => g.description)).size).toBe(guides.length);
    for (const g of guides) {
      expect(g.slug, g.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(g.updated, g.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('keeps SERP lengths for every guide', () => {
    for (const g of guides) {
      expect(g.title.length, g.slug).toBeLessThanOrEqual(65);
      expect(g.title.length, g.slug).toBeGreaterThan(20);
      expect(g.description.length, g.slug).toBeGreaterThanOrEqual(100);
      expect(g.description.length, g.slug).toBeLessThanOrEqual(170);
      expect(g.h1.length, g.slug).toBeGreaterThan(15);
    }
  });

  it('guarantees substantive bodies (anti-thin-content gate)', () => {
    for (const g of guides) {
      expect(g.intro.length, g.slug).toBeGreaterThanOrEqual(1);
      expect(g.sections.length, g.slug).toBeGreaterThanOrEqual(2);
      expect(g.steps.length, g.slug).toBeGreaterThanOrEqual(3);
      expect(g.faqs.length, g.slug).toBeGreaterThanOrEqual(3);
      for (const s of g.sections) {
        expect(s.h2.length, g.slug).toBeGreaterThan(10);
        expect(s.body.join(' ').length, g.slug).toBeGreaterThan(80);
      }
      for (const [q, a] of g.faqs) {
        expect(q.endsWith('?'), `${g.slug}: ${q}`).toBe(true);
        expect(a.length, `${g.slug}: ${q}`).toBeGreaterThanOrEqual(40);
      }
      const words = [...g.intro, ...g.sections.flatMap((s) => [s.h2, ...s.body]), ...g.steps, ...g.tips, ...g.faqs.flat()]
        .join(' ')
        .split(/\s+/).length;
      expect(words, g.slug).toBeGreaterThanOrEqual(200);
    }
  });

  it('cross-links only to real tools and guides (no dead ends)', () => {
    const slugs = new Set(guides.map((g) => g.slug));
    const toolIds = new Set(TOOLS.map((t) => t.id));
    for (const g of guides) {
      expect(g.relatedTools.length, g.slug).toBeGreaterThanOrEqual(2);
      for (const id of g.relatedTools) {
        expect(toolIds.has(id), `${g.slug} → tool ${id}`).toBe(true);
        expect(TOOL_SLUGS[id], `${g.slug} → tool ${id}`).toBeTruthy();
      }
      for (const gs of g.relatedGuides) {
        expect(slugs.has(gs), `${g.slug} → guide ${gs}`).toBe(true);
      }
    }
  });
});
