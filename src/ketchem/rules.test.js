import { describe, it, expect } from 'vitest';
import * as R from './rules.js';

// The worked examples of docs/01 Design/Ketch'em Mechanics.md, sections 3, 3b, 4, 5, 8 and 10, as fixtures.
// A creature is a plain object shaped like sim.makeFauna's output; every pref not named sits at 5 (no type), so the
// named axis is the only one that can type it. hue 100 is chosen so the species rolls land where the section 10 table
// needs them (one ability on rows 2 and 5, two on row 4); the rolls are pinned below so a hash change is caught.
function creature(o) {
  return { type: 'herbivore', prefArid: 5, prefTemp: 5, prefSL: 5, prefElev: 5, tolerance: 3, size: 1, vivid: false,
    hue: 100, energy: 80, maxEnergy: 100, age: 50, maxAge: 100, gen: 0, ...o };
}
const YOUNG = { age: 10, maxAge: 100 }, OLD = { age: 90, maxAge: 100 };

// The six creatures of the section 4 table, reused by section 10 (same rows, same order).
const ROWS = [
  { name: 'common prime grazer, Plain, sz 1.0, N 40', f: creature({}), N: 40,
    level: { low: 1, tp: 0, size: 0, rarity: 0, age: 0 }, L: 1, raw: 1,
    price: { base: 10, levelF: 1.0, populationF: 0.8, typeF: 1.0, sizeF: 1.0, abilityF: 1.4, conditionF: 1.0, elderF: 1.0 }, coins: 11 },
  { name: 'prime Dune grazer (A 9.5), sz 1.3, N 20', f: creature({ prefArid: 9.5, size: 1.3 }), N: 20,
    level: { low: 1, tp: 2, size: 1, rarity: 0, age: 0 }, L: 4, raw: 4,
    price: { base: 10, levelF: 1.9, populationF: 1.0, typeF: 1.5, sizeF: 1.3, abilityF: 1.4, conditionF: 1.0, elderF: 1.0 }, coins: 52 },
  { name: 'young Frost scavenger (P 2), sz 1.0, N 8', f: creature({ type: 'scavenger', prefTemp: 2, ...YOUNG }), N: 8,
    level: { low: 2, tp: 1, size: 0, rarity: 1, age: -1 }, L: 3, raw: 3,
    price: { base: 20, levelF: 1.3, populationF: 1.5, typeF: 2.5, sizeF: 1.0, abilityF: 1.4, conditionF: 0.8, elderF: 1.0 }, coins: 109 },
  { name: 'prime omnivore Plain, sz 1.7, N 3 (vivid, two abilities)', f: creature({ type: 'omnivore', size: 1.7, vivid: true }), N: 3,
    level: { low: 3, tp: 0, size: 2, rarity: 2, age: 0 }, L: 7, raw: 7,
    price: { base: 30, levelF: 2.2, populationF: 2.5, typeF: 1.0, sizeF: 1.7, abilityF: 1.96, conditionF: 1.0, elderF: 1.0 }, coins: 550 },
  { name: 'prime Shade carnivore (S 1), sz 1.0, N 15', f: creature({ type: 'carnivore', prefSL: 1 }), N: 15,
    level: { low: 5, tp: 2, size: 0, rarity: 0, age: 0 }, L: 7, raw: 7,
    price: { base: 60, levelF: 1.6, populationF: 1.0, typeF: 1.5, sizeF: 1.0, abilityF: 1.4, conditionF: 1.0, elderF: 1.0 }, coins: 202 },
  { name: 'old apex Ember (P 8), sz 1.3, N 2, gen 9, two abilities', f: creature({ type: 'apex', prefTemp: 8, size: 1.3, gen: 9, ...OLD }), N: 2,
    level: { low: 8, tp: 1, size: 1, rarity: 3, age: -1 }, L: 10, raw: 12,
    price: { base: 150, levelF: 1.6, populationF: 4.0, typeF: 4.0, sizeF: 1.3, abilityF: 1.96, conditionF: 0.7, elderF: 1.5 }, coins: 10274 },
];

describe('ketchem rules: elemental type (mechanics 3)', () => {
  it('types by the axis of largest deviation, with the A, P, S, E tie-break, else Plain', () => {
    expect(R.elementalType(creature({ prefArid: 9 })).typ).toBe('Dune');
    expect(R.elementalType(creature({ prefArid: 1 })).typ).toBe('Marsh');
    expect(R.elementalType(creature({ prefTemp: 8 })).typ).toBe('Ember');
    expect(R.elementalType(creature({ prefTemp: 2 })).typ).toBe('Frost');
    expect(R.elementalType(creature({ prefSL: 7 })).typ).toBe('Sun');
    expect(R.elementalType(creature({ prefSL: 3 })).typ).toBe('Shade');
    expect(R.elementalType(creature({ prefElev: 10 })).typ).toBe('Peak');
    expect(R.elementalType(creature({ prefElev: 0 })).typ).toBe('Vale');
    expect(R.elementalType(creature({ prefArid: 6.9, prefTemp: 3.1, prefSL: 6.5, prefElev: 3.5 })).typ).toBe('Plain');
    expect(R.elementalType(creature({ prefArid: 8, prefTemp: 8 })).typ).toBe('Dune');          // tie: A before P
    expect(R.elementalType(creature({ prefSL: 2, prefElev: 8 })).typ).toBe('Shade');           // tie: S before E
    expect(R.elementalType(creature({ prefArid: 7.5, prefElev: 0.5 })).typ).toBe('Vale');      // larger deviation wins
    expect(R.elementalType(creature({ prefElev: undefined })).typ).toBe('Plain');             // legacy creature: E reads 5
  });
  it('closeness and type points follow the section 3 bands on both sides', () => {
    const tp = p => R.elementalType(creature({ prefArid: p })).tp;
    expect(tp(10)).toBe(2); expect(tp(8.75)).toBe(2); expect(tp(8.74)).toBe(1); expect(tp(7)).toBe(1);
    expect(tp(0)).toBe(2); expect(tp(1.25)).toBe(2); expect(tp(1.26)).toBe(1); expect(tp(3)).toBe(1);
    expect(R.elementalType(creature({ prefArid: 9.5 }))).toMatchObject({ typ: 'Dune', d: 0.5, c: 0.9, tp: 2 });
    expect(R.elementalType(creature({ prefTemp: 2 }))).toMatchObject({ typ: 'Frost', d: 2, c: 0.6, tp: 1 });
    expect(R.elementalType(creature({}))).toMatchObject({ typ: 'Plain', c: 0, tp: 0 });
  });
  it('a typed creature always has tp 1 or 2 (elemental abilities are II or III only)', () => {
    for (let p = 0; p <= 10; p += 0.05) {
      const e = R.elementalType(creature({ prefArid: p }));
      if (e.typ !== 'Plain') expect(e.tp).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('ketchem rules: rarity (mechanics 3b)', () => {
  it('population rarity bands', () => {
    const band = N => R.populationRarity(N);
    expect(band(1)).toMatchObject({ reading: 'last of its kind', levelBonus: 3, priceF: 4.0 });
    expect(band(2).reading).toBe('last of its kind');
    expect(band(3)).toMatchObject({ reading: 'endangered', levelBonus: 2, priceF: 2.5 });
    expect(band(5).reading).toBe('endangered');
    expect(band(6)).toMatchObject({ reading: 'scarce', levelBonus: 1, priceF: 1.5 });
    expect(band(12).reading).toBe('scarce');
    expect(band(13)).toMatchObject({ reading: 'established', levelBonus: 0, priceF: 1.0 });
    expect(band(30).reading).toBe('established');
    expect(band(31)).toMatchObject({ reading: 'abundant', levelBonus: 0, priceF: 0.8 });
    expect(band(0).reading).toBe('last of its kind');   // the creature being read is itself alive
  });
  it('type rarity is the fixed habitat table', () => {
    const cls = { Plain: 'common', Sun: 'common', Dune: 'uncommon', Marsh: 'uncommon', Shade: 'uncommon', Vale: 'uncommon',
      Frost: 'rare', Peak: 'rare', Ember: 'very rare' };
    const F = { common: 1.0, uncommon: 1.5, rare: 2.5, 'very rare': 4.0 };
    for (const [typ, c] of Object.entries(cls)) expect(R.typeRarity(typ)).toEqual({ cls: c, priceF: F[c] });
  });
  it('the two combine on price only: a last-of-its-kind Ember is x16, an abundant Plain x0.8', () => {
    expect(R.rarity(2, 'Ember').priceF).toBe(16);
    expect(R.rarity(40, 'Plain').priceF).toBe(0.8);
    expect(R.rarity(40, 'Ember').levelBonus).toBe(0);
  });
  it('N counts the living members sharing the key; nulls (the sim\'s dead slots) are skipped', () => {
    const key = f => f.type + '|' + Math.floor(f.hue / 20);
    const list = [creature({ hue: 10 }), null, creature({ hue: 15 }), creature({ hue: 50 }), creature({ type: 'apex', hue: 10 })];
    expect(R.populationOf(creature({ hue: 5 }), list, key)).toBe(2);
    expect(R.populationOf(creature({ hue: 100 }), list, key)).toBe(0);
  });
});

describe('ketchem rules: level (mechanics 4)', () => {
  for (const row of ROWS) {
    it(row.name + ' is L' + row.L, () => {
      const lv = R.levelTerms(row.f, row.N);
      expect(lv.terms).toEqual(row.level);
      expect(lv.raw).toBe(row.raw);
      expect(lv.L).toBe(row.L);
      expect(R.levelOf(row.f, row.N)).toBe(row.L);
    });
  }
  it('size bands and the age words', () => {
    expect(R.sizeTerm(1.6)).toBe(2); expect(R.sizeTerm(1.59)).toBe(1); expect(R.sizeTerm(1.25)).toBe(1);
    expect(R.sizeTerm(1.24)).toBe(0); expect(R.sizeTerm(0.81)).toBe(0); expect(R.sizeTerm(0.8)).toBe(-1);
    expect(R.ageWord(creature(YOUNG))).toBe('young'); expect(R.ageWord(creature(OLD))).toBe('old');
    expect(R.ageWord(creature({ age: 20, maxAge: 100 }))).toBe('prime'); expect(R.ageWord(creature({ age: 80, maxAge: 100 }))).toBe('prime');
    expect(R.energyWord(creature({ energy: 24 }))).toBe('starving'); expect(R.energyWord(creature({ energy: 25 }))).toBe('hungry');
    expect(R.energyWord(creature({ energy: 50 }))).toBe('fed');
  });
  it('clamps to 1-10 at both ends', () => {
    expect(R.levelOf(creature({ size: 0.5, ...YOUNG }), 40)).toBe(1);        // raw -1
    expect(R.levelOf(creature({ type: 'apex', prefTemp: 10, size: 2 }), 1)).toBe(10);   // raw 15
  });
});

describe('ketchem rules: abilities (mechanics 5)', () => {
  it('a Plain, small, dull, low-tolerance creature has pool [trophic I] and never two, even at L10', () => {
    for (let L = 1; L <= 10; L++) {
      const a = R.abilitiesOf(creature({}), L);
      expect(a.pool).toEqual([{ name: 'Forager', family: 'trophic', strength: 1 }]);
      expect(a.abilities).toHaveLength(1);
    }
    expect(R.abilitiesOf(creature({ type: 'scavenger' }), 5).pool[0].name).toBe('Scrounge');
    expect(R.abilitiesOf(creature({ type: 'omnivore' }), 5).pool[0].name).toBe('Nose');
    expect(R.abilitiesOf(creature({ type: 'carnivore' }), 5).pool[0].name).toBe('Guard');
    expect(R.abilitiesOf(creature({ type: 'apex' }), 5).pool[0].name).toBe('Dread');
  });
  it('a typed creature with tp 2 has at least elemental III and trophic III in its pool', () => {
    const a = R.abilitiesOf(creature({ type: 'carnivore', prefSL: 1 }), 1);
    expect(a.pool.slice(0, 2)).toEqual([
      { name: 'Stalk', family: 'elemental', strength: 3 }, { name: 'Guard', family: 'trophic', strength: 3 }]);
  });
  it('a typed creature with tp 1 has elemental II and no trophic ability', () => {
    const a = R.abilitiesOf(creature({ type: 'scavenger', prefTemp: 2 }), 10);
    expect(a.pool).toEqual([{ name: 'Furcoat', family: 'elemental', strength: 2 }]);
    expect(a.abilities).toHaveLength(1);
  });
  it('each elemental type carries its own ability', () => {
    const of = o => R.abilitiesOf(creature(o), 1).pool[0].name;
    expect(of({ prefArid: 10 })).toBe('Waterless'); expect(of({ prefArid: 0 })).toBe('Wader');
    expect(of({ prefTemp: 10 })).toBe('Firewalk'); expect(of({ prefTemp: 0 })).toBe('Furcoat');
    expect(of({ prefSL: 10 })).toBe('Farsight'); expect(of({ prefSL: 0 })).toBe('Stalk');
    expect(of({ prefElev: 10 })).toBe('Climber'); expect(of({ prefElev: 0 })).toBe('Rivergait');
  });
  it('trophic abilities at II never occur; the fallback is always I', () => {
    for (const type of Object.keys(R.TROPHIC)) for (let p = 0; p <= 10; p += 0.25) {
      for (const ab of R.abilitiesOf(creature({ type, prefArid: p }), 10).pool) {
        if (ab.family === 'trophic') expect(ab.strength).not.toBe(2);
      }
    }
  });
  it('trait strengths: Pack by size, Lure by tp, Hardy by tolerance', () => {
    const pack = sz => R.abilitiesOf(creature({ size: sz }), 1).pool.find(a => a.name === 'Pack');
    expect(pack(1.24)).toBeUndefined(); expect(pack(1.25).strength).toBe(1); expect(pack(1.59).strength).toBe(1);
    expect(pack(1.6).strength).toBe(2); expect(pack(1.99).strength).toBe(2); expect(pack(2.0).strength).toBe(3);
    const lure = o => R.abilitiesOf(creature({ vivid: true, ...o }), 1).pool.find(a => a.name === 'Lure');
    expect(lure({}).strength).toBe(1); expect(lure({ prefTemp: 2 }).strength).toBe(2); expect(lure({ prefTemp: 0 }).strength).toBe(3);
    expect(R.abilitiesOf(creature({ vivid: false }), 1).pool.find(a => a.name === 'Lure')).toBeUndefined();
    const hardy = tol => R.abilitiesOf(creature({ tolerance: tol }), 1).pool.find(a => a.name === 'Hardy');
    expect(hardy(4.9)).toBeUndefined(); expect(hardy(5.0).strength).toBe(1); expect(hardy(5.4).strength).toBe(1);
    expect(hardy(5.5).strength).toBe(2); expect(hardy(5.9).strength).toBe(2); expect(hardy(6.0).strength).toBe(3);
  });
  it('the pool is in priority order: elemental, trophic, Pack, Lure, Hardy', () => {
    const a = R.abilitiesOf(creature({ prefArid: 10, size: 2, vivid: true, tolerance: 6 }), 10);
    expect(a.pool.map(x => x.name)).toEqual(['Waterless', 'Forager', 'Pack', 'Lure', 'Hardy']);
    expect(a.abilities.map(x => x.name)).toEqual(['Waterless', 'Forager']);   // L10: the second is always on
  });
  it('the second ability follows the 10% x L table against the genome roll', () => {
    const f = creature({ prefArid: 10 });                 // pool: Waterless III, Forager III
    const roll = R.genomeHash(f) % 100;
    for (let L = 1; L <= 10; L++) {
      const a = R.abilitiesOf(f, L);
      expect(a.roll).toBe(roll);
      expect(a.abilities.length).toBe(roll < 10 * L ? 2 : 1);
    }
    expect(R.abilitiesOf(f, 10).abilities).toHaveLength(2);   // 100% at L10 whatever the roll
    // Across many species at L5 about half get the second: the roll is uniform enough over the species buckets
    let two = 0, n = 0;
    for (let h = 0; h < 360; h += 20) for (const pt of [1, 3.5, 6, 8.5]) for (const ps of [1, 3.5, 6, 8.5]) {
      n++; if (R.abilitiesOf({ ...f, hue: h, prefTemp: pt, prefSL: ps }, 5).abilities.length === 2) two++;
    }
    expect(n).toBe(288); expect(two).toBeGreaterThan(100); expect(two).toBeLessThan(190);
  });
  it('the hash is a species property: every member of a species shares it; size, vivid and tolerance do not move it', () => {
    const f = creature({ prefArid: 9.5, size: 1.3 });
    const h = R.genomeHash(f);
    expect(R.genomeHash({ ...f, energy: 1, age: 99, x: 7, y: 9, id: 123 })).toBe(h);     // state is not genome
    expect(R.genomeHash({ ...f, size: 2.1, vivid: true, tolerance: 6 })).toBe(h);          // these shape the pool only
    expect(R.genomeHash({ ...f, prefArid: 9.9, hue: 119 })).toBe(h);                       // same buckets, same species
    expect(R.genomeHash({ ...f, prefArid: 7.4 })).not.toBe(h);                             // bucket edge: evolution
    expect(R.genomeHash({ ...f, hue: 120 })).not.toBe(h);
    expect(R.genomeHash({ ...f, type: 'omnivore' })).not.toBe(h);
    expect(R.genomeString(f)).toBe('herbivore|5|3|2|2|2');
  });
  it('the species buckets are the sim\'s own: genomeString equals sim.speciesKey', async () => {
    const sim = await import('../sim.js');
    const probes = [creature({}), creature({ prefArid: 9.5, hue: 359.9 }), creature({ type: 'apex', prefTemp: 10, prefElev: 0, hue: 0 }),
      creature({ type: 'carnivore', prefSL: 2.5, prefElev: 7.49 }), creature({ prefElev: undefined, hue: 20 })];
    for (const f of probes) expect(R.genomeString(f)).toBe(sim.speciesKey(f.prefElev === undefined ? { ...f, prefElev: 5 } : f));
    for (let p = 0; p <= 10; p += 0.01) expect(R.prefBucket(p)).toBe(sim.prefBucket(p));
  });
  it('the sixteen are all named, in three families', () => {
    const names = Object.keys(R.ABILITIES);
    expect(names).toHaveLength(16);
    expect(names.filter(n => R.ABILITIES[n].family === 'elemental')).toHaveLength(8);
    expect(names.filter(n => R.ABILITIES[n].family === 'trophic')).toHaveLength(5);
    expect(names.filter(n => R.ABILITIES[n].family === 'trait')).toHaveLength(3);
    expect(R.STRENGTH[3]).toBe('III');
  });
});

describe('ketchem rules: price (mechanics 10)', () => {
  for (const row of ROWS) {
    it(row.name + ' sells for ' + row.coins, () => {
      const nAb = Math.round(Math.log(row.price.abilityF) / Math.log(1.4));
      const p = R.priceTerms(row.f, row.N, row.L, nAb);
      for (const [k, v] of Object.entries(row.price)) expect(p.terms[k]).toBeCloseTo(v, 6);
      expect(p.price).toBe(row.coins);
      expect(R.priceOf(row.f, row.N, row.L, nAb)).toBe(row.coins);
    });
  }
  it('the whole card reproduces the table end to end (level and abilities derived, not given)', () => {
    const rolls = [];
    for (const row of ROWS) {
      const c = R.cardOf(row.f, row.N);
      expect(c.L).toBe(row.L);
      expect(c.abilities).toHaveLength(Math.round(Math.log(row.price.abilityF) / Math.log(1.4)));
      expect(c.price).toBe(row.coins);
      rolls.push(c.roll);
    }
    expect(rolls).toEqual([32, 43, 2, 37, 91, 33]);   // pinned: a hash change must be deliberate
    const apex = R.cardOf(ROWS[5].f, 2);
    expect(apex.abilities.map(a => a.name + ' ' + R.STRENGTH[a.strength])).toEqual(['Firewalk II', 'Pack I']);
    expect(apex.rarity).toMatchObject({ reading: 'last of its kind', cls: 'very rare', priceF: 16 });
    expect(apex).toMatchObject({ age: 'old', energy: 'fed', trophic: 'apex' });
  });
  it('condition factors multiply when two apply; level factor never drops below 1', () => {
    const f = creature({ type: 'carnivore', energy: 10, ...OLD });   // starving and old
    expect(R.priceTerms(f, 15, 5, 1).terms.conditionF).toBeCloseTo(0.6 * 0.7, 9);
    expect(R.priceTerms(creature({ energy: 40, ...YOUNG }), 15, 1, 1).terms.conditionF).toBeCloseTo(0.85 * 0.8, 9);
    expect(R.priceTerms(f, 15, 1, 1).terms.levelF).toBe(1);        // L below the band low (clamped elsewhere)
    expect(R.priceTerms(creature({ size: 0.5 }), 15, 1, 1).terms.sizeF).toBe(0.7);
    expect(R.priceTerms(creature({ gen: 8 }), 15, 1, 1).terms.elderF).toBe(1.5);
    expect(R.priceTerms(creature({ gen: 7 }), 15, 1, 1).terms.elderF).toBe(1);
  });
});

describe('ketchem rules: catch odds (mechanics 8)', () => {
  it('the odds table and stone prices are pinned', () => {
    expect(R.STONES.Amber).toEqual({ price: 5, odds: [85, 65, 45, 30, 20, 12, 6, 3, 1, 0] });
    expect(R.STONES.Geode).toEqual({ price: 25, odds: [95, 95, 95, 80, 65, 50, 40, 30, 20, 10] });
    expect(R.STONES.Obsidian).toEqual({ price: 150, odds: null });
    for (let L = 1; L <= 10; L++) {
      expect(R.oddsOf('Amber', L)).toBe(L === 10 ? 0 : R.STONES.Amber.odds[L - 1]);
      expect(R.oddsOf('Geode', L)).toBe(R.STONES.Geode.odds[L - 1]);
      expect(R.oddsOf('Obsidian', L)).toBe(100);
    }
  });
  it('expected Amber stones per catch match the spec line (L1 1.2 ... L6 8.3)', () => {
    const exp = L => Math.round(1000 / R.oddsOf('Amber', L)) / 10;
    expect([1, 2, 3, 4, 5, 6].map(exp)).toEqual([1.2, 1.5, 2.2, 3.3, 5, 8.3]);
  });
  it('modifiers add and the result clamps to 1-99', () => {
    expect(R.oddsOf('Amber', 4, { aw: 'calm', en: 0.9 })).toBe(45);
    expect(R.oddsOf('Amber', 4, { aw: 'calm', en: 0.4 })).toBe(30);     // calm needs en >= 0.5
    expect(R.oddsOf('Amber', 4, { bait: 'plant' })).toBe(50);
    expect(R.oddsOf('Amber', 4, { bait: 'meat' })).toBe(55);
    expect(R.oddsOf('Amber', 4, { aw: 'alert' })).toBe(20);
    expect(R.oddsOf('Amber', 4, { aw: 'growl' })).toBe(20);              // section 6: growl is -10 too
    expect(R.oddsOf('Amber', 4, { aw: 'wary' })).toBe(1);               // 0 clamps up to 1
    expect(R.oddsOf('Amber', 4, { lureIII: true })).toBe(40);
    expect(R.oddsOf('Amber', 4, { corral: true })).toBe(40);
    expect(R.oddsOf('Amber', 4, { aw: 'calm', en: 1, bait: 'plant', lureIII: true, corral: true })).toBe(85);
    expect(R.oddsOf('Geode', 1, { aw: 'calm', en: 1 })).toBe(99);       // 110 clamps down to 99
  });
  it('Dread III makes alert and wary count 0; Amber on L10 stays 0; Obsidian ignores everything', () => {
    expect(R.oddsOf('Amber', 4, { aw: 'wary', dreadIII: true })).toBe(30);
    expect(R.oddsOf('Amber', 4, { aw: 'alert', dreadIII: true })).toBe(30);
    expect(R.oddsOf('Amber', 4, { aw: 'growl', dreadIII: true })).toBe(30);
    expect(R.oddsOf('Amber', 10, { aw: 'calm', en: 1, bait: 'meat', lureIII: true, corral: true })).toBe(0);
    expect(R.oddsOf('Obsidian', 10, { aw: 'wary' })).toBe(100);
    expect(() => R.oddsOf('Opal', 1)).toThrow();
    expect(() => R.oddsOf('constructor', 1)).toThrow();                 // prototype names are not stones
    expect(() => R.levelOf(creature({ type: 'toString' }), 5)).toThrow();
  });
});
