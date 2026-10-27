// Ketch'em's page chrome (mechanics 22.3 and 5.6): the HUD bar at the top left (wallet, the three stones with the one
// in hand, the pack, active potions as arcs, the naming hint), the party row at the bottom left (up to three cards:
// the creature drawn as the sim draws it, name, level, type badge, growth, ability pips with the rule on hover, a
// collar on the follower), and Root's party row under its status in the visit panel. DOM, built once and re-rendered
// only when what it shows changes; the arcs alone move every tick. The module loads without a document (tests).
import { tick } from '../sim.js';
import { drawCreatureShape } from '../render.js';
import { creatureCard, packSummary, POTIONS } from './market.js';
import { TYPE_COLOUR } from './render.js';
import { STRENGTH } from './rules.js';
import { soundOn, toggleSound, soundTick } from './sound.js';

// Section 5.5 in one line each, I / II / III.
export const ABILITY_RULES = {
  Waterless: 'I desert, steppe and mesa cost 1 · II mesa never stops a leg · III those three at road stride',
  Wader: 'I wetland costs 1 · II coast shallows on foot, no boat · III lakes walkable',
  Firewalk: 'I volcanic ground walkable · II tiles hotter than 8 cost 1 · III active vents walkable',
  Furcoat: 'I arctic and tundra cost 1 · II glacier never stops a leg · III glacier at road stride',
  Farsight: 'sight I 11x11 · II 13x13 · III 15x15',
  Stalk: 'I no alert within 3 tiles · II wary lasts 100 ticks · III a failed throw never bolts the creature',
  Climber: 'I hills cost 1, mountain never stops a leg · II mountain walkable · III mountain at normal stride',
  Rivergait: 'I river tiles cost 1 · II river tiles at road stride · III lakes walkable',
  Forager: 'picked plants sell I x1.5 · II x2 · III x2 and every pick yields two',
  Scrounge: 'a carrion tile pays I 1 to 3 coins · II 2 to 6 · III and old creatures sell at full condition',
  Nose: 'odds shown at I 3 tiles · II 4 · III 5, calm creatures marked',
  Guard: 'I hungry carnivores do not attack · II nor apex · III predators within 3 tiles move away',
  Dread: 'I nothing attacks you · II nothing bolts · III nothing goes wary',
  Pack: 'pack slots I +5 · II +10 · III +15',
  Lure: 'calm creatures drift toward you from I 3 tiles · II 5 · III and odds +10 on every throw',
  Hardy: 'one attack absorbed per I 500 ticks · II 300 · III 150',
};

// One small icon per ability (5.6), 12x12, drawn in the pip's colour: [path, 'f' fill | 's' stroke].
export const ABILITY_ICON = {
  Waterless: ['M1 9Q4 4 7 9Q9 6 11 9', 's'], Wader: ['M3 11V4M6 11V2M9 11V5', 's'],
  Firewalk: ['M6 1C8 4 10 5 9 8A3 3 0 0 1 3 8C2 6 4 5 6 1Z', 'f'], Furcoat: ['M6 1V11M1.7 3.5L10.3 8.5M10.3 3.5L1.7 8.5', 's'],
  Farsight: ['M1 6Q6 1 11 6Q6 11 1 6ZM6 4.5A1.5 1.5 0 1 0 6 7.5A1.5 1.5 0 1 0 6 4.5', 's'], Stalk: ['M8 1A5 5 0 1 0 11 8A4 4 0 0 1 8 1Z', 'f'],
  Climber: ['M1 11L5 3L8 8L9 6L11 11Z', 'f'], Rivergait: ['M1 5Q3 3 5 5T9 5T11 5M1 9Q3 7 5 9T9 9T11 9', 's'],
  Forager: ['M2 10C2 4 6 2 10 2C10 7 7 10 2 10ZM2 10L7 5', 's'], Scrounge: ['M3 3L9 9M2 4L4 2M8 10L10 8M2 2.5L3.5 1M8.5 11L10 9.5', 's'],
  Nose: ['M6 2V8Q6 10 4 10M6 8Q6 10 8 10', 's'], Guard: ['M6 1L10 3V6C10 9 6 11 6 11C6 11 2 9 2 6V3Z', 'f'],
  Dread: ['M6 1A4 4 0 0 0 2 5C2 7 3 8 4 8V10H8V8C9 8 10 7 10 5A4 4 0 0 0 6 1Z', 'f'], Pack: ['M3 4H9L10 11H2ZM4.5 4V3A1.5 1.5 0 0 1 7.5 3V4', 's'],
  Lure: ['M6 1L7 5L11 6L7 7L6 11L5 7L1 6L5 5Z', 'f'], Hardy: ['M6 10L2 6A2.2 2.2 0 0 1 6 3A2.2 2.2 0 0 1 10 6Z', 'f'],
};
export function abilityIcon(name) {
  const ic = ABILITY_ICON[name]; if (!ic) return '';
  return '<svg class="kc-ic" viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="' + ic[0] + '" ' + (ic[1] === 'f' ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"') + '/></svg>';
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// A creature (or an Almanac glyph) into a card canvas: the sim's own shape, scaled to the card.
export function drawGlyph(canvas, g, px = 14) {
  if (!canvas || !g || !canvas.getContext) return;
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const S = canvas.width; ctx.clearRect(0, 0, S, canvas.height);
  const dim = Math.max(6, Math.min(S - 4, Math.round(px * (g.size || 1))));
  drawCreatureShape(ctx, g, 0, 0, S, dim, 1);
}
// Every canvas marked data-glyph inside el, from the id -> glyph map.
export function drawGlyphs(el, glyphs, px) {
  for (const c of el.querySelectorAll('canvas[data-glyph]')) drawGlyph(c, glyphs[c.dataset.glyph], px);
}

// One party card. cards: creatureCard() results; the collar marks the follower.
export function cardHTML(k, out) {
  const pips = k.abilityList.map(a => '<span class="kc-pip" title="' + esc(a.name + ' ' + STRENGTH[a.strength] + ': ' + (ABILITY_RULES[a.name] || '')) + '">' + abilityIcon(a.name) + esc(a.name) + ' <i>' + STRENGTH[a.strength] + '</i></span>').join('');
  return '<div class="kc' + (out ? ' out' : '') + '"><canvas class="kc-g" width="30" height="30" data-glyph="' + esc(k.id) + '"></canvas><div class="kc-body">' +
    '<div class="kc-top"><b>' + esc(k.name) + '</b><span class="kc-lvl">L' + k.level + '</span><span class="kc-type" style="background:' + (TYPE_COLOUR[k.elemental] || '#ccc') + '">' + esc(k.elemental) + '</span>' + (out ? '<span class="kc-collar" title="out, following"></span>' : '') + '</div>' +
    '<div class="kc-sub">' + esc(k.type) + ' · ' + esc(k.growth) + '</div><div class="kc-ab">' + pips + '</div></div></div>';
}
function partyCards(p) { return (p.party || []).map(c => creatureCard(c)); }
function rowHTML(p, cards) { return cards.map(k => cardHTML(k, p.follower === k.id)).join(''); }
function partySig(p, cards) { return JSON.stringify([p.follower, cards.map(k => [k.id, k.name, k.level, k.elemental, k.growth, k.abilities])]); }
function glyphMap(cards) { const m = {}; for (const k of cards) m[k.id] = k.glyph; return m; }

const STONES = [['Amber', 'amber'], ['Geode', 'geode'], ['Obsidian', 'obsidian']];
function hudHTML(p, guestChip = '', guest = false) {
  const ps = packSummary(p), potions = Object.keys(ps.potions);
  const stones = STONES.map(([n, k], i) => '<span class="kh-stone' + (p.stone === n ? ' on' : '') + '" title="' + (guest ? '[ and ] change the stone' : (i + 1) + ' picks ' + n) + '">' + (guest ? '' : '<i>' + (i + 1) + '</i>') + n + ' ' + p.stones[k] + '</span>').join('');
  const packTip = ps.plants + ' plants' + (potions.length ? ', ' + potions.map(n => n + ' x' + ps.potions[n]).join(', ') : '') + (ps.gear.length ? '; worn: ' + ps.gear.join(', ') : '') + (guest ? '. K for the pack, L for a potion or a shard' : '. I for the pack, P for a potion or a shard');
  const fx = (p.effects || []).filter(e => e.until > tick).map(e => '<span class="kh-arc" data-potion="' + esc(e.potion) + '" title="' + esc(e.potion) + '"><b>' + esc(e.potion[0]) + '</b></span>').join('');
  const nk = guest ? "'" : 'N', hint = p.naming ? nk + ' to name your catch' : p.namingSpecies ? nk + ' to name the new species' : p.cast ? 'homeward' : '';
  const over = ps.used > ps.cap;   // a Pack creature left the party: nothing more fits until the pack is lighter
  return '<span class="kh-wallet">' + p.wallet + ' coins</span>' + stones + '<span class="kh-pack' + (over ? ' over' : '') + '" title="' + esc(packTip + (over ? '. Over the cap: nothing more fits until the pack is lighter or a Pack creature rejoins the party' : '')) + '">pack ' + ps.used + '/' + ps.cap + '</span>' + (fx ? '<span class="kh-fx">' + fx + '</span>' : '') + (hint ? '<span class="kh-hint">' + hint + '</span>' : '') +
    '<button type="button" class="kh-sound' + (soundOn() ? '' : ' off') + '" title="Sound ' + (soundOn() ? 'on' : 'off') + ' (O)" aria-label="Sound">' + (soundOn() ? 'sound' : 'muted') + '</button>' + guestChip;
}
function hudSig(p) { return JSON.stringify([p.wallet, p.stone, p.stones, (p.pack || []).length, packSummary(p).cap, (p.pack || []).filter(x => x.potion).map(x => x.potion), (p.effects || []).filter(e => e.until > tick).map(e => e.potion), !!p.naming, !!p.namingSpecies, !!p.cast, soundOn(), Object.keys(p.gear || {})]); }
// The arcs: the fraction of each potion's duration left, as a conic sweep; the sweep moves every tick, the hover
// text once a second (a rewritten title would reset the tooltip under the pointer).
function arcs(el, p) {
  if (!p.effects || !p.effects.length) return;
  for (const a of el.querySelectorAll('.kh-arc')) {
    const e = p.effects.find(x => x.potion === a.dataset.potion); if (!e) continue;
    const dur = (POTIONS[e.potion] && POTIONS[e.potion].duration) || 1, left = Math.max(0, e.until - tick), frac = Math.max(0, Math.min(1, left / dur));
    a.style.background = 'conic-gradient(#e8a838 ' + Math.round(frac * 360) + 'deg, rgba(255,255,255,.12) 0)';
    const sec = String(Math.ceil(left / 6)); if (a.dataset.sec !== sec) { a.dataset.sec = sec; a.title = e.potion + ', ' + left + ' ticks'; }
  }
}
// The party cards cost a pass over the fauna each (populationOf), so they are rebuilt once a second, or at once when
// the party itself changes (ids, names, the follower).
const CARD_TICKS = 6;
function cheapSig(p) { return (p.follower || '') + '|' + (p.party || []).map(c => c.id + ':' + (c.name || '')).join(','); }
function partyFor(p, slot) {
  const cs = cheapSig(p);
  if (slot.cards && cs === slot.cheap && tick >= slot.at && tick - slot.at < CARD_TICKS) return slot.cards;   // a load to an earlier tick rebuilds at once
  slot.cards = partyCards(p); slot.cheap = cs; slot.at = tick; return slot.cards;
}

let hudEl = null, partyEl = null, hud2El = null, party2El = null, lastHud = '', lastParty = '', lastRoot = '', lastHud2 = '', lastParty2 = '';
const kevinSlot = {}, rootSlot = {};
function css() {
  const s = document.createElement('style');
  s.textContent = '#kHud,#kHud2{position:absolute;left:14px;top:12px;z-index:6;display:flex;gap:6px;align-items:center;flex-wrap:wrap;max-width:calc(100% - 28px);padding:6px 8px;' +
    'background:rgba(13,17,23,.82);border:1px solid var(--border-hi);border-radius:9px;backdrop-filter:blur(6px);color:var(--fg);font:12px/1.3 "JetBrains Mono",monospace;}' +
    '#kHud[hidden],#kParty[hidden],#kHud2[hidden],#kParty2[hidden]{display:none;}' +
    '.kh-bar .kh-wallet{font-weight:600;padding:2px 6px;}' +
    '.kh-bar .kh-stone{padding:2px 7px;border:1px solid transparent;border-radius:6px;color:var(--fg-dim);} .kh-bar .kh-stone i{font-style:normal;color:var(--fg-faint);margin-right:5px;}' +
    '.kh-bar .kh-stone.on{border-color:#e8a83899;background:rgba(232,168,56,.1);color:var(--fg);} .kh-bar .kh-stone.on i{color:#e8a838;}' +
    '.kh-bar .kh-pack{padding:2px 7px;color:var(--fg-dim);border-left:1px solid var(--border);}' +
    '.kh-bar .kh-fx{display:flex;gap:4px;margin-left:2px;} .kh-arc{width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;position:relative;}' +
    '.kh-arc b{width:14px;height:14px;border-radius:50%;background:var(--bg-panel);display:inline-flex;align-items:center;justify-content:center;font-size:9px;color:#f3d9a4;}' +
    '.kh-bar .kh-hint{color:#f3d9a4;padding:2px 7px;border-left:1px solid var(--border);}' +
    '.kh-bar .kh-pack.over{color:#ff7a7a;} .kh-bar .kh-sound{background:none;border:1px solid var(--border);border-radius:6px;color:var(--fg-dim);font:inherit;font-size:11px;padding:1px 6px;cursor:pointer;} .kh-bar .kh-sound.off{color:var(--fg-faint);text-decoration:line-through;}' +
    '.kc-ic{vertical-align:-1px;margin-right:3px;}' +
    '.kh-bar .kh-guest{background:none;border:1px solid var(--border);border-radius:6px;color:var(--fg-dim);font:inherit;font-size:11px;padding:1px 6px;cursor:pointer;} .kh-bar .kh-guest.on{border-color:#58d27a99;color:#58d27a;}' +
    '#kParty,#kParty2{position:absolute;left:14px;bottom:12px;z-index:6;display:flex;gap:8px;width:calc(100% - 28px);max-width:640px;}' +
    '.kc{display:flex;gap:8px;align-items:flex-start;flex:1 1 0;min-width:0;max-width:200px;box-sizing:border-box;padding:7px 9px;background:rgba(13,17,23,.86);border:1px solid var(--border-hi);border-radius:9px;backdrop-filter:blur(6px);color:var(--fg);font:11px/1.35 "JetBrains Mono",monospace;}' +
    '.kc.out{border-color:#e8a83899;} .kc .kc-g{flex:none;width:30px;height:30px;image-rendering:pixelated;background:rgba(255,255,255,.04);border-radius:6px;}' +
    '.kc .kc-body{min-width:0;flex:1;} .kc .kc-top{display:flex;gap:5px;align-items:center;min-width:0;} .kc .kc-top b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
    '.kc .kc-lvl{color:var(--fg-dim);flex:none;} .kc .kc-type{flex:none;font-size:9px;font-weight:600;color:#10141c;padding:1px 5px;border-radius:4px;}' +
    '.kc .kc-collar{flex:none;width:9px;height:9px;border-radius:50%;border:2px solid #e8a838;box-sizing:border-box;margin-left:auto;}' +
    '.kc .kc-sub{color:var(--fg-dim);font-size:10px;margin-top:1px;} .kc .kc-ab{display:flex;gap:4px;flex-wrap:wrap;margin-top:3px;}' +
    '.kc .kc-pip{font-size:9px;padding:1px 5px;border:1px solid var(--border);border-radius:4px;color:var(--fg-dim);cursor:help;} .kc .kc-pip i{font-style:normal;color:#f3d9a4;}' +
    '#vpParty{display:flex;flex-direction:column;gap:5px;padding:6px 10px;border-bottom:1px solid var(--border);} #vpParty:empty{display:none;} #vpParty .kc{width:auto;background:transparent;backdrop-filter:none;padding:4px 6px;}' +
    'body.ketchem #kPanel{bottom:104px;}' +
    '#kHud2{left:auto;right:14px;border-color:#58d27a66;} #kHud2 .kh-who{color:#58d27a;font-weight:600;padding:2px 6px;} #kParty2{left:auto;right:14px;justify-content:flex-end;} #kParty2 .kc{border-color:#58d27a55;}';
  document.head.appendChild(s);
}
function ensure() {
  if (hudEl) return;
  css();
  const host = document.querySelector('.canvas-wrap') || document.body;
  hudEl = document.createElement('div'); hudEl.id = 'kHud'; hudEl.className = 'kh-bar'; host.appendChild(hudEl);
  partyEl = document.createElement('div'); partyEl.id = 'kParty'; host.appendChild(partyEl);
  hud2El = document.createElement('div'); hud2El.id = 'kHud2'; hud2El.className = 'kh-bar'; hud2El.hidden = true; host.appendChild(hud2El);
  party2El = document.createElement('div'); party2El.id = 'kParty2'; party2El.hidden = true; host.appendChild(party2El);
}
// Called from draw(): with no board, hide everything; with one, refresh what changed.
export function hudTick(K) {
  if (typeof document === 'undefined') return;
  const vp = document.getElementById('vpParty');
  if (!K || !K.kevin) {
    if (hudEl) { hudEl.hidden = true; partyEl.hidden = true; hud2El.hidden = true; party2El.hidden = true; }
    if (vp && vp.innerHTML) vp.innerHTML = '';
    lastHud = lastParty = lastRoot = lastHud2 = lastParty2 = ''; kevinSlot.cards = rootSlot.cards = null; return;
  }
  ensure();
  const p = K.kevin;
  const g = K.root && K.root.human && !K.root.away ? K.root : null;
  const chip = '<button type="button" class="kh-guest' + (g ? ' on' : '') + '" title="' + (g ? 'The guest gets up; what they carry waits' : 'A second player on this keyboard: arrows, . / [ ] \' ; , L K') + '">' + (g ? esc(g.display || 'Guest') + ' leaves' : '+ guest') + '</button>';
  const hs = hudSig(p) + chip; if (hs !== lastHud) { lastHud = hs; hudEl.innerHTML = hudHTML(p, chip); hudEl.hidden = false; const sb = hudEl.querySelector('.kh-sound'); if (sb) sb.addEventListener('click', () => { toggleSound(); hudTick(K); }); }
  soundTick(K);
  arcs(hudEl, p);
  const cards = partyFor(p, kevinSlot), sig = partySig(p, cards);
  if (sig !== lastParty) { lastParty = sig; partyEl.innerHTML = rowHTML(p, cards); partyEl.hidden = !cards.length; drawGlyphs(partyEl, glyphMap(cards), 16); }
  // the guest's own bar (top right) and party row (bottom right)
  if (g) {
    const hs2 = hudSig(g) + (g.display || ''); if (hs2 !== lastHud2) { lastHud2 = hs2; hud2El.innerHTML = '<span class="kh-who">' + esc(g.display || 'Guest') + '</span>' + hudHTML(g, '', true).replace(/<button[^>]*kh-sound[^>]*>[^<]*<\/button>/, ''); hud2El.hidden = false; }
    arcs(hud2El, g);
    const gc = partyFor(g, rootSlot), gs = partySig(g, gc);
    if (gs !== lastParty2) { lastParty2 = gs; party2El.innerHTML = rowHTML(g, gc); party2El.hidden = !gc.length; drawGlyphs(party2El, glyphMap(gc), 16); }
  } else if (lastHud2 || lastParty2) { hud2El.hidden = true; party2El.hidden = true; lastHud2 = lastParty2 = ''; }
  if (vp) {
    const r = K.root, rc = r && !r.away && !r.human ? partyFor(r, rootSlot) : [], rs = rc.length ? partySig(r, rc) : '';
    if (rs !== lastRoot) { lastRoot = rs; vp.innerHTML = rc.length ? rowHTML(r, rc) : ''; if (rc.length) drawGlyphs(vp, glyphMap(rc), 16); }
  }
}
