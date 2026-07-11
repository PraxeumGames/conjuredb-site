# Schema Workflow Guide

This guide covers the daily author-validate-generate loop for SchemaDSL, from
setting up tooling through CI integration.

For language reference see [SchemaLanguage.md](/docs/schema/schema-language).  
For CLI and LSP details see [SchemaTooling.md](/docs/schema/schema-tooling).  
For migration scenarios see [SchemaMigration.md](/docs/schema/schema-migration).

---

## Setup

### VS Code Extension

The repository includes a VS Code extension that provides syntax highlighting,
diagnostics, completion, hover, go-to-definition, and find-references for
`.conjure` files.

```bash
cd vscode-conjure
npm ci
npm run compile
npm run package:vsix
npm run install:vsix
```

After installation, `.conjure` files open with the **conjure** language mode and
connect to the schema LSP server for live feedback.

### Schema CLI

The CLI parses, validates, and generates C# from `.conjure` files:

```bash
# Validate only (no code generation)
dotnet run --project ConjureDB.Schema.Cli -- <schema-dir> <output-dir> --validate

# Full generation
dotnet run --project ConjureDB.Schema.Cli -- <schema-dir> <output-dir> \
    --context=GameDbContext --namespace=Game.Data
```

For the full CLI option reference (positional arguments, options, exit codes), see [Schema Tooling](/docs/schema/schema-tooling#1--cli-reference).

### Recommended Project Layout

```
MyGame/
├── schemas/               # .conjure source files
│   ├── types.conjure       # shared enums and projection types
│   ├── player.conjure      # Player domain tables & queries
│   └── inventory.conjure   # Inventory domain, imports player.conjure
├── Generated/             # CLI output — committed but never hand-edited
│   ├── Player.g.cs
│   ├── Item.g.cs
│   ├── GameDbContext.g.cs
│   └── ...
└── MyGame.csproj
```

Conventions:
- Keep `.conjure` files in a dedicated directory (e.g. `schemas/`).
- Use a separate output directory for generated `.g.cs` files.
- Commit generated files so builds work without running the CLI, but treat them
  as read-only artifacts.
- Never hand-edit files under the generated output directory.

---

## Daily Authoring Loop

### 1. Edit `.conjure` files

Open a `.conjure` file in VS Code. The extension provides:

- **Diagnostics** — parse, type, and binding errors appear inline as you type.
- **Completion** — table names, field types, enum members, annotation keywords.
- **Hover** — shows resolved type information for fields and references.
- **Go-to-definition** — jump to the declaration of a referenced table, enum,
  or type.
- **Find references** — locate all usages of a declaration across files.

### 2. Validate

Run the CLI in validate mode to confirm the entire schema compiles without
errors — including cross-file imports and binding:

```bash
dotnet run --project ConjureDB.Schema.Cli -- ./schemas ./Generated --validate
```

Example output on success:

```
Found 3 .conjure file(s)
Validation succeeded: 3 table(s), 3 enum(s), 1 type(s), 6 query/queries, 5 mutation(s), 0 command(s).
```

Stage headers (`Resolving imports...`, `Merging declarations...`, `Binding...`)
only appear when a stage emits diagnostics — a clean validate prints just the
file count and the success line.

### 3. Generate

Generate C# entity types, repository/mutation interfaces, and DbContext:

```bash
dotnet run --project ConjureDB.Schema.Cli -- ./schemas ./Generated \
    --context=GameDbContext --namespace=Game.Data
```

The CLI emits:
- **`<Enum>.g.cs`** — one file per enum declaration
- **`<Table>.g.cs`** — one file per table (entity struct/class)
- **`<Type>.g.cs`** — one file per custom type (DTO)
- **`I<Entity>Queries.cs`** — query interface per entity with queries
- **`I<Entity>Mutations.cs`** — mutation interface per entity with mutations
- **`I<Module>.g.cs`** — module interface (when modules are used)
- **`<Context>.g.cs`** — DbContext with all DbSets

### 4. Include Generated Code in Your Project

Add the generated directory to your `.csproj`:

```xml
<ItemGroup>
  <Compile Include="Generated/**/*.cs" />
</ItemGroup>
```

Use `**/*.cs`, not `**/*.g.cs`, because schema emission currently produces a
mixed surface: metadata/context files are `.g.cs`, while repository interfaces
such as `I<Entity>Queries.cs` and `I<Entity>Mutations.cs` are plain `.cs`.

The Schema CLI emits lightweight stubs (entity, interface, and context
definitions). To generate the full executable query/mutation layer, run the
ConjureDB CodeGen — the compiler-backed generator that reads the same `.conjure`
schema source directly (it re-emits the entities and DbContext alongside the
runtime layer). Point it at the schema source directory, not the CLI output:

```bash
dotnet run --project ConjureDB.CodeGen.Manual -- ./schemas ./GeneratedRuntime
```

Schema CLI and CodeGen.Manual are two front-ends over the same schema source,
not a chained pipeline — CodeGen.Manual does not consume the CLI's `./Generated`
output.

### 5. Iterate

Repeat: edit → validate → generate → build. The VS Code extension gives
immediate feedback, and the CLI catches any issues the LSP might miss (for
example, cross-file merge conflicts that only surface when all files are
compiled together).

---

## Multi-File Schema Organization

For schemas with more than a handful of tables, split declarations across files
and use `import` to share types.

### Import Syntax

```
import "relative/path/file.conjure"
```

Imports resolve relative to the importing file's directory. The CLI discovers
all `.conjure` files recursively, resolves imports in topological order, and
merges declarations before binding.

### Recommended File Splits

| File | Contents |
|---|---|
| `types.conjure` | Shared enums, projection types, extern type aliases |
| `player.conjure` | Player table, player queries/mutations, imports types |
| `inventory.conjure` | Item/Equipment tables, imports types and player |
| `social.conjure` | Guild/FriendLink tables, imports types and player |

Each domain file imports only what it references:

```
// inventory.conjure
import "types.conjure"
import "player.conjure"

table Item(persistence: local) {
    id       : int   @id
    owner_id : int   @relation(references: Player.id, onDelete: Cascade)
    rarity   : Rarity   // enum from types.conjure
    ...
}
```

### Cycle Detection

Circular imports are detected and reported as `SCH3003` / `SCH4001`. If file A
imports B and B imports A, both files will fail to compile.

### Module-Based Grouping

Modules group related declarations into a named scope. The CLI generates a
separate interface (`ICore`, `ISocial`, etc.) for each module:

```
module Core {
    table Player { ... }

    query GetPlayer(id: int) -> Player {
        from Player | where id == @id | take 1 | require found
    }
}
```

> **Note:** Inside modules, use braced body syntax `{ ... }` for queries and
> mutations rather than expression-body `=` syntax.

See `samples/schema/multi-file/` for a
complete multi-file example and
`samples/schema/modules/` for module-based
organization.

---

## CI Integration

### Validation Step

Add a validation step early in your pipeline to catch schema errors before
building C#:

```bash
dotnet run --project ConjureDB.Schema.Cli -- ./schemas ./Generated --validate
```

Exit code `0` means success; `1` means schema errors (printed to stderr); `2`
means an unexpected exception.

### Generation + Staleness Check

Generate code and verify the committed files are up to date:

```bash
#!/bin/bash
set -euo pipefail

SCHEMA_DIR="./schemas"
OUTPUT_DIR="./Generated"

# Generate into a temporary directory
TMPDIR=$(mktemp -d)
dotnet run --project ConjureDB.Schema.Cli -- "$SCHEMA_DIR" "$TMPDIR" \
    --context=GameDbContext --namespace=Game.Data

# Compare with committed output
if ! diff -rq "$TMPDIR" "$OUTPUT_DIR" > /dev/null 2>&1; then
    echo "ERROR: Generated files are stale. Run the schema CLI and commit."
    diff -rq "$TMPDIR" "$OUTPUT_DIR" || true
    rm -rf "$TMPDIR"
    exit 1
fi

rm -rf "$TMPDIR"
echo "Generated files are up to date."
```

### Example GitHub Actions Snippet

```yaml
jobs:
  schema:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'

      - name: Validate schema
        run: dotnet run --project ConjureDB.Schema.Cli -- ./schemas ./Generated --validate

      - name: Check generated files are fresh
        run: |
          TMPDIR=$(mktemp -d)
          dotnet run --project ConjureDB.Schema.Cli -- ./schemas "$TMPDIR" \
              --context=GameDbContext --namespace=Game.Data
          diff -rq "$TMPDIR" ./Generated
```

---

## Troubleshooting

### Diagnostic Code Reference

For the SCHxxxx diagnostic code ranges and the complete per-code list, see [Error Codes](/docs/reference/error-codes#schema-diagnostic-codes-schxxxx). The Common Mistakes below show how the most frequent of these codes surface in practice.

### Common Mistakes

**Missing `@id` on a table**

Every table must have exactly one field annotated with `@id`:

```
table Player {
    id   : int @id    // ← required
    name : string
}
```

Error: `SCH2005: Table 'Player' has no primary key field`.

**Circular imports**

```
// a.conjure
import "b.conjure"

// b.conjure
import "a.conjure"   // ← SCH3003 / SCH4001
```

Break cycles by extracting shared declarations into a third file that both can
import.

**Duplicate declarations across files**

If two files define `enum Rarity { ... }`, the merge stage reports
`SCH3001: Duplicate enum 'Rarity' declared in 'inventory.conjure'; first declared in 'types.conjure'.`
Move shared types to a single file and import it.

**Unknown type references**

`SCH2002: Unknown type 'Rarity'` — the type is not declared in the current file
or any imported file. Add an `import` for the file that declares it.

**Expression-body syntax in modules**

Inside `module { ... }` blocks, use braced body syntax for queries and mutations:

```
module Core {
    query GetPlayer(id: int) -> Player {        // ← use { }
        from Player | where id == @id | take 1 | require found
    }
}
```

### Debugging Schema Compilation

1. **Run `--validate` first** — it exercises the full pipeline (parse → import
   → merge → bind) without generating files, so you can focus on schema
   correctness.

2. **Check stderr** — diagnostic messages print to stderr with severity, code,
   and the originating file name.

3. **Narrow the scope** — if you have many files, validate a single directory
   or file to isolate the issue:
   ```bash
   dotnet run --project ConjureDB.Schema.Cli -- ./schemas/player.conjure /tmp/out --validate
   ```

4. **Inspect generated code** — if the schema validates but generated code
   doesn't compile, check that `--namespace` and `--context` match your
   project's expectations.

---

## Sample Schemas

The repository includes ready-to-validate examples under `samples/schema/`:

| Sample | Description | Files |
|---|---|---|
| `basic/` | Single-file schema with a Player table, enums, queries, and mutations | `player.conjure` |
| `multi-file/` | Multi-file schema demonstrating imports and cross-file relations | `types.conjure`, `player.conjure`, `inventory.conjure` |
| `modules/` | Module-based organization with Core and Social modules | `game.conjure` |

Validate any sample:

```bash
dotnet run --project ConjureDB.Schema.Cli -- samples/schema/basic /tmp/out --validate
dotnet run --project ConjureDB.Schema.Cli -- samples/schema/multi-file /tmp/out --validate
dotnet run --project ConjureDB.Schema.Cli -- samples/schema/modules /tmp/out --validate
```
