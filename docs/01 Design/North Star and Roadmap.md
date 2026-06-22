# North Star and Roadmap - Worldbuilder

## North star (TBD - Kevin's call)
Not yet pinned. The deciding question: what is the primary goal - income, community, portfolio piece, or love-of-the-craft? That choice drives which direction the project takes. Until it is set, the working goal is: HARDEN and UNDERSTAND the existing sim (fix the ecosystem balance, decide rivers / beaches), no new feature commitments.

Observed center of gravity: the project has quietly moved from "terrain / climate generator" to a LIVING-WORLD sim. The title is now "Procedural Terrain & Ecology", and the predator / prey / evolution layer is the most alive and most distinctive part. Whatever the north star, the ecosystem is likely the heart of it.

## The three known problems (ranked by value)
1. **Ecosystem balance (the heart of the game).** In the default / "natural" state (sliders untouched), prey pulse outward, overeat, and die; predators starve, or if boosted they crash the prey and then themselves. This is a traveling-wave extinction with global synchrony - the system lacks local negative feedback, so collapses are total and need reseeding. Direction: density-dependence (reproduction falls / death rises as local crowding rises) + spatial refugia (places prey partly escape predators), MEASURED via a headless harness, not hand-tuned spawn rates (the band-aid that has not held). Needs a definition of "balanced" from Kevin first.
2. **Rivers.** Two prior bespoke attempts (v1: full water tiles, too much board became water; v2: curved overlay flowing downhill). The real problem: the tracer is bolted onto terrain with no coherent drainage, so clean rivers rarely generate and the feature cannot even be evaluated. If tried once more, use the standard method: depression-fill (priority-flood) -> flow direction -> flow accumulation -> threshold for width. This guarantees dendritic rivers by construction.
3. **Beaches (weakest ROI).** Intent: part of a tile is original terrain, part ocean, terrain morphs into a beach of varying size, straight or curved for interesting coastline, only in some places, forming gradually over time. Reality: a uniform yellow edge appearing everywhere at once. Fundamentally a sub-tile rendering problem at 6px resolution. Be willing to cut it or replace it with a purely cosmetic coastline pass decoupled from the erosion sim.

## Parked exploratory roadmap (NOT committed)
Unpinned ideas from an earlier exploration (the old "Base44" strategy doc), preserved to revisit later. They do NOT drive current work.
- Items the old roadmap listed as "to-do" that are ALREADY BUILT in the current file: world seeds, preset buttons, intro screen, population / stats panel, rivers, zoom / pan, 16 biomes (was 13), 9 overlays (was 6). The roadmap doc is stale against the code.
- Still-unbuilt ideas worth keeping: a statistics / biome-coverage panel, draggable legend, minimap, timeline scrubber, timelapse export, settlements.
- Distribution ideas (all speculative, none committed): screensaver (Electron), an interactive "god game" on Steam, a web platform / community gallery, generative-art prints, educational licensing, a world-gen API. Revisit after the north star is set.
