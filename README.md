# Span — Bridge Engineering Simulator

Design truss, arch and suspension bridges with real materials and section sizes, check them against design-code limits, then load-test them with live traffic.

## Play

- **Quickest:** download the repo, keep `Play Span.html` and `Span Tutorial.mp4` together, and open `Play Span.html` in a browser.
- **From source:** `npm install` then `npm run dev` → http://localhost:5199

Click **▶ Walkthrough** (or press `W`) in the game for the video guide with chapters and written steps.

## Data story: *How a bridge holds you up*

Open **`Bridge Story.html`** (or `/story.html` on the dev server, or **Story** in the game's top bar). A scroll-driven introduction to bridge engineering for newcomers, in seven chapters: loads, triangles, tension & compression (drive the truck yourself and watch live forces and influence lines), buckling, truss depth, safety factors (with a real dynamic load test), and which bridge form suits which span. Readers guess before each reveal, pick the vehicle that crosses, remove members and watch the real simulation collapse, read field notes on the Québec (1907) and Tacoma Narrows (1940) failures, and finish with a design challenge that scores stars and exports a shareable result card. Every number and colour is computed live in the browser by the simulator's own structural engine.

## Features

- **Materials & sections:** glulam GL24h timber, S355 steel hollow sections, spiral-strand cable and three deck types, with published properties. Compression members buckle (Rankine–Gordon / Euler).
- **Live static analysis:** direct stiffness method with a moving-load envelope (every design vehicle, both directions), tension-only cables and geometric stiffness for cable-supported decks. Checks: stability, deck continuity, strength (1.35G + 1.5Q), deflection (L/n), gradient, budget.
- **Dynamic load test:** XPBD simulation with multi-axle vehicles and suspension; members break at their characteristic resistance.
- **Failure hints:** when a test fails the game diagnoses why (buckled strut, snapped tie, mechanism, deck gap, too steep, stuck traffic), suggests specific fixes that escalate with repeated failures, and a *Show me* button zooms to the culprit member. Failing design checks carry inline hints too.
- **Starter project with a perfect solution:** the first project (*Starter Bridge*, 8 m) includes a worked three-star solution in its brief — the cheapest design found by `scripts/find-examples.ts` that is code compliant, within 80% of budget and passes the load test. Every other project has no example: players work them out.
- **10 projects** (a Starter plus nine) with client briefs, design traffic, clearance zones and three-star scoring, plus a **Playground** with two-way traffic, manual driving, dropped loads and earthquakes.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Type-check, build `Play Span.html` (game) and `Bridge Story.html` (data story) as single files |
| `npm run test:physics` | Static vs dynamic solver validation + level balance check |
| `npm run test:tutorial` | Verifies the tutorial bridge passes every check |
| `npm run test:playground` | Playground smoke test (traffic, driving, loads, earthquake) |
| `npx tsx scripts/story-numbers.ts` | Prints every number the data story quotes |
| `npx tsx scripts/challenge-search.ts` | Searches the story's design challenge for the cheapest compliant bridges |
| `npx tsx scripts/hint-check.ts <dir>` | Loads weak bridges into the built game and checks the failure hints |
| `npm run test:examples` | Re-verifies the Starter project's perfect solution (geometry, code checks, cost, load test) |
| `npx tsx scripts/find-examples.ts` | Regenerates the Starter project's perfect solution |
| `npm run video` | Re-records `Span Tutorial.mp4` and its chapters (needs dev server + Google Chrome) |
