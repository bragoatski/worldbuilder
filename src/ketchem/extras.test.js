import { describe, it, expect } from 'vitest';

// Breeding and gear extras (mechanics 20 and 23): the egg and its hatching, the pen fee by store, half price for an
// unlevelled young one, gear slots, wear and sell-back, and the three new items. Same hand-built world as items.test.js.
const sim = await import('../sim.js');
const F = await import('./fog.js');
const C = await import('./controls.js');
const E = await import('./encounter.js');
const M = await import('./market.js');
const G = await import('./growth.js');
const B = await import('./board.js');
const S = await import('./save.js');

const at = (x, y) => sim.idx(x, y);
function world() {
  sim.setWorldSize(32); sim.initWorld(777); sim.CFG.riverAccumThreshold = 1e9; sim.CFG.ecoActive = true;
  for (let i = 0; i < 32 * 32; i++) { const x = i % 32, y = (i / 32) | 0; const main = x >= 2 && x <= 25 && y >= 2 && y <= 29; sim.grid[i] = main ? sim.T.PLAINS : sim.T.OCEAN; sim.elev[i] = main ? 1 : 0; sim.volcActive[i] = 0; }
  sim.generateRivers(); for (let i = 0; i < 32 * 32; i++) sim.riverData[i] = null;
  sim.flora.length = 0; sim.fauna.length = 0; sim.road.fill(0);
  const stores = [{ x: 2, y: 24, i: at(2, 24), q: 0, name: 'A', door: { x: 3, y: 24 }, revealed: true }, { x: 18, y: 24, i: at(18, 24), q: 1, name: 'B', door: { x: 17, y: 24 }, revealed: false },
    { x: 2, y: 4, i: at(2, 4), q: 2, name: 'C', door: { x: 3, y: 4 }, revealed: true }, { x: 20, y: 4, i: at(20, 4), q: 3, name: 'D', door: { x: 19, y: 4 }, revealed: false }];
  const K = { seed: 1, stores, signposts: [], landmarks: [], fog: F.newFog(32 * 32), starts: [{ store: 0, x: 3, y: 24 }, { store: 1, x: 17, y: 24 }] };
  K.kevin = E.initPlayer(C.newPlayer(12, 12), 'kevin'); K.root = E.initPlayer(C.newPlayer(13, 12), 'root');
  E.initEncounters(K); M.initStores(K); K.rng = () => 0.001;
  return K;
}
function put(type, x, y) { const f = sim.makeFauna(x, y, type, null); f.energy = f.maxEnergy * 0.9; sim.fauna.push(f); return f; }
function caught(K, p, type, name) { const f = put(type, 30, 30); sim.fauna.splice(sim.fauna.indexOf(f), 1); if (name) f.name = name; p.party.push(f); return f; }
function egg(K, p, ticks = 50) { const f = put('herbivore', 30, 30); sim.fauna.splice(sim.fauna.indexOf(f), 1); f.bornAt = sim.tick; f.hatchAt = sim.tick + ticks; f.by = p.id; K.cabinet.push(f); return f; }
function onStore(K, p, k = 0) { p.x = K.stores[k].x; p.y = K.stores[k].y; }
const EGG = /that egg hatches in \d+ ticks/;

describe('the egg (20)', () => {
  it('a bred young one is an egg in the cabinet: no name prompt at birth, hatchAt a fixed wait on', () => {
    const K = world(), p = K.kevin; onStore(K, p); p.wallet = 1000;
    caught(K, p, 'herbivore', 'Ma'); caught(K, p, 'herbivore', 'Pa');
    const r = G.breed(K, p, 'Ma', 'Pa');
    expect(r.ok).toBe(true); expect(G.HATCH_TICKS).toBe(600); expect(r.child.hatchAt).toBe(sim.tick + 600);
    expect(K.cabinet).toContain(r.child); expect(p.naming).toBeFalsy(); expect(r.text).toMatch(/an egg/);
  });
  it('an egg cannot be sold, taken out, bred, fed, given, followed, baited, named or shaped', () => {
    const K = world(), p = K.kevin; onStore(K, p); p.wallet = 1000;
    const e = egg(K, p), a = caught(K, p, 'herbivore', 'Ann'), t0 = e.prefTemp;
    expect(M.sell(K, p, e.id).text).toMatch(EGG); expect(M.sell(K, p, 'a').ok).toBe(false);
    p.party = []; expect(M.sell(K, p, 'herbivore').text).toMatch(EGG);   // by type, with nothing hatched to match
    expect(M.box(K, p, e.id, true).text).toMatch(EGG); expect(M.box(K, p, 'herbivore', true).text).toMatch(EGG);
    p.party.push(a); expect(G.breed(K, p, 'Ann', String(e.id)).text).toMatch(EGG);
    p.naming = e.id; expect(E.nameCatch(K, p, 'Nope').text).toMatch(EGG); expect(e.name).toBeUndefined(); p.naming = null;
    expect(K.cabinet).toContain(e); expect(p.wallet).toBe(1000);
    // an egg that somehow sits in the party is refused by every party verb too
    K.cabinet = []; p.party = [e]; p.x = 12; p.y = 12;
    expect(G.feed(K, p, 'herbivore', 'plant').text).toMatch(EGG);
    expect(E.follow(K, p).text).toMatch(EGG); expect(p.follower).toBeNull();
    expect(E.placeBait(K, p, 'meat', 'N').text).toMatch(EGG); expect(p.party).toEqual([e]);
    expect(M.give(K, p, 'herbivore').text).toMatch(EGG); expect(K.root.party).toEqual([]);
    p.pack.push({ potion: 'Ember Shard' }, { potion: 'Tonic' });
    expect(M.usePotion(K, p, 'Ember Shard', e).text).toMatch(EGG); expect(M.usePotion(K, p, 'Tonic', e).text).toMatch(EGG);
    expect(p.pack).toHaveLength(2); expect(e.prefTemp).toBe(t0);
  });
  it('feeding a creature to a meat eater refuses an egg as the meal', () => {
    const K = world(), p = K.kevin, wolf = caught(K, p, 'carnivore', 'Wolf'), e = egg(K, p); K.cabinet = []; p.party.push(e);
    expect(G.feed(K, p, 'Wolf', 'herbivore').text).toMatch(EGG); expect(p.party).toContain(e); void wolf;
  });
  it('a hatched one is chosen before an egg when a type word fits both', () => {
    const K = world(), p = K.kevin; onStore(K, p); const e = egg(K, p), b = caught(K, p, 'herbivore'); K.cabinet.push(b); p.party = [];
    const r = M.sell(K, p, 'herbivore'); expect(r.ok).toBe(true); expect(K.cabinet).toEqual([e]);
  });
  it('the cabinet, the sell list, Root\'s shop text and the card show an egg as an egg', () => {
    const K = world(), p = K.kevin; onStore(K, p); const e = egg(K, p, 50);
    expect(M.creatureCard(e)).toMatchObject({ name: 'egg', egg: true, hatchIn: 50 });
    const L = M.shopLists(K, p, K.stores[0]);
    expect(L.sell.map(c => c.id)).not.toContain(e.id); expect(L.box.map(c => c.name)).toContain('egg'); expect(L.pen.find(c => c.id === e.id).egg).toBe(true);
    expect(M.shopText(K, p)).toContain('egg (hatches in 50 ticks)');
  });
  it('it hatches at hatchAt: born then, and the owner is asked for a name with news', () => {
    const K = world(), p = K.kevin; onStore(K, p); p.wallet = 1000;
    caught(K, p, 'herbivore', 'Ma'); caught(K, p, 'herbivore', 'Pa');
    const child = G.breed(K, p, 'Ma', 'Pa').child, due = sim.tick + 2; child.hatchAt = due;
    sim.step(); G.growthTick(K);
    expect(child.hatchAt).toBe(due); expect(p.naming).toBeFalsy();
    sim.step(); G.growthTick(K);
    expect(child.hatchAt).toBeUndefined(); expect(child.bornAt).toBe(due); expect(p.naming).toBe(child.id);
    expect(E.drainNews(K, 'kevin')).toContain('an egg hatched in the cabinet: name it');
    expect(G.breed(K, p, String(child.id), 'Ma').text).toMatch(/newborn/);   // the newborn rule counts from hatching
    expect(E.nameCatch(K, p, 'Pip').ok).toBe(true); expect(child.name).toBe('Pip');
  });
  it('Root\'s egg asks Root, not Kevin', () => {
    const K = world(), e = egg(K, K.root, 1);
    sim.step(); G.growthTick(K);
    expect(K.root.naming).toBe(e.id); expect(K.kevin.naming).toBeFalsy(); expect(E.drainNews(K, 'root')).toHaveLength(1);
  });
  it('hatchAt and the legacy gear record survive a save and a load', () => {
    const KB = B.buildBoard({ setting: 'archipelago', seed: 7, size: 48, settleTicks: 40 });
    KB.kevin = C.newPlayer(KB.starts[0].x, KB.starts[0].y); KB.root = null; KB.tick0 = sim.tick; KB.kevin.id = 'kevin'; KB.kevin.gear = { Satchel: true };
    const e = sim.makeFauna(5, 5, 'herbivore', null); sim.fauna.splice(sim.fauna.indexOf(e), 1); e.hatchAt = sim.tick + 123; e.bornAt = sim.tick; e.by = 'kevin'; KB.cabinet = [e];
    const K2 = S.importSave(S.exportSave(S.buildSave(KB, 'eggs')));
    expect(K2.cabinet[0].hatchAt).toBe(e.hatchAt); expect(K2.cabinet[0].bornAt).toBe(e.bornAt);
    expect(K2.kevin.gear).toEqual({ Satchel: true }); expect(M.packCap(K2.kevin)).toBe(M.packCap({ party: [], gear: {} }) + 5);
  });
});

describe('the pen fee by store', () => {
  it('the two start stores charge the full fee, any other store three quarters; breed and the panel agree', () => {
    const K = world(), p = K.kevin; p.wallet = 1000;
    const a = caught(K, p, 'herbivore', 'Ma'), b = caught(K, p, 'herbivore', 'Pa'), full = G.breedFee(a, b);
    expect(G.breedFee(a, b, K, K.stores[0])).toBe(full); expect(G.breedFee(a, b, K, K.stores[1])).toBe(full);
    expect(G.breedFee(a, b, K, K.stores[2])).toBe(Math.round(full * 0.75)); expect(G.breedFee(a, b, K, K.stores[3])).toBe(Math.round(full * 0.75));
    expect(M.shopLists(K, p, K.stores[2]).fee(a.id, b.id)).toBe(Math.round(full * 0.75)); expect(M.shopLists(K, p, K.stores[0]).fee(a.id, b.id)).toBe(full);
    onStore(K, p, 2); expect(G.breed(K, p, 'Ma', 'Pa').ok).toBe(true); expect(p.wallet).toBe(1000 - Math.round(full * 0.75));
    delete a.bredAt; delete b.bredAt; p.wallet = 1000; onStore(K, p, 0); expect(G.breed(K, p, 'Ma', 'Pa').ok).toBe(true); expect(p.wallet).toBe(1000 - full);
  });
});

describe('half price for an unlevelled young one', () => {
  it('a young one sells at half and the card, the shop text and the sale agree; a grown one at full', () => {
    const K = world(), p = K.kevin; onStore(K, p);
    const y = caught(K, p, 'herbivore', 'Kit'), g = caught(K, p, 'herbivore', 'Big'), plain = caught(K, p, 'herbivore', 'Old');
    const fullY = M.creaturePrice(y), fullG = M.creaturePrice(g), fullO = M.creaturePrice(plain);
    y.bornAt = sim.tick; g.bornAt = sim.tick; g.growthLevel = 1;
    expect(M.creaturePrice(y)).toBe(Math.floor(fullY / 2)); expect(M.creaturePrice(g)).toBe(fullG); expect(M.creaturePrice(plain)).toBe(fullO);   // no bornAt: not a young one
    expect(M.creatureCard(y).price).toBe(Math.floor(fullY / 2)); expect(M.creatureCard(y).breakdown).toContain('x0.5 young (not yet grown a level)');
    expect(M.creatureCard(g).breakdown).not.toContain('young'); expect(M.creatureCard(g).price).toBe(fullG);
    expect(M.shopText(K, p)).toContain('"Kit" L' + M.creatureCard(y).level + ' ' + M.creatureCard(y).elemental + ' ' + Math.floor(fullY / 2));
    expect(M.shopLists(K, p, K.stores[0]).sell.find(c => c.name === 'Kit').price).toBe(Math.floor(fullY / 2));
    const w0 = p.wallet; expect(M.sell(K, p, 'Kit').price).toBe(Math.floor(fullY / 2)); expect(p.wallet).toBe(w0 + Math.floor(fullY / 2));
    const w1 = p.wallet; M.sell(K, p, 'Big'); expect(p.wallet).toBe(w1 + fullG);
  });
});

describe('gear slots and sell-back', () => {
  it('a new item swaps the old one back automatically; a different slot keeps both; the same item is refused', () => {
    const K = world(), p = K.kevin; onStore(K, p); p.wallet = 1000;
    expect(M.GEAR.Satchel.slot).toBe('pack'); expect(M.GEAR['Trail Boots'].slot).toBe('feet'); expect(M.GEAR['Lucky Charm'].slot).toBe('charm');
    expect(M.buy(K, p, 'Trail Boots').ok).toBe(true); p.gear['Trail Boots'].left = 1400;
    expect(M.buy(K, p, 'Satchel').ok).toBe(true); expect(M.wears(p, 'Trail Boots')).toBe(true); expect(M.wears(p, 'Satchel')).toBe(true);
    expect(M.buy(K, p, 'Trail Boots').ok).toBe(false);
    const w = p.wallet, r = M.buy(K, p, 'Waders');
    expect(r.ok).toBe(true); expect(r.text).toBe('swapped Trail Boots for Waders (Trail Boots sold back for 63; ' + (w + 63 - 160) + ' left)');
    expect(M.wears(p, 'Trail Boots')).toBe(false); expect(M.wears(p, 'Waders')).toBe(true); expect(p.wallet).toBe(w + 63 - 160);
    const w2 = p.wallet; expect(M.buy(K, p, 'Pannier').text).toMatch(/swapped Satchel for Pannier \(Satchel sold back for 60;/); expect(p.wallet).toBe(w2 + 60 - 260);
    expect(M.wears(p, 'Satchel')).toBe(false);
  });
  it('a swap counts the sold-back item toward the price', () => {
    const K = world(), p = K.kevin; onStore(K, p); p.gear = { 'Trail Boots': { left: 2000 } }; p.wallet = 69;
    expect(M.buy(K, p, 'Waders').ok).toBe(false); p.wallet = 70; expect(M.buy(K, p, 'Waders').ok).toBe(true); expect(p.wallet).toBe(0);   // 90 back, 160 for the waders
  });
  it('worn gear sells back at half its price scaled by what is left; the SELL list, the shop text and the pack say so', () => {
    const K = world(), p = K.kevin; onStore(K, p); p.wallet = 0; p.gear = { 'Trail Boots': { left: 1000 }, Satchel: true };
    const L = M.shopLists(K, p, K.stores[0]);
    expect(L.gearSell).toEqual([{ item: 'Satchel', label: 'Satchel', price: 60 }, { item: 'Trail Boots', label: 'Trail Boots (1000 steps left)', price: 45 }]);
    expect(M.shopText(K, p)).toContain('Trail Boots (1000 steps left) (worn gear) 45');
    expect(M.packSummary(p).gear).toEqual(['Satchel', 'Trail Boots (1000 steps left)']);
    const r = M.sell(K, p, 'trail boots'); expect(r.ok).toBe(true); expect(p.wallet).toBe(45); expect(M.wears(p, 'Trail Boots')).toBe(false);
    expect(M.sell(K, p, 'Satchel').price).toBe(60); expect(p.wallet).toBe(105);
    expect(M.sell(K, p, 'Waders').text).toMatch(/do not wear/); expect(p.wallet).toBe(105);
  });
  it('gear sells ahead of creatures, and the new names are not creature names', () => {
    const K = world(), p = K.kevin; onStore(K, p); p.gear = { Waders: { left: 2000 } };
    expect(M.sell(K, p, 'Waders').price).toBe(80);
    const f = put('herbivore', p.x + 1, p.y); E.throwStone(K, p, f, 'Amber');
    for (const n of ['Waders', 'pannier', 'Quiet Bell']) expect(E.nameCatch(K, p, n).ok, n).toBe(false);
  });
  it('an old save\'s gear: true is a fresh item (full labels, full sell-back) and wears from full', () => {
    const K = world(), p = K.kevin; onStore(K, p); p.gear = { Satchel: true, 'Trail Boots': true };
    expect(M.packCap(p)).toBe(M.packCap({ party: [], gear: {} }) + 5); expect(M.packSummary(p).gear).toContain('Trail Boots (2000 steps left)');
    expect(M.gearSellBack(p, 'Trail Boots')).toBe(90); p.x = 10; p.y = 10; C.tryStep(K, p, 1, 0);
    expect(p.gear['Trail Boots']).toEqual({ left: 1999 });
  });
});

describe('gear wear', () => {
  const walk = (K, p) => { let n = 0; p.spent = 0; p.windowStart = sim.tick; while (C.tryStep(K, p, 1, 0).ok) n++; return n; };
  it('Trail Boots wear one per step they help, not on a road, and come off with a message at 0', () => {
    const K = world(), p = K.kevin; p.x = 10; p.y = 10; p.gear = { 'Trail Boots': { left: 5 } };
    for (let x = 12; x < 18; x++) sim.road[at(x, 10)] = 1;
    C.tryStep(K, p, 1, 0); expect(p.gear['Trail Boots'].left).toBe(4);   // tile 11: open ground
    C.tryStep(K, p, 1, 0); expect(p.gear['Trail Boots'].left).toBe(4);   // tile 12: road, the boots do nothing
    p.x = 10; p.y = 12; p.gear['Trail Boots'].left = 3; p.spent = 0; p.windowStart = sim.tick;
    for (let k = 0; k < 3; k++) expect(C.tryStep(K, p, 1, 0).ok).toBe(true);
    expect(p.gear['Trail Boots']).toBeUndefined(); expect(p.msg).toBe('your Trail Boots wore out');
    expect(E.drainNews(K, 'kevin')).toEqual(['your Trail Boots wore out']);
  });
  it('Root\'s walking body wears its boots too, and the news goes to root', () => {
    const K = world(), st = C.newPlayer(10, 10); st.gear = K.root.gear = { 'Trail Boots': { left: 1 } };
    expect(C.legWalk(K, st, 'E', 1)).toBe('walked 1E'); expect(K.root.gear['Trail Boots']).toBeUndefined(); expect(E.drainNews(K, 'root')).toEqual(['your Trail Boots wore out']);
  });
  it('the Lucky Charm wears per Amber or Geode throw, not per Obsidian throw', () => {
    const K = world(), p = K.kevin; p.gear = { 'Lucky Charm': { left: 2 } }; p.stones = { amber: 5, geode: 5, obsidian: 5 };
    E.throwStone(K, p, put('herbivore', p.x + 1, p.y), 'Obsidian'); expect(p.gear['Lucky Charm'].left).toBe(2);
    E.throwStone(K, p, put('herbivore', p.x + 1, p.y), 'Amber'); expect(p.gear['Lucky Charm'].left).toBe(1);
    expect(E.drainNews(K, 'kevin')).toEqual([]);
    E.throwStone(K, p, put('herbivore', p.x + 1, p.y), 'Geode'); expect(p.gear['Lucky Charm']).toBeUndefined();
    expect(E.drainNews(K, 'kevin')).toEqual(['your Lucky Charm wore out']); expect(p.msg).toBe('your Lucky Charm wore out');
  });
  it('the Quiet Bell makes creatures notice you one tile later, and wears one per tick on the board', () => {
    const near = (bell, type, dx) => {
      const K = world(), p = K.kevin; if (bell) p.gear = { 'Quiet Bell': { left: 3000 } };
      const f = put(type, p.x - dx, p.y); E.encounterTick(K); return K.aw[f.id].state;
    };
    expect(near(false, 'herbivore', 2)).toBe('alert'); expect(near(true, 'herbivore', 2)).toBe('calm'); expect(near(true, 'herbivore', 1)).toBe('alert');   // never below 1
    expect(near(false, 'carnivore', 3)).toBe('alert'); expect(near(true, 'carnivore', 3)).toBe('calm'); expect(near(true, 'carnivore', 2)).toBe('alert');
    const K = world(), p = K.kevin; p.gear = { 'Quiet Bell': { left: 3 } }; K.root.away = true; K.root.gear = { 'Quiet Bell': { left: 3 } };
    M.marketTick(K); expect(p.gear['Quiet Bell'].left).toBe(2); expect(K.root.gear['Quiet Bell'].left).toBe(3);   // a body off the board does not wear it
    M.marketTick(K); M.marketTick(K); expect(p.gear['Quiet Bell']).toBeUndefined(); expect(E.drainNews(K, 'kevin')).toEqual(['your Quiet Bell wore out']);
  });
  it('Waders add a tile of stride on rivers and marsh (not open ground, not a road) and wear only when they help', () => {
    const K = world(), p = K.kevin;
    for (let x = 10; x < 20; x++) { sim.riverData[at(x, 10)] = {}; sim.grid[at(x, 12)] = sim.T.WETLAND; sim.road[at(x, 14)] = 1; sim.riverData[at(x, 14)] = {}; }
    const at2 = (y, gear) => { p.x = 10; p.y = y; p.gear = gear; return walk(K, p); };
    expect(at2(10, {})).toBe(2); expect(at2(10, { Waders: { left: 100 } })).toBe(3); expect(p.gear.Waders.left).toBe(97);   // river
    expect(at2(12, {})).toBe(2); expect(at2(12, { Waders: { left: 100 } })).toBe(3); expect(p.gear.Waders.left).toBe(97);   // marsh
    expect(at2(14, { Waders: { left: 100 } })).toBe(4); expect(p.gear.Waders.left).toBe(100);                                // a road over a river stays a road
    expect(at2(16, { Waders: { left: 100 } })).toBe(2); expect(p.gear.Waders.left).toBe(100);                                // plain ground
  });
  it('the Pannier adds eight pack slots, and is never worn out', () => {
    const K = world(), p = K.kevin, base = M.packCap(p); p.gear = { Pannier: true };
    expect(M.packCap(p)).toBe(base + 8);
    for (let k = 0; k < base + 8; k++) { sim.flora.push(sim.makeFlora(p.x, p.y, null)); expect(E.pickPlant(K, p).ok, 'pick ' + (k + 1)).toBe(true); }
    sim.flora.push(sim.makeFlora(p.x, p.y, null)); expect(E.pickPlant(K, p).text).toBe('pack full (' + (base + 8) + ')');
    for (let k = 0; k < 20; k++) M.marketTick(K);
    expect(p.gear).toEqual({ Pannier: true }); expect(M.packSummary(p).gear).toEqual(['Pannier']);
  });
});
