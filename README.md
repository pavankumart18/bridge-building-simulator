# Span — Bridge Engineering Simulator

Design truss, arch and suspension bridges with real materials and section sizes, check them against design-code limits, then load-test them with live traffic.

## Play

**Live:** https://span-bridge-simulator.vercel.app (data story: https://span-bridge-simulator.vercel.app/story.html)


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
- **20 projects in four tiers** — Foundation, Professional, Expert and Landmarks — with client briefs, design traffic, clearance zones and three-star scoring, plus a **Playground** with two-way traffic, manual driving, dropped loads and earthquakes.
- **Expert tier:** *Timber Trail* (timber only), *Heavy Haul* (72 t seven-axle transporter), *Seismic Valley* (an earthquake strikes mid-test; braced tower on a rock spur), *Twin Pier Viaduct* (three spans, truck convoy), *Harbour Cable-Stay* (central tower, shipping channels) and the *Estuary Crossing* finale. Seismic projects add a code load case (elastic plateau 2.5·ag, G ± E_h ± 0.3·E_v) and horizontal + vertical ground motion in the live test. Every Expert and Landmark budget is calibrated from a verified reference design (`scripts/level-solutions.ts`), which is not shipped — players get no worked solution.
- **Landmarks tier:** real bridges scaled to fit, each with a fact box in its brief — *Chenab Arch* (world's highest railway bridge, a deck arch over a Himalayan gorge with trains and an earthquake), *Tower Bridge* (stone towers, the Pool of London channel and double-decker buses), *Hell Gate Arch* (New York's red railway through-arch over the East River) and *Golden Gate* (an 80 m suspension crossing between orange towers on a seismic coast). New vehicles: a 96 t two-car train and a London double-decker.

## Visuals

Members are drawn as real sections — shaded steel box sections, glulam timber with laminations and stranded cables — joined by bolted gusset plates, on bearings and concrete abutments. Decks show the girder or slab face, asphalt, railings and street lamps. Landmark projects get place-specific scenery: Himalayan ranges (Chenab), the London skyline with the Shard, Gherkin and St Paul's and stone quays (Tower Bridge, with its gothic towers and walkways), the Manhattan skyline (Hell Gate, painted red) and the Marin headlands with fog (Golden Gate's orange art-deco towers). Utilisation and Forces views keep the flat, readable colours.

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
| `npm run test:levels` | Verifies every Expert project is solvable at 3★ (reference design passes all checks and the load test, earthquake included) |
| `npx tsx scripts/level-solutions.ts [id]` | Searches and sizes reference designs for the Expert projects and sets their fair budgets |
| `npx tsx scripts/expert-e2e.ts` | Browser check of the Expert tier in the built game |
| `npm run video` | Re-records `Span Tutorial.mp4` and its chapters (needs dev server + Google Chrome) |
