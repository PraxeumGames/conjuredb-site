# Schema Workflow Guide

This guide covers the daily author-validate-generate loop for SchemaDSL, from
setting up tooling through CI integration.

The compiler admits normalized `.conjure` source format 2 only. An owning
project declares `<ConjureDBSyntaxVersion>2</ConjureDBSyntaxVersion>` **after**
all of its effective schema inputs have been migrated and their semantic
equivalence has been reviewed. A missing or unsupported marker is rejected,
not interpreted as a legacy format. The commands below describe a migrated
project, not the current checked-in
`samples/schema/SchemaSamples.csproj` host (see [Sample Schemas](#sample-schemas)).

For language reference see [Schema Language](/docs/schema/schema-language).
For CLI and LSP details see [Schema Tooling](/docs/schema/schema-tooling).
For migration scenarios see [Schema Migration](/docs/schema/schema-migration).

---

## Setup

### VS Code Extension

The repository includes a VS Code extension that provides syntax highlighting,
diagnostics, completion, hover, go-to-definition, and find-references for
`.conjure` files.

```bash
cd vscode-conjuredb
npm ci
npm run compile
npm run package:vsix
npm run install:vsix
```

After installation, `.conjure` files open with the **conjure** language mode and
connect to the schema LSP server for live feedback.

### Manual Compiler CLI

`ConjureDB.Compiler` evaluates an authoritative SDK-style project, then parses,
validates, plans, and emits its `.conjure` declarations. This is an explicit AOT
operation, not part of normal `dotnet build`:

```bash
# Validate only (no code generation)
dotnet run --project ConjureDB.Compiler -- verify <project.csproj>

# Full generation
dotnet run --project ConjureDB.Compiler -- generate <project.csproj> \
    --schema-root <schema-dir> --output <output-dir> \
    --context GameDbContext --namespace Game.Data
```

Run these commands from the repository root so `ConjureDB.Compiler` resolves.
The project path is resolved from the shell's working directory. In contrast,
relative `--schema-root` **and** `--output` values are resolved from the target
project's directory, not the shell's working directory. Absolute override paths
remain absolute. `verify` compiles without publishing generated files;
`generate` publishes the complete pack only after successful compilation.

For the full CLI option reference (positional arguments, options, exit codes), see [Schema Tooling](/docs/schema/schema-tooling#1--cli-reference).

### Recommended Project Layout

```text
MyGame/
├── MyGame.csproj          # authoritative C# project/reference closure
├── schemas/               # .conjure source files
│   ├── types.conjure       # shared enums and projection types
│   ├── player.conjure      # Player domain tables & queries
│   └── inventory.conjure   # Inventory domain, imports player.conjure
├── Generated/             # CLI output — committed but never hand-edited
│   ├── Player.g.cs
│   ├── Item.g.cs
│   ├── GameDbContext.g.cs
│   └── ...
```

Once the effective schemas are migrated to format 2, the owning project has:

```xml
<PropertyGroup>
  <ConjureDBSyntaxVersion>2</ConjureDBSyntaxVersion>
</PropertyGroup>
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

Run `verify` to confirm the entire schema and project-semantic closure compile
without errors, including cross-file imports and binding. For the illustrative
`MyGame/` layout above, run from the repository root; `schemas` is relative to
`MyGame/MyGame.csproj`:

```bash
dotnet run --project ConjureDB.Compiler -- verify ./MyGame/MyGame.csproj \
    --schema-root schemas
```

### 3. Generate

Generate C# entity types, repository/mutation interfaces, and DbContext:

```bash
dotnet run --project ConjureDB.Compiler -- generate ./MyGame/MyGame.csproj \
    --schema-root schemas --output Generated \
    --context GameDbContext --namespace Game.Data
```

The CLI emits:
- **`Schema.<Enum>.g.cs`** — one file per enum declaration
- **`Schema.<Table>.g.cs`** — one file per table (entity struct/class)
- **`Schema.<Type>.g.cs`** — one file per custom type (DTO)
- **`Schema.I<Entity>Queries.g.cs`** — query interface per entity with queries
- **`Schema.I<Entity>Mutations.g.cs`** — mutation interface per entity with mutations
- **`Schema.I<Module>.g.cs`** — module interface (when modules are used)
- **`Schema.<Context>.g.cs`** — DbContext with all DbSets

### 4. Compile The Committed Pack

SDK-style projects include C# files below the project directory by default. If
default compile items are disabled, include the generated directory explicitly:

```xml
<ItemGroup>
  <Compile Include="Generated/**/*.cs" />
</ItemGroup>
```

The one manual compiler invocation emits the complete executable pack; there is no
second metadata-to-runtime generation step. Commit the pack so ordinary builds and
Unity builds never need compiler assemblies.

### 5. Iterate

Repeat: edit → verify → generate → build. The VS Code extension gives
immediate feedback, and the CLI catches any issues the LSP might miss (for
example, cross-file merge conflicts that only surface when all files are
compiled together).

---

## Multi-File Schema Organization

For schemas with more than a handful of tables, split declarations across files
and use `import` to share types.

### Import Syntax

```conjure
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

This is a format-2 excerpt; `types.conjure` and `player.conjure` must themselves
contain migrated declarations for `Rarity` and `Player` before the combined
project can be verified. It is not a command to validate the current sample
files.

```conjure
// inventory.conjure
import "types.conjure"
import "player.conjure"

table Item(persistence: local, type_id: 62002, schema_version: 1) {
    id       : int   @id
    owner_id : int   @relation(references: Player.id, on_delete: cascade)
    rarity   : Rarity   // enum from types.conjure
}
```

### Cycle Detection

Circular imports are detected and reported as `SCH3003` / `SCH4001`. If file A
imports B and B imports A, both files will fail to compile.

### Module-Based Grouping

Modules group related declarations into a named scope. The CLI generates a
separate interface (`ICore`, `ISocial`, etc.) for each module. Executable
declarations use braced bodies whether or not they are inside a module:

```conjure
module Core {
    table Player(persistence: local, type_id: 62001, schema_version: 1) {
        id: int @id
    }

    query GetPlayer(id: int) -> Player {
        from Player
        | filter id == @id
        | single
    }
}
```

Equality on the primary key proves that at most one player matches. Because
the declared result is required, `single` also rejects a missing row; use an
optional result type when absence should be preserved.

The checked-in `multi-file/` and
`modules/` directories illustrate the layout,
but their current source is not yet a verified format-2 corpus.

---

## CI Integration

### Validation Step

Add a validation step early in your pipeline to catch schema errors before
building C#. This example assumes the illustrative `MyGame` project has
completed its format-2 cutover:

```bash
dotnet run --project ConjureDB.Compiler -- verify ./MyGame/MyGame.csproj \
    --schema-root schemas
```

Exit code `0` means success; a non-zero exit reports command, project-load, schema,
binding, planning, or emission diagnostics.

### Generation + Staleness Check

For a migrated project with committed generated output, generate to a temporary
absolute path and compare it to that project's `Generated/` directory. This
example also assumes output is deterministic across the two directories;
confirm that in the owning project's CI before adopting it as a gate:

```bash
#!/bin/bash
set -euo pipefail

PROJECT="./MyGame/MyGame.csproj"
OUTPUT_DIR="./MyGame/Generated"

# Generate into a temporary directory
scratch_dir=$(mktemp -d)
trap 'rm -rf "$scratch_dir"' EXIT
dotnet run --project ConjureDB.Compiler -- generate "$PROJECT" \
    --schema-root schemas --output "$scratch_dir/Generated" \
    --context GameDbContext --namespace Game.Data

# Compare with committed output
if ! diff -rq "$scratch_dir/Generated" "$OUTPUT_DIR" > /dev/null 2>&1; then
    echo "ERROR: Generated files are stale. Run ConjureDB.Compiler generate and commit."
    diff -rq "$scratch_dir/Generated" "$OUTPUT_DIR" || true
    exit 1
fi

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
          dotnet-version: '9.0.300'

      - name: Validate schema
        run: dotnet run --project ConjureDB.Compiler -- verify ./MyGame/MyGame.csproj --schema-root schemas

      - name: Check generated files are fresh
        run: |
          scratch_dir=$(mktemp -d)
          trap 'rm -rf "$scratch_dir"' EXIT
          dotnet run --project ConjureDB.Compiler -- generate ./MyGame/MyGame.csproj \
              --schema-root schemas --output "$scratch_dir/Generated" \
              --context GameDbContext --namespace Game.Data
          diff -rq "$scratch_dir/Generated" ./MyGame/Generated
```

---

## Troubleshooting

### Diagnostic Code Reference

For the SCHxxxx diagnostic code ranges and the complete per-code list, see [Error Codes](/docs/reference/error-codes#schema-diagnostic-codes-schxxxx). The Common Mistakes below show how the most frequent of these codes surface in practice.

### Common Mistakes

**Missing `@id` on an ordinary table**

Ordinary stored tables require exactly one field annotated with `@id`.
Event and singleton tables have their own identity rules and do not use `@id`:

```conjure
table Player {
    id   : int @id    // ← required
    name : string
}
```

Error: `SCH2005: Table 'Player' has no primary key field`.

**Circular imports**

```conjure
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

**Retired executable expression bodies**

Format 2 requires braced bodies for executable declarations both inside and
outside modules. Do not use `query Name(...) -> Type = pipeline`:

```conjure
module Core {
    table Player(persistence: local, type_id: 62001, schema_version: 1) {
        id: int @id
    }

    query GetPlayer(id: int) -> Player {
        from Player
        | filter id == @id
        | single
    }
}
```

### Debugging Schema Compilation

1. **Run `verify` first** — it exercises the project-aware pipeline without
   publishing files, so you can focus on compiler diagnostics.

2. **Check stderr** — diagnostic messages print to stderr with severity, code,
   and the originating file name.

3. **Narrow the scope** — create a minimal SDK-style repro project and schema
   directory so project references and C# symbols stay authoritative:
   ```bash
   dotnet run --project ConjureDB.Compiler -- verify ./repro/Repro.csproj \
       --schema-root schema
   ```

4. **Inspect generated code** — if the schema validates but generated code
   doesn't compile, check that `--namespace` and `--context` match your
   project's expectations.

---

## Sample Schemas

The repository includes organizational examples under `samples/schema/`:

| Sample | Description | Files |
|---|---|---|
| `basic/` | Single-file schema with a Player table, enums, queries, and mutations | `player.conjure` |
| `multi-file/` | Multi-file schema demonstrating imports and cross-file relations | `types.conjure`, `player.conjure`, `inventory.conjure` |
| `modules/` | Module-based organization with Core and Social modules | `game.conjure` |

These are **not yet ready-to-validate format-2 inputs**. The shared
`SchemaSamples.csproj` has no `ConjureDBSyntaxVersion` marker, and its
five-file `.conjure` corpus still contains retired query/mutation spellings.
The same host project is also used by schema MCP tests with temporary schema
roots and legacy inline inputs. Migrating that owner requires semantic proof
across all effective sources and tests before setting the marker; this guide
does not offer a legacy fallback or a sample command expected to pass today.

For path interpretation only: with project
`samples/schema/SchemaSamples.csproj`, a relative `--schema-root` would be
`basic`, `multi-file`, or `modules` (or use an absolute path). It is **not**
`samples/schema/basic`, `samples/schema/multi-file`, or
`samples/schema/modules`, because resolution starts at the project directory.
