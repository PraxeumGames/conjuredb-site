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
  items?: [string, string, string];
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
    also: {status: 'in-progress', note: 'syntax v3, automatic index creation'},
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
    body: "Compiled queries, commands and mutations over your game's persistent state. Declared indexes, screens that update themselves by applying only what changed, local persistence with snapshots and a write-ahead journal.",
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
    status: 'in-progress',
    body: 'The same compiled logic runs in a self-hosted authoritative backend: sharded ingress, one writer per player aggregate, a command write-ahead journal and snapshots. The device keeps a replica and a journal of what the player did.',
    items: ['One owner per player aggregate', 'HTTP and gRPC ingress, idempotent', 'You host it; the runtime is open'],
  },
  {
    id: 'replay-verification',
    name: 'Replay verification',
    group: 'server',
    status: 'prototype',
    body: "The server replays the device's command journal with the same compiled logic and compares state hashes along the journal's hash chain. A journal that does not replay is rejected and the device is rebased onto the server's state.",
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
    status: 'in-progress',
    body: 'Versioned configuration and liveops artifacts served by the backend with environment promotion, scheduled publishing and delta delivery, so old clients keep a compatible version.',
    items: ['Versioned config with promotion', 'Scheduled publish', 'Delta delivery'],
  },
  {
    id: 'shared-state',
    name: 'Shared state',
    group: 'server',
    status: 'planned',
    body: 'Clans, leaderboards and other state that belongs to many players, declared in the same schema and served by their own owner on the server.',
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
    status: 'in-progress',
    body: 'Rules, offers and experiments compiled into signed, versioned artifacts and evaluated by the same deterministic runtime on the device and on the server; portable query overrides run on the interpreter lane.',
    items: ['Signed, versioned artifacts', 'Deterministic decision runtime on both sides', 'Studio for authoring and rollout'],
  },
  {
    id: 'schema-modules',
    name: 'Schema modules',
    group: 'delivery',
    status: 'shipped',
    body: 'A feature is a module of the schema: its tables, commands and queries in one place, with one generated interface per module and commands named Module.Command.',
    items: ['Module declarations in the schema', 'One interface per module', 'Commands named Module.Command'],
    links: [{label: 'Schema language', to: '/docs/schema/schema-language'}],
  },
  {
    id: 'module-overrides',
    name: 'Module overrides',
    group: 'delivery',
    status: 'planned',
    body: 'Override a shared module from the project that uses it, so a feature stays yours to change without forking.',
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
    status: 'in-progress',
    body: 'Guest accounts, sessions, refresh and account linking are built; Google Play Games and Game Center token verification is next.',
    items: ['Guest to account upgrade', 'Session refresh and revoke', 'Provider linking'],
  },
  {
    id: 'in-app-purchases',
    name: 'In-app purchases',
    group: 'services',
    status: 'in-progress',
    body: 'A provider-agnostic purchase, refund and subscription pipeline with idempotent webhooks and a wallet ledger; store receipt adapters and regional prices are next.',
    items: ['Idempotent entitlement grants', 'Refunds and subscriptions', 'Regional prices (next)'],
  },
  {
    id: 'ab-groups',
    name: 'A/B groups',
    group: 'services',
    status: 'in-progress',
    body: 'Experiments with stable bucketing and holdouts, delivered as liveops artifacts and evaluated the same way on both sides.',
    items: ['Stable bucketing', 'Holdouts', 'Same evaluation on both sides'],
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
