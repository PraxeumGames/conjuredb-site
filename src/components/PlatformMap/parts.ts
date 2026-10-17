import type {Status} from '@site/src/components/StatusBadge';

// Every part of the platform and its real status. Single source for the map
// on /platform and the part cards below it — copy is final, do not add claims.

export type GroupId = 'schema' | 'client' | 'server' | 'liveops' | 'services';

/** A "what's in it" line; a few link to the page that explains them. */
export type PartItem = string | {label: string; to: string};

export type Part = {
  id: string; // anchor id on /platform
  name: string;
  group: GroupId;
  status: Status;
  also?: {status: Status; note: string}; // a second badge
  body: string;
  items?: [PartItem, PartItem, PartItem];
  links?: {label: string; to: string}[];
};

/** The four groups around the schema card, in map and page order. */
export const GROUPS: {id: Exclude<GroupId, 'schema'>; title: string}[] = [
  {id: 'client', title: 'Client'},
  {id: 'server', title: 'Server'},
  {id: 'liveops', title: 'Liveops'},
  {id: 'services', title: 'Services'},
];

export const PARTS: Part[] = [
  // Schema
  {
    id: 'schema-compiler',
    name: 'Schema & compiler',
    group: 'schema',
    status: 'shipped',
    body: 'One .conjure schema declares tables, indexes, queries, commands, mutations, modules and frame systems. The compiler binds, type-checks, plans with a cost-based optimizer and emits plain C# — nothing is parsed or planned on the device.',
    items: [
      'Typed diagnostics instead of runtime failures',
      'Explainable plans — read what it picked',
      'Generated code you can open and read',
    ],
    links: [
      {label: 'Getting started', to: '/docs/getting-started'},
      {label: 'Schema language', to: '/docs/schema/schema-language'},
      {label: 'How it works', to: '/how-it-works'},
    ],
  },
  {
    id: 'schema-modules',
    name: 'Schema modules & overrides',
    group: 'schema',
    status: 'shipped',
    body: 'A feature is a module of the schema: its tables, commands and queries in one place. Modules can be overridden by the project that uses them, so a shared feature stays yours to change.',
    items: ['Module declarations in the schema', 'Overrides without forking', {label: 'Vertical slices across client and server', to: '/architecture'}],
    links: [{label: 'Schema language', to: '/docs/schema/schema-language'}],
  },
  {
    id: 'ready-made-modules',
    name: 'Ready-made modules',
    group: 'schema',
    status: 'planned',
    body: 'Battle pass, store, inventory and similar features shipped as schema modules you can read, override and extend — not as a closed SDK.',
    items: ['Battle pass', 'Store', 'Inventory'],
  },
  // Client
  {
    id: 'client-data-layer',
    name: 'Client data layer',
    group: 'client',
    status: 'shipped',
    body: "Compiled queries, commands and mutations over your game's persistent state. Declared indexes, UI views that update themselves by applying only what changed, local persistence with snapshots and a write-ahead journal.",
    items: [
      'Index-aware, zero-allocation query paths',
      'View models maintained by delta (materialized views); reactive queries subscribe to them',
      'Transactions, snapshots, backup and restore',
    ],
    links: [
      {label: 'Reactive queries', to: '/docs/advanced/reactive-queries'},
      {label: 'Engine internals', to: '/docs/engine/database-engine'},
    ],
  },
  {
    id: 'frame-state',
    name: 'Frame state',
    group: 'client',
    status: 'shipped',
    body: 'Per-frame state for positions, projectiles and hit events: chunked struct-of-arrays storage, generational handles and declared systems scheduled per phase, at 0 B per frame. It joins live frame state to persistent tables and their indexes.',
    items: [
      'Ephemeral, event and singleton tables',
      'Declared systems and a frame scheduler',
      'Unity hosting, IL2CPP and Burst kernels',
    ],
    links: [
      {label: 'Ephemeral tables', to: '/docs/advanced/ephemeral-tables'},
      {label: 'Arena example', to: '/docs/examples/arena-ecs'},
    ],
  },
  {
    id: 'determinism',
    name: 'Determinism',
    group: 'client',
    status: 'shipped',
    body: 'Commands are deterministic by construction: a fixed-point math library (Fixed64) instead of floats, seeded random declared in the schema, and tests that hold the device and the server to the same answer. This is what makes server replay possible.',
    items: [
      'Fixed-point math, bit-identical on every platform',
      'Seeded random in the schema (ctx.random)',
      'Parity tests between execution lanes',
    ],
  },
  // Server
  {
    id: 'player-server',
    name: 'Player server',
    group: 'server',
    status: 'prototype',
    body: "The same compiled commands run on the server, one grain per player (Orleans). The player's state lives there as the source of truth; the device keeps a replica and a journal of what the player did. Validated in a backend prototype.",
    items: ['One grain per player, generated from the schema', 'Runs the commands the device runs', 'You host it; the runtime is open'],
  },
  {
    id: 'replay-verification',
    name: 'Replay verification',
    group: 'server',
    status: 'prototype',
    body: "The server replays the device's command journal and compares state hashes. Forged or divergent sessions are rejected and the device is rolled back to the server's state. Commands that need the server travel with the journal and run against the verified state.",
    items: [
      'Microseconds per replayed command',
      'No request per tap, no trust in the client',
      'Verdicts, not heuristics',
    ],
  },
  {
    id: 'shared-state',
    name: 'Shared state',
    group: 'server',
    status: 'planned',
    body: 'Clans, leaderboards and other state that belongs to many players, declared in the same schema and served by their own owner on the server.',
    items: ['Declared ownership and access', 'Same queries as player state', 'Schema keyword, not a separate service'],
  },
  // Liveops
  {
    id: 'liveops',
    name: 'Liveops',
    group: 'liveops',
    status: 'prototype',
    body: 'Rules, offers and queries delivered after the build and executed identically on the device and on the server. Change the game without a release and without the two sides disagreeing. Validated in a prototype.',
    items: ['Runs on the interpreter lane', 'Same verification as everything else', 'No second rules engine'],
  },
  {
    id: 'config-server',
    name: 'Config server',
    group: 'liveops',
    status: 'prototype',
    body: 'Game configuration served per version from its own grains, so old clients keep the config they shipped with while new ones get the new one. Validated in the backend prototype.',
    items: ['Versioned config', 'Same schema types on both sides', 'Rollout without a client release'],
  },
  {
    id: 'portable-interpreter',
    name: 'Portable interpreter',
    group: 'liveops',
    status: 'shipped',
    body: 'A no-JIT, allocation-lean bytecode lane for queries that arrive as content after the build. Same semantics as the compiled lane, verified by differential tests, running wherever AOT runs.',
    items: ['No runtime code generation', 'Bit-identical results to compiled code', 'Fast enough for a frame budget'],
    links: [{label: 'Portable interpreter', to: '/docs/query-language/portable-interpreter'}],
  },
  {
    id: 'ab-groups',
    name: 'A/B groups',
    group: 'liveops',
    status: 'planned',
    body: 'Experiment groups declared in the schema, assigned on the server and read by the same queries the game already runs.',
    items: ['Declared groups', 'Server assignment', 'No special-case code'],
  },
  // Services
  {
    id: 'sign-in',
    name: 'Sign-in',
    group: 'services',
    status: 'planned',
    body: 'Google Play Games and Game Center sign-in wired to the player server.',
    items: ['Platform accounts', 'Guest to account upgrade', 'No credentials on the device'],
  },
  {
    id: 'in-app-purchases',
    name: 'In-app purchases',
    group: 'services',
    status: 'planned',
    body: 'Unity IAP with regional prices; receipts verified on the server and granted by a command, like any other change.',
    items: ['Regional price tables', 'Server-side receipt checks', 'Grants are ordinary commands'],
  },
  {
    id: 'analytics',
    name: 'Analytics',
    group: 'services',
    status: 'planned',
    body: 'Events declared in the schema, with part of the questions answered on the device before anything is sent.',
    items: ['Typed events', 'On-device aggregation', 'Less data leaving the phone'],
  },
];

export const partsIn = (group: GroupId) => PARTS.filter((p) => p.group === group);
