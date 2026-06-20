# Error and Diagnostic Codes

Complete reference for all ConjureDB compiler, schema, and runtime diagnostic codes.

> **Modeled after PostgreSQL Appendix A — Error Codes.**
> Every code emitted by the compiler or schema processor is documented here with severity, description, and remediation guidance.

---

## How Diagnostics Work

ConjureDB uses a structured diagnostic system across two subsystems:

| Subsystem | Prefix | Format | Example |
|---|---|---|---|
| Compiler | `UM` | `UM{category}{number}` (6 chars) | `UM1001` |
| Schema | `SCH` | `SCH{category}{number}` | `SCH2001` |
| Binding Resolution | `BIND_RES` | `BIND_RES_{number}` | `BIND_RES_001` |
| Binding Build (IR) | `BIND_BLD` | `BIND_BLD_{number}` | `BIND_BLD_001` |
| Binding Contract | `BIND_CONTRACT` | fixed string | `BIND_CONTRACT` |
| Join Planning | `JOIN` | `JOIN{number}` | `JOIN0001` |

### Severity Levels

| Level | Meaning |
|---|---|
| **Error** | Query cannot be compiled. Must be fixed before code generation proceeds. |
| **Warning** | Query compiles but may have performance or correctness issues. |
| **Info** | Informational notice; no action required. |

### Where Diagnostics Appear

- **MSBuild output** — during source-generator compilation.
- **IDE** — as squiggles / warning list in Visual Studio / Rider.
- **`[DebugGeneration]`** — attach attribute to emit optimization trace as code comments.
- **`CompilerDiagnostic.ToString()`** — formatted as `"{Id} {Location}: {Message}"`.

### Diagnostic Structure

Each `CompilerDiagnostic` contains:

| Field | Type | Description |
|---|---|---|
| `Id` | `CompilerDiagnosticId` | Strongly-typed code (e.g., `UM1001`) |
| `Severity` | `DiagnosticSeverity` | Error / Warning / Info |
| `Message` | `string` | Human-readable description |
| `Location` | `SourceLocation` | Source position (line, column) if available |
| `OriginNodeId` | `IrNodeId?` | IR node for late-binding location mapping |
| `Timestamp` | `DateTimeOffset` | When the diagnostic was created |

---

## Internal Errors (UM0xxx)

Internal errors indicate compiler bugs or infrastructure problems. Users should never see these under normal operation.

| Code | Name | Severity | Message | Description | Action |
|---|---|---|---|---|---|
| `UM0000` | `Unknown` | Error | Unknown diagnostic | Placeholder for unclassified diagnostics. Should never appear in production. | Report as bug with full query text. |
| `UM0001` | `InternalError` | Error | Internal compiler error | An unexpected condition occurred inside the compiler pipeline. | Report as bug. Include the query, schema, and full diagnostic output. |
| `UM0002` | `InvariantViolation` | Error | Compiler invariant violated | A structural invariant assumed by the compiler was broken. This is always a compiler bug. | Report as bug. The optimizer or planner encountered an impossible state. |
| `UM0003` | `PipelineValidationError` | Error | Pipeline validation failed | The compiler pipeline detected an inconsistency between stages (e.g., missing output from a prior stage). | Report as bug. May indicate a stage was skipped or produced invalid output. |
| `UM0004` | `MissingSchema` | Error | Schema metadata is missing or empty | No schema was provided to the compiler, or the schema contains zero table definitions. | Ensure your `.conjure` schema file is present and contains at least one `table` declaration. |

**Example triggering UM0004:**
```text
// No schema file referenced — compiler has no metadata.
// Declare the query in a .conjure schema (which also supplies the schema metadata):
query GetUserNames() -> string[] {
    from Users | select Name
}
```
```csharp
// Then call the generated method on the entity set:
string[] names = context.Users.GetUserNames();  // UM0004 occurs when no schema metadata exists
```

---

## Semantic Errors (UM1xxx)

Semantic errors occur during name resolution, type checking, and semantic validation. These are the most common user-facing errors.

### Table and Column Resolution (UM1001–UM1009)

| Code | Name | Severity | Message | Description | Action |
|---|---|---|---|---|---|
| `UM1001` | `MissingTableAlias` | Error | Table referenced without alias in multi-table context | When multiple tables are in scope (e.g., after a JOIN), column references must be qualified with a table alias. | Add table alias: `u.Name` instead of `Name`. |
| `UM1002` | `AmbiguousColumnReference` | Error | Column reference is ambiguous | A column name exists in more than one table in scope, and no alias was used to disambiguate. | Qualify the column with a table alias: `u.Name` or `o.Name`. |
| `UM1003` | `MissingSource` | Error | No source table in scope | A query expression references columns but no `from` clause introduced a table. | Ensure your pipeline starts with `from TableName`. |
| `UM1004` | `DuplicateAlias` | Error | Alias already defined for different table | Two tables in the same scope share the same alias. | Use distinct aliases for each table/join source. |
| `UM1005` | `InvalidAggregateUsage` | Error | Aggregate function used incorrectly | An aggregate function (SUM, COUNT, etc.) appears in a context where it is not allowed, such as a WHERE clause or nested inside another aggregate. | Move aggregate to SELECT or GROUP clause. Use a subquery or CTE for complex cases. |
| `UM1006` | `InvalidWindowFrame` | Error | Invalid window frame specification | The ROWS/RANGE frame specified for a window function is invalid (e.g., start > end). | Check frame bounds. See UM1037–UM1040 for specific frame errors. |
| `UM1007` | `UnknownTable` | Error | Table not found in schema | The table name used in `from` does not match any table in the schema. | Check spelling. Verify the table is declared in your `.conjure` schema file. |
| `UM1008` | `UnknownColumn` | Error | Column not found on entity | The referenced column does not exist on the target table. | Check column name spelling. Run schema validation to see available columns. |
| `UM1009` | `TypeMismatch` | Error | Type mismatch in expression | Operand types are incompatible (e.g., comparing string to int without a cast). | Check operand types. Use explicit CAST if conversion is intended. |

**Example triggering UM1001:**
```
from Users u
| join Orders o (u.Id == o.UserId)
| select Name, o.Total
         ^^^^ UM1001: Must qualify as u.Name
```

**Example triggering UM1007:**
```
from Userz
     ^^^^^ UM1007: Table 'Userz' not found in schema
```

### Binding Semantic Errors (UM1010–UM1028)

| Code | Name | Severity | Message | Description | Action |
|---|---|---|---|---|---|
| `UM1010` | `DuplicateLetBinding` | Error | Let binding already defined | A `let` variable with the same name is declared twice in the same scope. | Rename one of the bindings to a unique name. |
| `UM1011` | `LetBindingNullRoot` | Error | Let binding produced null root | Internal: the let binding resolved to a null expression tree. | Simplify the let expression or report as bug if the expression looks valid. |
| `UM1012` | `UntypedParameter` | Error | Parameter type cannot be inferred | A query parameter was used but its CLR type could not be determined. | Declare the parameter with an explicit type in the schema query header: `query GetById(id: int) -> ...`. |
| `UM1013` | `CaseTypeMismatch` | Error | CASE expression has incompatible branch types | The THEN/ELSE branches of a CASE return different types that cannot be unified. | Ensure all branches return the same type, or add explicit CASTs. |
| `UM1014` | `AmbiguousColumn` | Error | Column reference is ambiguous between multiple tables | Same as UM1002 but raised during binding phase. Column matches multiple sources. | Qualify with table alias. |
| `UM1015` | `UnknownNavigationProperty` | Error | Navigation property not found on entity | A navigation (foreign key traversal) path references a property that doesn't exist. | Check the navigation property name and verify the FK relationship in schema. |
| `UM1016` | `CircularNavigation` | Error | Circular navigation reference detected | Navigation properties form a cycle (A → B → A). | Break the cycle by using explicit JOINs instead of navigation. |
| `UM1017` | `AggregateMissingArgument` | Error | Aggregate function requires argument | An aggregate like SUM or AVG was called without an argument (except COUNT which allows `*`). | Provide an argument: `sum(Amount)` instead of `sum()`. |
| `UM1018` | `UnknownAggregateFunction` | Error | Unknown aggregate function | The function name is not recognized as a built-in or UDF aggregate. | Check spelling. Supported: `count`, `sum`, `avg`, `min`, `max`, `bool_and`, `bool_or`. |
| `UM1019` | `DuplicateAggregateAlias` | Error | Duplicate aggregate alias | Two aggregates in the same GROUP/SELECT produce columns with the same name. | Use explicit aliases: `sum(a) as total_a, sum(b) as total_b`. |
| `UM1020` | `SetOperationArityMismatch` | Error | Set operation arity mismatch | UNION/INTERSECT/EXCEPT sides have different column counts. | Ensure both sides of the set operation SELECT the same number of columns. |
| `UM1021` | `SetOperationTypeMismatch` | Error | Set operation type mismatch | Corresponding columns in a set operation have incompatible types. | Align types with CASTs or select compatible columns. |
| `UM1022` | `ExistsSubqueryError` | Error | EXISTS subquery error | An EXISTS subquery is malformed or references invalid scope. | Check subquery syntax and ensure it references valid outer scope columns. |
| `UM1023` | `InvalidLimitOffset` | Error | Invalid TAKE/SKIP value | TAKE or SKIP has a non-positive value or is out of Int32 range. | Use a positive integer literal or parameter for TAKE/SKIP. |
| `UM1024` | `DeriveColumnError` | Error | Derive column expression error | A computed column in `derive` could not be resolved. | Check the expression syntax and referenced columns. |
| `UM1025` | `FunctionArgumentError` | Error | Function argument error | Wrong number or type of arguments passed to a function. | Check function signature. See `QueryLanguage.md` for built-in function reference. |
| `UM1026` | `CaseImplicitConversion` | Warning | Implicit type conversion in CASE expression | CASE branches have different types that were implicitly converted. May lose precision. | Add explicit CASTs to make the conversion intentional. |
| `UM1027` | `AmbiguousNavigationPath` | Error | Navigation path is ambiguous | Multiple navigation paths exist between two entities; the compiler cannot pick deterministically. | Qualify the navigation or use an explicit JOIN with a specific FK. |
| `UM1028` | `NavigationLineageUnavailable` | Error | Navigation path cannot be expanded — lineage metadata unavailable | The compiler cannot trace the FK chain because required metadata is missing. | Ensure all FK relationships are declared in the schema with `@relation`. |

**Example triggering UM1020:**
```
from Users | select Name, Age
| union
from Orders | select OrderId
                     ^^^^^^^ UM1020: Left has 2 columns, right has 1
```

### SQL Semantic Validation (UM1030–UM1042)

| Code | Name | Severity | Message | Description | Action |
|---|---|---|---|---|---|
| `UM1030` | `BinaryOperatorTypeMismatch` | Error | Binary operator type mismatch | Left and right operands of a binary operator have incompatible types (e.g., `int + string`). | Check operand types. Use CAST to align types. |
| `UM1031` | `AggregateRequiresNumeric` | Error | SUM/AVG requires numeric argument | SUM or AVG was applied to a non-numeric column (e.g., a string). | Use a numeric column or CAST the value. |
| `UM1032` | `AggregateRequiresComparable` | Error | MIN/MAX requires comparable type | MIN or MAX was applied to a type that doesn't support comparison. | Use a comparable type (numeric, string, DateTime). |
| `UM1033` | `AggregateRequiresBoolean` | Error | BOOL_AND/BOOL_OR requires boolean argument | Boolean aggregate applied to non-boolean column. | Ensure the argument is a boolean expression. |
| `UM1034` | `NestedAggregate` | Error | Nested aggregate functions not allowed | An aggregate contains another aggregate: `sum(count(x))`. | Split into a subquery or use GROUP + derive. |
| `UM1035` | `AggregateInWhere` | Error | Aggregate function not allowed in WHERE clause | Aggregates cannot appear in filter predicates. | Move the condition to a HAVING clause (via `filter` after `group`). |
| `UM1036` | `FunctionTypeMismatch` | Error | Function argument type mismatch | A function was called with arguments of incorrect type. | Check function signature and argument types. |
| `UM1037` | `InvalidWindowFrameBounds` | Error | Invalid window frame bounds | Window frame start is after the end (e.g., `ROWS BETWEEN 5 FOLLOWING AND 2 PRECEDING`). | Ensure frame start ≤ frame end. |
| `UM1038` | `InvalidWindowFrameStart` | Error | UNBOUNDED FOLLOWING cannot be frame start | Frame start cannot be UNBOUNDED FOLLOWING. | Use UNBOUNDED PRECEDING or a concrete offset for the start bound. |
| `UM1039` | `InvalidWindowFrameEnd` | Error | UNBOUNDED PRECEDING cannot be frame end | Frame end cannot be UNBOUNDED PRECEDING. | Use UNBOUNDED FOLLOWING or a concrete offset for the end bound. |
| `UM1040` | `WindowOffsetMustBeNumeric` | Error | LAG/LEAD offset must be numeric | The offset argument to LAG or LEAD is not a numeric type. | Pass an integer literal for the offset. |
| `UM1041` | `SetOperationColumnTypeMismatch` | Error | SET operation column type mismatch | Post-validation detected incompatible column types across UNION/INTERSECT/EXCEPT sides. | Align column types with explicit CASTs. |
| `UM1042` | `OuterJoinFilterWarning` | Warning | Outer join filter may change join semantics | A filter on the nullable side of a LEFT/RIGHT JOIN may convert it to an INNER JOIN. | Move the filter into the JOIN predicate, or confirm the semantic change is intentional. |

**Example triggering UM1034:**
```
from Orders
| group UserId
| select UserId, sum(count(Amount))
                 ^^^^^^^^^^^^^^^^^^ UM1034: Nested aggregate
```

**Example triggering UM1042:**
```
from Users u
| join left Orders o (u.Id == o.UserId)
| filter o.Status == "Active"
         ^^^^^^^^^^^^^^^^^^^^ UM1042: Filter on nullable side converts LEFT JOIN to INNER JOIN
```

### UDF Validation (UM1050–UM1052)

| Code | Name | Severity | Message | Description | Action |
|---|---|---|---|---|---|
| `UM1050` | `UdfInvalidSignature` | Error | UDF has invalid method signature | UDF method uses unsupported features: generics, ref/out parameters, params, or optional parameters. | Simplify the UDF signature to use only concrete value-type or string parameters. |
| `UM1051` | `UdfUnresolvableType` | Error | UDF parameter or return type cannot be resolved | The CLR type of a UDF parameter or return value cannot be mapped to a query type. | Use supported types: primitives, string, DateTime, enums defined in schema. |
| `UM1052` | `UdfMutableCollection` | Error | UDF uses mutable collection type | UDF signature includes `List<T>`, `HashSet<T>`, or similar mutable collections. | Use `ImmutableArray<T>` or return a scalar value. |

---

## Canonicalization / Lowering Errors (UM2xxx)

These errors occur during the transition from the bound AST to the semantic IR (SIR). They indicate structural problems in the query plan.

| Code | Name | Severity | Message | Description | Action |
|---|---|---|---|---|---|
| `UM2001` | `MissingSourceRelation` | Error | Source relation missing from IR | A relational node references a source table that was not included in the IR. | Likely a compiler bug. Report with full query. |
| `UM2002` | `MissingPayload` | Error | Required payload missing from semantic node | A semantic IR node is missing required metadata (e.g., output column descriptors). | Likely a compiler bug. Report with full query. |
| `UM2003` | `EmptyPlan` | Error | Semantic plan is empty | The binding phase produced no relational nodes — the query is effectively empty. | Ensure your query has at least a `from` and one operator (select, filter, etc.). |
| `UM2004` | `InvalidSubquery` | Error | Invalid subquery structure | A subquery has an invalid shape (e.g., missing FROM, empty body). | Check subquery syntax. Ensure it starts with `from` and produces output. |
| `UM2005` | `ColumnNotFound` | Error | Column not found during IR construction | A column referenced during IR lowering does not exist in the available output scope. | May indicate a column was pruned too early. Check SELECT clause and report if query looks valid. |

---

## IR / Optimization Errors (UM3xxx)

These errors occur during IR validation and Cascades optimization.

| Code | Name | Severity | Message | Description | Action |
|---|---|---|---|---|---|
| `UM3001` | `IrValidationError` | Error | IR validation failed | The IR snapshot failed structural validation after binding or optimization. | Report as bug. The optimizer produced an invalid plan. |
| `UM3002` | `OptimizationError` | Error | Optimization rule failed | A Cascades optimization rule threw an exception during application. | Report as bug. Include full query and schema. |

---

## Physical Planning Errors (UM4xxx)

These errors occur during the physical plan generation phase — when the optimizer maps logical operators to physical implementations.

| Code | Name | Severity | Message | Description | Action |
|---|---|---|---|---|---|
| `UM4001` | `PhysicalPlanningError` | Error | Physical plan generation failed | The planner could not generate a valid physical plan from the logical IR. | Check that all required indexes exist. Simplify the query if possible. |
| `UM4002` | `EmptyIrSnapshot` | Error | IR snapshot is empty | The logical IR passed to planning is empty. | Ensure the binding and optimization stages produced output. Likely a compiler bug. |
| `UM4003` | `UnsupportedDecorrelationPattern` | Error | Unsupported decorrelation pattern | The planner cannot decorrelate a correlated subquery (e.g., nested subqueries, non-equality correlation predicates). | Rewrite the subquery as an explicit JOIN or use a different correlation pattern. See also UM7005. |

**Example triggering UM4003:**
```
from Users u
| select Name, (from Orders | filter UserId == u.Id and Amount > u.MinAmount | select count(*))
                                                        ^^^^^^^^^^^^^^^^^^^^ Non-equality correlation not decorrelatable
```

---

## Unsupported Feature Errors (UM5xxx)

These indicate usage of syntax or features the compiler does not yet support.

| Code | Name | Severity | Message | Description | Action |
|---|---|---|---|---|---|
| `UM5001` | `UnsupportedFeature` | Error | Feature not supported by the compiler | A query construct is recognized but not yet implemented. | Check `QueryLanguage.md` for supported features. Rewrite using supported syntax. |
| `UM5002` | `UnsupportedOperator` | Error | Operator not supported | An operator (e.g., bitwise, ternary) is not supported in the query language. | Use supported operators. See `QueryLanguage.md`. |
| `UM5003` | `UnsupportedSyntax` | Error | Syntax construct not supported | A syntax construct is valid in the parser but not supported by the compiler backend. | Rewrite using a different approach. |
| `UM5004` | `UnsupportedNodeType` | Error | Node type not supported | An AST node type was encountered that the compiler doesn't handle. | Simplify the query. This may indicate an internal issue — report if the syntax looks valid. |
| `UM5005` | `SyntaxError` | Error | Query text could not be parsed | The query text has a syntax error that prevents parsing. | Check query syntax. Look for missing operators, unmatched parentheses, or invalid tokens. |

**Example triggering UM5005:**
```
from Users
| filter Name ==
                ^ UM5005: Unexpected end of expression
```

---

## Emission Errors (UM6xxx)

Emission errors occur during C# code generation from the physical plan.

### Core Emission (UM6001–UM6010)

| Code | Name | Severity | Message | Description | Action |
|---|---|---|---|---|---|
| `UM6001` | `EmissionError` | Error | Code emission failed | Generic emission failure — the code generator could not produce valid C# from the physical plan. | Report as bug with full query and schema. |
| `UM6002` | `MissingParameterTypes` | Error | Parameter types not specified | Query uses parameters but their CLR types were not declared. | Declare each parameter with an explicit type in the schema query header, e.g. `query GetById(id: int) -> ...`. |
| `UM6010` | `ReactiveUnsupportedMaintainerRejected` | Error | No supported reactive materialized maintainer | A reactive query reached emission without a supported Z-set materialized maintainer. | Use a maintainable query shape, add the needed materialized index/view, or keep the query as a non-reactive compiled query. |
| `UM6011` | `ReactiveUnsupportedShape` | Error | Reactive query shape unsupported | The reactive query contains a shape outside the current Z-set materialized maintainer matrix. | Rewrite the query to a supported materialized maintainer shape or wait for the missing maintainer family to be implemented. |

### Portable Emission (UM6020–UM6025)

These errors occur when compiling for the portable emission target (cross-platform, IL2CPP-safe).

| Code | Name | Severity | Message | Description | Action |
|---|---|---|---|---|---|
| `UM6020` | `PortableUnsupportedOperator` | Error | Physical operator not supported in portable target | A physical operator has no portable implementation. | Simplify the query to use operators available in portable mode. |
| `UM6021` | `PortableUnsupportedExpression` | Error | Expression type not supported in portable target | An expression node cannot be emitted in portable mode. | Rewrite the expression using supported constructs. |
| `UM6022` | `PortableUnsupportedStrategy` | Error | Strategy not supported in portable target | A join or scan strategy has no portable implementation. | Adjust indexes or query structure to use portable-compatible strategies. |
| `UM6023` | `PortableUnsupportedFunction` | Error | Function has no portable implementation descriptor | A built-in or UDF function has no implementation for the portable target. | Use only functions that support portable emission. |
| `UM6024` | `PortableReactiveNotSupported` | Error | Reactive query mode not supported in portable target | Reactive (live-updating) queries are not available in portable mode. | Use one-shot query mode for portable builds. |
| `UM6025` | `PortableMutationNotSupported` | Error | Mutation mode not supported in portable target | Mutation operations cannot be emitted in portable mode. | Perform mutations through the runtime API directly. |

---

## Plan Warnings (UM7xxx)

Plan warnings indicate that your query compiles successfully but may have performance or correctness concerns. **These do not prevent compilation** but should be reviewed.

### Scan and Sort Warnings

| Code | Name | Severity | Message | Description | How to Fix |
|---|---|---|---|---|---|
| `UM7001` | `FullScanOnLargeTable` | Warning | Full scan on a large table (> threshold rows based on PGO) | No index covers the filter predicate, forcing a full table scan. With PGO data, the table is known to be large. | Add an appropriate index on the filtered column(s). |
| `UM7003` | `UnusedIndex` | Warning | Unused index — a suitable index exists but was not used | An index on the table could theoretically cover the query but the optimizer chose not to use it. | Verify index column order matches the query pattern. Consider INCLUDE columns. |
| `UM7004` | `SortWithoutLimit` | Warning | Sort without LIMIT on potentially large result set | An `order by` sorts the entire result set with no `take` to cap the output. | Add `take N` to limit results, or rely on an index that provides the desired order. |
| `UM7008` | `FullSortOnLargeDataset` | Warning | Full sort on large dataset | PGO data indicates the sorted dataset is large, making sort expensive. | Add a covering index that matches the sort order, or add `take N`. |

**Example triggering UM7001:**
```
from Users
| filter Age > 18
  ^^^^^^^^^^^^^^^^ UM7001: Full scan — no index on 'Age'
| select Name
```

### Join Warnings

| Code | Name | Severity | Message | Description | How to Fix |
|---|---|---|---|---|---|
| `UM7002` | `CartesianProduct` | Warning | Cartesian product (JOIN without condition) | A JOIN has no predicate, producing a cross product of all rows. | Add a join condition: `join Orders o (u.Id == o.UserId)`. |
| `UM7007` | `NestedLoopOnLargeTables` | Warning | Nested loop join on large tables — consider adding an index | The optimizer chose a nested loop join for tables known (via PGO) to be large. This is O(N×M). | Add an index on the join key of the inner table, or enable PGO to let the optimizer choose hash join. |
| `UM7010` | `SemiAntiJoinNestedLoop` | Warning | Semi/Anti join fell back to NestedLoop | An EXISTS/NOT EXISTS subquery could not be decorrelated or lacks a suitable index, forcing nested loop evaluation. | Add an index on the correlation key, or rewrite as an explicit JOIN. |

### Subquery Warnings

| Code | Name | Severity | Message | Description | How to Fix |
|---|---|---|---|---|---|
| `UM7005` | `CorrelatedSubqueryNotDecorrelated` | Warning | Correlated subquery was not decorrelated | The optimizer could not transform a correlated subquery into a JOIN. Each outer row triggers a separate inner evaluation. | Rewrite as an explicit JOIN or ensure the correlation predicate uses equality on indexed columns. |
| `UM7011` | `NestedCollectionAllocation` | Warning | Nested collection subquery generates per-entity allocation and O(N×M) scan | A nested collection projection creates a `List<T>` per outer row and performs a full inner scan for each. | Add an index on the correlation key. Consider flattening the query. |
| `UM7012` | `NestedObjectProjectionNotEmittable` | Warning | Nested object projection detected but emission not yet supported | A nested object projection was planned but code generation for it is not yet implemented. | Flatten the projection or wait for a compiler update. |
| `UM7015` | `SubqueryCorrelatedCompatibilityPath` | Info | Correlated scalar subquery uses per-row compatibility path | A scalar subquery in SELECT could not be decorrelated and will execute once per outer row. | Rewrite as a JOIN with GROUP BY, or add an index on the correlation key. |

### PGO Warnings

| Code | Name | Severity | Message | Description | How to Fix |
|---|---|---|---|---|---|
| `UM7006` | `MissingPgoStatistics` | Warning | Missing PGO statistics for a critical query | No profile data is available for this query, preventing the optimizer from making cost-based decisions. | Run PGO collection. See `PGO.md` for setup instructions. |
| `UM7009` | `IndexRecommendation` | Info | Index recommendation from the Index Advisor | The optimizer suggests adding an index to improve this query's performance. | Review the recommendation and add the suggested index if appropriate. |
| `UM7013` | `PgoUntrustedHeuristicFallback` | Warning | PGO profile is untrusted — falling back to heuristic estimation | The PGO profile failed trust validation; the optimizer uses heuristic selectivity estimates instead. | Re-run PGO collection with representative workload data. |
| `UM7014` | `PgoUntrustedOverrideBlocked` | Warning | PGO profile is untrusted — behavioral override blocked | A PGO-directed strategy override (e.g., SkipSort, NoOptimize) was blocked because the profile is untrusted. | Re-run PGO collection. Untrusted profiles cannot influence planning decisions. |
| `UM7016` | `HeuristicPlanningFallback` | Warning | Planner used heuristic fallback | Costing or strategy selection fell back to heuristics because statistics or metadata was unavailable. | Provide PGO data or ensure schema metadata is complete. |
| `UM7018` | `PgoProfileDataInconsistency` | Warning | Trusted PGO profile contains inconsistent data | The profile passed trust validation but contains internally contradictory data (e.g., invalid key ranges). | Re-collect PGO data. The profile may be from a stale schema version. |

---

## Join Planning Diagnostics (JOINxxx)

These diagnostics are specific to join strategy selection during physical planning.

| Code | Name | Severity | Message | Description | Action |
|---|---|---|---|---|---|
| `JOIN0001` | `JoinNoStrategy` | Error | No applicable join strategy | The planner could not find any valid join implementation for the given predicate and available indexes. | Verify the join predicate uses equality on indexed columns. Add a primary or secondary index on the join key. |
| `JOIN0003` | `JoinConjunctivePredicateUnsupported` | Warning | Conjunctive join predicate unsupported | A multi-condition join predicate (AND) cannot be served by non-BETWEEN strategies. | Simplify the join predicate or ensure the combined columns are covered by a composite index. |
| `JOIN0002` | `JoinSecondaryIndexNotProduced` | Warning | Join secondary index strategy could not be produced | The planner attempted to use a secondary index for the join but failed (e.g., type mismatch, missing index). | Verify the secondary index definition matches the join key type and column. |
| `JOIN0003` | `JoinSecondaryIndexProduced` | Info | Join secondary index strategy produced | Informational: a secondary index strategy was successfully generated for this join. | No action needed. This confirms an index-based join is available. |
| `JOIN0004` | `JoinPgoHintUnavailable` | Warning | PGO join strategy hint unavailable | PGO data recommended a specific join strategy, but it could not be produced (e.g., missing index). | Add the index required by the PGO-recommended strategy, or re-collect PGO data. |
| `JOIN0005` | `JoinPgoEnforceUnavailable` | Error | PGO join strategy enforcement failed | PGO enforcement mode requested a specific strategy that is not available. Unlike `JOIN0004` (hint), this is a hard error because enforcement is strict. | Add the required index, or change the PGO enforcement mode from `Enforce` to `Hint`. |

### Join Strategy Trace Codes

When `[DebugGeneration]` is enabled, the optimization trace includes these codes indicating which join strategy was selected:

| Trace Code | Strategy | Description |
|---|---|---|
| `JOIN:DAL` | DenseArrayLookup | Primary key lookup via dense array (O(1), best for small integer PKs) |
| `JOIN:DPK` | DirectPkLookup | Direct primary key lookup (O(1) hash) |
| `JOIN:SSL` | SparseSetLookup | Sparse set lookup (hash-based, for non-contiguous keys) |
| `JOIN:HASH` | Hash Join | Hash join (build + probe, O(N+M)) |
| `JOIN:NL` | NestedLoop | Nested loop join (O(N×M), fallback) |
| `JOIN:SSR` | SortedSetRange | Sorted set range scan (for range predicates) |
| `JOIN:UIX` | UniqueIndex | Unique index lookup |
| `JOIN:SIX` | SecondaryIndex | Secondary index lookup |
| `JOIN:PGO` | PGO Enforcement | PGO-directed strategy override |

---

## Binding Resolution Errors (BIND_RES_xxx)

These errors are raised during the binding name-resolution phase. They are thrown as `BindingResolutionException` and indicate that a name, type, or construct could not be resolved.

### Table and Column Resolution

| Code | Message | Description | Action |
|---|---|---|---|
| `BIND_RES_001` | Table not found in schema | The table name in `from` does not match any schema declaration. | Check table name spelling. Verify it exists in your `.conjure` file. |
| `BIND_RES_002` | Column not found | The referenced column does not exist on the specified (or any in-scope) table. | Check column spelling and table alias. |
| `BIND_RES_003` | Ambiguous column | A column name matches multiple tables; no alias disambiguates it. | Qualify with table alias: `t.ColumnName`. |
| `BIND_RES_004` | Type mismatch | Type mismatch in a specific context (e.g., join condition expects matching types). | Align types or add an explicit CAST. |

### Function Resolution

| Code | Message | Description | Action |
|---|---|---|---|
| `BIND_RES_005` | Function not found | No function with the given name exists in the catalog. | Check spelling. See `QueryLanguage.md` for built-in functions. |
| `BIND_RES_006` | Function does not support DISTINCT | DISTINCT modifier was used on a function that doesn't support it. | Remove the DISTINCT modifier. |
| `BIND_RES_009` | Window function requires OVER clause | A window function (e.g., `row_number`, `lag`) was called without `OVER()`. | Add `OVER(...)` clause with appropriate partitioning and ordering. |
| `BIND_RES_015` | Ambiguous function overload | Multiple function overloads match the provided arguments equally well. | Add explicit CASTs to narrow the overload selection. |
| `BIND_RES_016` | Function does not support OVER clause | A non-window function was called with an OVER clause. | Remove the OVER clause — this function is not a window function. |

### Type Coercion

| Code | Message | Description | Action |
|---|---|---|---|
| `BIND_RES_011` | No common type | CASE/IN branches or binary operands have no common type for implicit conversion. | Add explicit CASTs or ensure operands share a compatible type. |
| `BIND_RES_012` | Requires boolean expression | A context (e.g., filter, WHEN) requires a boolean but received another type. | Ensure the expression evaluates to a boolean. |
| `BIND_RES_013` | Requires integer expression | A context (e.g., TAKE/SKIP) requires an integer but received another type. | Pass an integer value or CAST to integer. |
| `BIND_RES_014` | Cannot convert literal | A literal value cannot be converted to the required target type. | Check the literal format and target type compatibility. |
| `BIND_RES_017` | Unknown cast target type | The target type in a CAST expression is not recognized. | Use supported target types: `int`, `long`, `float`, `double`, `string`, `bool`, `DateTime`. |
| `BIND_RES_021` | Cannot cast between types | An explicit CAST between the source and target types is not supported. | Check supported cast paths. Not all type combinations allow casting. |

### Operators

| Code | Message | Description | Action |
|---|---|---|---|
| `BIND_RES_019` | Operator not supported | An operator is not supported for the given operand types. | Use a supported operator or CAST operands to compatible types. |
| `BIND_RES_022` | Operator requires boolean operands | A logical operator (`and`, `or`) received non-boolean operands. | Ensure both sides are boolean expressions. |
| `BIND_RES_023` | Operator requires numeric operands | An arithmetic operator (`+`, `-`, `*`, `/`) received non-numeric operands. | Ensure both sides are numeric. |
| `BIND_RES_024` | Operator requires comparable operands | A comparison operator (`>`, `<`, `>=`, `<=`) received non-comparable operands. | Ensure operands implement comparison. |
| `BIND_RES_025` | Operator requires string operands | A string operator (e.g., `contains`) received non-string operands. | Ensure the operand is a string type. |
| `BIND_RES_026` | Unary '-' requires numeric operand | The negate operator was applied to a non-numeric value. | Apply negate only to numeric columns or expressions. |

### IN Expressions

| Code | Message | Description | Action |
|---|---|---|---|
| `BIND_RES_027` | IN list cannot be empty | An `IN (...)` expression was provided with an empty list. | Provide at least one value in the IN list. |
| `BIND_RES_042` | IN requires list, array, or subquery | The right-hand side of IN is not a list, array, or subquery. | Use `IN (1, 2, 3)` or `IN (from ...)` syntax. |

### Subquery Errors

| Code | Message | Description | Action |
|---|---|---|---|
| `BIND_RES_018` | Subquery not supported in context | Subquery expressions are not supported in the current context. | Rewrite without a subquery or use a different operator. |
| `BIND_RES_020` | CASE requires at least one WHEN | An empty CASE expression was encountered. | Add at least one `when ... then ...` clause. |
| `BIND_RES_033` | Subquery column count mismatch | A scalar subquery must return exactly 1 column but returned more. | Adjust the subquery SELECT to return a single column. |
| `BIND_RES_035` | Correlated subquery requires LATERAL | A correlated subquery is used in a position that requires LATERAL. | Mark the subquery as LATERAL or rewrite as a JOIN. |
| `BIND_RES_043` | Function requires subquery argument | A function (e.g., EXISTS) requires exactly one subquery argument. | Pass a subquery to the function. |
| `BIND_RES_044` | Internal function requires subquery and path arguments | An internal projection function is missing required arguments. | This is typically an internal error — report as bug. |
| `BIND_RES_045` | Non-empty projection path required | An internal function requires a non-empty projection path. | This is typically an internal error — report as bug. |

### Let Bindings and Aliases

| Code | Message | Description | Action |
|---|---|---|---|
| `BIND_RES_010` | Let binding not found | A referenced `let` variable does not exist in scope. | Check the `let` name spelling and ensure it's defined before use. |
| `BIND_RES_034` | Duplicate let binding | A `let` variable with the same name already exists. | Rename one of the bindings. |
| `BIND_RES_040` | Duplicate output alias | Two columns in SELECT have the same alias. | Use unique aliases for each output column. |
| `BIND_RES_041` | Duplicate table alias | Two tables/joins use the same alias. | Use unique aliases for each table source. |

### Set Operations

| Code | Message | Description | Action |
|---|---|---|---|
| `BIND_RES_030` | Set operation column type incompatible | Corresponding columns in UNION/INTERSECT/EXCEPT have incompatible types. | Add CASTs to align column types. |
| `BIND_RES_031` | BY column not found in left side | A BY column in a set operation doesn't exist in the left operand. | Check column name spelling. |
| `BIND_RES_032` | GROUP BY requires columns only | GROUP BY received a computed expression instead of a column reference. | Use `derive` to compute the expression, then GROUP BY the derived column. |
| `BIND_RES_044` | BY column ambiguous in right side | A BY column in a set operation matches multiple columns on the right side. | Use explicit column selection or aliasing. |
| `BIND_RES_046` | Composed TAKE/SKIP value out of range | Chained TAKE/SKIP operations produce a value outside Int32/Int64 range. | Simplify the TAKE/SKIP chain or use smaller values. |

### Window Functions

| Code | Message | Description | Action |
|---|---|---|---|
| `BIND_RES_028` | Window function call not normalized | Internal: a window function reference is malformed. | Report as bug. |
| `BIND_RES_029` | Function is not a window function | A non-window function was used in a window context. | Use a proper window function (e.g., `row_number`, `rank`, `lag`, `lead`). |
| `BIND_RES_036` | Window functions require ORDER BY | Window functions need an ORDER BY in the OVER clause or a preceding sort. | Add `sort` before the window transform or specify ORDER BY in OVER. |
| `BIND_RES_047` | All window functions failed to resolve | Every window function in a window transform failed resolution. | Check function names and argument types. |

### Schema Metadata Errors

| Code | Message | Description | Action |
|---|---|---|---|
| `BIND_RES_037` | Schema column has unresolved CLR type | A column's CLR type could not be resolved from the schema. | Ensure the column type is a known type or declared as an extern type. |
| `BIND_RES_038` | Schema alias conflicts | An alias is already mapped to a different table and cannot be reassigned. | Use a unique alias for each table reference. |
| `BIND_RES_039` | Logical operator type mismatch | Logical operators (AND/OR) received non-boolean operands. | Ensure both operands are boolean expressions. |

### Miscellaneous

| Code | Message | Description | Action |
|---|---|---|---|
| `BIND_RES_048` | Unsupported filter type | An unknown filter AST node type was encountered. | Report as bug if the filter syntax looks valid. |
| `BIND_RES_049` | Unsupported expression type | An unknown expression AST node type was encountered. | Report as bug if the expression syntax looks valid. |
| `BIND_RES_050` | Cannot compose chained TAKE/SKIP with non-literal values | Dynamic TAKE/SKIP values cannot be composed when chained. | Use a single TAKE/SKIP with a dynamic value, or chain only literal values. |

---

## Binding Build Errors (BIND_BLD_xxx)

These errors occur during the IR building phase — when the resolved AST is lowered into the relational intermediate representation. They are thrown as `BindingBuildException`.

| Code | Message | Description | Action |
|---|---|---|---|
| `BIND_BLD_001` | OutputColumnId is invalid | A column identity is invalid during IR construction. Resolver must assign valid IDs. | Report as bug — the binding phase failed to assign column identities. |
| `BIND_BLD_002` | ClrType is null | A node's CLR type was not resolved before IR building. | Report as bug — the type resolver missed this node. |
| `BIND_BLD_003` | ComputationExpressionId is missing | An aggregate descriptor lacks its computation expression identity. | Report as bug — aggregate binding incomplete. |
| `BIND_BLD_004` | DISTINCT ON not supported | DISTINCT ON syntax is not yet implemented in the IR builder. | Use GROUP BY or a window function with ROW_NUMBER instead. |
| `BIND_BLD_005` | IN list requires literal array | IN list operands must be compile-time literal values for array construction. | Use literal values in the IN list, or pass as a parameter. |
| `BIND_BLD_006` | Output column count mismatch | The IR node's output column count doesn't match what was expected by the parent. | Report as bug — indicates a binding/lowering inconsistency. |
| `BIND_BLD_007` | NULLS FIRST/LAST not supported | ORDER BY with explicit NULL ordering is not yet implemented. | Remove NULLS FIRST/LAST clause. Default NULL ordering applies. |
| `BIND_BLD_008` | Aggregate requires argument | An aggregate function has no argument expression during IR building. | Provide an argument to the aggregate function. |
| `BIND_BLD_009` | Unsupported binary operator | A binary operator cannot be lowered to the IR. | Use a supported operator. Check `QueryLanguage.md`. |
| `BIND_BLD_010` | Let binding not found during IR build | A let binding referenced during IR construction does not exist. | Report as bug if the let binding was defined in the query. |
| `BIND_BLD_011` | Duplicate LET binding | A LET name is defined more than once in the query during IR build. | Use unique LET names. |
| `BIND_BLD_012` | Unsupported window frame bound kind | An unrecognized window frame boundary type was encountered. | Use standard frame bounds: UNBOUNDED, CURRENT ROW, or numeric PRECEDING/FOLLOWING. |
| `BIND_BLD_013` | Set operation column cannot cast | A set operation column type cannot be cast to the target type during IR lowering. | Ensure corresponding columns have compatible types or add explicit CASTs. |
| `BIND_BLD_014` | Unknown FilterPhase value | An internal filter phase enum value is not handled. | Report as bug. |
| `BIND_COALESCE` | COALESCE requires at least two arguments | The COALESCE function was called with fewer than 2 arguments. | Provide at least two arguments: `coalesce(a, b)`. |

---

## Binding Contract Errors (BIND_CONTRACT)

| Code | Message | Description | Action |
|---|---|---|---|
| `BIND_CONTRACT` | Contract violation(s) detected | One or more binding invariants were violated. The exception contains a list of `BindingContractViolation` records with individual error codes and messages. | Inspect the `Violations` collection for specific codes. Report as bug. |

---

## Schema Diagnostic Codes (SCHxxxx)

Schema diagnostics are emitted by the schema processor during `.conjure` file parsing, import resolution, binding, and validation. They use the `DiagnosticBag` infrastructure with phase tagging.

### Schema Phases

| Phase | Description |
|---|---|
| `Parse` | Lexing and parsing of `.conjure` text |
| `Import` | Import path resolution and file loading |
| `Validate` | Pre-bind semantic validation (duplicate fields, annotations) |
| `Bind` | Binding, type resolution, and fragment expansion |

### Lexer Errors (SCH0xxx)

| Code | Severity | Message | Description | Action |
|---|---|---|---|---|
| `SCH0001` | Error | Unterminated string literal | A string literal is missing its closing quote. | Add the closing `"` to the string. |
| `SCH0002` | Warning | (Lexer warning) | A non-fatal lexer issue was detected. | Review the token at the reported position. |
| `SCH0003` | Error | Lexer error | A character sequence could not be tokenized. | Check for invalid characters in the schema file. |

### Parse Errors (SCH1xxx)

| Code | Severity | Message | Description | Action |
|---|---|---|---|---|
| `SCH1001` | Error | Expected token not found | The parser expected a specific token (identifier, `{`, `=`, etc.) but found something else. | Fix the syntax at the reported position. Common causes: missing braces, typos. |
| `SCH1002` | Error | Unexpected token | An unexpected token was encountered where a declaration, field, or keyword was expected. | Check the schema syntax. Ensure declarations follow the correct format. |
| `SCH1003` | Error | Invalid option value | A table or field option has an invalid value (e.g., invalid persistence mode). | Use valid values. Persistence: `local`, `remote`, `none`. |
| `SCH1004` | Error | Invalid index kind | An unrecognized index type was specified. | Use supported index kinds. |
| `SCH1005` | Error | Invalid annotation | A field or table annotation (e.g., `@id`, `@@index`) is not recognized. | Check annotation spelling. Valid field annotations: `@id`, `@relation`, `@default`. |
| `SCH1006` | Error | Invalid index option | An index option is not recognized or has an invalid value. | Check index option names and values. |
| `SCH1007` | Error | Empty body | A declaration body (table, type, enum) is empty. | Add at least one field to the declaration. |
| `SCH1008` | Error | Integer literal out of range | An integer value in the schema exceeds Int32 range. | Use a value within Int32 range (−2,147,483,648 to 2,147,483,647). |
| `SCH1021` | Error | Annotations not supported on type fields | A type (not table) field has annotations, which are only valid on table fields. | Remove annotations from type fields. |

### Binding Errors (SCH2xxx)

| Code | Severity | Message | Description | Action |
|---|---|---|---|---|
| `SCH2001` | Error | Duplicate declaration | A name (table, enum, type, query, mutation, fragment, extern) is declared more than once. | Rename one of the declarations to be unique. |
| `SCH2002` | Error | Unknown type | A type reference cannot be resolved to any declared or extern type. | Check type name spelling. Declare it as a table, type, enum, or extern type. |
| `SCH2003` | Error | Foreign key references non-existent table | A `@relation` annotation points to a table that doesn't exist in the schema. | Check the target table name in the `@relation`. |
| `SCH2005` | Error | Table has no primary key | A table has no field with the `@id` annotation. | Add `@id` to exactly one field in the table. |
| `SCH2006` | Error | Table has multiple primary keys | More than one field has the `@id` annotation. ConjureDB requires exactly one PK. | Remove `@id` from all but one field. |
| `SCH2007` | Error | Unknown index type | An `@@index` annotation specifies an unrecognized index kind. | Use a supported index type. |
| `SCH2009` | Error | Query parameter has unknown type | A query parameter references a type not found in the schema. | Declare the type or use a built-in type. |
| `SCH2010` | Error | Invalid mutation return type | A mutation return type is an enum or unknown type; must be `void`, `int`, or a table/type. | Use a valid return type for the mutation. |
| `SCH2011` | Error | Duplicate field name | Two fields in the same table/type resolve to the same PascalCase name. | Rename one of the fields to be unique after PascalCase conversion. |
| `SCH2012` | Error | Unknown fragment | A `@fragmentName` reference in a query/mutation body refers to a non-existent fragment. | Define the fragment or check the spelling. |
| `SCH2013` | Error | Fragment argument count mismatch | A fragment invocation passes the wrong number of arguments. | Match the number of arguments to the fragment's parameter list. |
| `SCH2014` | Error | Duplicate key ordinal | Two fields in a table have the same key ordinal value. | Assign unique ordinal values to each key field. |
| `SCH2015` | Error | Invalid enum backing type / Unterminated fragment | Enum backing type is invalid (allowed: byte, sbyte, short, ushort, int, uint, long, ulong). Also: unterminated fragment invocation syntax. | Use an allowed backing type for enums. Fix fragment syntax `@frag(...)`. |
| `SCH2016` | Error | Invalid aggregation variant / Fragment expansion depth exceeded | An `aggregation_variant` value is not recognized (allowed: `all_stats`, `sum_count`, `count_only`). Also: fragment expansion recursion limit hit. | Use a valid variant name. Simplify fragment nesting. |
| `SCH2017` | Error | Aggregation variant on non-aggregation index | An index uses `aggregation_variant` but the index type is not `aggregation`. | Remove `aggregation_variant` or change the index type to `aggregation`. |
| `SCH2019` | Error | Fragment expansion size exceeded | Fragment expansion produced more text than the maximum allowed. | Reduce fragment complexity. Avoid exponentially expanding patterns. |
| `SCH2020` | Error | Declaration exceeds maximum field count | A table or type has more fields than the supported maximum. | Split the declaration into multiple types or reduce field count. |
| `SCH2021` | Error | Fragment expansion exceeded max field count | After expanding fragments, the total field count exceeds the limit. | Reduce the number of fields produced by fragment expansion. |
| `SCH2032` | Error | View source relation unresolved | A view source pipeline does not reference a declared source relation. | Start the view pipeline with `from <TableOrView>` and ensure the source is declared. |
| `SCH2033` | Error | Invalid materialized view capacity | A materialized view declares a non-positive capacity. | Use a positive `capacity` value or omit it to use the compiler default. |
| `SCH2034` | Error | Unsupported materialized view refresh mode | `refresh: rebuild` or `refresh: manual` was parsed but is not executable by the in-memory materialized maintainer contract. | Use `refresh: incremental` for executable materialized views. |
| `SCH2036` | Error | View source projection missing | A view source does not end with a `select` projection producing the declared fields. | Add a final `select { ... }` whose aliases match the view fields. |
| `SCH2037` | Error | Duplicate view projection field | A view source projection produces the same field more than once. | Keep one projection item per declared view field. |
| `SCH2038` | Error | View projection missing field | A declared view field is not produced by the source projection. | Add the missing projection alias. |
| `SCH2039` | Error | View projection extra field | The source projection produces a field not declared by the view. | Remove the projection item or declare the field. |
| `SCH2040` | Error | View projection type mismatch | A projected field type is not assignable to the declared view field type. | Align the declared field type with the source expression. |
| `SCH2041` | Error | View dependency cycle | Views or materialized views depend on each other cyclically. | Break the cycle by making one view depend on a base table or non-recursive view chain. |
| `SCH2042` | Error | Semi/anti projection owner invalid | A semi/anti materialized view projection references the right source or an ambiguous unqualified field. | Project only left-source fields and qualify ambiguous fields with the left source. |
| `SCH2043` | Error | Mutation targets derived relation | A mutation targets a `view` or `materialized view`. | Mutate authoritative base tables instead; views are derived read-only relations. |
| `SCH2044` | Error | Left-join projection unsupported | A materialized left join projects a right-source expression that cannot be null-extended by the v1 maintainer. | Project right-source fields directly, declare them nullable, or move the expression to a later supported slice. |
| `SCH2110` | Error | Invalid command pipeline | A command query pipeline or remaining generic command pipeline surface is malformed: missing target table, unknown table, unsupported operator, missing terminal, invalid assignment/projection, or unsupported reserved operation. | Fix the pipeline so it names a declared table, uses supported operators, and for `var` query bindings ends with a lower-case cardinality terminal such as `single`, `count`, or `to_list`. |
| `SCH2111` | Error | Unknown command kind | A command `kind` clause is not one of the supported command kinds. | Use `local`, `local_or_online`, `online_player`, `admin`, `server_job`, or `internal`. |
| `SCH2112` | Error | Unknown idempotency parameter | `idempotent by <param>` references a parameter not declared by the command. | Rename the idempotency key reference or add the missing command parameter. |
| `SCH2113` | Error | Unknown command metadata parameter | A command metadata call, such as `scope player(...)` or `auth ...`, references an unknown command parameter. | Ensure every metadata parameter reference names a declared command parameter. |
| `SCH2114` | Error | Duplicate command variable | A command variable reuses a command parameter name or a previously declared variable name. | Rename the variable so every command-scope name is unique. |
| `SCH2115` | Error | Missing command return | A command declares a result type but its body has no `return` statement. | Add `return { ... }` matching the declared result type, or remove the result type. |
| `SCH2116` | Error | Unknown schema command invocation | A command invocation does not resolve to a declared schema command in the current module or by canonical identity. | Fix the command name, qualify it, or declare the target command. |
| `SCH2117` | Error | Command call cycle | Commands invoke each other cyclically, so execution order and error manifests cannot be determined. | Break the cycle by extracting shared logic into a non-recursive command or direct pipeline. |
| `SCH2118` | Error | Unknown command argument | A named subcommand invocation passes an argument that is not declared by the target command. | Remove the argument or rename it to a target parameter. |
| `SCH2119` | Error | Missing command argument | A subcommand invocation omits a required target command parameter. | Pass every required argument. |
| `SCH2120` | Error | Duplicate command argument | A named subcommand invocation passes the same argument more than once. | Keep one value per target parameter. |
| `SCH2121` | Error | Command positional argument count mismatch | A positional subcommand invocation has a different argument count than the target command parameters. | Pass exactly the target parameter count or switch to named arguments. |
| `SCH2122` | Error | Mixed command argument styles | A subcommand invocation mixes positional and named arguments. | Use either all positional arguments or all named arguments in a single invocation. |
| `SCH2123` | Error | Invalid command return payload syntax | A command return payload for a typed result is not object syntax. | Return an object payload: `return { field: expression }`. |
| `SCH2124` | Error | Malformed command return field | A field in a command return payload is missing `:`. | Write return fields as `name: expression`. |
| `SCH2125` | Error | Unknown command return field | A command returns a field not declared by its result type. | Remove the field or add it to the declared result type. |
| `SCH2126` | Error | Missing command return field | A command return payload omits a field required by the declared result type. | Include every result field in the return payload. |
| `SCH2127` | Error | Duplicate command return field | A command return payload declares the same result field more than once after PascalCase normalization. | Return each result field once. |
| `SCH2128` | Error | Empty command event name | A command event statement has an empty event name. | Give the event a non-empty name. |
| `SCH2129` | Error | Invalid command payload object | A command event, error, or pipeline error payload is missing where required or is not object syntax. | Use `{ field: expression }` object syntax, and provide a non-empty payload for events. |
| `SCH2130` | Error | Malformed command payload field | A field in an event/error/pipeline payload is missing `:`. | Write payload fields as `name: expression`. |
| `SCH2131` | Error | Empty command payload field | A command payload field has an empty name or empty expression. | Provide both a field name and an expression. |
| `SCH2132` | Error | Duplicate command payload field | A command payload declares the same field more than once after PascalCase normalization. | Keep one payload value per field. |
| `SCH2133` | Error | Unknown command expression symbol | A command expression references a parameter or variable that is not in scope. | Use a declared parameter, prior variable, or supported context path. |
| `SCH2134` | Error | Invalid command invocation expression | A command variable classified as an invocation is not a direct command call expression. | Bind command calls as direct expressions such as `var result = CommandName(arg: value)`. |
| `SCH2135` | Error | Empty command argument expression | A subcommand invocation argument is present but has no expression. | Supply an expression for the argument. |
| `SCH2136` | Error | Unknown command member reference | A command expression references a member not available on the variable's inferred shape. | Fix the member name or project/return the member before referencing it. |
| `SCH2137` | Error | Unsupported command context path | A command expression references a `ctx.*` path outside the deterministic context allowlist. | Use supported paths such as `ctx.now`, `ctx.tick`, `ctx.contentVersion`, `ctx.seasonId`, `ctx.random.next_int`, or `ctx.random.next_uint64`. |
| `SCH2138` | Error | Command expression type mismatch | A command return field or subcommand argument expression has a type not assignable to the expected field or parameter type. | Align the expression type with the declared result field or target parameter type. |
| `SCH2139` | Error | Duplicate command using import | A module imports the same command module path more than once. | Keep one `using` declaration for each imported module path. |
| `SCH2140` | Error | Duplicate command using alias | A module declares the same command `using` alias more than once. | Rename one alias or remove the duplicate import. |
| `SCH2141` | Error | Duplicate command CLR artifact name | Two schema commands in different modules share the same bare command name, which would generate colliding C# command artifact names. | Rename one command until every generated command artifact name is unique. |
| `SCH2142` | Error | Ambiguous command reference | A short or alias-qualified command invocation resolves to more than one imported command. | Qualify the call with a full canonical command identity or remove the ambiguous import. |
| `SCH2143` | Error | Command write bound through `var` | A command write operation (`update`, `upsert`, `insert`, or `delete`) is used as `var x = ...`. Command writes are statement-shaped. | Rewrite the write as a top-level statement and bind returned data with `returning { ... } into name`. |
| `SCH2144` | Error | Command write filter forbidden | A command write statement uses `filter`, which would imply a bulk or scan-based write. | Use `key { ... }` for `update`, `upsert`, and `delete`, or `values { ... }` for `insert`. Bulk writes require a separate explicit contract. |
| `SCH2145` | Error | Command write terminal forbidden | A command write statement uses a read cardinality terminal such as `single`, `first`, `count`, or `to_list`. | Remove the terminal. Write cardinality is defined by the command write statement contract. |
| `SCH2146` | Error | Command write returning missing `into` | A command write statement has `returning` but does not bind the projection with `into <name>`. | Add `into <name>` after the returning projection, for example `returning { amountAfter: Amount } into inventoryAfter`. |
| `SCH2147` | Error | Invalid command write key | A command `update`, `upsert`, or `delete` statement has a missing or invalid `key`, lacks required `key ... else Error` for missing rows, or does not resolve to a primary key / named unique index. | Provide a `key { ... }` matching the table primary key or a declared named unique index. For `update` and `delete`, add `else Error`. |
| `SCH2148` | Error | Invalid command insert conflict | A command `conflict` clause is malformed, appears outside `insert`, is duplicated, or the inserted values do not cover a primary key / named unique index to precheck. | Use at most one `insert ... \| conflict else Error` clause and provide values covering the target primary key or named unique index. |
| `SCH2149` | Error | Duplicate command write `into` binding | A command write `returning ... into <name>` reuses a command parameter or previously declared command variable. | Rename the `into` binding so every command-scope name is unique. |

### Multi-File Merge Errors (SCH3xxx)

| Code | Severity | Message | Description | Action |
|---|---|---|---|---|
| `SCH3001` | Error | Duplicate declaration across files | A table, enum, type, query, mutation, or fragment with the same name exists in multiple schema files. | Ensure each name is unique across all schema files, or use a single file. |
| `SCH3002` | Error | Import resolved but file not found | An import path resolved to a canonical path, but no schema file matches that path. | Check the import path. Ensure the target file exists and is included in the schema set. |
| `SCH3003` | Error | Import cycle detected | The import graph contains a cycle (A imports B imports A). | Break the cycle by restructuring imports. |
| `SCH3004` | Error | Duplicate schema file identity | Two schema files resolve to the same canonical path. | Remove the duplicate file or rename one. |
| `SCH3005` | Error | Import outside schema root | An import resolves to a path outside the schema root directory. | Move the imported file inside the schema root, or adjust the import path. |

### Import Resolution Errors (SCH4xxx)

| Code | Severity | Message | Description | Action |
|---|---|---|---|---|
| `SCH4001` | Error | Circular import detected | A file is already in the current import chain, creating a cycle. | Restructure imports to eliminate the cycle. |
| `SCH4002` | Error | Imported file not found | The file referenced by an import statement does not exist. | Check the import path and ensure the file exists. |
| `SCH4003` | Error | I/O or access error reading imported file | The schema processor could not read the imported file due to I/O errors or access denial. | Check file permissions and filesystem state. |
| `SCH4004` | Error | Invalid import path | The import path is malformed or contains invalid characters. | Fix the import path syntax. |

### Semantic Validation Errors (SCH5xxx)

| Code | Severity | Message | Description | Action |
|---|---|---|---|---|
| `SCH5001` | Error | Duplicate field in table | A field name is declared more than once in a table. | Rename one of the duplicate fields. |
| `SCH5002` | Error | Field has both @id and @relation | A single field has both `@id` and `@relation` annotations, which is invalid. | Remove one annotation. Primary keys cannot be foreign keys. |
| `SCH5003` | Warning | Table has no primary key (advisory) | A table has no `@id` field. This is a pre-bind warning (SCH2005 is the bind-time error). | Add `@id` to one field. |
| `SCH5004` | Error | Fragment cycle detected | A fragment references itself directly or transitively. | Remove the circular reference from the fragment. |
| `SCH5005` | Error | Duplicate field in type | A field name is declared more than once in a type (struct). | Rename one of the duplicate fields. |
| `SCH5006` | Error | Type field cannot have table annotations | A type (struct) field uses annotations like `@id` or `@relation` that are only valid on table fields. | Remove table-specific annotations from type fields. |
| `SCH5007` | Error | Index field does not exist in table | An `@@index` references a field name that doesn't exist in the table. | Check field name spelling in the `@@index` annotation. |
| `SCH5021` | Error | Duplicate field in view | A view field name is declared more than once. | Rename one of the duplicate fields. |
| `SCH5022` | Error | View field annotation unsupported | A view field uses `@id`, `@relation`, or field-level `@index`. | Remove field-level table annotations from views. |
| `SCH5023` | Error | Virtual view table annotation unsupported | A virtual view declares a table-level annotation such as `@@index`, `@@unique`, or `@@identity`. | Remove table-level annotations or use a materialized view where supported. |
| `SCH5024` | Error | Materialized view index field missing | A materialized view `@@index` references a field not declared by the view. | Fix the index field name or declare the field. |
| `SCH5025` | Error | Materialized view identity field missing | `@@identity` references a field not declared by the view. | Fix the identity field list or declare the field. |
| `SCH5026` | Error | Materialized view annotation unsupported | A materialized view declares an annotation outside the materialized view contract. | Use only `@@identity`, `@@index`, or `@@unique` on materialized views. |
| `SCH5027` | Error | Materialized view source not maintainable | The materialized view source uses a pipeline shape outside the supported Z-set materialized maintainer matrix. The message includes a structured reason descriptor with source kind, unsupported operator, dependency path, and supported family. | Restrict the source to supported maintainable operators or change the refresh contract. |
| `SCH5028` | Error | Materialized view index kind unsupported | A materialized view index uses an index kind that the materialized runtime cannot emit. | Use `lookup`, `grouped_sorted`, or `unique`. |
| `SCH5029` | Error | Materialized index shape invalid | A materialized view index has an invalid field shape, such as an empty field list or a `grouped_sorted` index without either a grouping key or a sort field. | Declare at least one field for `lookup`/`unique` indexes. For `grouped_sorted`, declare at least two fields: the key first, then one or more sort fields. |

---

## Quick Reference — All Codes (Numerical Order)

### Compiler Diagnostics (UMxxxx)

| Code | Name | Severity | One-Line Description |
|---|---|---|---|
| `UM0000` | Unknown | Error | Unknown / unclassified diagnostic |
| `UM0001` | InternalError | Error | Internal compiler error |
| `UM0002` | InvariantViolation | Error | Compiler invariant violated |
| `UM0003` | PipelineValidationError | Error | Pipeline stage validation failed |
| `UM0004` | MissingSchema | Error | Schema metadata missing or empty |
| `UM1001` | MissingTableAlias | Error | Unqualified column in multi-table scope |
| `UM1002` | AmbiguousColumnReference | Error | Column exists in multiple tables |
| `UM1003` | MissingSource | Error | No source table in scope |
| `UM1004` | DuplicateAlias | Error | Table alias already in use |
| `UM1005` | InvalidAggregateUsage | Error | Aggregate in wrong context |
| `UM1006` | InvalidWindowFrame | Error | Invalid window frame specification |
| `UM1007` | UnknownTable | Error | Table not found in schema |
| `UM1008` | UnknownColumn | Error | Column not found on entity |
| `UM1009` | TypeMismatch | Error | Incompatible types in expression |
| `UM1010` | DuplicateLetBinding | Error | Let binding already defined |
| `UM1011` | LetBindingNullRoot | Error | Let binding resolved to null |
| `UM1012` | UntypedParameter | Error | Parameter type cannot be inferred |
| `UM1013` | CaseTypeMismatch | Error | CASE branch types incompatible |
| `UM1014` | AmbiguousColumn | Error | Column ambiguous between tables |
| `UM1015` | UnknownNavigationProperty | Error | Navigation property not found |
| `UM1016` | CircularNavigation | Error | Circular navigation detected |
| `UM1017` | AggregateMissingArgument | Error | Aggregate called without argument |
| `UM1018` | UnknownAggregateFunction | Error | Aggregate function not recognized |
| `UM1019` | DuplicateAggregateAlias | Error | Duplicate aggregate alias |
| `UM1020` | SetOperationArityMismatch | Error | UNION/INTERSECT sides have different column counts |
| `UM1021` | SetOperationTypeMismatch | Error | UNION/INTERSECT column types incompatible |
| `UM1022` | ExistsSubqueryError | Error | EXISTS subquery malformed |
| `UM1023` | InvalidLimitOffset | Error | TAKE/SKIP value invalid |
| `UM1024` | DeriveColumnError | Error | Derive column expression failed |
| `UM1025` | FunctionArgumentError | Error | Wrong function arguments |
| `UM1026` | CaseImplicitConversion | Warning | Implicit conversion in CASE branches |
| `UM1027` | AmbiguousNavigationPath | Error | Navigation path is ambiguous |
| `UM1028` | NavigationLineageUnavailable | Error | Navigation lineage metadata missing |
| `UM1030` | BinaryOperatorTypeMismatch | Error | Binary operator type mismatch |
| `UM1031` | AggregateRequiresNumeric | Error | SUM/AVG requires numeric argument |
| `UM1032` | AggregateRequiresComparable | Error | MIN/MAX requires comparable type |
| `UM1033` | AggregateRequiresBoolean | Error | BOOL_AND/BOOL_OR requires boolean |
| `UM1034` | NestedAggregate | Error | Nested aggregate not allowed |
| `UM1035` | AggregateInWhere | Error | Aggregate in WHERE clause |
| `UM1036` | FunctionTypeMismatch | Error | Function argument type mismatch |
| `UM1037` | InvalidWindowFrameBounds | Error | Window frame start > end |
| `UM1038` | InvalidWindowFrameStart | Error | UNBOUNDED FOLLOWING as frame start |
| `UM1039` | InvalidWindowFrameEnd | Error | UNBOUNDED PRECEDING as frame end |
| `UM1040` | WindowOffsetMustBeNumeric | Error | LAG/LEAD offset must be numeric |
| `UM1041` | SetOperationColumnTypeMismatch | Error | SET operation column types mismatch |
| `UM1042` | OuterJoinFilterWarning | Warning | Filter may change outer join semantics |
| `UM1050` | UdfInvalidSignature | Error | UDF has invalid method signature |
| `UM1051` | UdfUnresolvableType | Error | UDF type cannot be resolved |
| `UM1052` | UdfMutableCollection | Error | UDF uses mutable collection type |
| `UM2001` | MissingSourceRelation | Error | Source relation missing from IR |
| `UM2002` | MissingPayload | Error | Required payload missing |
| `UM2003` | EmptyPlan | Error | Semantic plan is empty |
| `UM2004` | InvalidSubquery | Error | Invalid subquery structure |
| `UM2005` | ColumnNotFound | Error | Column not found during IR build |
| `UM3001` | IrValidationError | Error | IR validation failed |
| `UM3002` | OptimizationError | Error | Optimization rule failed |
| `UM4001` | PhysicalPlanningError | Error | Physical plan generation failed |
| `UM4002` | EmptyIrSnapshot | Error | IR snapshot is empty |
| `UM4003` | UnsupportedDecorrelationPattern | Error | Cannot decorrelate subquery |
| `UM5001` | UnsupportedFeature | Error | Feature not supported |
| `UM5002` | UnsupportedOperator | Error | Operator not supported |
| `UM5003` | UnsupportedSyntax | Error | Syntax construct not supported |
| `UM5004` | UnsupportedNodeType | Error | Node type not supported |
| `UM5005` | SyntaxError | Error | Query text parse error |
| `UM6001` | EmissionError | Error | Code emission failed |
| `UM6002` | MissingParameterTypes | Error | Parameter types not specified |
| `UM6010` | ReactiveUnsupportedMaintainerRejected | Error | No supported reactive materialized maintainer |
| `UM6020` | PortableUnsupportedOperator | Error | Operator not portable |
| `UM6021` | PortableUnsupportedExpression | Error | Expression not portable |
| `UM6022` | PortableUnsupportedStrategy | Error | Strategy not portable |
| `UM6023` | PortableUnsupportedFunction | Error | Function not portable |
| `UM6024` | PortableReactiveNotSupported | Error | Reactive mode not portable |
| `UM6025` | PortableMutationNotSupported | Error | Mutation not portable |
| `UM7001` | FullScanOnLargeTable | Warning | Full scan on large table |
| `UM7002` | CartesianProduct | Warning | JOIN without condition |
| `UM7003` | UnusedIndex | Warning | Suitable index not used |
| `UM7004` | SortWithoutLimit | Warning | Sort without TAKE |
| `UM7005` | CorrelatedSubqueryNotDecorrelated | Warning | Correlated subquery not decorrelated |
| `UM7006` | MissingPgoStatistics | Warning | No PGO statistics available |
| `UM7007` | NestedLoopOnLargeTables | Warning | Nested loop on large tables |
| `UM7008` | FullSortOnLargeDataset | Warning | Full sort on large dataset |
| `UM7009` | IndexRecommendation | Info | Index recommendation |
| `UM7010` | SemiAntiJoinNestedLoop | Warning | Semi/Anti join using nested loop |
| `UM7011` | NestedCollectionAllocation | Warning | Per-entity allocation in nested collection |
| `UM7012` | NestedObjectProjectionNotEmittable | Warning | Nested object projection not emittable |
| `UM7013` | PgoUntrustedHeuristicFallback | Warning | PGO untrusted — heuristic fallback |
| `UM7014` | PgoUntrustedOverrideBlocked | Warning | PGO untrusted — override blocked |
| `UM7015` | SubqueryCorrelatedCompatibilityPath | Info | Scalar subquery per-row compatibility path |
| `UM7016` | HeuristicPlanningFallback | Warning | Planner used heuristic fallback |
| `UM7018` | PgoProfileDataInconsistency | Warning | PGO profile data inconsistent |

### Join Planning Diagnostics (JOINxxx)

| Code | Name | Severity | One-Line Description |
|---|---|---|---|
| `JOIN0001` | JoinNoStrategy | Error | No join strategy available |
| `JOIN0003` | JoinConjunctivePredicateUnsupported | Warning | Conjunctive predicate unsupported |
| `JOIN0002` | JoinSecondaryIndexNotProduced | Warning | Secondary index strategy failed |
| `JOIN0003` | JoinSecondaryIndexProduced | Info | Secondary index strategy available |
| `JOIN0004` | JoinPgoHintUnavailable | Warning | PGO join hint unavailable |
| `JOIN0005` | JoinPgoEnforceUnavailable | Error | PGO join enforcement failed |

### Binding Resolution Errors (BIND_RES_xxx)

| Code | One-Line Description |
|---|---|
| `BIND_RES_001` | Table not found in schema |
| `BIND_RES_002` | Column not found |
| `BIND_RES_003` | Ambiguous column reference |
| `BIND_RES_004` | Type mismatch in context |
| `BIND_RES_005` | Function not found |
| `BIND_RES_006` | DISTINCT not supported on function |
| `BIND_RES_009` | Window function missing OVER |
| `BIND_RES_010` | Let binding not found |
| `BIND_RES_011` | No common type for operands |
| `BIND_RES_012` | Boolean expression required |
| `BIND_RES_013` | Integer expression required |
| `BIND_RES_014` | Literal conversion failed |
| `BIND_RES_015` | Ambiguous function overload |
| `BIND_RES_016` | Function does not support OVER |
| `BIND_RES_017` | Unknown cast target type |
| `BIND_RES_018` | Subquery not supported in context |
| `BIND_RES_019` | Operator not supported |
| `BIND_RES_020` | CASE requires at least one WHEN |
| `BIND_RES_021` | Cannot cast between types |
| `BIND_RES_022` | Boolean operands required |
| `BIND_RES_023` | Numeric operands required |
| `BIND_RES_024` | Comparable operands required |
| `BIND_RES_025` | String operands required |
| `BIND_RES_026` | Negate requires numeric operand |
| `BIND_RES_027` | IN list cannot be empty |
| `BIND_RES_028` | Window function call not normalized |
| `BIND_RES_029` | Not a window function |
| `BIND_RES_030` | Set operation column types incompatible |
| `BIND_RES_031` | BY column not found in left side |
| `BIND_RES_032` | GROUP BY requires columns only |
| `BIND_RES_033` | Subquery column count mismatch |
| `BIND_RES_034` | Duplicate let binding |
| `BIND_RES_035` | Correlated subquery requires LATERAL |
| `BIND_RES_036` | Window functions require ORDER BY |
| `BIND_RES_037` | Schema column CLR type unresolved |
| `BIND_RES_038` | Schema alias conflicts |
| `BIND_RES_039` | Logical operator type mismatch |
| `BIND_RES_040` | Duplicate output alias |
| `BIND_RES_041` | Duplicate table alias |
| `BIND_RES_042` | IN requires list, array, or subquery |
| `BIND_RES_043` | Function requires subquery argument |
| `BIND_RES_044` | Internal function missing arguments |
| `BIND_RES_045` | Non-empty projection path required |
| `BIND_RES_046` | TAKE/SKIP value out of range |
| `BIND_RES_047` | All window functions failed |
| `BIND_RES_048` | Unsupported filter type |
| `BIND_RES_049` | Unsupported expression type |
| `BIND_RES_050` | Cannot compose non-literal TAKE/SKIP |

### Binding Build Errors (BIND_BLD_xxx)

| Code | One-Line Description |
|---|---|
| `BIND_BLD_001` | Invalid OutputColumnId |
| `BIND_BLD_002` | CLR type is null |
| `BIND_BLD_003` | Missing ComputationExpressionId |
| `BIND_BLD_004` | DISTINCT ON not supported |
| `BIND_BLD_005` | IN list requires literal array |
| `BIND_BLD_006` | Output column count mismatch |
| `BIND_BLD_007` | NULLS FIRST/LAST not supported |
| `BIND_BLD_008` | Aggregate requires argument |
| `BIND_BLD_009` | Unsupported binary operator |
| `BIND_BLD_010` | Let binding not found in IR build |
| `BIND_BLD_011` | Duplicate LET binding |
| `BIND_BLD_012` | Unsupported window frame bound kind |
| `BIND_BLD_013` | Set operation column cast failed |
| `BIND_BLD_014` | Unknown FilterPhase value |
| `BIND_COALESCE` | COALESCE requires ≥ 2 arguments |

### Schema Diagnostics (SCHxxxx)

| Code | Severity | One-Line Description |
|---|---|---|
| `SCH0001` | Error | Unterminated string literal |
| `SCH0002` | Warning | Lexer warning |
| `SCH0003` | Error | Lexer error |
| `SCH1001` | Error | Expected token not found |
| `SCH1002` | Error | Unexpected token |
| `SCH1003` | Error | Invalid option value |
| `SCH1004` | Error | Invalid index kind |
| `SCH1005` | Error | Invalid annotation |
| `SCH1006` | Error | Invalid index option |
| `SCH1007` | Error | Empty declaration body |
| `SCH1008` | Error | Integer literal out of range |
| `SCH1021` | Error | Type field annotations not supported |
| `SCH2001` | Error | Duplicate declaration name |
| `SCH2002` | Error | Unknown type reference |
| `SCH2003` | Error | FK references non-existent table |
| `SCH2005` | Error | Table has no primary key |
| `SCH2006` | Error | Table has multiple primary keys |
| `SCH2007` | Error | Unknown index type |
| `SCH2009` | Error | Query parameter unknown type |
| `SCH2010` | Error | Invalid mutation return type |
| `SCH2011` | Error | Duplicate field name |
| `SCH2012` | Error | Unknown fragment reference |
| `SCH2013` | Error | Fragment argument count mismatch |
| `SCH2014` | Error | Duplicate key ordinal |
| `SCH2015` | Error | Invalid enum backing type / unterminated fragment |
| `SCH2016` | Error | Invalid aggregation variant / fragment depth exceeded |
| `SCH2017` | Error | Aggregation variant on non-aggregation index |
| `SCH2019` | Error | Fragment expansion size exceeded |
| `SCH2020` | Error | Declaration exceeds max field count |
| `SCH2021` | Error | Fragment expansion exceeds max field count |
| `SCH2032` | Error | View source relation unresolved |
| `SCH2033` | Error | Invalid materialized view capacity |
| `SCH2034` | Error | Unsupported materialized view refresh mode |
| `SCH2036` | Error | View source projection missing |
| `SCH2037` | Error | Duplicate view projection field |
| `SCH2038` | Error | View projection missing field |
| `SCH2039` | Error | View projection extra field |
| `SCH2040` | Error | View projection type mismatch |
| `SCH2041` | Error | View dependency cycle |
| `SCH2042` | Error | Semi/anti projection owner invalid |
| `SCH2043` | Error | Mutation targets derived relation |
| `SCH2044` | Error | Left-join projection unsupported |
| `SCH3001` | Error | Duplicate declaration across files |
| `SCH3002` | Error | Import resolved but file not found |
| `SCH3003` | Error | Import cycle detected |
| `SCH3004` | Error | Duplicate schema file identity |
| `SCH3005` | Error | Import outside schema root |
| `SCH4001` | Error | Circular import detected |
| `SCH4002` | Error | Imported file not found |
| `SCH4003` | Error | I/O or access error reading import |
| `SCH4004` | Error | Invalid import path |
| `SCH5001` | Error | Duplicate field in table |
| `SCH5002` | Error | Field has both @id and @relation |
| `SCH5003` | Warning | Table has no primary key (advisory) |
| `SCH5004` | Error | Fragment cycle detected |
| `SCH5005` | Error | Duplicate field in type |
| `SCH5006` | Error | Type field has table annotations |
| `SCH5007` | Error | Index field does not exist in table |
| `SCH5021` | Error | Duplicate field in view |
| `SCH5022` | Error | View field annotation unsupported |
| `SCH5023` | Error | Virtual view annotation unsupported |
| `SCH5024` | Error | Materialized view index field missing |
| `SCH5025` | Error | Materialized view identity field missing |
| `SCH5026` | Error | Materialized view annotation unsupported |
| `SCH5027` | Error | Materialized view source not maintainable |
| `SCH5028` | Error | Materialized view index kind unsupported |
| `SCH5029` | Error | Materialized index shape invalid |

---

## See Also

- **[QueryLanguage.md](/docs/query-language/reference)** — Query language syntax reference
- **[GettingStarted.md](/docs/getting-started)** — Setup and basic usage
- **[PGO.md](/docs/performance/pgo)** — Profile-Guided Optimization setup and usage
- **CompilerPipeline.md** — Compiler pipeline architecture (internal)
- **PhysicalPlanning.md** — Physical planning details (internal)
