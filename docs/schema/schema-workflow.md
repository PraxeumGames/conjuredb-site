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
cd vscode-unimem
npm ci
npm run compile
npm run package:vsix
npm run install:vsix
```

After installation, `.conjure` files open with the **unimem** language mode and
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

| Option | Default | Description |
|---|---|---|
| `--context=Name` | `AppDbContext` | Generated DbContext class name |
| `--namespace=Name` | `Generated` | Namespace for all emitted files |
| `--validate` | — | Run parse/bind pipeline without emitting files |

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
  Parsing types.conjure...
  Parsing player.conjure...
  Parsing inventory.conjure...
Resolving imports...
Merging declarations...
Binding...
Validation succeeded: 3 table(s), 3 enum(s), 1 type(s), 6 query/queries, 5 mutation(s), 0 command(s).
```

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

Then run the ConjureDB CodeGen for the executable query/mutation layer:

```bash
dotnet run --project ConjureDB.CodeGen.Manual -- ./Generated ./GeneratedRuntime
```

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

> **Note:** Inside modules, queries and mutations accept both the expression-body
> `=` form and the braced `{ ... }` form, exactly as at the top level.

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

| Range | Phase | Examples |
|---|---|---|
| **SCH0xxx** | Lexer | `SCH0001` unterminated string, `SCH0003` unexpected character |
| **SCH1xxx** | Parser | `SCH1001` unexpected token, `SCH1003` invalid table option, `SCH1007` empty body |
| **SCH2xxx** | Binder | `SCH2002` unknown type, `SCH2005` missing `@id`, `SCH2011` duplicate field |
| **SCH3xxx** | Multi-file merge | `SCH3001` duplicate declaration across files, `SCH3003` circular import |
| **SCH4xxx** | Import resolution | `SCH4001` circular import chain, `SCH4002` file not found |
| **SCH5xxx** | Semantic validation | `SCH5001` duplicate field, `SCH5004` fragment cycle, `SCH5008` multiple `@id` fields |

The full diagnostic list is in [SchemaTooling.md — Diagnostic Reference](/docs/schema/schema-tooling).

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
`SCH3001: Duplicate enum Rarity across files`. Move shared types to a single
file and import it.

**Unknown type references**

`SCH2002: Unknown type 'Rarity'` — the type is not declared in the current file
or any imported file. Add an `import` for the file that declares it.

**Query and mutation bodies**

Queries and mutations accept both the expression-body `=` form and the braced
`{ ... }` form, inside modules and at the top level alike:

```
module Core {
    query GetPlayer(id: int) -> Player {        // braced body
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
