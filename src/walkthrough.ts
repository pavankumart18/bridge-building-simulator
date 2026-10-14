/** Written walkthrough. `ch` links each section to a chapter number in the recorded video. */
export interface GuideSection { ch: string; title: string; steps: string[]; tip?: string }

export const VIDEO_SRC = 'Span%20Tutorial.mp4';

export const GUIDE: GuideSection[] = [
  {
    ch: '1', title: 'Read the project brief',
    steps: [
      'Every project opens with a brief (press <kbd>B</kbd> to reopen it).',
      'Note the <b>span</b>, the <b>design traffic</b> (gross weight and axle loads), the <b>deflection limit</b> (e.g. L/500), the maximum <b>gradient</b>, any <b>clearance zones</b> and the <b>budget</b>.',
      'The <b>Engineering concept</b> box tells you what the project is teaching.',
    ],
  },
  {
    ch: '2', title: 'Understand the site',
    steps: [
      'The <b>red triangles</b> are anchors — fixed foundations. The road on each bank ends at an anchor.',
      'The dashed rectangle is the area you may build in. Orange hatched zones (on some projects) must stay empty.',
      'Navigate with two-finger scroll to pan, pinch or <kbd>⌘</kbd>+scroll to zoom, and <kbd>R</kbd> to recentre.',
    ],
  },
  {
    ch: '3', title: 'Choose the road deck',
    steps: [
      'Click <b>deck</b> in the Tools panel (or press <kbd>1</kbd>). Vehicles can only drive on deck members.',
      'Pick a section in the left panel. Each row shows weight, cost per metre, tension capacity <b>T</b> and compression capacity <b>C@3m</b>.',
      '<b>Timber plank</b> is light and cheap; steel and concrete decks are stiffer but heavier and dearer.',
    ],
  },
  {
    ch: '4', title: 'Build the deck',
    steps: [
      '<b>Drag</b> from the left anchor to place a member. Release to build it; a new joint appears at the end.',
      'Deck panels are at most 3 m long, so build it joint to joint (e.g. five 2 m panels on a 10 m span) until you reach the right anchor.',
      'Hold <kbd>Shift</kbd> to place off-grid. <b>Right-click</b> deletes; <kbd>⌘Z</kbd> undoes.',
      'Watch the right panel: a deck alone sags like a rope and the <b>deflection</b> check turns red.',
    ],
  },
  {
    ch: '5', title: 'Choose a structural material',
    steps: [
      '<b>Timber</b> (<kbd>2</kbd>): cheap and light, but buckles sooner. <b>Steel</b> (<kbd>3</kbd>): strong, stiff, longer reach. <b>Cable</b> (<kbd>4</kbd>): very strong but tension only — it goes slack if pushed.',
      'Choose the section before you draw; you can change it later.',
    ],
  },
  {
    ch: '6', title: 'Make triangles',
    steps: [
      'From each deck joint, drag down (or up) about 1.5 m to make <b>V shapes</b>, then join the new points into a bottom (or top) chord.',
      'Pin-jointed squares fold; triangles cannot change shape without stretching a member. That is what makes a truss stiff.',
      'When the deck, stability, strength, deflection and gradient checks are all green, the panel shows <b>Code compliant</b>.',
    ],
    tip: 'Deeper trusses carry the same load with smaller chord forces.',
  },
  {
    ch: '7', title: 'Read the analysis',
    steps: [
      '<b>Utilisation</b> view colours each member by its factored design force (1.35 × dead + 1.5 × traffic) divided by its design resistance. Green is relaxed; red is above 100%.',
      '<b>Forces</b> view shows tension in blue and compression in red, with values in kN. <kbd>Tab</kbd> cycles views, <kbd>N</kbd> toggles labels, <kbd>D</kbd> shows the exaggerated deflected shape.',
    ],
  },
  {
    ch: '8', title: 'Inspect and size members',
    steps: [
      'Press <kbd>V</kbd> (Select) and click a member. <kbd>Shift</kbd>-click selects several.',
      'The inspector shows length, slenderness <b>L/r</b>, tension resistance, buckling resistance (Euler N<sub>cr</sub>) and the dead and traffic forces.',
      'Change the section from the dropdown (or click a row in the left panel). Make over-used members bigger and lightly loaded ones smaller to save money.',
    ],
    tip: 'Buckling capacity falls with length squared. Shorten struts by adding a joint, or use a stockier section.',
  },
  {
    ch: '9', title: 'Run the load test',
    steps: [
      'Press <b>Load test</b> (<kbd>Space</kbd>). Real vehicles drive across with suspension and dynamics, and members break if overloaded.',
      'Hover a member to read its live force. Use <kbd>P</kbd> pause, <kbd>.</kbd> step, <kbd>F</kbd> speed and <kbd>C</kbd> follow-camera.',
    ],
  },
  {
    ch: '10', title: 'Results and stars',
    steps: [
      '★ <b>Safe crossing</b>: every vehicle reaches the far bank on a stable, continuous bridge within budget.',
      '★ <b>Code compliant</b>: strength, deflection and gradient checks all pass.',
      '★ <b>Efficient</b>: code compliant and at or under 80% of the budget.',
      'Click <b>Back to design</b> to refine, or <b>Next project</b> to continue. Press <kbd>L</kbd> for all projects.',
    ],
  },
  {
    ch: '11', title: 'Playground: traffic',
    steps: [
      'Click <b>Playground</b> in the top bar — unlimited budget and anchors everywhere. Build anything, then press <b>Start sim</b>.',
      'Pick a vehicle and click <b>→ Send</b> or <b>Send ←</b>. <b>Start traffic</b> sends a continuous mixed stream both ways; the slider sets vehicles per minute.',
    ],
  },
  {
    ch: '12', title: 'Playground: drive yourself',
    steps: [
      'Click <b>Drive</b> (or click any vehicle on the bridge) and use <kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd>. Releasing the keys brakes.',
      'The speedometer shows your speed; <b>Hand back to autopilot</b> returns control.',
    ],
  },
  {
    ch: '13', title: 'Playground: drop loads',
    steps: ['Choose 1 t, 5 t or 20 t, then click above the deck to drop a concrete block (tool <kbd>O</kbd>). <b>Clear loads</b> removes them.'],
  },
  {
    ch: '14', title: 'Playground: earthquake',
    steps: ['Set amplitude and frequency with the sliders and press <b>Start ground motion</b>. The anchors shake, and so does your bridge.'],
    tip: 'Use the Playground to compare designs: same layout, different sections, and see how the analysis predicts the test.',
  },
];
