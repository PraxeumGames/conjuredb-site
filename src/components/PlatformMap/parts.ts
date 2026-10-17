import type {Status} from '@site/src/components/StatusBadge';

// Every part of the platform and its real status. Single source for the map
// on /platform and the part cards below it — copy is final, do not add claims.

export type GroupId = 'compiler' | 'device' | 'server' | 'delivery' | 'services';

export type Part = {
  id: string; // anchor id on /platform
  name: string;
  group: GroupId;
  status: Status;
  also?: {status: Status; note: string}; // a second badge
  body: string;
  items: [string, string, string];
  links?: {label: string; to: string}[];
};

export const GROUPS: {id: Exclude<GroupId, 'compiler'>; title: string}[] = [
  {id: 'device', title: 'Device'},
  {id: 'server', title: 'Server'},
  {id: 'delivery', title: 'Delivery'},
  {id: 'services', title: 'Services'},
];

export const PARTS: Part[] = [
  {
    id: 'schema-compiler',
    name: 'Schema & compiler',
    group: 'compiler',
    status: 'shipped',
    also: {status: 'in-progress', note: 'syntax v3, automatic indexes'},
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

  // Device
  {
    id: 'client-data-layer',
    name: 'Client data layer',
    group: 'device',
    status: 'shipped',
    body: "Compiled queries, commands and mutations over your game's persistent state. Declared indexes, screens that update themselves by applying only what changed, local persistence with snapshots and a write-ahead log.",
    items: [
      'Index-aware, zero-allocation query paths',
      'Reactive views maintained by delta',
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
    group: 'device',
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
    group: 'device',
    status: 'shipped',
    body: 'Commands are deterministic by construction: a fixed floating-point math library, seeded random declared in the schema, and tests that hold the device and the server to the same answer. This is what makes server replay possible.',
    items: [
      'Own float math, identical on every platform',
      'Seeded random as a schema feature',
      'Parity tests between execution lanes',
    ],
  },

  // Server
  {
    id: 'player-server',
    name: 'Player server',
    group: 'server',
    status: 'prototype',
    body: "The same compiled commands run in a per-player grain on Orleans. The player's state lives there as the source of truth; the device keeps a replica and a log of what the player did.",
    items: [
      'One grain per player, generated from the schema',
      'No protocol or DTOs to write by hand',
      'You host it; the runtime is open',
    ],
  },
  {
    id: 'replay-verification',
    name: 'Replay verification',
    group: 'server',
    status: 'prototype',
    body: "The server replays the device's action log with the same compiled logic and compares state hashes. Forged or divergent sessions are rejected and the device is rolled back to the server's state.",
    items: [
      'Microseconds per replayed command',
      'No request per tap, no trust in the client',
      'Verdicts, not heuristics',
    ],
  },
  {
    id: 'config-server',
    name: 'Config server',
    group: 'server',
    status: 'planned',
    body: 'Game configuration served per version from its own grains, so old clients keep the config they shipped with while new ones get the new one.',
    items: ['Versioned config', 'Same schema types on both sides', 'Rollout without a client release'],
  },
  {
    id: 'shared-state',
    name: 'Shared state',
    group: 'server',
    status: 'planned',
    body: 'Clans, leaderboards and other state that belongs to many players, declared in the same schema and served from shared grains.',
    items: ['Declared ownership and access', 'Same queries as player state', 'Schema keyword, not a separate service'],
  },

  // Delivery
  {
    id: 'portable-interpreter',
    name: 'Portable interpreter',
    group: 'delivery',
    status: 'shipped',
    body: 'A no-JIT, allocation-lean bytecode lane for queries that arrive as content after the build. Same semantics as the compiled lane, verified by differential tests, running wherever AOT runs.',
    items: ['No runtime code generation', 'Bit-identical results to compiled code', 'Fast enough for a frame budget'],
    links: [{label: 'Portable interpreter', to: '/docs/query-language/portable-interpreter'}],
  },
  {
    id: 'liveops',
    name: 'Liveops',
    group: 'delivery',
    status: 'prototype',
    body: 'Rules, offers and queries delivered after the build and executed identically on the device and on the server. Change the game without a release and without the two sides disagreeing.',
    items: ['Runs on the interpreter lane', 'Same verification as everything else', 'No second rules engine'],
  },
  {
    id: 'schema-modules',
    name: 'Schema modules & overrides',
    group: 'delivery',
    status: 'shipped',
    body: 'A feature is a module of the schema: its tables, commands and queries in one place. Modules can be overridden by the project that uses them, so a shared feature stays yours to change.',
    items: ['Module declarations in the schema', 'Overrides without forking', 'Vertical slices across client and server'],
    links: [{label: 'Schema language', to: '/docs/schema/schema-language'}],
  },
  {
    id: 'ready-made-modules',
    name: 'Ready-made modules',
    group: 'delivery',
    status: 'planned',
    body: 'Battle pass, store, inventory and similar features shipped as schema modules you can read, override and extend — not as a closed SDK.',
    items: ['Battle pass', 'Store', 'Inventory'],
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
    body: 'Unity IAP with regional prices; receipts verified on the server and granted through the same compiled commands.',
    items: ['Regional price tables', 'Server-side receipt checks', 'Grants are ordinary commands'],
  },
  {
    id: 'ab-groups',
    name: 'A/B groups',
    group: 'services',
    status: 'planned',
    body: 'Experiment groups declared in the schema, assigned on the server and read by the same queries the game already runs.',
    items: ['Declared groups', 'Server assignment', 'No special-case code'],
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
