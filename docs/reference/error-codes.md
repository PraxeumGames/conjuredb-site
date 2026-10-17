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

- **Manual compiler output** — from `ConjureDB.Compiler verify` or `generate`.
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
```conjure
// Intentionally invalid context: no table schema is supplied to the compiler.
// A query declaration alone does not supply metadata for the Users table.
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
```text
from Users u
| join Orders o (u.Id == o.UserId)
| select Name, o.Total
         ^^^^ UM1001: Must qualify as u.Name
```

**Example triggering UM1007:**
```text
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
| `UM1019` | `DuplicateAggregateAlias` | Error | Duplicate aggregate alias | Two aggregates in the same GROUP/SELECT produce columns with the same name. | Use explicit aliases: `total_a = sum(a), total_b = sum(b)`. |
| `UM1020` | `SetOperationArityMismatch` | Error | Set operation arity mismatch | UNION/INTERSECT/EXCEPT sides have different column counts. | Ensure both sides of the set operation SELECT the same number of columns. |
| `UM1021` | `SetOperationTypeMismatch` | Error | Set operation type mismatch | Corresponding columns in a set operation have incompatible types. | Align types with CASTs or select compatible columns. |
| `UM1022` | `ExistsSubqueryError` | Error | EXISTS subquery error | An EXISTS subquery is malformed or references invalid scope. | Check subquery syntax and ensure it references valid outer scope columns. |
| `UM1023` | `InvalidLimitOffset` | Error | Invalid TAKE/SKIP value | TAKE or SKIP has a non-positive value or is out of Int32 range. | Use a positive integer literal or parameter for TAKE/SKIP. |
| `UM1024` | `DeriveColumnError` | Error | Derive column expression error | A computed column in `derive` could not be resolved. | Check the expression syntax and referenced columns. |
| `UM1025` | `FunctionArgumentError` | Error | Function argument error | Wrong number or type of arguments passed to a function. | Check function signature. See `Query Language` for built-in function reference. |
| `UM1026` | `CaseImplicitConversion` | Warning | Implicit type conversion in CASE expression | CASE branches have different types that were implicitly converted. May lose precision. | Add explicit CASTs to make the conversion intentional. |
| `UM1027` | `AmbiguousNavigationPath` | Error | Navigation path is ambiguous | Multiple navigation paths exist between two entities; the compiler cannot pick deterministically. | Qualify the navigation or use an explicit JOIN with a specific FK. |
| `UM1028` | `NavigationLineageUnavailable` | Error | Navigation path cannot be expanded — lineage metadata unavailable | The compiler cannot trace the FK chain because required metadata is missing. | Ensure all FK relationships are declared in the schema with `@relation`. |

**Example triggering UM1020:**
```text
from Users | select Name, Age
| union
```

```text
from Orders | select OrderId
                     ^^^^^^^ UM1020: Left has 2 columns, right has 1
```

### Binding Resolution Conditions (UM1202–UM1214)

| Code | Name | Severity | Message | Description | Action |
|---|---|---|---|---|---|
| `UM1202` | `BareReferenceNoneRequiresDomain` | Error | Bare `none` requires an exact expected ref entity domain | `BIND_RES_074`: a bare `none` was written where no destination states a concrete, non-nullable entity-handle domain to type it. | Annotate the binding or fold seed with the ref type, or write into a declared handle column. |
| `UM1203` | `FoldResultRequiresMember` | Error | A fold result is not a whole value | `BIND_RES_075`: an immutable fold result was read as a whole scalar or record value instead of one of its readonly fields. | Select one result field (`result.Field`). |
| `UM1204` | `FoldResultMemberNotDeclared` | Error | Fold result has no such field | `BIND_RES_076`: the selected member is not declared by the issuing immutable fold result. | Use a field the fold result declares. |
| `UM1205` | `InferredPositionRequiresTypedValue` | Error | Cannot infer a type from `null` | `BIND_RES_077`: a position typed by its value alone — an unrouted command event or error payload member, an inferred nested payload record member, a command `var`, a function `let`, a system `var` or unannotated fold seed, a `select` output with no declared target (neither a declared result record member nor the single output of a declared scalar result) — received a bare `null` (or another untyped value), which states no type. | Write a value of a concrete type, or write into storage that declares the type (an event table route, a declared result record, an annotation). |
| `UM1206` | `NumericConstantOverflow` | Error | Integral constant overflow | `BIND_RES_NUMERIC_CONSTANT_OVERFLOW`: an integral constant expression is proven to leave its carrier under the governing checked overflow mode. | Widen the operand type, use `unchecked(...)` where wrapping is intended, or change the constant. |
| `UM1207` | `NumericConstantDivisionByZero` | Error | Integral constant division by zero | `BIND_RES_NUMERIC_CONSTANT_DIVZERO`: an integral constant expression is proven to divide or take a remainder by zero. | Change the divisor. |
| `UM1208` | `PureNominalConstructionTypeNotAdmitted` | Error | Construction type is not an admitted declared struct | `BIND_RECORD_008`: a pure function constructs a type that is not an admitted declared struct. | Construct a declared struct that the pure function surface admits. |
| `UM1209` | `PureNominalConstructionShapeNotAdmitted` | Error | Construction shape is not admitted | `BIND_RECORD_009`: a pure function constructs a declared struct whose fields are not all non-nullable `int` or whose original declared-type publication is unavailable. | Use a struct with non-nullable `int` fields only. |
| `UM1210` | `NoMatchingFunctionOverload` | Error | No overload of the function accepts the arguments | `BIND_RES_007`: the function exists, but none of its overloads accepts the call's argument types or count. The message names the argument types and the available signatures. | Pass arguments of an accepted type or arity, or cast an argument to one of the listed parameter types. |
| `UM1211` | `RetiredSpelling` | Error | A retired spelling | Parser code `C109`: the query writes a spelling Syntax V3 retired (every one is listed in [Retired Spellings](#retired-spellings-sch2173--um1211)). The parser refuses it, so the query is never bound; the message names the replacement exactly and the diagnostic carries the catalog's fix-it. A schema body reports the same refusal as `SCH2173`. | Write the replacement the message names, or apply the fix-it. |
| `UM1213` | `IdentifierCaseMismatch` | Error | Identifier differs only by case from its declaration | `BIND_RES_180`: an authored reference does not exactly match an existing declaration's spelling. | Use the exact declared spelling. A fix-it is available only when the binder owns the original identifier token. |
| `UM1214` | `IdentifierCaseCollision` | Error | Sibling names cannot differ only in case | `BIND_RES_181`: a new declaration conflicts with an existing sibling declaration by case alone. This is a declaration collision, not a misspelled reference. | Rename the new declaration to a distinct name. Changing its case to match the existing declaration would not resolve the duplicate; no replacement is inferred. |

### SQL Semantic Validation (UM1030–UM1042)

| Code | Name | Severity | Message | Description | Action |
|---|---|---|---|---|---|
| `UM1030` | `BinaryOperatorTypeMismatch` | Error | Binary operator type mismatch | Left and right operands of a binary operator have incompatible types (e.g., `int + string`). | Check operand types. Use CAST to align types. |
| `UM1031` | `AggregateRequiresNumeric` | Error | SUM/AVG requires numeric argument | SUM or AVG was applied to a non-numeric column (e.g., a string). | Use a numeric column or CAST the value. |
| `UM1032` | `AggregateRequiresComparable` | Error | MIN/MAX requires comparable type | MIN or MAX was applied to a type that doesn't support comparison. | Use a comparable type (numeric, string, DateTime). |
| `UM1033` | `AggregateRequiresBoolean` | Error | BOOL_AND/BOOL_OR requires boolean argument | Boolean aggregate applied to non-boolean column. | Ensure the argument is a boolean expression. |
| `UM1034` | `NestedAggregate` | Error | Nested aggregate functions not allowed | An aggregate contains another aggregate: `sum(count(x))`. | Split into a subquery or use GROUP + derive. |
| `UM1035` | `AggregateInWhere` | Error | Aggregate function not allowed in WHERE clause | Aggregates cannot appear in filter predicates. | Move the condition to a `filter` after `group` (the DSL equivalent of SQL HAVING). |
| `UM1036` | `FunctionTypeMismatch` | Error | Function argument type mismatch | A function was called with arguments of incorrect type. | Check function signature and argument types. |
| `UM1037` | `InvalidWindowFrameBounds` | Error | Invalid window frame bounds | Window frame start is after the end (e.g., `ROWS BETWEEN 5 FOLLOWING AND 2 PRECEDING`). | Ensure frame start ≤ frame end. |
| `UM1038` | `InvalidWindowFrameStart` | Error | UNBOUNDED FOLLOWING cannot be frame start | Frame start cannot be UNBOUNDED FOLLOWING. | Use UNBOUNDED PRECEDING or a concrete offset for the start bound. |
| `UM1039` | `InvalidWindowFrameEnd` | Error | UNBOUNDED PRECEDING cannot be frame end | Frame end cannot be UNBOUNDED PRECEDING. | Use UNBOUNDED FOLLOWING or a concrete offset for the end bound. |
| `UM1040` | `WindowOffsetMustBeNumeric` | Error | LAG/LEAD offset must be numeric | The offset argument to LAG or LEAD is not a numeric type. | Pass an integer literal for the offset. |
| `UM1041` | `SetOperationColumnTypeMismatch` | Error | SET operation column type mismatch | Post-validation detected incompatible column types across UNION/INTERSECT/EXCEPT sides. | Align column types with explicit CASTs. |
| `UM1042` | `OuterJoinFilterWarning` | Warning | Outer join filter may change join semantics | A filter on the nullable side of a LEFT/RIGHT JOIN may convert it to an INNER JOIN. | Move the filter into the JOIN predicate, or confirm the semantic change is intentional. |

**Example triggering UM1034:**
```text
from Orders
| group UserId
| select UserId, sum(count(Amount))
                 ^^^^^^^^^^^^^^^^^^ UM1034: Nested aggregate
```

**Example triggering UM1042:**
```text
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
| `UM2014` | `IrBuildInListRequiresLiteral` | Error | IN list requires literal values to build array RHS | An `in (...)` list contains a column reference or a computed expression. The list is materialized as a typed CLR array at compile time, so every element must be a constant. | Replace the non-constant elements with literals, or pass the set as a typed array parameter (`in @ids`). |
| `UM2028` | `IrBuildMembershipSetNotElementInspectable` | Error | NOT IN requires an element-inspectable right-hand side | `x not in S` is false whenever any element of `S` is null, so binding needs a way to test the elements for null. A right-hand side whose carrier is not an array cannot be tested, leaving that row of the truth table undecidable. | Declare the parameter as a typed array. See [Query Language § Set Membership](/docs/query-language/reference#nulls-in-membership). |

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
| `UM4003` | `UnsupportedDecorrelationPattern` | Error | Unsupported decorrelation pattern | The planner cannot decorrelate a correlated subquery (e.g., nested subqueries, non-equality correlation predicates). | Rewrite the subquery as an explicit JOIN or use a different correlation pattern. See also UM7015. |

**Example triggering UM4003:**
```text
from Users u
| select Name, (from Orders | filter UserId == u.Id and Amount > u.MinAmount | select count(*))
                                                        ^^^^^^^^^^^^^^^^^^^^ Non-equality correlation not decorrelatable
```

---

## Unsupported Feature Errors (UM5xxx)

These indicate usage of syntax or features the compiler does not yet support.

| Code | Name | Severity | Message | Description | Action |
|---|---|---|---|---|---|
| `UM5001` | `UnsupportedFeature` | Error | Feature not supported by the compiler | A query construct is recognized but not yet implemented. | Check `Query Language` for supported features. Rewrite using supported syntax. |
| `UM5002` | `UnsupportedOperator` | Error | Operator not supported | An operator (e.g., bitwise, ternary) is not supported in the query language. | Use supported operators. See `Query Language`. |
| `UM5003` | `UnsupportedSyntax` | Error | Syntax construct not supported | A syntax construct is valid in the parser but not supported by the compiler backend. | Rewrite using a different approach. |
| `UM5004` | `UnsupportedNodeType` | Error | Node type not supported | An AST node type was encountered that the compiler doesn't handle. | Simplify the query. This may indicate an internal issue — report if the syntax looks valid. |
| `UM5005` | `SyntaxError` | Error | Query text could not be parsed | The query text has a syntax error that prevents parsing. | Check query syntax. Look for missing operators, unmatched parentheses, or invalid tokens. |

**Example triggering UM5005:**
```text
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
| `UM6003` | `MemoryBudgetExceeded` | Error | Trusted heap budget exceeded | The finalized plan's proven upper bound on live heap bytes is larger than the budget the query host requested. | Raise the requested budget, or change the plan (add an index, bound a TOP-N) so its proven bound fits. The diagnostic names the dominant contributor. |
| `UM6004` | `MemoryBudgetUnprovable` | Error | Trusted heap budget could not be proven | The plan contains a surface the memory model cannot prove allocation-free **per call**. This is a statement about the plan, not about your query text: a different plan for the same query may satisfy it. | Read the surface named in the message. Common causes: a secondary index that re-synchronizes committed lag on every execution, a collection-valued scalar subquery, a growable sort buffer, or a result container the caller owns. See Memory Contract. |
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
| `UM7004` | `SortWithoutLimit` | Warning | Sort without LIMIT on potentially large result set | A `sort` orders the entire result set with no `take` to cap the output. | Add `take N` to limit results, or rely on an index that provides the desired order. |
| `UM7008` | `FullSortOnLargeDataset` | Warning | Full sort on large dataset | PGO data indicates the sorted dataset is large, making sort expensive. | Add a covering index that matches the sort order, or add `take N`. |

**Example triggering UM7001:**
```text
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

### Subquery Diagnostics

| Code | Name | Severity | Message | Description | How to Fix |
|---|---|---|---|---|---|
| `UM7011` | `NestedCollectionAllocation` | Warning | Nested collection subquery generates per-entity allocation and O(N×M) scan | A nested collection projection creates a `List<T>` per outer row and performs a full inner scan for each. | Add an index on the correlation key. Consider flattening the query. |
| `UM7012` | `NestedObjectProjectionNotEmittable` | Warning | Nested object projection detected but emission not yet supported | A nested object projection was planned but code generation for it is not yet implemented. | Flatten the projection or wait for a compiler update. |
| `UM7015` | `ResidualCorrelatedScalarSubqueryUnsupported` | Error | Residual correlated scalar subquery is unsupported | A scalar subquery still references an outer-row slot after planning. The compiler stops before C# or portable emission. | Rewrite as an explicit JOIN with aggregation, or use a scalar shape that the optimizer can decorrelate. |
| `UM7022` | `ResidualLateralJoinUnsupported` | Error | Correlated relation-valued JOIN sources are not supported after binding | The JOIN RHS references outer columns, but no DependentApply physical contract exists for native and portable execution. | Rewrite it as an uncorrelated JOIN/aggregate shape. |

### PGO Warnings

| Code | Name | Severity | Message | Description | How to Fix |
|---|---|---|---|---|---|
| `UM7006` | `MissingPgoStatistics` | Warning | Missing PGO statistics for a critical query | No profile data is available for this query, preventing the optimizer from making cost-based decisions. | Run PGO collection. See `PGO` for setup instructions. |
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

### Optimization Trace Codes

When `[DebugGeneration]` is enabled, the optimizer records short codes naming the decisions it made.
A trace code is a **decision**, not a strategy inventory: the optimizer chooses between far more
physical strategies than it explains, and only the decisions worth surfacing get a code.

This page previously listed a nine-row `JOIN:*` strategy table. Eight of those codes were never
recorded by any planner — they were declared alongside the real ones and copied here, so the list
described an intent rather than the tool's behaviour, and `JOIN:PGO` never existed even as a
declaration. If you searched a trace for one of them and found nothing, that is why.

The authoritative list is the `ConjureDB.Compiler.Diagnostics.TraceCodes` table, which a governance
test keeps equal to the set of codes planners actually record — in both directions, so it can
neither list a code nothing emits nor miss one that some planner does. The join family currently
records one code:

| Trace Code | Decision |
|---|---|
| `JOIN:HASH` | A hash join's runtime contract was planned |

See Compilation Tracing for the trace format and how to read
the full set.

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
| `BIND_RES_005` | Function not found | No function with the given name exists in the catalog. | Check spelling. See `Query Language` for built-in functions. |
| `BIND_RES_006` | Function does not support DISTINCT | DISTINCT modifier was used on a function that doesn't support it. | Remove the DISTINCT modifier. |
| `BIND_RES_007` | No matching function overload | The function exists, but none of its overloads accepts the call's argument types or count (e.g. `max` over a `string`). The message lists the argument types and the available signatures (canonical `UM1210`). | Pass arguments of an accepted type or arity, or cast an argument to one of the listed parameter types. |
| `BIND_RES_009` | Window function requires OVER clause | A window function (e.g., `row_number`, `lag`) was called without `OVER()`. | Add `OVER(...)` clause with appropriate partitioning and ordering. |
| `BIND_RES_015` | Ambiguous function overload | Multiple function overloads match the provided arguments equally well. | Add explicit CASTs to narrow the overload selection. |
| `BIND_RES_016` | Function does not support OVER clause | A non-window function was called with an OVER clause. | Remove the OVER clause — this function is not a window function. |

### Type Coercion

| Code | Message | Description | Action |
|---|---|---|---|
| `BIND_RES_011` | No common type | CASE/IN branches or binary operands have no common type for implicit conversion — including two numeric operands no implicit conversion joins (`long` with `ulong`, `decimal` with `double`, a signed integral with `ulong`), which C# rejects too. | Add an explicit `cast(<operand> as T)` choosing the type, or ensure operands share a compatible type. |
| `BIND_RES_012` | Requires boolean expression | A context (e.g., filter, WHEN) requires a boolean but received another type. | Ensure the expression evaluates to a boolean. |
| `BIND_RES_013` | Requires integer expression | A context (e.g., TAKE/SKIP) requires an integer but received another type. | Pass an integer value or CAST to integer. |
| `BIND_RES_014` | Cannot convert or assign value | A value cannot be converted to the required target type, or cannot be assigned to it. Every write — `set`, `update {}`, insert/upsert/values fields, event payloads, record construction members, scalar command results (`-> T` / `-> T?`), pure function returns (`function f() -> long { return null }` is refused here), command invocation arguments, system `var`/fold-seed annotations and writes into annotated fold accumulators, and each column of `insert … \| from … \| select …` — admits only implicit conversions. A target that does not admit absence (a non-nullable value-type or reference-type column, member, result or parameter: `string` versus `string?`) never accepts a value that may be absent: `null`, a nullable column or parameter, or any value whose nullability is not proven. A filter does not narrow a later write (`filter w.Nick != null \| set { w.Name = w.Nick }` is refused) — one explicit-absence rule for value and reference types. Reported at the value, behind the owner prefix (`System 'X':`, `Command 'X':`, `Mutation 'X':`); systems and commands report it under the write position's code (`SCH2156` for set/update and every command write, `SCH2167` for system insert/upsert fields), mutations under `BIND_RES_014`. | Convert the value explicitly, supply a default (`value ?? other`), or declare the target nullable. |
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
| `BIND_RES_042` | IN requires list, array, or subquery | The right-hand side of IN is not a list, array, or subquery. | Use `in (1, 2, 3)` or `in (from ...)` syntax. |

### Subquery Errors

| Code | Message | Description | Action |
|---|---|---|---|
| `BIND_RES_018` | Subquery not supported in context | Subquery expressions are not supported in the current context. | Rewrite without a subquery or use a different operator. |
| `BIND_RES_020` | CASE requires at least one WHEN | An empty internal CASE expression was encountered. This retains its diagnostic identity; authored format-2 expressions use `switch`, not CASE text. | If authored format-2 source produced this code, report it as a compiler bug; use a `switch` with at least one arm and an `_` default. |
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
| `BIND_RES_032` | BY column not found in right side | A BY column in a set operation doesn't exist in the right operand. | Check column name spelling, or alias the right-side column to match. |
| `BIND_RES_056` | BY set-operation output metadata missing | Internal: a BY set-operation output column lost its binding metadata. | Report as bug. |
| `BIND_RES_059` | Set operation column count mismatch | The two sides of UNION/INTERSECT/EXCEPT project a different number of columns. | Align the two SELECT lists. |
| `BIND_RES_061` | Duplicate BY column | A BY column is listed more than once in a set operation. | Remove the duplicate from the BY list. |
| `BIND_RES_062` | BY column not found in left side | A BY column in a set operation doesn't exist in the left operand. | Check column name spelling. |
| `BIND_RES_063` | BY column ambiguous in left side | A BY column in a set operation matches multiple columns on the left side. | Use explicit column selection or aliasing. |
| `BIND_RES_064` | BY column ambiguous in right side | A BY column in a set operation matches multiple columns on the right side. | Use explicit column selection or aliasing. |

### Grouping and Pagination

| Code | Message | Description | Action |
|---|---|---|---|
| `BIND_RES_060` | GROUP BY requires columns only | GROUP BY received a computed expression instead of a column reference. | Use `derive` to compute the expression, then GROUP BY the derived column. |
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
| `BIND_RES_050` | Pipeline transform / closed lexical value error | Two shapes share this code. (a) Dynamic TAKE/SKIP values cannot be composed when chained. (b) A scope with a **closed lexical value catalog** — a frame `system` body is one — named a value the catalog does not declare, or a member the named value's type does not have (`ExpressionResolver.IdentifierAndLiteral.cs`, `BindingScope.LexicalValues.cs`). An enum literal is **no longer** case (b): the schema's declared enums now reach binding as a catalog and `CrateGrade.Priority` resolves to a typed constant in all three dialects. A *bare* member name (`Priority` on its own) is still case (b), deliberately — see `BIND_RES_069`. | (a) Use a single TAKE/SKIP with a dynamic value, or chain only literal values. (b) Bind the value first — read it from a column, a `var`, or an `insert` payload — or, for an enum member, qualify it with its enum. |
| `BIND_RES_058` | Assignment has no parsed scalar expression | An assignment reached binding without the parser-populated expression payload. | Report as a compiler bug; valid parsed assignment syntax always carries this payload. |
| `BIND_RES_069` | Enum declares no such member | A qualified name resolved its root to a declared enum, but the enum declares no member with that name. The message names the enum and lists every member it does declare. This is deliberately **not** `BIND_RES_050`: that code says the root name is undeclared, which would be a false statement about a name the catalog knows. Member references require exact declared spelling. A case-only miss such as `CrateGrade.pRiOrItY` is reported as `UM1213` with the actual declared spelling; a name with no matching declaration reaches this code. Note that a **bare** member name is not this error: enum constants must be qualified, because the enum catalog is schema-global and admitting bare members would make adding a member to a schema a source-breaking change for unrelated queries. | Use one of the members the message lists, or add the member to the enum declaration. |
| `BIND_RES_070` | Enum name is ambiguous with a name in scope | A qualified name's root names both a declared enum and a value the query introduced — a relation alias, a row alias, a parameter or a local — so `Root.Member` has two readings. A COLUMN sharing an enum's name is not this error: `rank: Rank` is ordinary, and a qualified `Rank.Officer` is a relation lookup that finds nothing rather than a second reading of the column. The binder refuses rather than arbitrating: resolving it in either order would decide the author's meaning silently, and a later rename could change it again without a diagnostic. This is checked **before** any resolver runs, so the answer does not depend on which one would have won. | Rename the alias, parameter or local, or rename the enum in the schema. |
| `BIND_RES_071` | Sort key is a constant | A `sort` key resolved to a constant, which orders nothing because every row compares equal on it. The sort grammar takes an identifier path rather than an arbitrary expression, so this is reachable only through a path that resolves to a constant — an enum member (`sort Rank.Officer`). Refused at binding, where the clause is still visible, rather than in the planner, which would report an internal winner-surface failure naming neither the clause nor the cause. | Sort by a column, or by an output alias of the pipeline. An enum *column* already sorts by its backing value. The check covers the DIRECT form only: a sort key that is an output alias projected from a constant (`select g = Rank.Officer \| sort g`) is still admitted, as `select g = 1 \| sort g` always has — by the time `sort` resolves it, the alias is a column of the projected surface. |
| `BIND_RES_072` | Invalid construction workspace read | An indexed read `name[index]` binds only as a read of a construction workspace declared in scope (a frame `system` `var ... = workspace(...)`); the target must be that unqualified workspace name and the index must be a non-nullable `int`. Indexing anything else — a query parameter, a column, a collection-typed `extern` value — is rejected here rather than reported as a generic expression error (`ExpressionResolver.ResolveWorkspaceRead`). | Index only an in-scope workspace with a non-nullable `int`; read keyed external data through a join or a function instead of an indexer. |
| `BIND_RES_073` | Window partition key is a constant | A `window by` key resolved to a constant, which partitions nothing because every row falls in the one partition it names. Like `BIND_RES_071`, this is reachable only through an identifier path that resolves to a constant — an enum member (`window by Rank.Officer (...)`). Refused at binding, through the same owner as constant sort keys, rather than surfacing as the unrelated `BIND_VAL_010` type check. | Partition by a column, or omit `by` to compute the window over the whole input. An enum *column* is an ordinary partition key. |
| `BIND_RES_074` | Bare `none` requires an exact expected ref entity domain | A bare `none` (reference absence) is typed only by its destination; here no destination states a concrete non-nullable entity-handle domain (canonical `UM1202`). | Annotate the binding or fold seed with its ref type, or write `none` into a declared handle column. |
| `BIND_RES_075` | Fold result is not a whole value | An immutable fold result was used as a whole scalar or record value; only its readonly fields are values (canonical `UM1203`). | Select one result field. |
| `BIND_RES_076` | Fold result member not declared | The selected member is not declared by the issuing immutable fold result (canonical `UM1204`). | Use a field the fold result declares. |
| `BIND_RES_077` | Cannot infer a type from `null` | A position typed by its value alone has no declaration to contextualize an untyped value, so a bare `null` (absent of every type) cannot state which absent value it is — as in C#, where `var x = null` and `new { V = null }` are errors. Self-typed positions: unrouted command `event` and error payload members (and their nested inferred records), command `var`, function `let`, system `var` and unannotated fold seeds, and `select` outputs with no declared target (neither a declared result record member nor the single output of a declared scalar result such as `-> long?[]`). Positions with an exact required type (`if`/`require` guards, draw arguments, handle targets) instead contextualize the `null` and report their own exact-type refusal (canonical `UM1205`). | Write a value of a concrete type, or write into storage that declares the type (route the event into an event table, declare the result record member, annotate the local). |
| `BIND_RES_NUMERIC_CONSTANT_OVERFLOW` | Integral constant overflow | An integral constant expression is proven to leave its carrier under the governing checked overflow mode (canonical `UM1206`). | Widen the operand type, use `unchecked(...)` where wrapping is intended, or change the constant. |
| `BIND_RES_NUMERIC_CONSTANT_DIVZERO` | Integral constant division by zero | An integral constant expression is proven to divide or take a remainder by zero (canonical `UM1207`). | Change the divisor. |
| `BIND_RECORD_008` | Construction type is not an admitted declared struct | A pure function constructs a type that is not an admitted declared struct (canonical `UM1208`). | Construct a declared struct that the pure function surface admits. |
| `BIND_RECORD_009` | Construction shape is not admitted | A pure function constructs a declared struct whose fields are not all non-nullable `int` or whose original declared-type publication is unavailable (canonical `UM1209`). | Use a struct with non-nullable `int` fields only. |

### Mutation Targets (BIND_MUT_xxx)

| Code | Message | Description | Action |
|---|---|---|---|
| `BIND_MUT_021` | Query INSERT output names no target column | `insert T \| from … \| select …` maps each select output onto the target column its declared name denotes (resolved by the exact authored target-column name). An output that declares no name — a computed item written without `Name =`, whose alias the parser synthesized (`select s.Id + 100, …`) — or whose name denotes no column of `T` (`Zz = s.Total`) is refused at the select item, behind the `Mutation 'X':` prefix. | Write each output as `Column = expression`, naming the target column it writes. |

---

## Binding Build Errors (BIND_BLD_xxx)

These errors occur during the IR building phase — when the resolved AST is lowered into the relational intermediate representation. They are thrown as `BindingBuildException`.

| Code | Message | Description | Action |
|---|---|---|---|
| `BIND_BLD_001` | OutputColumnId is invalid | A column identity is invalid during IR construction. Resolver must assign valid IDs. | Report as bug — the binding phase failed to assign column identities. |
| `BIND_BLD_002` | ClrType is null | A node's CLR type was not resolved before IR building. | Report as bug — the type resolver missed this node. |
| `BIND_BLD_003` | ComputationExpressionId is missing | An aggregate descriptor lacks its computation expression identity. | Report as bug — aggregate binding incomplete. |
| `BIND_BLD_005` | IN list requires literal array | IN list operands must be compile-time literal values for array construction. | Use literal values in the IN list, or pass as a parameter. |
| `BIND_BLD_006` | Output column count mismatch | The IR node's output column count doesn't match what was expected by the parent. | Report as bug — indicates a binding/lowering inconsistency. |
| `BIND_BLD_007` | NULLS FIRST/LAST not supported | ORDER BY with explicit NULL ordering is not yet implemented. | Remove NULLS FIRST/LAST clause. Default NULL ordering applies. |
| `BIND_BLD_008` | Aggregate requires argument | An aggregate function has no argument expression during IR building. | Provide an argument to the aggregate function. |
| `BIND_BLD_009` | Unsupported binary operator | A binary operator cannot be lowered to the IR. | Use a supported operator. Check `Query Language`. |
| `BIND_BLD_010` | Let binding not found during IR build | A let binding referenced during IR construction does not exist. | Report as bug if the let binding was defined in the query. |
| `BIND_BLD_011` | Duplicate LET binding | A LET name is defined more than once in the query during IR build. | Use unique LET names. |
| `BIND_BLD_012` | Unsupported window frame bound kind | An unrecognized window frame boundary type was encountered. | Use standard frame bounds: UNBOUNDED, CURRENT ROW, or numeric PRECEDING/FOLLOWING. |
| `BIND_BLD_013` | Set operation column cannot cast | A set operation column type cannot be cast to the target type during IR lowering. | Ensure corresponding columns have compatible types or add explicit CASTs. |
| `BIND_BLD_014` | Unknown FilterPhase value | An internal filter phase enum value is not handled. | Report as bug. |
| `BIND_BLD_015` | Set operation column cannot be padded | A `by` set operation must pad a column whose type has no canonical default value. | Project the column explicitly on every branch, or use a type with a default. |
| `BIND_BLD_016` | ORDER BY key unavailable after projection | The sort key cannot be represented once the projection boundary has dropped it. | Sort before the projection, or include the key in the projected output. |
| `BIND_BLD_017` | NOT IN needs an element-inspectable right-hand side | `not in` is false whenever any element is null, so binding must be able to test the elements; a carrier that is not an array cannot be tested. | Declare the parameter as a typed array. See [Query Language § Set Membership](/docs/query-language/reference#nulls-in-membership). |
| `BIND_COALESCE` | COALESCE requires at least two arguments | Internal invariant of the coalesce node: `a ?? b` always supplies two operands, so authored text cannot reach it. | Report a compiler defect. |

---

## Binding Contract Errors (BIND_CONTRACT)

| Code | Message | Description | Action |
|---|---|---|---|
| `BIND_CONTRACT` | Contract violation(s) detected | One or more binding invariants were violated. The exception contains a list of `BindingContractViolation` records with individual error codes and messages. | Inspect the `Violations` collection for specific codes. Report as bug. |

---

## Ephemeral Table Errors (UMEPxxx)

These schema/compiler diagnostics enforce frame-local safety and current capability
boundaries of ephemeral storage.

| Code | Severity | Description | Action |
|---|---|---|---|
| `UMEP001` | Error | An ephemeral field is not a schema-proven unmanaged value type. | Use a scalar, enum, or `struct type`; remove strings, binary, collections, class types, and extern CLR types. |
| `UMEP002` | Error | An `event table` or `singleton table` declares `@index`, `@unique`, `@@index`, or `@@unique`; these kinds own no rows to index. | Use chunk scans or entity-slot probes; a plain `ephemeral table` may declare `@index(kind: lookup \| bucketed)` instead — see `UMEP018`. |
| `UMEP003` | Error | An ephemeral kind declares `persistence`. | Remove the persistence option. |
| `UMEP004` | Error | An ephemeral kind declares a persistent `type_id`. | Remove `type_id`; generated frame storage receives a compiler-owned runtime identity. |
| `UMEP005` | Error | An event or singleton table declares `@id`. | Remove the id; events are keyless and singletons have implicit one-row identity. |
| `UMEP006` | Error | A singleton declares `capacity` or `max_capacity`. | Remove the option; singleton capacity is exactly one. |
| `UMEP007` | Error | `lifetime` appears on a non-event table. | Use `lifetime: frame` or `lifetime: next_frame` only on `event table`. |
| `UMEP008` | Error | An `@@group` declaration is invalid or appears on an unsupported kind. | Group only known, non-id fields of a plain ephemeral table, and place each field in at most one group. |
| `UMEP009` | Error | A relation or navigation points into frame-lifetime storage. | Store a plain id when explicitly needed; persistent rows cannot own relations to ephemeral rows. |
| `UMEP010` | Error | `max_capacity` is non-positive or smaller than `capacity` on a non-event frame-lifetime table; a malformed singleton bound can report this code in addition to `UMEP006`. | Give a plain `ephemeral table` a positive hard cap at least as large as its capacity hint. Remove `max_capacity` from singleton tables (`UMEP006`) and event tables (`UMEP021`). |
| `UMEP011` | Error | An entity-domain declaration is duplicate, ambiguous, unknown, or contains a non-ephemeral member. | Give each plain ephemeral table at most one valid domain membership. |
| `UMEP012` | Error | An ephemeral entity `@id` is not a non-nullable `int`. | Use exactly one non-nullable integer id. |
| `UMEP013` | Error | A reactive query or materialized view reads an ephemeral source whose publication into existing IVM is not implemented. | Current limitation, not a permanent integration ban. Until supported, use a compiled query or explicitly publish a persistent summary; see [the corrected integration contract](/docs/advanced/ephemeral-tables#reactive-integration--current-implementation-limitation). |
| `UMEP014` | Error | A transactional command or mutation writes an ephemeral target. | Move the operation into a `system`, or write a persistent outcome through the transaction. |
| `UMEP015` | Error | A routed command event targets a table that is not an `event table`. | Route the event to an ephemeral `event table`, or remove the table route. |
| `UMEP016` | Error | A persistent column reaches a `handle(...)` type, directly or through a declared struct type. | Entity handles are frame-lifetime identities and are never persisted; store a domain-owned persistent key instead. |
| `UMEP017` | Error | A `handle(...)` column is declared nullable. | Drop the `?`; the absent value of a handle column is `EntityHandle.None`. |
| `UMEP018` | Error | Invalid `@index` on a plain `ephemeral table`: an unsupported kind, an unsupported or nullable key type, the `@id` column, an unsupported index option, a `buckets:` count that is not positive or exceeds the table's row bound (`max_capacity` when declared, otherwise `capacity`), a `name:` already used by another index of the same table (its derived `<Table>_<Column>_Index` default included), or a composite `@@index`/`@@unique`. | Declare `@index(kind: lookup \| bucketed)` on a non-nullable integral, enum, or `handle(D)` column (`bucketed` excludes `handle`); size `buckets:` between 1 and the table's row bound — its `max_capacity` when it declares one, otherwise its `capacity`; give each index of a table a distinct name; drop composite index declarations, which are not supported on ephemeral tables. |
| `UMEP019` | Error | An indexed ephemeral column is named in a `@@group`. | Remove the column from the `@@group`; an indexed column is placed in its own storage group automatically. |
| `UMEP020` | Error | A frame-lifetime `ephemeral table`, `event table`, or `singleton table` declares `schema_version`. | Remove `schema_version`; these kinds have no persisted schema descriptor. |
| `UMEP021` | Error | An `event table` declares `max_capacity`. | Remove `max_capacity`; an event stream has no hard row cap. |

### Frame runtime contract errors

These are **not** diagnostics: they are typed exceptions a generated frame system throws at
run time when the host has put the database in a state a frame may not read. Each carries a
reason code so a handler can branch on the cause rather than on a message.

| Type | Reason | Meaning | Action |
|---|---|---|---|
| `FrameHostContractException` | `FrameHostContractError.PersistentIndexUncommittedChanges` | A system with a `join P t on index (…)` acquired a persistent lookup index that does not reflect committed state — the table has staged uncommitted changes, or a committed change has not reached the index yet. The exception names the system, the table and the index. A frame never synchronizes an index on the frame thread and never scans the primary index instead, so this fails closed rather than pausing or reading stale rows. | Finish (commit or roll back) the transaction that changed the table before calling `Pump` — the host commits before it pumps ([Ephemeral Tables § Persistent index sources in a system](/docs/advanced/ephemeral-tables#persistent-index-sources-in-a-system)). The frame loop is usable again on the next pump. |
| `EphemeralParentLinkViolationException` | `EphemeralParentLinkViolation.Cycle` | A write to a `@parent` link column would make the row its own ancestor. The message names the table, the link column, the row and the proposed parent. | Do not close the cycle: a `@parent` column is a forest at all times ([Schema Language § `@parent`](/docs/schema/schema-language#65--ephemeral-tables-events-singletons-domains-and-systems)). Nothing was stored, so the table is unchanged. |
| `EphemeralParentLinkViolationException` | `EphemeralParentLinkViolation.MaxDepthExceeded` | The proposed link would put the row at a depth past the declared `max_depth`. The message names the computed depth and the declared bound. | Raise `max_depth` (and the depth index's `buckets:` with it, since the domain must hold `[0, max_depth]`), or reparent to a shallower row. |
| `EphemeralParentLinkViolationException` | `EphemeralParentLinkViolation.ParentNotShallower` | The live parent's stored depth is not strictly less than the depth the ancestor walk computed for the row. It is a defence-in-depth check: the two can disagree only if something other than the link owner wrote the depth column. | Treat it as a defect report, not a shape to handle — the depth column has a second writer. The declarative surface refuses both writers it can see statically (`SCH2171`). |
| `EphemeralIndexDomainViolationException` | — (typed, no reason enum: it has exactly one cause) | A write stored a `bucketed` index key outside the index's declared `[0, buckets)` domain. The message names the table, the column, the rejected key and the domain; `TableName` / `ColumnName` / `Key` / `Buckets` expose them. Non-negativity of a computed key is a runtime fact, not a column-type one, so this is an exception rather than a diagnostic. | Widen the index's `buckets:` (subject to the table's row bound), or clamp the value before writing it. The bucket is resolved before anything is stored, so a rejected write leaves the column and the index exactly as they were. |

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
| `SCH1028` | Error | Fragment invocation syntax is not canonical | A fragment invocation is missing its parenthesized argument list, contains an empty or malformed argument, or cannot be represented as one canonical typed expression with a valid source span. | Use `@fragment(...)` and fix the argument expression at the reported span. |

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
| `SCH2022` | Error | Partial index predicate is not analyzable | An `@@index` / `@index` `filter:` predicate is outside the supported fragment: a conjunction of `column == literal`, bare boolean `column`, and negated boolean `not column` terms. Inequality (`>`, `<`, `!=`), disjunction (`or`), arithmetic and function calls are rejected. | Rewrite the predicate as an equality conjunction, or drop `filter:` and index the whole table. A predicate outside this fragment cannot be proven to imply a query's filter, so the index would be maintained on every write and never selected. |
| `SCH2027` | Error | Duplicate index | Two index declarations on one table have the same physical identity — kind, key columns and every declared option agree — whatever their spelling: field `@unique` beside `@@unique(fields: [Field])` or `@index(kind: unique)` is the same unique index declared twice. Reported at the later declaration in binding order (field-level before `@@`). | Delete one of the two declarations. |
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
| `SCH2045` | Error | View projection semantic binding failed | A view projection cannot be resolved from its canonical typed source syntax. | Fix the typed source pipeline and ensure its final `select` matches the declared view fields. |
| `SCH2062` | Error | Invalid query result terminal contract | A query result terminal has a typed `else` outcome, does not match the declared return shape, or is applied to a reactive query. | Remove the typed `else` outcome, align the terminal with the return type, or use a non-reactive query. |
| `SCH2063` | Error | Query result projection field invalid | An authored query projection names a field absent from the declared result record or traverses a field without a nested record shape. | Align projection field names and nesting with the declared result type. |
| `SCH2064` | Error | Invalid file-local table alias | A `using Alias = Table` duplicates another alias of the file, collides with a visible declaration name, or names something other than a declared table (aliases cannot chain); or a local symbol — query parameter, `let`, source alias, or in a system a driver/join/fold alias, local, `derive`, `values` input, random stream, fold result, workspace or grid snapshot — has the same (case-insensitive) name as an active alias of its file. | Rename the alias or the local symbol, and point the alias at a declared table. |
| `SCH2110` | Error | Invalid command pipeline | A command query pipeline or remaining generic command pipeline surface is malformed: missing target table, unknown table, unsupported operator, missing terminal, invalid assignment/projection, or unsupported reserved operation. | Fix the pipeline so it names a declared table, uses supported operators, and for `var` query bindings ends with a lower-case cardinality terminal such as `single`, `count`, or `to_list`. |
| `SCH2111` | Error | Unknown command kind | A command `kind` clause is not one of the supported command kinds. | Use `local`, `local_or_online`, `online_player`, `admin`, `server_job`, or `internal`. |
| `SCH2112` | Error | Unknown idempotency parameter | `idempotent: by <param>` references a parameter not declared by the command. | Rename the idempotency key reference or add the missing command parameter. |
| `SCH2113` | Error | Unknown command metadata parameter | A command metadata call, such as `scope: player(...)` or `auth: player(...)`, references an unknown command parameter. | Ensure every metadata parameter reference names a declared command parameter. |
| `SCH2114` | Error | Duplicate command variable | A command variable reuses a command parameter name or a previously declared variable name. | Rename the variable so every command-scope name is unique. |
| `SCH2115` | Error | Missing command return | A command declares a result type but its body has no `return` statement. | Add `return { ... }` matching the declared result type, or remove the result type. |
| `SCH2116` | Error | Unknown schema command invocation | A command invocation does not resolve to a declared schema command in the current module or by canonical identity. | Fix the command name, qualify it, or declare the target command. |
| `SCH2117` | Error | Command call cycle | Commands invoke each other cyclically, so execution order and error manifests cannot be determined. | Break the cycle by extracting shared logic into a non-recursive command or direct pipeline. |
| `SCH2118` | Error | Unknown command argument | A named subcommand invocation passes an argument that is not declared by the target command. | Remove the argument or rename it to a target parameter. |
| `SCH2119` | Error | Missing command argument | A subcommand invocation omits a required target command parameter. | Pass every required argument. |
| `SCH2120` | Error | Duplicate command argument | A named subcommand invocation passes the same argument more than once. | Keep one value per target parameter. |
| `SCH2121` | Error | Command positional argument count mismatch | A positional subcommand invocation has a different argument count than the target command parameters. | Pass exactly the target parameter count or switch to named arguments. |
| `SCH2122` | Error | Mixed command argument styles | A subcommand invocation mixes positional and named arguments. | Use either all positional arguments or all named arguments in a single invocation. |
| `SCH2123` | Error | Invalid command return payload syntax | A command return payload for a typed result is not object syntax. | Return an object payload: `return { field = expression }`. |
| `SCH2124` | Error | Malformed command return field | A field in a command return payload is missing `=`. | Write return fields as `name = expression`. |
| `SCH2125` | Error | Unknown command return field | A command returns a field not declared by its result type. | Remove the field or add it to the declared result type. |
| `SCH2126` | Error | Missing command return field | A command return payload omits a field required by the declared result type. | Include every result field in the return payload. |
| `SCH2127` | Error | Duplicate command return field | A command return payload declares the same result field more than once after PascalCase normalization. | Return each result field once. |
| `SCH2128` | Error | Empty command event name | A command event statement has an empty event name. | Give the event a non-empty name. |
| `SCH2129` | Error | Invalid command payload object | A command event, error, or pipeline error payload is missing where required or is not object syntax. | Use `{ field = expression }` object syntax, and provide a non-empty payload for events. |
| `SCH2130` | Error | Malformed command payload field | A field in an event/error/pipeline payload is missing `=`. | Write payload fields as `name = expression`. |
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
| `SCH2146` | Error | Command write returning missing `into` | A command write statement has `returning` but does not bind the projection with `into <name>`. | Add `into <name>` after the returning projection, for example `returning { amountAfter = Amount } into inventoryAfter`. |
| `SCH2147` | Error | Invalid command write key | A command `update`, `upsert`, or `delete` statement has a missing or invalid `key`, lacks required `key ... else Error` for missing rows, or does not resolve to a primary key / named unique index. | Provide a `key { ... }` matching the table primary key or a declared named unique index. For `update` and `delete`, add `else Error`. |
| `SCH2148` | Error | Invalid command insert conflict | A command `conflict` clause is malformed, appears outside `insert`, is duplicated, or the inserted values do not cover a primary key / named unique index to precheck. | Use at most one `insert ... \| conflict else Error` clause and provide values covering the target primary key or named unique index. |
| `SCH2149` | Error | Duplicate command write `into` binding | A command write `returning ... into <name>` reuses a command parameter or previously declared command variable. | Rename the `into` binding so every command-scope name is unique. |
| `SCH2160` | Error | Invalid command auth policy | The `auth` clause does not match a typed policy form (`none`, `authenticated`, `player(<parameter>) [optional]`, or `role("<claim>") [optional]`). | Use a supported auth policy and ensure parameter references name declared command parameters. |
| `SCH2161` | Error | Invalid command idempotency policy | The `idempotent` clause does not match `none`, `command_key`, `aggregate_scoped_command_key`, or `by <parameter> [optional]`. | Use a supported typed idempotency policy and declare the referenced key parameter. |
| `SCH2162` | Error | Invalid command scope policy | The `scope` clause does not match `none`, `unscoped`, `world`, `player[(<parameter>) [optional]]`, or `aggregate[(<parameter>) [optional]]`. | Use a supported typed scope and ensure its parameter is declared by the command. |
| `SCH2157` | Error | Invalid frame-system driver | A `system` driver names a table that is not a plain ephemeral, event, or singleton table, `update`s an append-only event table, or a counted `generate(...)` driver's count reads a row source. | Drive the system from a frame-local table, iterate event rows with `from`, and compute a `generate` count from singletons and frame parameters only. |
| `SCH2159` | Error | System dependency cycle | The hard `before:` / `after:` ordering a set of `system` declarations asks for is circular, so no total order satisfies it. Relaxable `prefer_before:` / `prefer_after:` preferences do not assert this hard dependency. | Break the cycle: a hard ordering edge states a data dependency, and a cycle of them says two systems each need the other's output in the same phase. |
| `SCH2158` | Error | Invalid frame-system join | A `system` join does not connect its source to an already-declared alias, its `on handle` / `on id` operands have the wrong type, or an `on id` join targets a persistent table without a single `int` primary key. | Join on a declared alias, give `on handle` an `(int, uint)` pair or `on id` an `int` expression, and probe persistent tables that have a single integer primary key. |
| `SCH2163` | Error | Invalid frame-system clause | A clause reads a source before its join or after a `match` handled that join's miss, redeclares a row-local or shadows an alias with one, writes a persistent source, or the statement declares no effect at all. | Move the clause after the join (or into a guard arm), rename the row-local, treat persistent sources as read-only, and give the system at least one effect. |
| `SCH2164` | Error | Invalid frame-system effect | An effect names an undeclared alias, emits to a non-event table, omits or duplicates an emitted column, destroys / enables a source that owns no entity rows or enabled mask, or enables / disables an alias an earlier effect of the same row already destroyed. | Name a declared alias, event every column of an event table exactly once, apply `delete` and `enable`/`disable` to plain ephemeral sources, and do not address a row after destroying it in the same clause block. |
| `SCH2165` | Error | Invalid frame-system match | A `miss` arm names no earlier join, names a join whose miss an earlier `match` already handled, or one `match` handles the same join miss twice. | Handle each observable join miss in exactly one later `match`, naming a join declared before it. |
| `SCH2166` | Error | Provisional handle escapes | A handle bound by `var name = insert T { … }` (or a `var` alias of one) is read outside the three positions that admit it: the `for` target of a later insert, a handle value in an insert payload, or a handle value in the payload of an `event` into a `next_frame` event table. A `frame`-lifetime stream is readable before the boundary remaps it. | Keep the provisional handle in those positions; read the real handle back from the created row after the next phase boundary. |
| `SCH2167` | Error | Invalid frame-system insert or upsert | An `insert` or `upsert` names a table that is not a plain ephemeral table, omits a non-identity column that declares no `@default` or duplicates a non-identity column, assigns the runtime-allocated identity column, binds an `upsert … for` result to a `var`, or its `for` target is not a chunked alias or `handle` row-local in the created table's entity domain. A **tag table** has no non-identity column, so its payload block is optional and a written one must be empty (rule: `docs/public/Schema Language`, *Effects*, `insert T`); every field in it is either an unknown column or the identity, and each is reported here separately, with its own span. | Create plain ephemeral rows, assign every non-identity column without a `@default` exactly once (a defaulted column may be omitted and receives its default), and target an alias or handle local whose entity domain contains the created table. |
| `SCH2168` | Error | Invalid frame-system draw | A `draw` clause does not name a `uint` column of a singleton table in scope. | Hold the xorshift32 state in a `uint` column of a singleton table and draw from it. |
| `SCH2169` | Error | Invalid frame-system index join (ephemeral `@index`, or a persistent single-column `lookup`) | A `join T a on index (a.Key == expr)` or `join T a on index (a.Key in (e1, …, ek))` names no column of `T`, supplies a key expression whose type is not assignable to the indexed column, or names a column that is not an access path: on a plain `ephemeral table` one that carries no admissible `@index`; on a **persistent** table one with no non-partial single-column `@index(kind: lookup)`, or a nullable one, since a frame index key has no absent value; on an `event table` or `singleton table` any column at all, because neither owns indexable rows. It also covers the `in (…)` key list itself: an empty list, more than 16 keys, or a multi-key list on a persistent access path, whose pair loop walks one committed row group. | Declare `@index(kind: lookup)` or `@index(kind: bucketed, buckets: N)` on the ephemeral column you join through, or a full single-column `@index(kind: lookup)` on the non-nullable persistent column, give every key expression the indexed column's own type, and keep an `in (…)` list between 1 and 16 keys — the bound is what keeps the duplicate-key skip a register-resident linear scan, so a wider fan-out wants separate systems rather than a longer list. |
| `SCH2170` | Error | Index key written inside an open index walk | A `set` assigns the key column of an index that a walk currently open around it is iterating. Two constructs open such a walk: a `join … on index`, whose pair loop contains every clause after the join, and a `sort [-]alias.Col` DRIVER, whose bucket walk contains the whole body. Moving a row between buckets there would skip or repeat rows. For the ordered driver the rule covers both the ordering column itself and the `@parent` link whose engine-maintained depth IS that column, since one link write re-files the row and its whole subtree. The rule matches on the table and column, so a second alias of the same table is the same defect. | Write the key BEFORE the join, in an earlier system, or drive the system unordered. A `insert` or `delete` inside the walk needs no change: both are commands and apply at the phase boundary, long after it. |
| `SCH2171` | Error | Invalid ordered access path (`sort` driver or `@parent`) | Either a `sort [-]alias.Col` driver whose column carries no `@index(kind: bucketed)`, names an alias that is not the driver's, or sits on a table kind that owns no bucketed index a frame system may walk (an `event table` or `singleton table` driver); or a `@parent(depth: Col [, max_depth: N])` declaration on a table that is not a plain `ephemeral table` (a `persistent`, `event` or `singleton` table owns neither of the two synchronous indexes a hierarchy is made of, and its depth would be maintained by nothing), or one that is not on a non-nullable `handle` into its OWN table, whose link column carries no `@index(kind: lookup)`, whose depth column is missing / is the link column / is not a non-nullable `int` / is the `@id` column / carries no `@index(kind: bucketed)`, or whose `max_depth` is below 1 or outside the depth index's `[0, buckets - 1]` domain; or a second `@parent` in one table; or a write — a declarative `set`, a `insert` payload — that names the engine-maintained depth column. (`sort` on a counted `generate` driver is not this code: `sort` is a modifier of the table driver form, so the grammar refuses it first.) | An ordering is satisfied from a declared access path, never from an operator: declare `@index(kind: bucketed, buckets: N)` on the column you sort by. For a hierarchy, declare the link on a same-table `handle` with `@index(kind: lookup)`, the depth beside it as a non-nullable `int` with `@index(kind: bucketed, buckets: <max_depth + 1>)`, and leave the depth to the engine — it is written on every link write, and a payload neither may name it nor needs to. |
| `SCH2172` | Error | Invalid `ids: dense` use | A table declares `ids: dense` but is not a plain ephemeral table (an event stream and a singleton own no per-row identity; a persistent table owns a host-assigned primary key), or it shares an entity domain with another table, or a frame system `delete`s / `delete entity`s it (directly or through the domain the entity-wide delete takes with it), or a `upsert … for` targets it. Dense identities run 1, 2, 3, … in creation order and are never destroyed — that is what makes `slot = id - 1` a correct row address. | Declare `ids: dense` on a plain ephemeral table that owns its entity domain, insert its rows with a plain `insert`, and disable a row instead of destroying it — or drop the modifier and keep the general id map. |
| `SCH2173` | Error | Retired spelling | A schema writes a spelling Syntax V3 (or Phase C W0) retired; [Retired Spellings](#retired-spellings-sch2173--um1211) lists every one, generated from the one retired-spelling catalog (`RetiredDslSpellings`) every producer reads. A retired callee name is also reserved as a declaration name, but that is a different rule with its own code, `SCH2180`. `let` is not retired: it is the canonical local binding of a system body (Syntax V3 RFC §7.3), and the system-body `var` it replaced is itself retired (a row of the table below); `var` survives only in command bodies. The old spelling is **rejected, never aliased** — two spellings for one construct would be a second dialect — and the message names the replacement exactly. The diagnostic carries a structured fix-it (replacement span inside the diagnostic span, replacement text, and the id of the `tools/syntax-v3` migration rule that rewrites a whole corpus, when one exists) that the language server offers as a quick fix. A fix-it is either a pure respelling (the program binds to the same meaning) or an intent repair whose result binds to what the author evidently meant (a field-default suffix that used to be discarded, a window function that never bound). Where the occurrence's context decides the text — an unnamed item that took its output name from the retired spelling keeps it by having the name written out (`average_x = avg(x)`) — the fix-it follows that context, and where no single edit can keep the program's meaning none is offered. The message template is `` `{retired}` is a retired {surface} spelling; write `{replacement}`. `` The persistent `keys: [Col, …]` column list and the query DSL's `let name = (pipeline)` subquery are different constructs and are unaffected. | Write the replacement the message names. |
| `SCH2174` | Error | Duplicate enum member name | Two members of one enum have identical names or differ only in case, such as `Priority` and `PRIORITY`. Declaration admission forbids these sibling collisions. Successful references still require the exact declared spelling; the collision check does not create a case-insensitive alias. The later **declaration** is rejected. | Rename one of the two members so they differ by more than case. |
| `SCH2175` | Error | Invalid system composition | A system's `composition` metadata is unknown or declared more than once (`System 'S' declares composition more than once.`). Declare `composition` at most once, with one of the canonical composition values. |
| `SCH2176` | Error | Column default is not a compile-time constant | A `@default(…)` argument reads a table or column, names a parameter, calls a function, draws randomness, divides by zero, overflows under checked arithmetic, or names an enum member that does not exist, or evaluates to NaN (whose payload bits are host-dependent). A default is evaluated once at schema binding, so it may only be a literal (with C# numeric suffixes and a sign), `true`/`false`, `none`, a member of the column's own enum, or constant arithmetic over them. | Write the constant itself; compute a runtime value in the system body and assign it in the payload instead. |
| `SCH2177` | Error | Column default does not initialize the column type | A `@default(…)` constant is not of the column's exact type and does not convert to it implicitly and losslessly: a `double` literal on a `float` column (write `1F`), an integer on an enum column, a member of another enum, an operator over operands of the wrong type (`BotState.Idle + 1`), `5L` on an `int` column (C# constant-conversion rules), a nullable column, an integral constant outside the column type's range, an integer a `float` cannot represent exactly, a string, `none` on a column that is not a `ref`/`handle`, a non-`none` value on a `ref`/`handle` column, or any constant on a column type with no constant form. | Write a constant of the column type, e.g. `@default(0F)`, `@default(BotState.Idle)`, `@default(none)`. |
| `SCH2178` | Error | Column default not admitted here | A `@default(…)` is declared where no construction payload applies it: a persistent table (persistent construction, migration and host-API defaults have no specified contract), an `event table` (an event payload stays complete), a `singleton table` (its row is never constructed by `insert`/`upsert`), the runtime-allocated `@id` column, the engine-maintained depth column of a `@parent` link, or a second `@default` on one field. | Declare defaults only on non-identity columns of plain `ephemeral table`s, once per field; initialize other columns explicitly. |
| `SCH2179` | Error | Index name collision | Two different indexes on one table share a name under declaration collision admission (including forbidden case-only siblings), or resolve to the same generated accessor (`IndexAccessorNaming`); the name `PrimaryKey` and accessor `PrimaryIndex` belong to a keyed table's primary-key index. An index that omits `name:` is named after its key column(s), so field `@unique` and an unnamed `@index`/`@@index` of another kind on the same column both claim it. The lookup a `@@navigation` synthesizes on its child's foreign key (named `<Child>_<Parent>`, when the child declares no lookup on that column) obeys the same rule and is reported at the `@@navigation`, which is then not published. Reported at the later declaration in binding order (field-level before `@@`), instead of surfacing as an ambiguous `pin` or a C# member collision in the generated set. (Two declarations of the *same* index are `SCH2027`.) | If one of the two names was defaulted, give that index an explicit `name:`; if both were authored, rename one of them; never reuse `PrimaryKey`; for a navigation lookup, declare a single-column lookup on the foreign key (the navigation reuses it) or rename the colliding index. |
| `SCH2180` | Error | Reserved callee name | A `function`, `extern function` or `command` is declared with the name of an enforced retired callee (`average`, `coalesce`, …; the *Enforced* rows of [Retired Spellings](#retired-spellings-sch2173--um1211)). Every call of such a name is refused by the parser with a fix-it that rewrites it to the canonical spelling, so a declaration of that name would have its own calls silently retargeted; the declaration is refused instead. One code for all three declaration kinds, because it is one rule. Unlike `SCH2173` it carries no fix-it: renaming the declaration is the author's decision. | Give the declaration another name. |
| `SCH2181` | Error | Scalar constant declaration conflict | A `const Name: T = v` repeats a constant name or collides with another declaration in its namespace. | Give the declaration a unique exact name. |
| `SCH2182` | Error | Unknown constant reference | An initializer references a name that is not a constant or enum member, or its dependency failed binding. | Declare the referenced value; qualify values from another module. |
| `SCH2183` | Error | Scalar constant type mismatch | A value cannot initialize its exact declared scalar/enum carrier by an admitted implicit or constant conversion. Nullable values cannot implicitly initialize nonnullable targets. Collections, refs and object/binary values are not scalar constants. | Correct the declared type or write an explicit valid conversion. |
| `SCH2184` | Error | Constant dependency cycle | Constant definitions form a cycle, or a definition depends on that cycle. | Break the cyclic dependency. |
| `SCH2185` | Error | Initializer is not a closed constant | An initializer reads a runtime value, calls a function without compile-time execution authority, overflows, divides by zero, or uses an unsupported/noncanonical constant execution contract. Null requires its declared nullable scalar carrier. | Use a closed deterministic expression with the required typed carrier. |

#### Ephemeral index and frame-system diagnostics — one example each

One refused shape per code, so the table rows above can stay abstract. Each snippet reports
exactly the code named, with a span on the marked construct.

```conjure
ephemeral table Body(plural: Bodies, capacity: 20000) {
    Id:    int   @id
    Cell:  int   @index(kind: bucketed, buckets: 16384)
    Speed: float
}
```

| Code | Refused shape | Why |
|---|---|---|
| `UMEP018` | `Speed: float @index(kind: lookup)` | Equality on a float key is a defect generator; quantize to an `int` cell key. Also `@index(kind: sorted_set)`, a nullable key column, the `@id` column, `buckets: 20001` on the table above (past its row bound), a duplicate index `name:`, and any `@@index`/`@@unique`. |
| `UMEP019` | `@@group(fields: [Cell, Speed], name: "Motion")` | `Cell` is indexed, so it already owns a storage group; a `@@group` would put it back into an interleaved span the checked mutator replaces. |
| `SCH2169` | `join Body o on index (o.Speed == b.Speed)` | `Speed` carries no index, so it is not an access path. Same code for a key expression whose type is not assignable to the column, for `in ()` and for an `in (…)` list past 16 keys. |
| `SCH2170` | `update Body b \| join Body o on index (o.Cell == b.Cell) \| set { b.Cell = 0 }` | The `set` re-files a row into another bucket while the pair loop is walking one. Write it before the join, or in a later system. |
| `SCH2171` | `from Body b sort b.Speed` | `sort` is satisfied from a `bucketed` index or not at all — there is no sort operator in a frame. Same code for a `@parent` missing either companion index, and for a `set` or `insert` payload naming an engine-maintained depth column. |
| `SCH2172` | `delete s` where `s` drives an `ids: dense` table | Dense identities are never destroyed — that is what makes `slot = id - 1` a correct address. `disable s` instead. |
| `SCH2173` | Intentionally rejected old syntax: `\| create Frozen for c`, or `Cell: int @index(kind: bucketed, keys: 16)` | Both spellings were retired by Phase C W0. Write `\| upsert Frozen for c` and `@index(kind: bucketed, buckets: 16)`; the message names the replacement. |

### Retired Spellings (SCH2173 / UM1211)

Every spelling a producer refuses, with what to write instead and the fix-it each context gets. The table between the markers is generated from the retired-spelling catalog (`RetiredDslSpellings`) and checked by `RetiredSpellingCatalogDocumentationTests`: a lane that adds a catalog row pastes the block the failing test prints, never edits a row by hand.

<!-- BEGIN GENERATED: retired-spellings (RetiredSpellingCatalogDocumentationTests) -->
| Retired | Write instead | Surface | Fix-it per context | Corpus rule | Status | Note |
|---------|---------------|---------|--------------------|-------------|--------|------|
| `create` | `insert` | system-DSL | Default: `insert` (Respelling); AttachTarget: `upsert` (Respelling) | predates the migrator | Enforced | Write `upsert T for e { … }` for the attach-or-overwrite form `create T for e` used to spell. |
| `destroy` | `delete` | system-DSL | Default: `delete` (Respelling) | predates the migrator | Enforced |  |
| `emit` | `event` | system-DSL | Default: `event` (Respelling) | predates the migrator | Enforced |  |
| `range` | `generate` | system-DSL | Default: `generate` (Respelling) | predates the migrator | Enforced | The driver is `from generate(n) i`; a system's randomness is `draw`, so `generate` takes no seed here. |
| `keys:` | `buckets:` | ephemeral `@index` | Default: `buckets` (Respelling) | predates the migrator | Enforced | The option is the index's bucket count — a hard key domain `[0, buckets)` for `kind: bucketed` and a growable sizing hint for `kind: lookup` — while `keys:` names a persistent index's key COLUMNS, so the two spellings are now disjoint. |
| `= value` | `@default(value)` | schema field-default | Default: delete it (Respelling); PlainEphemeralColumn: `@default(…)` (IntentRepair) | predates the migrator | Enforced | A field default is a typed compile-time constant of the column type on a plain ephemeral column, applied when an `insert` or `upsert` payload omits the field. |
| `average` | `avg` | aggregate | Default: `avg` (Respelling); ImplicitOutputName: `… = avg` (Respelling); WindowFunction: `avg` (IntentRepair) | `p0.1-average-to-avg` | Enforced |  |
| `alias = Source` | `Source alias` | source-alias | Default: `…` (Respelling) | `p0.4-alias-assignment-to-trailing-alias` | Enforced | The alias is the same; only its position changes (`from T t`, `join T t (…)`, `join (from …) t (…)`). |
| `join … on` | `join T t (predicate)` | join-condition | Default: `…` (Respelling) | `p0.5-join-on-to-parenthesized-predicate` | Enforced | The predicate is unchanged; it moves into parentheses after the source. |
| `join … (==Col)` | `join T t (Col == t.Col)` | join-condition | Default: `…` (Respelling) | `p0.5-join-key-shorthand-to-predicate` | Enforced | Write the incoming key and joined key explicitly. No fix-it is offered: the syntax layer cannot prove which incoming source owns `Col`. |
| `inner join` | `join` | join-kind | Default: `join` (Respelling) | `p0.5-inner-join-to-join` | Enforced |  |
| `sample n seed s [by w] [with replacement]` | `sample n (seed: s, weight: w, replacement: true)` | sampling-source | Default: `sample n (seed: s, weight: w, replacement: true)` (IntentRepair) | `phase1c8-QuerySampleSeed` | Enforced | No automatic fix: Unity32 sampling changes the random sequence, and count-only generation removes the Seed column. |
| `shuffle seed_expression` | `shuffle (seed: seed_expression)` | sampling-source | Default: `shuffle (seed: seed_expression)` (IntentRepair) | `phase1c8-QueryShuffleSeed` | Enforced | No automatic fix: Unity32 sampling changes the random sequence, and count-only generation removes the Seed column. |
| `generate(count, seed)` | `generate(count)` | sampling-source | Default: `generate(count)` (IntentRepair) | `phase1c8-QueryGenerateSeed` | Enforced | No automatic fix: Unity32 sampling changes the random sequence, and count-only generation removes the Seed column. |
| `with … as` | `let name = (…)` | named-result | Default: `…` (Respelling); CteColumnList: `let name = (… \| select { renamed columns })` (IntentRepair) | `p0.6-with-to-let` | Enforced | Several CTEs become one `let` each. |
| `\| into` | `let name = (…)` | named-result | Default: `…` (Respelling) | `p0.6-into-to-let` | Enforced | The pipeline written before `into` becomes the body of the `let`. |
| `bare set operation` | `\| union (…)` | set-operation | Default: `…` (Respelling) | `p0.7-bare-set-operation-to-pipe` | Enforced | `union`, `intersect` and `except` (with an optional `all`) follow a `\|` and take their pipeline in parentheses. |
| `fragment … { … }` | `fragment … = …` | fragment-body | Default: `= …` (Respelling) | `p0.8-fragment-braces-to-expression-body` | Enforced |  |
| `distinct columns` | `group k (sort … \| take 1)` | distinct | Default: `group k (sort … \| take 1)` (IntentRepair) | `p0.13-distinct-columns-retired` | Enforced | The form arrives with Syntax V3 Phase 1 (RFC §5.2); until then use `group k (aggregate { … })` or a `window` with `row_number()` plus a `filter`. `select { cols } \| distinct` keeps only the listed columns and drops the choice of the kept row (DISTINCT ON), so it is not a replacement; `distinct` alone still removes duplicate whole rows. |
| `coalesce` | `(a ?? b)` | function | Default: `…` (Respelling) | `p0.11-coalesce-to-null-coalescing` | Enforced | More than two operands nest to the right, as in C#: `coalesce(a, b, c)` is `(a ?? (b ?? c))`. |
| `switch (` | `switch {` | switch-expression | Default: `…` (Respelling) | `p0.3-switch-parentheses-to-braces` | Enforced | The arms are unchanged; only the delimiters differ. |
| `var` | `let` | system-DSL | Default: `let` (Respelling) | `p0.9-var-to-let` | Enforced |  |
| `:` | `=` | system-DSL | Default: `=` (Respelling) | `p0.12-event-colon-to-eq` | Enforced | An `event` payload field is `Name = value`, the form an `insert` payload uses. |
| `update T a \| …` | `from T a \| …` | system-DSL | Default: `from` (Respelling) | `rfc13.3-update-driver-to-from` | Enforced | `update T a { … }` and `update { … }` remain: they are effects, not a pipeline driver. |
| `lookup … on handle` | `join … on ref` | system-DSL | Default: `join…ref` (Respelling) | `p0.9-lookup-handle-to-join-ref` | Enforced | `lookup T a on id (…)` remains. |
| `required` | `require … on ref` | system-DSL | Default: `require…ref` (Respelling) | `p0.9-required-lookup-to-require` | Enforced | `required lookup T a on handle (x)` is `require T a on ref (x)`; id, index and equality forms cannot be required. |
| `random` | `let r = unity32(…)` | system-DSL | Default: `let… =` (Respelling) | `p0.9-random-to-let-unity32` | Enforced | The capability constructor is the local's initializer: `let r = unity32(seed: e)`. |
| `int32` | `int` | type | Default: `int` (Respelling) | `p0.2-int32-to-int` | Enforced |  |
| `boolean` | `bool` | type | Default: `bool` (Respelling) | `p0.2-boolean-to-bool` | Enforced |  |
| `timestamp` | `datetime` | type | Default: `datetime` (Respelling) | `p0.2-timestamp-to-datetime` | Enforced |  |
| `interval` | `timespan` | type | Default: `timespan` (Respelling) | `p0.2-interval-to-timespan` | Enforced |  |
| `single` | `float` | type | Default: `float` (Respelling) | `p0.2-single-to-float` | Enforced |  |
| `fixed` | `fixed64` | type | Default: `fixed64` (Respelling) | `p0.2-fixed-to-fixed64` | Enforced |  |
| `optional T` | `T?` | type | Default: `…` (Respelling) | `p0.2-optional-to-nullable` | Enforced |  |
| `many T` | `T[]` | type | Default: `…` (Respelling) | `p0.2-many-to-array` | Enforced |  |
| `#` | `//` | line-comment | Default: `//` (Respelling) | `p0.10-hash-comment-to-slashes` | Enforced |  |
| `'…'` | `"…"` | string-literal | Default: `"…"` (Respelling) | `p0.10-single-to-double-quoted-string` | Enforced |  |
| `@temporal` | `an explicitly chosen datetime(…) expression` | temporal-literal | Default: `…` (Respelling) | `l7-temporal-literal-to-constructor` | Enforced | A date preserves its timezone-free DateTime components. Old text-only time/timestamp wrappers have no bound meaning; choose the new expression explicitly. |
| `camel/Pascal-case relation option` | `snake_case` | relation-option | Default: `…` (Respelling) | `l9-option-to-snake-case` | Enforced |  |
| `stdev` | `stddev` | function | Default: `stddev` (Respelling); ImplicitOutputName: `… = stddev` (Respelling) | `p0.1-stdev-to-stddev` | Enforced |  |
| `std_dev` | `stddev` | function | Default: `stddev` (Respelling); ImplicitOutputName: `… = stddev` (Respelling) | `p0.1-std_dev-to-stddev` | Enforced |  |
| `booland` | `bool_and` | function | Default: `bool_and` (Respelling); ImplicitOutputName: `… = bool_and` (Respelling) | `p0.1-booland-to-bool_and` | Enforced |  |
| `all` | `bool_and` | function | Default: `bool_and` (Respelling); ImplicitOutputName: `… = bool_and` (Respelling) | `p0.1-all-to-bool_and` | Enforced |  |
| `boolor` | `bool_or` | function | Default: `bool_or` (Respelling); ImplicitOutputName: `… = bool_or` (Respelling) | `p0.1-boolor-to-bool_or` | Enforced |  |
| `bitand` | `bit_and` | function | Default: `bit_and` (Respelling); ImplicitOutputName: `… = bit_and` (Respelling) | `p0.1-bitand-to-bit_and` | Enforced |  |
| `bitor` | `bit_or` | function | Default: `bit_or` (Respelling); ImplicitOutputName: `… = bit_or` (Respelling) | `p0.1-bitor-to-bit_or` | Enforced |  |
| `stddevpop` | `stddev_pop` | function | Default: `stddev_pop` (Respelling); ImplicitOutputName: `… = stddev_pop` (Respelling) | `p0.1-stddevpop-to-stddev_pop` | Enforced |  |
| `stdev_pop` | `stddev_pop` | function | Default: `stddev_pop` (Respelling); ImplicitOutputName: `… = stddev_pop` (Respelling) | `p0.1-stdev_pop-to-stddev_pop` | Enforced |  |
| `stdevpop` | `stddev_pop` | function | Default: `stddev_pop` (Respelling); ImplicitOutputName: `… = stddev_pop` (Respelling) | `p0.1-stdevpop-to-stddev_pop` | Enforced |  |
| `varpop` | `var_pop` | function | Default: `var_pop` (Respelling); ImplicitOutputName: `… = var_pop` (Respelling) | `p0.1-varpop-to-var_pop` | Enforced |  |
| `variance_pop` | `var_pop` | function | Default: `var_pop` (Respelling); ImplicitOutputName: `… = var_pop` (Respelling) | `p0.1-variance_pop-to-var_pop` | Enforced |  |
| `variancepop` | `var_pop` | function | Default: `var_pop` (Respelling); ImplicitOutputName: `… = var_pop` (Respelling) | `p0.1-variancepop-to-var_pop` | Enforced |  |
| `arrayagg` | `array_agg` | function | Default: `array_agg` (Respelling); ImplicitOutputName: `… = array_agg` (Respelling) | `p0.1-arrayagg-to-array_agg` | Enforced |  |
| `len` | `text.length` | function | Default: `text.length` (Respelling); ImplicitOutputName: `… = text.length` (Respelling) | `p0.1-len-to-length` | Enforced |  |
| `ceil` | `math.ceiling` | function | Default: `math.ceiling` (Respelling); ImplicitOutputName: `… = math.ceiling` (Respelling) | `p0.1-ceil-to-ceiling` | Enforced |  |
| `pow` | `math.power` | function | Default: `math.power` (Respelling); ImplicitOutputName: `… = math.power` (Respelling) | `p0.1-pow-to-power` | Enforced |  |
| `substr` | `text.substring` | function | Default: `text.substring` (Respelling); ImplicitOutputName: `… = text.substring` (Respelling) | `p0.1-substr-to-substring` | Enforced |  |
| `ln` | `math.log` | function | Default: `math.log` (Respelling); ImplicitOutputName: `… = math.log` (Respelling) | `p0.1-ln-to-log` | Enforced |  |
| `toupper` | `text.upper` | function | Default: `text.upper` (Respelling); ImplicitOutputName: `… = text.upper` (Respelling) | `p0.1-toupper-to-upper` | Enforced |  |
| `tolower` | `text.lower` | function | Default: `text.lower` (Respelling); ImplicitOutputName: `… = text.lower` (Respelling) | `p0.1-tolower-to-lower` | Enforced |  |
| `isnull` | `x == null` | function | Default: `…` (Respelling) | `p0.1-isnull-to-x == null` | Enforced |  |
| `isnotnull` | `x != null` | function | Default: `…` (Respelling) | `p0.1-isnotnull-to-x != null` | Enforced |  |
| `first_value` | `first` | function | Default: `first` (IntentRepair); ImplicitOutputName: `… = first` (IntentRepair); WindowFunction: `first` (Respelling) | `p0.1-first_value-to-first` | Enforced |  |
| `last_value` | `last` | function | Default: `last` (IntentRepair); ImplicitOutputName: `… = last` (IntentRepair); WindowFunction: `last` (Respelling) | `p0.1-last_value-to-last` | Enforced |  |
| `.Contains` | `text.contains` | scalar method | Default: `…` (Respelling); ImplicitOutputName: `…` (Respelling) | `p0.1-method-contains-to-contains` | Enforced |  |
| `.StartsWith` | `text.startswith` | scalar method | Default: `…` (Respelling); ImplicitOutputName: `…` (Respelling) | `p0.1-method-startswith-to-startswith` | Enforced |  |
| `.EndsWith` | `text.endswith` | scalar method | Default: `…` (Respelling); ImplicitOutputName: `…` (Respelling) | `p0.1-method-endswith-to-endswith` | Enforced |  |
| `.ToUpper` | `text.upper` | scalar method | Default: `…` (Respelling); ImplicitOutputName: `…` (Respelling) | `p0.1-method-toupper-to-upper` | Enforced |  |
| `.ToLower` | `text.lower` | scalar method | Default: `…` (Respelling); ImplicitOutputName: `…` (Respelling) | `p0.1-method-tolower-to-lower` | Enforced |  |
| `.Trim` | `text.trim` | scalar method | Default: `…` (Respelling); ImplicitOutputName: `…` (Respelling) | `p0.1-method-trim-to-trim` | Enforced |  |
| `.Substring` | `text.substring` | scalar method | Default: `…` (Respelling); ImplicitOutputName: `…` (Respelling) | `p0.1-method-substring-to-substring` | Enforced |  |
| `.Replace` | `text.replace` | scalar method | Default: `…` (Respelling); ImplicitOutputName: `…` (Respelling) | `p0.1-method-replace-to-replace` | Enforced |  |
| `.IndexOf` | `text.indexof` | scalar method | Default: `…` (Respelling); ImplicitOutputName: `…` (Respelling) | `p0.1-method-indexof-to-indexof` | Enforced |  |
| `and` | `&&` | expression | Default: `&&` (Respelling) | `e1-and-to-symbol` | Enforced |  |
| `or` | `\|\|` | expression | Default: `\|\|` (Respelling) | `e1-or-to-symbol` | Enforced |  |
| `not` | `!` | expression | Default: `!` (Respelling) | `e1-not-to-symbol` | Enforced |  |
| `is null` | `== null` | expression | Default: `== null` (Respelling) | `e3-is-null-to-equality` | Enforced |  |
| `is not null` | `!= null` | expression | Default: `!= null` (Respelling) | `e3-is-not-null-to-inequality` | Enforced |  |
| `between` | `in a..b` | expression | Default: `in a..b` (Respelling) | `e7-between-to-range` | Enforced |  |
| `cast` | `x as T` | expression | Default: `…` (Respelling); ImplicitOutputName: `…` (Respelling) | `e8-cast-to-as` | Enforced |  |
| `is_null` | `x == null` | expression | Default: `…` (Respelling); ImplicitOutputName: `…` (Respelling) | `e3-is-null-call-to-equality` | Enforced |  |
| `is_not_null` | `x != null` | expression | Default: `…` (Respelling); ImplicitOutputName: `…` (Respelling) | `e3-is-not-null-call-to-inequality` | Enforced |  |
| `wrapping_add_int` | `unchecked((x as int) + (y as int))` | expression | Default: `…` (Respelling); ImplicitOutputName: `…` (Respelling) | `e9-wrapping-add-int-to-unchecked` | Enforced |  |
| `wrapping_add_uint` | `unchecked((x as uint) + (y as uint))` | expression | Default: `…` (Respelling); ImplicitOutputName: `…` (Respelling) | `e9-wrapping-add-uint-to-unchecked` | Enforced |  |
| `to_int` | `x as int` | expression | Default: `…` (Respelling); ImplicitOutputName: `…` (Respelling) | `e8-to-int-to-as` | Enforced |  |
| `to_double` | `x as double` | expression | Default: `…` (Respelling); ImplicitOutputName: `…` (Respelling) | `e8-to-double-to-as` | Enforced |  |
| `to_long` | `x as long` | expression | Default: `…` (Respelling); ImplicitOutputName: `…` (Respelling) | `e8-to-long-to-as` | Enforced |  |
| `:` | `=` | record-value field | Default: `=` (Respelling) | `p1b.3-record-field-colon-to-eq` | Enforced | Anonymous and nominal record value fields use `Name = value`; declaration, metadata and named-argument colons remain valid. Corpus closure remains pending. |
| `non-scoped group form` | `group key (pipeline)` | group | Default: `…` (Respelling) | `1c.2-group-to-scoped-pipeline` | Enforced | Multiple keys use braces; the body is an explicit scoped pipeline. A keyless reduction uses aggregate without group. |
| `singleton aggregate tuple` | `aggregate Name = function(value)` | aggregate | Default: `…` (Respelling) | `1c.2-aggregate-singleton-tuple` | Enforced | One aggregate is written without braces; braces require at least two aggregates. |
| `by(@parameter)` | `command_key` | command-idempotency | Default: `command_key` (Respelling) | `p2a.1-by-to-command-key` | Enforced | The canonical policy does not carry a command-parameter selector. |
| `insert T \| values { … } [\| conflict else Error] [\| returning … into row]` | `insert T { … } [else Error]; let row = insert T { … } [else Error]` | command-insert | Default: `…` (Respelling) | `p2a.3-command-insert-payload` | Enforced | Only primary-key conflicts use else. Bind the inserted live row with let, not a returning snapshot. |
| `capacity:` | `max_count:` | workspace resource | Default: `max_count` (Respelling) | `p2b.6-workspace-capacity-to-max-count` | Enforced | A workspace's positive compile-time hard bound is named `max_count:`. |
<!-- END GENERATED: retired-spellings -->

### Multi-File Merge Errors (SCH3xxx)

| Code | Severity | Message | Description | Action |
|---|---|---|---|---|
| `SCH3001` | Error | Duplicate declaration across files | A table, enum, type, query, mutation, or fragment with the same name exists in multiple schema files. | Ensure each name is unique across all schema files, or use a single file. |
| `SCH3002` | Error | Import resolved but file not found | An import path resolved to a canonical path, but no schema file matches that path. | Check the import path. Ensure the target file exists and is included in the schema set. |
| `SCH3003` | Error | Import cycle detected | The import graph contains a cycle (A imports B imports A). | Break the cycle by restructuring imports. |
| `SCH3004` | Error | Duplicate schema file identity | Two schema files resolve to the same canonical path. | Remove the duplicate file or rename one. |
| `SCH3005` | Error | Import outside schema root | An import resolves to a path outside the schema root directory. | Move the imported file inside the schema root, or adjust the import path. |
| `SCH3007` | Error | Schema source outside schema root | A compiled schema source file lies outside the schema root, so generated artifacts (e.g. required-site source spans) cannot name it by a portable root-relative path. Reported on that file. This tightens every host that runs the schema pipeline with a root — CLI generation, MSBuild/source generation, LSP and analysis: a source passed explicitly from outside the root used to be accepted (only imports outside the root were refused, SCH3005) and is now an error. | Move the file inside the schema root, or compile with a schema root that contains every source. |

### External Kernel Admission

| Code | Severity | Meaning | Action |
|---|---|---|---|
| `SCH3024` | Error | An external kernel declares an unsupported policy, driver, directive or field access. | Use `composition: external`, `execution: serial`, one ephemeral driver and explicit valid read/write fields; probes, structural effects, scratch and sinks are not admitted. |
| `SCH3025` | Error | Unsupported bounded projection declaration, scalar shape, capture policy or shared-owner reference. | Use one ephemeral from/select with unique scalar aliases, positive capacity, window: until_next_frame or until_next_capture, composition: external; additional captures reference the same projection with mode: once_when_nonempty. |
| `SCH3026` | Error | A schema field stores an imported host value, or an extern declaration mismatches an admitted host call signature. | Keep imported host shapes expression-local and store flat primitive fields; use the exact nonnullable full-arity `UnityMathematicsStrict` parameter/result contract, including an explicit `normalizesafe` fallback. |
| `UMCG036` | Error | Projection physical storage or native scalar admission failed. | Use the existing native scalar/enum/handle storage ABI and pure deterministic admitted expressions. No candidate pack is published. |
| `UMCG035` | Error | The fresh external-kernel storage ABI or exact static target cannot be admitted. The message names the kernel and source; the invocation span locates the refusal. | Supply an accessible ordinary nongeneric static `void Execute(in GeneratedBatch)` on a concrete nongeneric type, with supported nonnullable scalar/enum payload groups. Remove stale/conflicting Batch declarations. No candidate pack is published on refusal. |

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
| `SCH5030` | Error | Fragment typed invocation syntax missing or malformed | Semantic dependency validation received a fragment invocation without a complete canonical typed argument carrier or with invalid span/source-offset identity. | Reparse the schema through the canonical schema parser and fix the invocation reported by `SCH1028`. |

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
| `UM2014` | IrBuildInListRequiresLiteral | Error | IN list requires literal values |
| `UM2028` | IrBuildMembershipSetNotElementInspectable | Error | NOT IN needs an element-inspectable RHS |
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
| `UM6003` | MemoryBudgetExceeded | Error | Trusted heap budget exceeded |
| `UM6004` | MemoryBudgetUnprovable | Error | Trusted heap budget could not be proven |
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
| `UM7006` | MissingPgoStatistics | Warning | No PGO statistics available |
| `UM7007` | NestedLoopOnLargeTables | Warning | Nested loop on large tables |
| `UM7008` | FullSortOnLargeDataset | Warning | Full sort on large dataset |
| `UM7009` | IndexRecommendation | Info | Index recommendation |
| `UM7010` | SemiAntiJoinNestedLoop | Warning | Semi/Anti join using nested loop |
| `UM7011` | NestedCollectionAllocation | Warning | Per-entity allocation in nested collection |
| `UM7012` | NestedObjectProjectionNotEmittable | Warning | Nested object projection not emittable |
| `UM7013` | PgoUntrustedHeuristicFallback | Warning | PGO untrusted — heuristic fallback |
| `UM7014` | PgoUntrustedOverrideBlocked | Warning | PGO untrusted — override blocked |
| `UM7015` | ResidualCorrelatedScalarSubqueryUnsupported | Error | Residual correlated scalar subquery unsupported |
| `UM7016` | HeuristicPlanningFallback | Warning | Planner used heuristic fallback |
| `UM7018` | PgoProfileDataInconsistency | Warning | PGO profile data inconsistent |
| `UM7022` | ResidualLateralJoinUnsupported | Error | Residual lateral JOIN unsupported |

### Ephemeral Table Diagnostics (UMEPxxx)

| Code | One-Line Description |
|---|---|
| `UMEP001` | Ephemeral field is not unmanaged |
| `UMEP002` | Indexes are forbidden on event/singleton storage |
| `UMEP003` | Persistence option is forbidden |
| `UMEP004` | Persistent type id is forbidden |
| `UMEP005` | Event/singleton identity is forbidden |
| `UMEP006` | Singleton capacity option is invalid |
| `UMEP007` | Event lifetime option is misplaced |
| `UMEP008` | Column-group declaration is invalid |
| `UMEP009` | Relation/navigation into ephemeral storage is forbidden |
| `UMEP010` | Ephemeral capacity contract is invalid |
| `UMEP011` | Entity-domain declaration is invalid |
| `UMEP012` | Ephemeral entity id type is invalid |
| `UMEP013` | Ephemeral-source integration with existing Reactive Query/IVM is not implemented yet |
| `UMEP014` | Transactional write to ephemeral target is forbidden |
| `UMEP015` | Command event route target is not an event table |
| `UMEP016` | Persistent table field declares handle type |
| `UMEP017` | Ephemeral table field declares a nullable handle type |
| `UMEP018` | Invalid `@index` on an ephemeral table: unsupported kind, unsupported or nullable key type, the `@id` column, an unsupported index option, a `buckets:` count outside `1..(max_capacity ?? capacity)`, a duplicate index `name:`, or a composite `@@index`/`@@unique` |
| `UMEP019` | An indexed ephemeral column is named in a `@@group` |
| `UMEP020` | Frame-lifetime table declares a persisted `schema_version` |
| `UMEP021` | Event table declares `max_capacity` |

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
| `BIND_RES_007` | No matching function overload |
| `BIND_RES_009` | Window function missing OVER |
| `BIND_RES_010` | Let binding not found |
| `BIND_RES_011` | No common type for operands |
| `BIND_RES_012` | Boolean expression required |
| `BIND_RES_013` | Integer expression required |
| `BIND_RES_014` | Value conversion or assignment failed |
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
| `BIND_RES_031` | Derived column has no parsed expression |
| `BIND_RES_032` | BY column not found in right side |
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
| `BIND_RES_050` | Pipeline transform error, or an undeclared name / member in a closed lexical value catalog |
| `BIND_RES_051` | Pipeline GROUP BY error, SHUFFLE/SAMPLE conflict, or an operation-parameter expression reference missing the `@` prefix |
| `BIND_RES_052` | Pipeline WINDOW error |
| `BIND_RES_053` | JOIN source resolution error |
| `BIND_RES_054` | Window function not registered |
| `BIND_RES_055` | Pipeline mutation error |
| `BIND_RES_056` | BY set-operation output metadata missing |
| `BIND_RES_057` | Singleton table is not a query source |
| `BIND_RES_058` | Assignment has no parsed scalar expression |
| `BIND_RES_059` | Set operation column count mismatch |
| `BIND_RES_060` | GROUP BY requires columns only |
| `BIND_RES_061` | Duplicate BY column |
| `BIND_RES_062` | BY column not found in left side |
| `BIND_RES_063` | BY column ambiguous in left side |
| `BIND_RES_064` | BY column ambiguous in right side |

### Mutation Binding Errors (BIND_MUT_xxx)

| Code | One-Line Description |
|---|---|
| `BIND_MUT_021` | Query INSERT output names no target column |

### Binding Build Errors (BIND_BLD_xxx)

| Code | One-Line Description |
|---|---|
| `BIND_BLD_001` | Invalid OutputColumnId |
| `BIND_BLD_002` | CLR type is null |
| `BIND_BLD_003` | Missing ComputationExpressionId |
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
| `BIND_BLD_015` | BY set-operation padding type has no canonical default |
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
| `SCH1028` | Error | Fragment invocation syntax is not canonical |
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
| `SCH2022` | Error | Partial index predicate is not analyzable |
| `SCH2027` | Error | Duplicate index (same kind, key columns and options) |
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
| `SCH2045` | Error | View projection semantic binding failed |
| `SCH2062` | Error | Invalid query result terminal contract |
| `SCH2063` | Error | Query result projection field invalid |
| `SCH2064` | Error | Invalid file-local table alias |
| `SCH2157` | Error | Invalid frame-system driver |
| `SCH2158` | Error | Invalid frame-system join |
| `SCH2159` | Error | System dependency cycle |
| `SCH2160` | Error | Invalid command auth policy |
| `SCH2161` | Error | Invalid command idempotency policy |
| `SCH2162` | Error | Invalid command scope policy |
| `SCH2163` | Error | Invalid frame-system clause |
| `SCH2164` | Error | Invalid frame-system effect |
| `SCH2165` | Error | Invalid frame-system match |
| `SCH2166` | Error | Provisional handle escapes |
| `SCH2167` | Error | Invalid frame-system insert or upsert |
| `SCH2168` | Error | Invalid frame-system draw |
| `SCH2169` | Error | Invalid frame-system index join, including an `in (…)` key list that is empty or longer than 16 |
| `SCH2170` | Error | Index key written inside an open index walk — an `on index` pair loop, or a `sort` driver's bucket walk |
| `SCH2171` | Error | Invalid ordered access path (`sort` driver or `@parent`) |
| `SCH2172` | Error | Invalid `ids: dense` use |
| `SCH2173` | Error | Retired spelling (every one listed in [Retired Spellings](#retired-spellings-sch2173--um1211)) |
| `SCH2174` | Error | Duplicate enum member name (including forbidden case-only siblings) |
| `SCH2175` | Error | Invalid system composition (unknown value or declared more than once) |
| `SCH2176` | Error | Column `@default` is not a compile-time constant |
| `SCH2177` | Error | Column `@default` does not initialize the exact column type |
| `SCH2178` | Error | Column `@default` not admitted (non-ephemeral table, `@id`, engine-maintained, duplicate) |
| `SCH2179` | Error | Index name collision (two indexes on one table share a canonical name or generated accessor) |
| `SCH2180` | Error | Declaration named after a retired callee (`function`, `extern function`, `command`) |
| `SCH3001` | Error | Duplicate declaration across files |
| `SCH3002` | Error | Import resolved but file not found |
| `SCH3003` | Error | Import cycle detected |
| `SCH3004` | Error | Duplicate schema file identity |
| `SCH3005` | Error | Import outside schema root |
| `SCH3007` | Error | Schema source outside schema root |
| `SCH3024` | Error | Unsupported external kernel declaration |
| `SCH3025` | Error | Bounded projection declaration/scalar admission refusal |
| `SCH3026` | Error | Imported host-value storage or exact extern-signature refusal |
| `UMCG036` | Error | Projection physical/native scalar admission refusal |
| `UMCG035` | Error | External kernel fresh storage/signature admission refusal |
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
| `SCH5030` | Error | Fragment typed invocation syntax missing or malformed |

---

## See Also

- **[Query Language](/docs/query-language/reference)** — Query language syntax reference
- **[Getting Started](/docs/getting-started)** — Setup and basic usage
- **[PGO](/docs/performance/pgo)** — Profile-Guided Optimization setup and usage
- **the compiler pipeline notes** — Compiler pipeline architecture (internal)
- **the physical-planning notes** — Physical planning details (internal)
