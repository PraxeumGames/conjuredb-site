# Schema Migration

This guide explains how ConjureDB handles schema evolution — what happens when your entity definitions change between application versions, and how to migrate persisted data safely.

## Overview

When you modify an entity (add or remove fields, change types, rename properties), persisted snapshots may contain data in the old shape. ConjureDB compares the **schema descriptor** stored in each snapshot against the current entity definition and classifies the relationship as one of:

| Verdict | Meaning | Action |
|---------|---------|--------|
| `Identical` | Fingerprints match exactly | Loaded directly |
| `BackwardCompatible` | Fields added or nullability widened; no breaking changes | Loaded directly via MessagePack tolerance |
| `RequiresMigration` | Breaking changes detected (type change, nullability narrowed) and a migration chain is registered | Per-entity binary migration applied before deserialization |
| `Incompatible` | Breaking changes detected but no migration chain registered, or stored schema is newer than current | **Hard error** — startup fails with `SchemaMigrationException` |
| `EntityRemoved` | Stored data has no matching entity in the current code | Logged as warning; data skipped |
| `EntityAdded` | New entity with no stored data | Empty DbSet initialized normally |

### How Detection Works

Each entity has two identity coordinates tracked in snapshots:

- **`type_id`** — stable numeric identifier declared in the `.conjure` table options (1-65535).
- **`schema_version`** — explicit version number declared in the `.conjure` table options.

ConjureDB computes a **schema fingerprint** (FNV-1a hash) from the `TypeId`, `SchemaVersion`, and the full set of `FieldDescriptor` entries (ordinal, name, CLR type, nullability). When a snapshot is loaded, the stored fingerprint is compared to the current one. If they differ, field-level diffing determines whether the change is backward-compatible or breaking.

## Automatic Handling

Many common schema changes are handled automatically without any migration code.

### Adding a New Field

When you add a new nullable/defaultable field to a schema table, MessagePack deserialization assigns
the type's default value to any field absent from the stored payload. No version bump is required if
the new field is nullable or has a safe default.

```prql
// Version 1
table Player(plural: Players, persistence: local, capacity: 10000, type_id: 1) {
  id   : int @id
  name : string
}

// Version 2 - added field; old snapshots load fine (email defaults to null)
table Player(plural: Players, persistence: local, capacity: 10000, type_id: 1) {
  id    : int @id
  name  : string
  email : string?
}
```

### Removing a Field

If a stored snapshot contains fields that no longer exist in the current entity, MessagePack silently skips them during deserialization. As long as you do not reassign the removed field's `[Key]` ordinal to a different field with a different type, this is backward-compatible.

### Widening Nullability

Changing a non-nullable field to nullable (e.g., `string` → `string?`) is classified as `BackwardCompatible` and requires no migration.

## Manual Migration

Breaking schema changes require explicit migration code. A change is **breaking** when:

- A field's CLR type changes (e.g., `int` → `long`, `string` → `int`).
- A field's nullability narrows (e.g., `string?` → `string`).

### Step 1: Bump the Schema Version

Set `schema_version` on the table and increment it with each breaking change:

```prql
table Player(plural: Players, persistence: local, capacity: 10000, type_id: 1, schema_version: 2) {
  id    : int @id
  score : long // was int
}
```

### Step 2: Provide Schema Descriptors

Override `GetSchemaDescriptorsCore()` in your `DbContext` to return the current schema shape:

```csharp
public class GameDbContext : DbContext
{
    private static readonly EntitySchemaDescriptor[] SchemaDescriptors =
    {
        new(
            typeId: 1,
            schemaVersion: 2,
            entityName: nameof(Player),
            fields: new[]
            {
                new FieldDescriptor(0, nameof(Player.Id), "System.Int32", false),
                new FieldDescriptor(1, nameof(Player.Score), "System.Int64", false)
            })
    };

    protected override ReadOnlySpan<EntitySchemaDescriptor> GetSchemaDescriptorsCore()
        => SchemaDescriptors;

    // ... DbSet declarations, Build(), etc.
}
```

### Step 3: Register a Migration

In your `DbContext.OnBeforeBuild()`, register a migration with the `MigrationRegistry` using the `EntityMigrationBuilder`:

```csharp
protected override void OnBeforeBuild()
{
    MigrationRegistry.Register(
        new EntityMigrationBuilder(typeId: 1, fromVersion: 1, toVersion: 2)
            .KeepField(0)                                            // Id stays as-is
            .TransformField<int, long>(1, static v => (long)v)       // Score: int → long
            .Build());
}
```

### Field Operations

The `EntityMigrationBuilder` provides four operations, each addressed by `[Key]` ordinal:

| Operation | Description |
|-----------|-------------|
| `KeepField(ordinal)` | Copies the field value unchanged from source to target. |
| `DropField(ordinal)` | Skips the source field; does not write to the target. |
| `AddField<T>(ordinal, defaultValue)` | Writes `defaultValue` to a new target slot (source must not have this ordinal). |
| `TransformField<TSource, TTarget>(ordinal, transform)` | Reads source value as `TSource`, applies `transform`, writes result as `TTarget`. |

All operations work at the MessagePack binary level — entities are never deserialized into CLR objects during migration.

### Custom Migration (IEntityMigration)

For complex migrations that the builder cannot express, implement `IEntityMigration` directly:

```csharp
public sealed class PlayerV1ToV2Migration : IEntityMigration
{
    public ushort TypeId => 1;
    public uint FromVersion => 1;
    public uint ToVersion => 2;

    public void MigrateEntity(ref MessagePackReader reader, ref MessagePackWriter writer)
    {
        var fieldCount = reader.ReadArrayHeader();
        writer.WriteArrayHeader(3); // target has 3 fields

        // [Key(0)] Id — keep as-is
        writer.WriteRaw(reader.ReadRaw());

        // [Key(1)] Score — int → long
        var oldScore = reader.ReadInt32();
        writer.Write((long)oldScore);

        // [Key(2)] Rank — new field, default to 0
        writer.Write(0);
    }
}
```

Register it the same way:

```csharp
MigrationRegistry.Register(new PlayerV1ToV2Migration());
```

## Version Tracking

### Schema Version Option

Mark each persisted table with its current schema version:

```prql
table Player(plural: Players, persistence: local, type_id: 1, schema_version: 3) {
  id : int @id
}
```

The version must be a positive `uint` (≥ 1). Increment it each time you make a breaking change.

### Schema Fingerprint

ConjureDB computes a deterministic FNV-1a fingerprint from the `TypeId`, `SchemaVersion`, and all field descriptors. Two entities with the same version but different field layouts produce different fingerprints. If the fingerprint changes without a version bump, the snapshot is classified as **Incompatible** and loading fails:

```
Schema fingerprint mismatch without version bump for typeId 1.
```

This prevents accidental data corruption from uncommitted schema changes.

### Migration Chains

Migrations are registered as single-step transforms (e.g., v1→v2, v2→v3). The `MigrationRegistry` automatically resolves multi-step chains. If data is stored at version 1 and the current schema is version 3, the registry finds and applies v1→v2, then v2→v3 sequentially.

```csharp
protected override void OnBeforeBuild()
{
    // v1 → v2: Score changed from int to long
    MigrationRegistry.Register(
        new EntityMigrationBuilder(typeId: 1, fromVersion: 1, toVersion: 2)
            .KeepField(0)
            .TransformField<int, long>(1, static v => (long)v)
            .Build());

    // v2 → v3: Added Rank field
    MigrationRegistry.Register(
        new EntityMigrationBuilder(typeId: 1, fromVersion: 2, toVersion: 3)
            .KeepField(0)
            .KeepField(1)
            .AddField(2, 0)  // Rank defaults to 0
            .Build());
}
```

The chain must be **contiguous** (no gaps) and **forward-only** (each step's `ToVersion > FromVersion`). Cycles are detected and produce a hard error.

## Migration Options

Configure migration behavior on the `DbContextBuilder`:

```csharp
var context = DbContextBuilder<GameDbContext>.Create()
    .WithDataDirectory(dataDir)
    .WithMigration(m =>
    {
        m.SnapshotAfterMigration(true);   // default: true
        m.VerboseLogging(true);            // default: false
    })
    .Build();
```

| Option | Default | Description |
|--------|---------|-------------|
| `SnapshotAfterMigration` | `true` | Automatically takes a full snapshot after migrations complete, so subsequent startups skip migration. |
| `VerboseLogging` | `false` | Logs detailed per-entity migration steps for debugging. |

## Best Practices

### 1. Always Assign Stable TypeIds

Use a fixed `type_id` table option for every persisted entity. Runtime-generated or CLR-derived IDs
are not valid persistence identities because they can shift when you add or remove entity types.

### 2. Never Reuse Key Ordinals

When removing a field, do not reassign its `[Key(n)]` ordinal to a new field with a different type. MessagePack uses ordinals for positional deserialization — reuse causes silent data corruption.

```csharp
// ❌ WRONG — Key(1) was string Name, now it's int Level
[Key(0)] public int Id { get; set; }
[Key(1)] public int Level { get; set; }  // was: [Key(1)] public string Name

// ✅ CORRECT — assign a new ordinal
[Key(0)] public int Id { get; set; }
[Key(2)] public int Level { get; set; }  // new ordinal
```

### 3. Keep Migration Steps Small

Prefer one migration per breaking change rather than a single migration that handles multiple version jumps. Small steps are easier to test and compose via chains.

### 4. Test Migrations

Serialize test data in the old format, apply the migration, and verify the result:

```csharp
[Test]
public void Migration_V1_To_V2_TransformsScoreCorrectly()
{
    var migration = new EntityMigrationBuilder(typeId: 1, fromVersion: 1, toVersion: 2)
        .KeepField(0)
        .TransformField<int, long>(1, static v => v + 1000L)
        .Build();

    // Serialize old-format entity: [42, 23]
    var buffer = new ArrayBufferWriter<byte>();
    var writer = new MessagePackWriter(buffer);
    writer.WriteArrayHeader(2);
    writer.Write(42);   // Id
    writer.Write(23);   // Score (int)
    writer.Flush();

    var reader = new MessagePackReader(buffer.WrittenMemory);
    var outputBuffer = new ArrayBufferWriter<byte>();
    var outputWriter = new MessagePackWriter(outputBuffer);

    migration.MigrateEntity(ref reader, ref outputWriter);
    outputWriter.Flush();

    var outputReader = new MessagePackReader(outputBuffer.WrittenMemory);
    Assert.Equal(2, outputReader.ReadArrayHeader());
    Assert.Equal(42, outputReader.ReadInt32());      // Id preserved
    Assert.Equal(1023L, outputReader.ReadInt64());   // Score: 23 + 1000 = 1023
}
```

### 5. Prefer Backward-Compatible Changes

When possible, evolve your schema without breaking changes:

- **Add** new fields with nullable types or safe defaults instead of changing existing field types.
- **Deprecate** fields by ignoring them in application code rather than removing them from the schema.
- **Widen** types at the application layer (e.g., read an `int` field and cast to `long` in your code) rather than changing the persisted type.

### 6. Validate Before Shipping

Use verbose migration logging during development to verify the compatibility analysis:

```csharp
.WithMigration(m => m.VerboseLogging(true))
```

The logs report the detected `CompatibilityVerdict`, list of `SchemaChange` entries, and migration chain resolution for each entity type.

## Error Reference

| Error | Cause | Fix |
|-------|-------|-----|
| `SchemaMigrationException`: fingerprint mismatch without version bump | Schema changed but `[SchemaVersion]` was not incremented | Increment `[SchemaVersion]` and register a migration if breaking |
| `SchemaMigrationException`: stored schema is newer than current | Downgrading to an older application version | Not supported; use the version that created the snapshot |
| `SchemaMigrationException`: no migration chain registered | Breaking change detected but no migration covers the version gap | Register migrations via `MigrationRegistry.Register()` in `OnBeforeBuild()` |
| `SchemaMigrationException`: migration chain contains a cycle | Migration steps form a loop (e.g., v1→v2→v1) | Ensure all steps are forward-only with `ToVersion > FromVersion` |
| `SchemaMigrationException`: migration chain is not contiguous | Gap in version coverage (e.g., v1→v2 exists, v2→v3 missing, current is v3) | Register the missing intermediate step |
