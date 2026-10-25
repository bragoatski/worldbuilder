// The board builder's Worker: runs buildBoard() on its own copy of the sim so the page stays responsive, posting
// progress as it goes and the finished world as a snapshot (restoreState on the page side) plus the board.
import { CFG, snapshotState } from '../sim.js';
import { buildBoard } from './board.js';

self.onmessage = function (e) {
  const { setting, seed, size } = e.data || {};
  try {
    const board = buildBoard({ setting, seed, size }, p => self.postMessage({ type: 'progress', ...p }));
    self.postMessage({ type: 'done', board, snap: snapshotState(), cfg: { ...CFG } });
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
