---
description: Run the Worldbuilder gate - the in-page test suite - and report PASS/FAIL.
---

Worldbuilder's authoritative "does it RUN" gate is the in-page test suite (`runTests()` in index.html).

Until a headless runner exists, this is MANUAL:
1. Open `index.html` in a browser.
2. Click the **Test** button (or press `T`).
3. Read the Tests panel and the badge. Report the pass / fail counts. Any failures = RED gate; quote the failing assertion lines.

If/when a headless runner is added (node + jsdom, or a Playwright / CLI loader), wire it here and run it with full output in this session. Building that runner is an early priority - it doubles as the ecosystem-tuning harness (see STATUS.md).
