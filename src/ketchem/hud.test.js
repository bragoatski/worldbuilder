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

describe('icons, sound and the question bar (finishing pass 2026-10-26)', () => {
  it('every ability has an icon and a card pip carries it', () => {
    for (const name of Object.keys(R.ABILITIES)) { expect(H.ABILITY_ICON[name], name).toBeTruthy(); expect(H.abilityIcon(name)).toContain('<svg'); }
    expect(H.cardHTML({ id: 1, name: 'Tam', level: 2, elemental: 'Vale', type: 'herbivore', growth: 'G0 0/10', abilityList: [{ name: 'Rivergait', strength: 1 }] }, false)).toContain('<svg class="kc-ic"');
  });
  it('the sound and question modules load and stay quiet without a page', async () => {
    const S = await import('./sound.js'); const A = await import('./ask.js');
    expect(() => S.soundTick({ fx: [{ kind: 'throw', start: 0, wobbles: 0, caught: true, to: { x: 0, y: 0 } }], kevin: { x: 0, y: 0 } })).not.toThrow();
    expect(await A.ask('name?')).toBeNull();
    const was = S.soundOn(); S.toggleSound(); expect(S.soundOn()).toBe(!was); S.toggleSound();
  });
});

describe('the sounds land with their animation (critic 2026-10-26)', () => {
  it('a catch clicks after three wobbles, a break bursts, a warning pulse growls, and only in sight', async () => {
    const S = await import('./sound.js');
    const K = { kevin: { x: 10, y: 10, effects: [] } };
    const thr = (wobbles, caught, x = 11) => ({ kind: 'throw', wobbles, caught, to: { x, y: 10 } });
    expect(S.soundFor(K, thr(3, true), 41)).toBe('wait'); expect(S.soundFor(K, thr(3, true), 42)).toBe('click');
    expect(S.soundFor(K, thr(1, false), 22)).toBe('burst'); expect(S.soundFor(K, thr(3, true), 60)).toBeNull();
    expect(S.soundFor(K, thr(3, true, 15), 42)).toBeNull();
    expect(S.soundFor(K, { kind: 'pulse', x: 12, y: 12 }, 0)).toBe('growl'); expect(S.soundFor(K, { kind: 'pulse', x: 15, y: 10 }, 0)).toBeNull();
    K.kevin.effects = [{ potion: 'Hawkeye', until: 1e9 }]; expect(S.soundFor(K, { kind: 'pulse', x: 15, y: 10 }, 0)).toBe('growl');
  });
});
