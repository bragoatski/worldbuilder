# Engineering Lessons - Worldbuilder

Durable, reusable gotchas specific to Worldbuilder. Format: rule + why + Verified date. Universal (cross-project) lessons live in the global layer (`~/.claude/Engineering Lessons.md`), not here. When a lesson stops being true, move it to Archive rather than deleting it.

## Reproducibility
- **Terrain is seeded, the ecosystem is not.** Generation (terrain, sunlight blobs, world meta, rivers) uses the seeded RNG (`sRng` / `mulberry32`), but `floraStep`, `faunaStep`, `beachStep`, mutation, and the anomaly drift call raw `Math.random()`. So a seed reproduces the same TERRAIN but a different ecology run every time. Consequence: you cannot reproduce a specific population collapse to debug it, or A/B a tuning change against an identical run, until the ecology RNG is seeded. Decide whether deterministic ecology is wanted before relying on it. [Verified: 2026-06-21]

## Encoding
- **index.html relies on UTF-8 glyphs (toolbar emoji, the title em-dash, legend symbols); save and serve it as UTF-8 or they mojibake.** The file survives only as raw bytes; pasting it through a non-UTF-8 channel mangled every emoji (e.g. a play triangle became "a-circumflex + symbol"). When editing, preserve UTF-8; when hosting, send `charset=utf-8`. [Verified: 2026-06-21]

## Archive
(none yet - move a lesson here, with the date it stopped being true, rather than deleting it.)
