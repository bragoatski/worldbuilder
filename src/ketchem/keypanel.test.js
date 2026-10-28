import { describe, it, expect } from 'vitest';

// The Controls panel (src/ketchem/keypanel.js): the pure parts. The DOM is checked on the running page.
const P = await import('./keypanel.js');

const base = { stone: 'Geode', stones: { amber: 12, geode: 5, obsidian: 0 }, bait: null, potion: false, potions: [], asking: false };
const ids = state => P.panelSections(state).map(s => s.id);
const sec = (state, id) => P.panelSections(state).find(s => s.id === id);
const keys = s => s.buttons.map(b => b.key);

describe('keypanel: the synthetic key event', () => {
  it('has the shape of a plain, non-repeating press', () => {
    const e = P.keyEvent('e');
    expect(e).toMatchObject({ key: 'e', code: 'KeyE', repeat: false, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false });
    expect(typeof e.preventDefault).toBe('function'); expect(() => e.preventDefault()).not.toThrow();
    expect('target' in e).toBe(true);
  });
  it('sends Space, Tab, Escape, F5 and F9 as the keys do', () => {
    expect(P.keySend('Space')).toEqual({ key: ' ', code: 'Space' });
    expect(P.keySend('Tab').key).toBe('Tab');
    expect(P.keySend('Escape').key).toBe('Escape');
    expect(P.keySend('F5').key).toBe('F5');
    expect(P.keySend('F9').key).toBe('F9');
  });
  it('sends digits and letters as themselves', () => {
    expect(P.keySend('1')).toEqual({ key: '1', code: 'Digit1' });
    expect(P.keySend('w')).toEqual({ key: 'w', code: 'KeyW' });
  });
  it('releases a key under the name the page stores it by (lower case)', () => {
    expect(P.releaseKey('w')).toBe('w'); expect(P.releaseKey('Space')).toBe(' '); expect(P.releaseKey('Tab')).toBe('tab');
  });
  it('shows a key as a chip', () => {
    expect(P.chipOf('Space')).toBe('Space'); expect(P.chipOf('Escape')).toBe('Esc'); expect(P.chipOf('e')).toBe('E'); expect(P.chipOf('F5')).toBe('F5'); expect(P.chipOf('2')).toBe('2');
  });
});

describe('keypanel: the buttons for a state', () => {
  it('lists every control in its section', () => {
    expect(P.panelSections(base).map(s => s.id)).toEqual(['move', 'act', 'stones', 'bait', 'potion', 'more']);
    expect(keys(sec(base, 'move'))).toEqual(['w', 'a', 's', 'd']);
    expect(sec(base, 'move').buttons.every(b => b.hold && b.cell && b.aria)).toBe(true);
    expect(keys(sec(base, 'act'))).toEqual(['Space', 'Tab', 'e', 'n', 'f']);   // Throw first and full width: its "Space" chip clipped the label in a half-width cell
    expect(sec(base, 'act').buttons.map(b => b.label)).toEqual(['Throw', 'Target', 'Use', 'Name', 'Follow']);
    expect(keys(sec(base, 'more'))).toEqual(['i', 'm', 'g', 't', 'c', 'v', 'o', 'F5', 'F9']);
    expect(sec(base, 'more').buttons.map(b => b.label)).toEqual(['Pack', 'Almanac', 'Give', 'Feed', 'Cabinet', 'Camera', 'Sound', 'Save', 'Load']);
  });
  it('marks the stone in hand and shows each count', () => {
    const s = sec(base, 'stones');
    expect(keys(s)).toEqual(['1', '2', '3']);
    expect(s.buttons.map(b => b.count)).toEqual([12, 5, 0]);
    expect(s.buttons.map(b => b.on)).toEqual([false, true, false]);
  });
  it('is quiet about a missing state', () => {
    expect(() => P.panelSections()).not.toThrow(); expect(() => P.panelSections(null)).not.toThrow();
    expect(sec({}, 'stones').buttons.map(b => b.count)).toEqual([0, 0, 0]);
  });
  it('starts the bait and potion flows with one button each', () => {
    expect(keys(sec(base, 'bait'))).toEqual(['b']);
    expect(keys(sec(base, 'potion'))).toEqual(['p']);
  });
  it('narrows to the pad and the bait section while a bait choice is pending', () => {
    expect(ids({ ...base, bait: { kind: null } })).toEqual(['move', 'bait']);
    expect(ids({ ...base, bait: { kind: 'plant' } })).toEqual(['move', 'bait']);
  });
  it('narrows to the potion section alone while a potion choice is pending', () => {
    expect(ids({ ...base, potion: true, potions: [['Tonic', 1]] })).toEqual(['potion']);
    expect(ids({ ...base, potion: true, potions: [] })).toEqual(['potion']);
  });
  it('asks for a bait kind, then for a direction', () => {
    const pick = sec({ ...base, bait: { kind: null } }, 'bait');
    expect(pick.buttons.map(b => b.bait).filter(Boolean)).toEqual(['plant', 'scatter', 'meat', 'stake']);
    expect(keys(pick)).toEqual(['p', 's', 'm', 't', 'Escape']);
    const dir = sec({ ...base, bait: { kind: 'meat' } }, 'bait');
    expect(keys(dir)).toEqual(['e', 'Escape']);
    expect(dir.buttons[0].label).toBe('Here'); expect(dir.buttons[1].label).toBe('Cancel');
    expect(dir.hint).toMatch(/Move pad/);
  });
  it('lists the pack potions by digit, in order, with a cancel', () => {
    const s = sec({ ...base, potion: true, potions: [['Tonic', 2], ['Musk', 1]] }, 'potion');
    expect(s.buttons.map(b => b.potion || b.label)).toEqual(['Tonic', 'Musk', 'Cancel']);
    expect(keys(s)).toEqual(['1', '2', 'Escape']);
    expect(s.buttons.map(b => b.count)).toEqual([2, 1, undefined]);
  });
  it('never offers a tenth potion (digits stop at 9)', () => {
    const potions = Array.from({ length: 12 }, (_, i) => ['P' + i, 1]);
    expect(keys(sec({ ...base, potion: true, potions }, 'potion'))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Escape']);
  });
});

describe('keypanel: the state signature and the markup', () => {
  it('changes with what the panel shows and not with anything else', () => {
    const a = P.stateSig(base);
    expect(P.stateSig({ ...base, extra: 1 })).toBe(a);
    expect(P.stateSig({ ...base, stone: 'Amber' })).not.toBe(a);
    expect(P.stateSig({ ...base, stones: { amber: 11, geode: 5, obsidian: 0 } })).not.toBe(a);
    expect(P.stateSig({ ...base, bait: { kind: null } })).not.toBe(a);
    expect(P.stateSig({ ...base, bait: { kind: null } })).not.toBe(P.stateSig({ ...base, bait: { kind: 'plant' } }));
    expect(P.stateSig({ ...base, potion: true })).not.toBe(a);
    expect(P.stateSig({ ...base, potions: [['Tonic', 1]] })).not.toBe(a);
    expect(P.stateSig({ ...base, asking: true })).not.toBe(a);
  });
  it('gives every button its stable selectors', () => {
    const html = P.sectionHTML(sec({ ...base, bait: { kind: null } }, 'bait')) + P.sectionHTML(sec({ ...base, potion: true, potions: [['Tonic', 2]] }, 'potion'));
    expect(html).toContain('data-key="p"'); expect(html).toContain('data-bait="plant"'); expect(html).toContain('data-key="Escape"');
    expect(html).toContain('data-potion="Tonic"'); expect(html).toContain('type="button"'); expect(html).toContain('tabindex="-1"');
    const pad = P.sectionHTML(sec(base, 'move'));
    expect(pad).toContain('data-hold="1"'); expect(pad).toContain('aria-label="Move up"'); expect(pad).toContain('grid-row:1;grid-column:2');
    const stones = P.sectionHTML(sec(base, 'stones'));
    expect(stones).toContain('aria-pressed="true"'); expect(stones).toContain('<i>12</i>');
    expect(P.sectionHTML(sec(base, 'act'))).toContain('data-key="Space"');
  });
  it('escapes a potion name', () => {
    expect(P.buttonHTML({ act: 'x', label: '<b>', key: '1', potion: 'a"b' })).toContain('data-potion="a&quot;b"');
  });
  it('opens by default on a wide screen (1100 px and up) and starts collapsed below', () => {
    expect(P.defaultOpen(1280)).toBe(true); expect(P.defaultOpen(1100)).toBe(true); expect(P.defaultOpen(1099)).toBe(false); expect(P.defaultOpen(760)).toBe(false); expect(P.defaultOpen(375)).toBe(false);
  });
  it('loads and ticks without a page', () => { expect(() => P.keypanelTick(null)).not.toThrow(); expect(() => P.keypanelTick(base, {})).not.toThrow(); });
});
