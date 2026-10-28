# Ketch'em rehearsals

Live-page rehearsals, one per build step, each printing PASS / FAIL lines and writing screenshots to the folder given
as its first argument. They drive the dev server at http://127.0.0.1:5173 with Playwright borrowed from ~/taipan.

| script | what it rehearses | needs |
|---|---|---|
| rehearse9.mjs | the pen (breeding), Kevin and Root | scratch relay |
| rehearse10.mjs | HUD, party cards, store cards, Almanac, Root's party row | scratch relay |
| rehearse11.mjs | the finishing pass: question bar, icons, cabinet drag, sound chip, Root on load and Reset | scratch relay |
| rehearse12.mjs | items: shards and gear, Kevin and Root | scratch relay |
| rehearse13.mjs | trading between saves (two saves) | nothing |
| rehearse14.mjs | a guest at the same keyboard (bait, give, feed, the Almanac, a stake across a seat swap); Call Root refused while seated | scratch relay |
| rehearse18.mjs | breeding and gear extras: wear and wearing out, a slot swap, selling gear back, the Pannier, an egg and its hatch, half price for a young one, the found store's pen fee | nothing |
| rehearse17.mjs | saves: Root's save / save as through the door, never-overwrite naming, autosave when Root leaves, the F9 delete and the mirror (args: screenshots, the scratch relay folder) | scratch relay |
| rehearse16.mjs | a gamepad for the guest seat (a scripted pad: seat, move, catch, name, bait, give, feed, the Almanac, RB to a fifth potion) | nothing |
| rehearse15.mjs | a guest on another screen through the guest link (two browsers; bait, give, feed, the Almanac as text, a pad on the guest's screen, the store's buttons, a sound sent) | the guest link (the dev server starts it) |

Never rehearse against the real visit record. A scratch relay, from PowerShell in the repo:

    $p=(Get-NetTCPConnection -LocalPort 7796 -State Listen -ErrorAction SilentlyContinue).OwningProcess; if($p){Stop-Process -Id $p -Force}
    $env:VISIT_ROOT="<a scratch folder>"; $env:VISIT_MODEL="haiku"; $r=Start-Process -FilePath (Get-Command node).Source -ArgumentList 'visit/relay.mjs' -WorkingDirectory (Get-Location) -WindowStyle Hidden -PassThru
    node scripts/rehearsals/rehearse12.mjs "<screenshot folder>"
    Stop-Process -Id $r.Id -Force   # the keepalive restores the real relay within about 45 s; .local/relay.log names C:\Users\KevinReilly\root\visits

Run one rehearsal at a time: the relay serves one live page, so two pages retire each other. Edits to the page's
modules during a run make Vite reload the page under the script.

The guest link (`visit/guest-link.mjs`) usually runs as its own node process, not under Vite: after editing its page,
stop whatever listens on 7797 and start `node visit/guest-link.mjs` again, or rehearse15 tests the old page. It also
reads `src/ketchem/pad.js` and `src/ketchem/synth.js` once at start, so the same goes for an edit to either.
