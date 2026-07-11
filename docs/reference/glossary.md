# ConjureDB Glossary

An alphabetical reference of terms, concepts, and components used throughout ConjureDB documentation and source code.

---

### Aggregate Function

A function that computes a single result from a set of input rows. ConjureDB supports built-in aggregate functions such as `sum`, `avg`, `count`, `min`, `max`, `stddev`, `variance`, `array_agg`, and boolean/bitwise aggregates. Aggregate functions appear inside `group` transforms or as inline aggregates in `select`/`derive`.

**See also:** [Functions Reference](/docs/query-language/functions), [Query Language — AGGREGATE](/docs/query-language/reference#aggregate)

### AggregationIndex

A secondary index (`kind: aggregation`) that maintains per-group (per-key) running scalar aggregates (Sum, Count, Avg, Min, Max), O(1) per key. Updates are applied incrementally on each commit. Whole-table/global aggregation is a distinct, runtime-only `GlobalAggregationIndex` that is not declarable via `@index kind:`.

**See also:** [Indexing — Aggregation](/docs/schema/indexing#aggregationindex)

### AOT (Ahead-of-Time) Compilation

The process by which ConjureDB compiles DSL queries into optimized C# source code at build time via a Roslyn source generator. AOT compilation eliminates runtime parsing, expression-tree construction, and reflection — producing code that uses `Span<T>`, `ref readonly`, and `stackalloc` for zero-allocation execution.

**See also:** [Compiled Queries](/docs/query-language/compiled-queries), [Getting Started](/docs/getting-started#what-is-conjuredb)

### ASSERT (Mutation)

A mutation statement that validates a condition against the database and aborts the enclosing transaction if the condition fails. Used to express preconditions in multi-statement mutation pipelines (e.g., `assert all(materials, Quantity >= RequiredQuantity)`).

**See also:** [Mutations — ASSERT](/docs/query-language/mutations#assert)

### Binding / Binder

The compiler stage (`BindingStage`) that performs name resolution, type checking, and scope analysis on the parsed AST. Binding produces a logical IR snapshot (`IrSnapshot`) with resolved column references (`GlobalColumnId`), validated types, and a source map for diagnostics.

**See also:** Compiler Pipeline

### Cascades Optimizer

A cost-based query optimizer modeled after the Cascades framework (as used in SQL Server and CockroachDB). It explores logically equivalent query plans using transformation rules, then selects the cheapest physical plan based on cost estimates. ConjureDB's Cascades optimizer supports predicate pushdown, index selection, projection pruning, TopN fusion, and join reordering.

**See also:** Optimization

### Commit / CommitAsync

The operation that atomically applies all buffered mutations in the current transaction. `Commit()` is synchronous and single-threaded; `CommitAsync` is thread-safe via an internal `SemaphoreSlim`. After commit, primary index updates are immediately visible; secondary index updates are deferred to the background worker.

**See also:** [Transactions](/docs/engine/transactions), [Database Engine](/docs/engine/database-engine#transaction-methods)

### Compiled Mutation

A DSL mutation pipeline compiled ahead-of-time into a zero-allocation C# method. Declared schema-first with the `mutation` keyword in a `.conjure` file (e.g. `mutation DeductGold(pid: string, amount: long) -> int = update PlayerProfiles | filter PlayerId == @pid | set SoftCurrency = SoftCurrency - @amount`); the generator emits a method on the target entity's set, called as `context.PlayerProfiles.DeductGold(pid, amount)` and returning the affected-row count. Supports `update`, `delete`, `insert`, `upsert`, and `assert` statements executing atomically within a single `TransactionScope`.

**See also:** [Mutations](/docs/query-language/mutations)

### Compiled Query

A DSL query compiled ahead-of-time into an optimized, strongly-typed C# method. Declared schema-first with the `query` keyword in a `.conjure` file (e.g. `query GetTopPlayersByScore(limit: int) -> Player[] { from Player | sort -Score | take @limit }`); the generator emits a method on the entity's generated set (also exposed on the `I<Entity>Queries` interface), called as `context.Players.GetTopPlayersByScore(limit)`. The compiler selects optimal indexes, applies predicate pushdown, and emits zero-allocation code.

**See also:** [Compiled Queries](/docs/query-language/compiled-queries)

### Composite Index

An index defined over multiple columns (a composite key). Declared via the table-level `@@index(fields: [...])` annotation in a `.conjure` schema file. Composite indexes enable efficient equality lookups on multi-column predicates.

**See also:** [Indexing](/docs/schema/indexing)

### CrossTableArrayIndex

`IndexType.CrossTableArray` is a reserved, unimplemented enum value: there is no runtime index class and no schema `kind:` keyword for it, so it cannot be declared. Foreign-key access is served by [LookupIndex](#lookupindex) plus generated [Navigation Editors](#navigation-editor).

**See also:** [LookupIndex](#lookupindex), [Navigation Editors](/docs/advanced/navigation-editors)

### CTE (Common Table Expression)

A named subquery that can be referenced later in the main pipeline. In ConjureDB, the supported equivalent is a `let name = (pipeline)` binding or a `| into name` handoff; raw SQL-style `with ... as (...)` text is not part of the supported DSL contract today.

**See also:** [Set Operations — LET Bindings](/docs/query-language/set-operations#let-bindings-ctes)

### DbContext

The central entry point for a ConjureDB database instance. `DbContext` is an abstract class that owns all entity collections (`DbSet<T>`), the transaction manager, persistence layer, background worker, and diagnostics. Subclass it and declare `DbSet<T>` properties; the code generator wires them up automatically.

**See also:** [Database Engine — DbContext](/docs/engine/database-engine#dbcontext)

### DbContextBuilder

A fluent API for configuring and constructing a `DbContext` instance. Allows setting persistence options, encryption, memory budgets, and migration registrations before calling `Build()`.

**See also:** [Database Engine](/docs/engine/database-engine)

### DbSet\<T\>

A typed collection representing a single entity table within a `DbContext`. Provides CRUD operations (`Add`, `Update`, `Remove`), primary-key lookup, secondary index access, change subscriptions, and full-collection access via `All()` (returns `ReadOnlyMemory<T>`).

**See also:** [Database Engine — DbSet](/docs/engine/database-engine#core-types)

### DbWorker

The background thread responsible for deferred secondary index synchronization, journal writes, and snapshot triggers after each transaction commit.

**See also:** [Database Engine — Architecture](/docs/engine/database-engine#architecture-overview)

### Z-set Maintenance

A generated materialized-view component that processes base-table Z-deltas
(inserts, updates, deletes) and incrementally updates a materialized relation
and its indexes. It is the executable component that performs the O(changes)
incremental update described under [IVM (Incremental View Maintenance)](#ivm-incremental-view-maintenance).

**See also:** [Reactive Queries](/docs/advanced/reactive-queries)

### DERIVE (Transform)

A pipeline transform that adds new computed columns to the current row set without removing existing columns (equivalent to SQL `SELECT *, expr AS alias`). Use `derive` when you need to extend rows with calculated values.

**See also:** [Query Language — DERIVE](/docs/query-language/reference#derive)

### DISTINCT

A pipeline transform that removes duplicate rows from the result set, equivalent to SQL `SELECT DISTINCT`. Applied after projection to deduplicate on the selected columns.

**See also:** [Query Language — DISTINCT](/docs/query-language/reference#distinct)

### DSL (Domain-Specific Language)

ConjureDB's pipeline-based query language for defining compiled queries and mutations. Inspired by PRQL and functional data transformation patterns, it uses pipe syntax (`|`) where data flows through a linear chain of transforms. DSL queries are compiled to C# at build time.

**See also:** [Query Language Reference](/docs/query-language/reference)

### Entity

A C# record generated from a `table` declaration in a `.conjure` schema, representing a row in a ConjureDB table. Entities are identified by an `int` primary key (`Id`) and serialized via MessagePack attributes. Each entity type occupies a dedicated `DbSet<T>`.

**See also:** [Getting Started — Defining Entities](/docs/getting-started#defining-entities)

### Expression DAG

The internal directed acyclic graph representation of expressions within the compiler's intermediate representation. Expression nodes (comparisons, arithmetic, function calls, column references) form a DAG that enables common subexpression elimination and efficient optimization.

**See also:** Compiler Pipeline

### FILTER (Transform)

A pipeline transform that selects rows matching a boolean predicate, equivalent to SQL `WHERE`. The optimizer pushes filters toward data sources and selects appropriate indexes for evaluation.

**See also:** [Query Language — FILTER](/docs/query-language/reference#filter)

### Foreign Key / @relation

A relationship declaration between two entity tables. In the schema DSL, `@relation` annotates a field to declare a foreign-key reference to another table. The compiler validates referential integrity and uses FK metadata for join optimization and navigation editor generation.

**See also:** [Schema Language — Relations](/docs/schema/schema-language)

### Fragment (Schema)

A reusable schema block in `.conjure` files that can be included in multiple table definitions via the `fragment` keyword. Fragments promote DRY schema definitions by extracting common field groups (e.g., audit timestamps, soft-delete flags).

**See also:** [Schema Language](/docs/schema/schema-language)

### FROM (Data Source)

The starting clause of a query pipeline that specifies the source table. `from TableName` binds the pipeline to a `DbSet<T>` and establishes the initial row set and column scope for subsequent transforms.

**See also:** [Query Language — FROM Clause](/docs/query-language/reference#from-clause)

### GlobalColumnId

A stable, compiler-internal identifier for a column that survives all optimization and planning stages. Unlike name-based matching, `GlobalColumnId` provides identity stability across joins, projections, and subqueries.

**See also:** Design Contracts

### GROUP (Transform)

A pipeline transform that partitions rows by one or more key expressions and applies aggregate functions to each group, equivalent to SQL `GROUP BY`. The syntax is `group keys (aggregate functions)`.

**See also:** [Query Language — GROUP](/docs/query-language/reference#group)

### GroupedSortedIndex

A secondary index that maintains per-group sorted lists, optimized for "Top-N per group" access patterns. Rows are partitioned by a group key and sorted within each partition, enabling O(1) group lookup followed by ordered iteration.

**See also:** [Indexing — GroupedSorted](/docs/schema/indexing#groupedsortedindex)

### Inline Aggregate

An aggregate function used directly in a `select` or `derive` expression without an explicit `group` transform. The compiler detects inline aggregates and rewrites them into the appropriate grouping operations during binding.

**See also:** [Query Language — AGGREGATE](/docs/query-language/reference#aggregate)

### IVM (Incremental View Maintenance)

The mechanism by which supported materialized-view and reactive-query shapes
update materialized results incrementally. Instead of re-executing the source
query on each commit, executable Z-set maintainers apply O(changes) delta
operations to the existing result. Shapes outside the current maintainer matrix
fail compilation with typed diagnostics.

**See also:** [Reactive Queries](/docs/advanced/reactive-queries)

### Index / Indexing

A data structure that provides sub-linear access paths (O(1) or O(log n)) to entities in a `DbSet<T>`. ConjureDB provides primary and secondary index types. The compiler enforces indexed access: unindexed access patterns produce hard compilation errors.

**See also:** [Indexing Reference](/docs/schema/indexing)

### JOIN (Transform)

A pipeline transform that combines rows from two tables based on a join predicate. ConjureDB supports `inner`, `left`, `right`, `full`, `semi`, and `anti` join types. The syntax is `join Table alias (predicate)` with an optional join-type prefix. The optimizer selects join strategies (hash, nested-loop, index) based on available indexes and PGO data.

**See also:** [Query Language — JOIN](/docs/query-language/reference#join)

### Journal (WAL)

The write-ahead log maintained by `DbPersistence`. After each commit, the background worker writes a `ChangeRecord` entry and a `TransactionEnd` marker to the journal file. On crash recovery, uncommitted journal entries are replayed on top of the most recent snapshot to restore the database to its last consistent state.

**See also:** [Persistence](/docs/engine/persistence)

### LET Binding

A named subquery declaration at the top of a query module (`let name = (pipeline)`) that defines a reusable intermediate result. LET bindings are the supported DSL surface for SQL-like named-subquery composition and are inlined by the optimizer during planning.

**See also:** [Set Operations — LET Bindings](/docs/query-language/set-operations#let-bindings-ctes)

### LookupIndex

A hash-based secondary index for non-unique equality lookups. The workhorse for `filter Column == value` queries, providing O(1) amortized access. LookupIndex is type-specialized to avoid boxing (e.g., Fibonacci hashing for `int` keys).

**See also:** [Indexing — LookupIndex](/docs/schema/indexing#lookupindex)

### Materialized View

A derived in-memory relation declared in schema or synthesized internally for a
reactive query. A materialized view holds the current result and is updated
incrementally through Z-set maintenance on each commit.

**See also:** [Reactive Queries](/docs/advanced/reactive-queries)

### MemoryBudget

A configuration parameter on `DbContextBuilder` that limits the total memory available to the database instance. Controls capacity growth, buffer pool sizing, and snapshot allocation.

**See also:** [Database Engine](/docs/engine/database-engine)

### Migration

A registered transformation that converts persisted entity data from an older schema version to the current one. Migrations are keyed by `TypeId` and `SchemaVersion` and execute binary-level conversion during snapshot loading when the stored schema fingerprint differs from the current definition.

**See also:** [Schema Migration](/docs/schema/schema-migration)

### Mutation

A write operation that modifies database state. ConjureDB supports five mutation statements: `update`, `delete`, `insert`, `upsert`, and `assert`. All mutations execute within a transaction and are buffered until `Commit()`.

**See also:** [Mutations](/docs/query-language/mutations), [Transactions](/docs/engine/transactions)

### Navigation Editor

A generated `ref struct` type that provides zero-allocation, type-safe access to parent-child entity relationships. Navigation editors are generated from `@@navigation(...)` and `@@index(..., kind: lookup)` metadata in a `.conjure` schema, enabling fluent traversal and cascading mutations without heap allocations.

**See also:** [Navigation Editors](/docs/advanced/navigation-editors)

### NoAlloc

A variant of compiled query or mutation that guarantees zero heap allocations during execution. NoAlloc methods use `Span<T>`, `stackalloc`, and `ref struct` patterns to keep all data on the stack. `NoAlloc` is a method-name suffix (e.g. `GetTopPlayersNoAlloc`) on the generated entity set, returning `DisposableQueryResult<T>`; it is generated on the concrete set, not declared on the `I<Entity>Queries` interface.

**See also:** [Compiled Queries — NoAlloc Variants](/docs/query-language/compiled-queries#noalloc-variants)

### NULL Coalescing (??)

The null coalescing operator in the query DSL, equivalent to SQL `COALESCE`. Returns the left operand if it is non-null, otherwise returns the right operand. Used for providing default values in nullable column expressions.

**See also:** [Query Language — NULL Handling](/docs/query-language/reference#null-handling)

### Parameter (@param)

A query or mutation parameter, prefixed with `@` in the DSL. Parameters are declared in the schema header as `name: Type` and referenced in pipeline expressions with a leading `@`; they bind to the arguments of the generated method on the entity set and are type-checked at compile time. Example: `filter Level > @minLevel`.

**See also:** [Query Language — Parameters](/docs/query-language/reference#parameters)

### PGO (Profile-Guided Optimization)

A two-phase optimization strategy where runtime statistics (collected by building codegen with the `--pgo` flag, which sets the MSBuild property `ConjureDBPgoMode=Collect`) are exported as a JSON profile and fed back into the compiler. PGO data guides strategy selection for joins, aggregations, sorting, buffer sizing, and operator fusion — producing code optimized for the observed workload.

**See also:** [Profile-Guided Optimization](/docs/performance/pgo)

### Pipeline / Pipe Syntax

The core syntactic pattern of the ConjureDB DSL. Queries are composed as a chain of transforms separated by the pipe operator (`|`), with data flowing linearly from top to bottom. This eliminates the nested subquery structure of SQL.

**See also:** [Query Language — Pipeline Structure](/docs/query-language/reference#pipeline-structure)

### PrimaryIndex\<T\>

The automatic, always-present index for every `DbSet<T>`, keyed by the entity's `int Id`. Uses dense, contiguous storage with a separate ID-to-slot mapping for O(1) lookups. Primary index mutations take effect immediately (synchronous consistency).

**See also:** [Indexing — PrimaryIndex](/docs/schema/indexing#primaryindex)

### Projection / SELECT (Transform)

A pipeline transform that selects a subset of columns from the current row set, equivalent to SQL `SELECT`. The optimizer applies projection pruning to eliminate unused columns early in the plan.

**See also:** [Query Language — SELECT](/docs/query-language/reference#select)

### RangeLookupIndex

A secondary index using sparse min/max arrays that answers "does any row exist where column is in range?" queries in O(1) time. Optimized for existence checks with range predicates rather than returning matching rows.

**See also:** [Indexing — RangeLookup](/docs/schema/indexing#rangelookupindex)

### Reactive Query

A compiled query annotated with `reactive query`. When its shape is supported
by the Z-set maintainer matrix, it exposes a live `ReactiveQuery<T>` facade over
a named materialized view or a hidden compiler-owned `ReactiveAutoView`.
Unsupported shapes fail compilation with typed diagnostics instead of producing
a query-time execution path.

**See also:** [Reactive Queries](/docs/advanced/reactive-queries)

### ref readonly

A C# language feature used extensively in ConjureDB's generated code and API. `ref readonly` returns allow reading entity data directly from the primary index storage without copying, achieving zero-allocation access patterns.

**See also:** [Getting Started](/docs/getting-started), [Navigation Editors](/docs/advanced/navigation-editors)

### Schema DSL (.conjure)

The declarative domain-specific language for defining data models in `.conjure` files. A schema-first alternative to C# schema-first definitions, it specifies tables, enums, custom types, indexes, queries, mutations, and fragments in a single source of truth. The schema compiler generates all required C# artifacts.

**See also:** [Schema Language Reference](/docs/schema/schema-language)

### SchemaVersion

An explicit version number assigned to a table via the `schema_version: N` table option in a `.conjure` schema. Combined with `TypeId` and field descriptors, it forms the schema fingerprint used to detect breaking changes during snapshot loading.

**See also:** [Schema Migration](/docs/schema/schema-migration)

### Secondary Index

Any index beyond the automatic `PrimaryIndex<T>`. Secondary indexes use a deferred-commit consistency model: they are maintained by the background worker thread after each transaction commit. Types include Lookup, Unique, SortedSet, SortedList, RangeLookup, GroupedSorted, Aggregation, UniversalAggregation, and SpatialGrid.

**See also:** [Indexing — Overview](/docs/schema/indexing#overview)

### SELECT (Transform)

See [Projection / SELECT](#projection--select-transform).

### Snapshot

A full-state binary dump of the entire database written to disk by the persistence layer. Snapshots provide a baseline for crash recovery; journal entries are replayed on top of the most recent snapshot during startup. Delta snapshots capture only changes since the last full snapshot.

**See also:** [Persistence](/docs/engine/persistence)

### SORT (Transform)

A pipeline transform that orders rows by one or more expressions, equivalent to SQL `ORDER BY`. Prefix a column with `-` for descending order. The optimizer fuses adjacent `sort` and `take` into a TopN operator when possible.

**See also:** [Query Language — SORT](/docs/query-language/reference#sort)

### SortedSetIndex

A secondary index backed by a `SortedSet<Group>` with cached arrays, providing O(log n) lookups for equality, range, and ordering queries. Ideal for range scans and `ORDER BY` access patterns.

**See also:** [Indexing — SortedSet](/docs/schema/indexing#sortedsetindex)

### Subquery

A nested pipeline expression used as a data source, a scalar value, or a set membership test within a larger query. Subqueries can appear in `from`, `filter` (via `IN`, `EXISTS`), `select`, and `derive` contexts. The optimizer inlines or decorrelates subqueries during planning.

**See also:** [Query Language — Subquery Expressions](/docs/query-language/reference#subquery-expressions)

### table (Schema Declaration)

The schema-first declaration that defines a ConjureDB entity table in a `.conjure` file. Specifies the table name, persistence type, capacity, and `type_id`. Example: `table Player(plural: Players, persistence: local, capacity: 1024, type_id: 1) { ... }`.

**See also:** [Getting Started — Defining Entities](/docs/getting-started#defining-entities), [Database Engine](/docs/engine/database-engine)

### TAKE / SKIP

Pipeline transforms that limit (`take N`) or offset (`skip N`) the number of rows returned, equivalent to SQL `LIMIT` / `OFFSET`. When preceded by `sort`, the optimizer may fuse them into a TopN physical operator.

**See also:** [Query Language — TAKE](/docs/query-language/reference#take), [Query Language — SKIP](/docs/query-language/reference#skip)

### Transaction / TransactionScope

The unit of atomic, consistent work in ConjureDB. All mutations are buffered within a transaction begun by `BeginTransaction()` and applied atomically on `Commit()`. ConjureDB uses a single-writer, multi-reader model with monotonically increasing version numbers.

**See also:** [Transactions](/docs/engine/transactions)

### Transform

A pipeline operator in the ConjureDB DSL that processes and reshapes data flowing through the pipe. Each transform takes the output of the previous stage and produces a new row set. Core transforms include `filter`, `select`, `derive`, `join`, `group`, `sort`, `take`, `skip`, and `distinct`.

**See also:** [Query Language — Transforms](/docs/query-language/reference#transforms-operators)

### TypeId

A stable numeric identifier (1-65535) assigned to a persisted table via the `.conjure` `type_id` option. Used in persistence to match stored data to entity types across application versions, independent of CLR type names.

**See also:** [Schema Migration](/docs/schema/schema-migration)

### ConjureDB

A high-performance NoSQL in-memory database designed for game clients, embedded applications, and latency-sensitive systems. Features zero-allocation compiled queries, a Cascades-based query optimizer, AOT source generation, persistent storage with optional AES-256 encryption, and Unity 2021.3+ support.

**See also:** README

### UniqueIndex

A secondary index that enforces a uniqueness constraint on a column or composite key. Backed by a custom key→id hash map (`NullableKeyDictionary<TKey, int>`) with O(1) lookup. Insert or update operations that violate uniqueness produce an error at commit time.

**See also:** [Indexing — UniqueIndex](/docs/schema/indexing#uniqueindex)

### UniversalAggregationIndex

A secondary index that maintains per-group aggregation statistics (Sum, Avg, Count, Min, Max) using `Dictionary<TKey, Stats>`. Provides O(1) lookup for grouped aggregate values without requiring a full-table scan.

**See also:** [Indexing — UniversalAggregation](/docs/schema/indexing#universalaggregationindex)

### UPSERT

A mutation statement that inserts a new entity if no matching row exists, or updates the existing row if it does. Provides atomic insert-or-update semantics within a compiled mutation pipeline.

**See also:** [Mutations — UPSERT](/docs/query-language/mutations#upsert)

### Window Function

A function that computes a value across a set of rows related to the current row, without collapsing the result into a single group. ConjureDB supports built-in window functions across ranking, navigation, and windowed aggregate categories, including `row_number`, `rank`, `dense_rank`, `lag`, `lead`, `ntile`, `first_value`, and `last_value`. Defined using the `window` transform in the DSL.

**See also:** [Query Language — WINDOW](/docs/query-language/reference#window), [Functions Reference](/docs/query-language/functions#window-functions)

### Zero-Allocation

A design constraint enforced throughout ConjureDB's runtime and generated code. Hot-path operations must produce no heap allocations, using `Span<T>`, `stackalloc`, `ref struct`, `ref readonly` returns, and value types to eliminate GC pressure. Compiler-time allocations are acceptable when they improve maintainability.

**See also:** [Compiled Queries — NoAlloc Variants](/docs/query-language/compiled-queries#noalloc-variants), [Navigation Editors](/docs/advanced/navigation-editors)
