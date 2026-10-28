import { describe, it, expect } from 'vitest';
import { padPressed, padEdges, padKey, padArrowUp, PAD_KEYS, START } from './pad.js';

// A gamepad for the guest seat (mechanics 25.1): buttons become guest keys; A B X Y pick in a choice; A / B answer
// only the guest's own question; the left stick is the d-pad.
const pad = (on = [], axes = [0, 0], values = {}) => ({ buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: on.includes(i), value: values[i] ?? (on.includes(i) ? 1 : 0) })), axes });

describe('the guest\'s gamepad (25.1)', () => {
  it('reads held buttons, an analogue trigger past half-way, and the stick as the d-pad', () => {
    expect([...padPressed(pad([0, 13]))].sort((a, b) => a - b)).toEqual([0, 13]);
    expect(padPressed(pad([], [0, 0], { 6: 0.3 })).has(6)).toBe(false);
    expect(padPressed(pad([], [0, 0], { 6: 0.8 })).has(6)).toBe(true);
    expect([...padPressed(pad([], [-0.9, 0.7]))].sort((a, b) => a - b)).toEqual([13, 14]);   // left and down
    expect(padPressed(pad([], [0.3, -0.4])).size).toBe(0);   // a resting stick drifts; half-way is the line
    expect(padPressed(null).size).toBe(0);
  });
  it('a stick or trigger near the line does not chatter: down past 0.5, up only below 0.3', () => {
    const held = padPressed(pad([], [0, 0], { 7: 0.6 }));
    expect(held.has(7)).toBe(true);
    expect(padPressed(pad([], [0, 0], { 7: 0.4 }), held).has(7)).toBe(true);   // dipped, still held
    expect(padPressed(pad([], [0, 0], { 7: 0.2 }), held).has(7)).toBe(false);
    const left = padPressed(pad([], [-0.6, 0]));
    expect(padPressed(pad([], [-0.4, 0]), left).has(14)).toBe(true); expect(padPressed(pad([], [-0.4, 0])).has(14)).toBe(false);
  });
  it('reports a press once, and its release once', () => {
    const a = padPressed(pad([0])), b = padPressed(pad([0, 12])), c = padPressed(pad([12]));
    expect(padEdges(new Set(), a)).toEqual({ downs: [0], ups: [] });
    expect(padEdges(a, b)).toEqual({ downs: [12], ups: [] });
    expect(padEdges(b, c)).toEqual({ downs: [], ups: [0] });
    expect(padEdges(c, c)).toEqual({ downs: [], ups: [] });   // held: nothing new
  });
  it('maps every button to a guest key, never one of Kevin\'s', () => {
    const kevins = new Set('w a s d e c p i m g v t f n b o r 1 2 3 tab shift'.split(' '));
    for (const k of Object.values(PAD_KEYS)) expect(kevins.has(k.toLowerCase())).toBe(false);
    expect(padKey(0)).toBe('/'); expect(padKey(1)).toBe('.'); expect(padKey(2)).toBe("'"); expect(padKey(3)).toBe(';');
    expect(padKey(7)).toBe('j'); expect(padKey(8)).toBe('h'); expect(padKey(11)).toBe('u'); expect(padKey(START)).toBe('y');
    expect(padKey(12)).toBe('ArrowUp'); expect(padKey(16)).toBe(null);
  });
  it('in a choice, A B X Y are 1 2 3 4 and the rest keep their meaning', () => {
    expect([0, 1, 2, 3].map(i => padKey(i, { picking: true }))).toEqual(['1', '2', '3', '4']);
    expect(padKey(14, { picking: true })).toBe('ArrowLeft');
    expect(padKey(3, { picking: false })).toBe(';');   // after the kind, Y is "here"
  });
  it('RB\'s pages: on the second page A B X Y are 5 6 7 8', () => {
    expect([0, 1, 2, 3].map(i => padKey(i, { picking: true, page: 1 }))).toEqual(['5', '6', '7', '8']);
    expect(padKey(0, { picking: false, page: 1 })).toBe('/');   // a page means nothing outside a choice
  });
  it('with the guest\'s question open, A answers, B declines, and nothing else acts', () => {
    expect(padKey(0, { asking: true })).toBe('ok'); expect(padKey(1, { asking: true })).toBe('cancel');
    expect(padKey(12, { asking: true })).toBe(null); expect(padKey(7, { asking: true, picking: true })).toBe(null);
  });
  it('a released d-pad button names the arrow to let go of', () => {
    expect(padArrowUp(13)).toBe('arrowdown'); expect(padArrowUp(0)).toBe(null);
  });
});
