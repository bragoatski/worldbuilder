import { describe, it, expect } from 'vitest';

// The HUD module (src/ketchem/hud.js) loads without a document, and every ability of 5.5 has its one-line rule.
const H = await import('./hud.js');
const R = await import('./rules.js');

describe('ability rules (5.6 hover text)', () => {
  it('names every ability of 5.5 with its three strengths', () => {
    for (const name of Object.keys(R.ABILITIES)) {
      const line = H.ABILITY_RULES[name];
      expect(line, name).toBeTruthy();
      expect(line).toMatch(/\bI\b/); expect(line).toMatch(/\bII\b/); expect(line).toMatch(/\bIII\b/);
    }
    expect(Object.keys(H.ABILITY_RULES)).toHaveLength(Object.keys(R.ABILITIES).length);
  });
  it('hudTick without a document is a no-op', () => { expect(() => H.hudTick(null)).not.toThrow(); });
  it('a card names the creature, its level, type and ability pips', () => {
    const html = H.cardHTML({ id: 7, name: 'Tam', level: 4, elemental: 'Vale', type: 'herbivore', growth: 'G1 12/40', abilityList: [{ name: 'Rivergait', strength: 2 }, { name: 'Pack', strength: 1 }] }, true);
    expect(html).toContain('<b>Tam</b>'); expect(html).toContain('L4'); expect(html).toContain('Vale'); expect(html).toContain('data-glyph="7"');
    expect(html).toContain('Rivergait <i>II</i>'); expect(html).toContain('Pack <i>I</i>'); expect(html).toContain('kc-collar');
    expect(html).toContain(H.ABILITY_RULES.Pack);
  });
});
