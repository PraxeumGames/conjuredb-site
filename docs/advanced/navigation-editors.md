# Navigation Editors

Navigation Editors provide a **zero-allocation-by-default, type-safe API** for
navigating and mutating parent-child entity relationships. They are generated
at build time from parent-side `[NavigationCollection]` declarations or from
legacy inferred child-side metadata, producing `ref struct` types that live
entirely on the stack.

**See also:** [Transactions](/docs/engine/transactions) · [Reactive Queries](/docs/advanced/reactive-queries) · [Query Language](/docs/query-language/reference)

---

## Overview

For each entity with child relationships, the code generator produces three
types:

| Generated Type | Kind | Purpose |
|---------------|------|---------|
| `{Entity}Editor` | `ref struct` | Write proxy for reading, updating, and deleting an entity |
| `{Child}CollectionHandle` | `ref struct` | Handle for the child collection scoped to a parent FK |
| `{Entity}EditorFactory` | `ref struct` | Indexer factory accessed via `ctx.Entity[id]` |

All types are **stack-only** (`ref struct`). The default traversal and mutation
path stays allocation-free and boxing-free. Explicit snapshot helpers such as
`ToArray()` and `ToList()` allocate by design when you need an owned copy.

### Comparison with Other Patterns

| Pattern | Allocations | Type Safety | Navigation | Cascading |
|---------|------------|-------------|-----------|-----------|
| **Navigation Editors** | Zero by default (snapshot helpers allocate) | ✅ Compile-time | ✅ Fluent | ✅ Generated |
| Entity Framework Navigation | Yes (tracked proxies) | ✅ | ✅ | ✅ (runtime) |
| Raw DbSet operations | Zero | ❌ Manual FK management | ❌ | ❌ |
| Repository pattern | Varies | ✅ | Varies | Manual |

---

## Setup

### 1. Define Entities with Relationships

```csharp
[Table("Customers", PersistenceType.Local, capacity: 10_000)]
public record Customer
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;

    [NavigationCollection(nameof(Order), nameof(Order.CustomerId))]
    public IReadOnlyList<Order>? Orders => null;
}

[Table("Orders", PersistenceType.Local, capacity: 50_000)]
public record Order
{
    public int Id { get; set; }

    [ForeignKey(nameof(Customer))]
    [Index("Order_Customer", Type = IndexType.Lookup)]
    public int CustomerId { get; set; }

    [NavigationCollection(nameof(OrderItem), nameof(OrderItem.OrderId))]
    public IReadOnlyList<OrderItem>? OrderItems => null;

    public decimal TotalAmount { get; set; }
    public string Status { get; set; } = string.Empty;
}

[Table("OrderItems", PersistenceType.Local, capacity: 200_000)]
public record OrderItem
{
    public int Id { get; set; }

    [ForeignKey(nameof(Order))]
    [Index("OrderItem_Order", Type = IndexType.Lookup)]
    public int OrderId { get; set; }

    public int ProductId { get; set; }
    public int Quantity { get; set; }
    public decimal UnitPrice { get; set; }
}
```

**Key attributes:**

| Attribute | Purpose |
|-----------|---------|
| `[NavigationCollection]` | Preferred parent-side declaration for generated child collection navigation |
| `[ForeignKey]` | Declares the FK relationship for compiler/optimizer metadata |
| `[Index(..., Type = IndexType.Lookup)]` | Creates the lookup index used by `CollectionHandle` |
| `[InjectReference]` | Immutable-config injection on child entities; legacy fallback for inferred navigation generation |

### 2. Generate Code

```bash
dotnet run --project ConjureDB.CodeGen.Manual -- MyProject MyProject/Generated
```

This produces:
- `CustomerEditor.g.cs` — Editor for Customer
- `OrderCollectionHandle.g.cs` — Handle for Customer's Orders
- `OrderItemCollectionHandle.g.cs` — Handle for Order's OrderItems
- `NavigationExtensions.g.cs` — Factory structs and context properties

### 3. Automatic Lookup Index Synthesis

If the relationship metadata identifies a child FK but no explicit lookup index
exists, the generator calls `SynthesizeMissingLookupIndexes()` to create the
required lookup index automatically. This works both for explicit
`[NavigationCollection]` declarations and for legacy inferred relationships.

---

## Editor API

### Creating an Editor

Access an Editor through the DbContext indexer:

```csharp
// By primary key
var customer = Context.Customer[1];

// By entity reference
var alice = Context.Customers.FindById(1);
var customer = Context.Customer[alice];
```

### Properties

| Member | Type | Description |
|--------|------|-------------|
| `Value` | `T` | Reads the current entity snapshot from the DbSet |
| `Id` | `int` | The entity's primary key |
| `Exists` | `bool` | Whether this entity exists in the DbSet |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `Update(T value)` | `void` | Replaces the entity in its DbSet |
| `Remove()` | `bool` | Removes the entity, returns success |
| `RemoveCascade()` | `bool` | Removes all children recursively, then the entity |
| `Modify(Func<T, T>)` | `Editor` | Read-modify-update in one call. Returns `this` for chaining |

### Implicit Conversion

Editors implicitly convert to their entity type:

```csharp
Customer alice = Context.Customer[1]; // equivalent to Context.Customer[1].Value
```

### Fluent Chaining

`Modify` returns the Editor, enabling expressive chains:

```csharp
Context.Customer[1]
    .Modify(c => c with { Name = "Alice Updated" })
    .Orders.Add(new Order { TotalAmount = 100m, Status = "New" });
```

### Parent Reference Navigation

When an entity has a FK to another entity, the Editor exposes a navigation
property that returns the parent's Editor. The property name is derived from
the FK (e.g., `CustomerId` -> `Customer`):

```csharp
// Navigate: Order -> Customer
var customer = Context.Order[orderId].Customer;
Console.WriteLine(customer.Value.Name);

// Full round-trip: Order -> Customer -> Orders -> OrderItems
var items = Context.Order[2].Customer.Orders.Editor(1).OrderItems;
```

Parent references return an Editor, so all Editor operations are available.

---

## CollectionHandle API

Access a child collection through the Editor's navigation property:

```csharp
var orders = Context.Customer[1].Orders;
```

### Properties

| Member | Type | Description |
|--------|------|-------------|
| `this[childId]` | `T` | Finds a child by primary key (throws if not found) |
| `Count` | `int` | Number of children belonging to this parent |
| `Any` | `bool` | `true` if at least one child exists |
| `IsEmpty` | `bool` | `true` if no children exist |

### CRUD Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `Add(T item)` | `Editor` or `int` | Adds child, **auto-sets FK**. Returns Editor (aggregate-root) or id (leaf) |
| `AddRange(T[] items)` | `void` | Batch add. Auto-sets FK on each item |
| `TryGet(childId, out T)` | `bool` | Safe lookup without exceptions |
| `First()` | `T` | Returns the first child. Throws if empty |
| `TryGetFirst(out T)` | `bool` | Safe first-child access |
| `Last()` | `T` | Returns the last child in current enumeration order. Throws if empty |
| `TryGetLast(out T)` | `bool` | Safe last-child access |
| `Update(T item)` | `void` | Updates a child entity |
| `Remove(childId)` | `bool` | Removes a child by id |
| `Modify(childId, Func<T,T>)` | `void` | Read-modify-update a child |
| `ModifyAll(Func<T,T>)` | `void` | Applies a transform to every child |
| `Transfer(childId, newParentId)` | `void` | Reparents a child by updating its FK |
| `RemoveAll()` | `int` | Removes all children, returns count |
| `Editor(childId)` | `Editor` | Returns Editor for aggregate-root child |
| `GetAll()` | `GroupEnumerable` | Returns the zero-allocation enumerable for querying |
| `ToArray()` | `T[]` | Explicitly materializes the current children into an array |
| `ToList()` | `List<T>` | Explicitly materializes the current children into a list |

### FK Auto-Assignment

When you call `Add()`, the CollectionHandle automatically sets the FK
property to the parent's ID:

```csharp
// CustomerId is automatically set to 1
Context.Customer[1].Orders.Add(new Order
{
    TotalAmount = 100m,
    Status = "New"
    // CustomerId is set automatically — do not set it manually
});
```

This uses zero-copy `with` patterns on record types for efficient
value assignment.

### Enumeration

CollectionHandles support direct `foreach` without calling `GetAll()`:

```csharp
foreach (var order in Context.Customer[1].Orders)
    Console.WriteLine($"Order {order.Id}: {order.TotalAmount:C}");
```

`First()`, `TryGetFirst()`, `Last()`, and `TryGetLast()` all use this current
enumeration order. They do not sort or lazy-load anything.

### GetAll() vs explicit materialization

Use `GetAll()` or direct `foreach` as the default read path when you want
zero-allocation traversal inside the current transaction:

```csharp
var orders = Context.Customer[1].Orders.GetAll();
if (orders.HasItems)
    Console.WriteLine($"First visible order id: {Context.Customer[1].Orders.First().Id}");

foreach (var order in Context.Customer[1].Orders)
    Console.WriteLine(order.Status);
```

Use `ToArray()` or `ToList()` only when you explicitly need an owned snapshot,
for example to hand data to an API that requires `T[]`/`List<T>` or to sort a
copy without changing the underlying collection contract:

```csharp
var orderArray = Context.Customer[1].Orders.ToArray();
var orderList = Context.Customer[1].Orders.ToList();
orderList.Sort((left, right) => right.TotalAmount.CompareTo(left.TotalAmount));
```

`ToArray()` and `ToList()` are escape hatches:

- They allocate on the heap.
- They snapshot the current transaction state only.
- They do **not** lazy-load or keep a live link to the handle.

---

## Cascading Deletes

### Entity-Level Cascade

`RemoveCascade()` recursively removes all children before removing the entity:

```csharp
// Removes Customer + all Orders + all OrderItems of those Orders
Context.Customer[1].RemoveCascade();
```

### Cascade Behavior

| Entity Type | Cascade Action |
|------------|---------------|
| **Aggregate root** (has children) | Recursively cascade to children first |
| **Leaf** (no children) | `RemoveAll()` on the collection |

### Example: Multi-Level Cascade

```
Customer 1
├── Order 10
│   ├── OrderItem 100
│   ├── OrderItem 101
│   └── OrderItem 102
├── Order 11
│   └── OrderItem 103
└── Review 20

RemoveCascade(Customer 1):
  1. RemoveCascade(Order 10) → Remove OrderItems 100, 101, 102 → Remove Order 10
  2. RemoveCascade(Order 11) → Remove OrderItem 103 → Remove Order 11
  3. RemoveAll(Reviews of Customer 1) → Remove Review 20
  4. Remove Customer 1
```

---

## Batch Operations

### AddRange — Batch Insert

```csharp
Context.Customer[1].Orders.AddRange(new Order[]
{
    new() { TotalAmount = 10m, Status = "New" },
    new() { TotalAmount = 20m, Status = "New" },
    new() { TotalAmount = 30m, Status = "New" },
});
// All three orders have CustomerId = 1 set automatically
```

Uses `DbSet.Add(T[])` with pre-sized capacity for zero-resize insertion.

### ModifyAll — Batch Transform

```csharp
// Cancel all orders for a customer
Context.Customer[1].Orders.ModifyAll(o => o with { Status = "Cancelled" });
```

Iterates all children and applies the transform. Each modification goes
through the transaction buffer.

### RemoveAll — Batch Delete

```csharp
int removed = Context.Customer[1].Orders.RemoveAll();
Console.WriteLine($"Removed {removed} orders");
```

Returns the count of removed entities. Uses stack-allocated spans for
zero-GC batching.

---

## Transfer / Reparenting

Move a child from one parent to another by updating its FK:

```csharp
// Move order 5 from Customer 1 to Customer 2
Context.Customer[1].Orders.Transfer(orderId: 5, newParentId: 2);
```

### Transfer Semantics

| Aspect | Behavior |
|--------|----------|
| FK update | Sets the child's FK to `newParentId` |
| Children of transferred entity | Unaffected (they reference the child's PK, not the grandparent) |
| Old parent subscription | Notified of removal |
| New parent subscription | Notified of addition |
| Transaction required | Yes |

### Example: Transfer with Notification

```csharp
// Subscribe to both parents' order collections
Context.Customer[1].Orders.OnChanged(c =>
    Console.WriteLine($"Customer 1 orders: {c.Type}"));
Context.Customer[2].Orders.OnChanged(c =>
    Console.WriteLine($"Customer 2 orders: {c.Type}"));

Context.BeginTransaction();
Context.Customer[1].Orders.Transfer(orderId: 5, newParentId: 2);
Context.Commit();
// Output:
// Customer 1 orders: Remove
// Customer 2 orders: Add
```

---

## Dual-FK Disambiguation

When a child entity has FK references to multiple parents, handles are
disambiguated with the parent name:

```csharp
[Table("Reviews")]
public record Review
{
    public int Id { get; set; }

    [ForeignKey(nameof(Customer))]
    [InjectReference]
    public int CustomerId { get; set; }

    [ForeignKey(nameof(Product))]
    [InjectReference]
    public int ProductId { get; set; }

    public int Rating { get; set; }
    public string Text { get; set; }
}
```

This generates:

| Generated Type | FK | Index |
|---------------|-----|-------|
| `ReviewByCustomerCollectionHandle` | Sets `CustomerId` | Queries `ReviewCustomerIndex` |
| `ReviewByProductCollectionHandle` | Sets `ProductId` | Queries `ReviewProductIndex` |

Access:

```csharp
// All reviews by Customer 1
var customerReviews = Context.Customer[1].ReviewsByCustomer;

// All reviews for Product 42
var productReviews = Context.Product[42].ReviewsByProduct;
```

Single-FK children keep the simpler name: `OrderCollectionHandle`.

---

## Reactive Subscriptions

Editors and CollectionHandles support per-entity and per-parent change
notifications. Under the hood, a single `ChangeRouter<T>` subscribes once
to the DbSet and dispatches to subscribers by key — O(batch_size) per commit,
not O(subscribers x batch_size).

### Entity-Level Subscription (`OnChanged`)

Subscribe to changes for a specific entity by ID:

```csharp
IDisposable sub = Context.Customer[1].OnChanged((in StateChange<Customer> change) =>
{
    Console.WriteLine($"Customer 1: {change.Type}");
});

context.BeginTransaction();
Context.Customer[1].Update(Context.Customers.FindById(1) with { Name = "Updated" });
context.Commit(); // handler fires here (synchronous, during Commit)

sub.Dispose(); // stop listening
```

### Collection-Level Subscription (`OnChanged`)

Subscribe to changes for children of a specific parent:

```csharp
IDisposable sub = Context.Customer[1].Orders.OnChanged((in StateChange<Order> change) =>
{
    Console.WriteLine($"Order {change.Id} of Customer 1: {change.Type}");
});

// Fires on add, update, remove, AND transfers
context.BeginTransaction();
Context.Customer[1].Orders.Add(new Order { TotalAmount = 50m, Status = "New" });
context.Commit(); // handler fires
```

### Weak Subscriptions (`OnChangedWeak`)

Subscribe with a weak reference to a target object. The subscription auto-cleans
when the target is garbage-collected:

```csharp
IDisposable sub = Context.Customer[1].OnChangedWeak(panel,
    static (p, change) => p.Refresh(change));
```

The callback must be `static` (or non-capturing) — it receives the target as
the first argument. This prevents capturing the target, which would defeat
the weak reference.

### Batched Subscriptions (`OnBatchChanged`)

Accumulate all changes during a commit and deliver as a single list:

```csharp
IDisposable sub = Context.Customer[1].Orders.OnBatchChanged(changes =>
{
    Console.WriteLine($"Received {changes.Count} order changes");
    foreach (var change in changes)
        Console.WriteLine($"  {change.Type}: Order {change.Id}");
});

context.BeginTransaction();
Context.Customer[1].Orders.Add(new Order { TotalAmount = 10m, Status = "New" });
Context.Customer[1].Orders.Add(new Order { TotalAmount = 20m, Status = "New" });
context.Commit(); // handler fires ONCE with list of 2 changes
```

### Deep Watch (`OnDeepChanged`)

Subscribe to changes on an entity AND all its child collections. Child changes
are forwarded as synthetic `Update` notifications on the parent:

```csharp
IDisposable sub = Context.Customer[1].OnDeepChanged((in StateChange<Customer> change) =>
{
    // Fires when:
    // - Customer 1 is updated
    // - Any Order of Customer 1 is added/updated/removed
    // - Any Review of Customer 1 is added/updated/removed
    Console.WriteLine("Customer 1 or its children changed");
});

// Disposing unsubscribes from ALL sub-subscriptions (entity + children)
sub.Dispose();
```

The returned `IDisposable` is a `CompositeDisposable` that groups the entity
subscription and all child FK router subscriptions.

### No-Op Update Suppression

Updates that produce a value-equal entity are automatically suppressed:

```csharp
var alice = Context.Customers.FindById(1);
context.BeginTransaction();
Context.Customer[1].Update(alice with { }); // identical copy
context.Commit(); // OnChanged does NOT fire
```

Uses `EqualityComparer<T>.Default.Equals` (leveraging record value equality).

### Subscription Comparison

| Mode | Scope | Delivery | Allocation | Use Case |
|------|-------|----------|-----------|----------|
| `OnChanged` (entity) | Single entity | Per-change | Zero (in-delegate) | Entity detail view |
| `OnChanged` (collection) | Parent's children | Per-change | Zero (in-delegate) | Child list view |
| `OnChangedWeak` | Single entity/collection | Per-change | Zero (weak ref) | UI with lifecycle |
| `OnBatchChanged` | Parent's children | Batched (once/commit) | List allocation | Batch UI update |
| `OnDeepChanged` | Entity + all children | Per-change (synthetic) | CompositeDisposable | Aggregate views |

### Design Notes

- **Indexed routing** — `ChangeRouter<T>` subscribes once to the DbSet and
  dispatches by int key (entity ID or FK value).
- **Main-thread delivery** — handlers fire synchronously during `Commit()`.
- **Transfer notifications** — both old and new parent subscribers are notified.
- **Constraint** — do not `Subscribe` or `Dispose` from within a handler
  callback (deadlock risk — EventDispatcher dispatches under lock).

---

## Chained Navigation

Navigate multiple levels of the entity hierarchy:

```csharp
// Customer -> Orders -> pick an order -> OrderItems
var items = Context.Customer[1].Orders.Editor(orderId).OrderItems.GetAll();

// Create order + items in one chain
Context.Customer[1].Orders.Add(new Order { TotalAmount = 200m, Status = "New" })
    .OrderItems.Add(new OrderItem { ProductId = 1, Quantity = 2, UnitPrice = 99.99m });
```

### Navigation Patterns

| Pattern | Code |
|---------|------|
| Parent -> Children | `Context.Customer[1].Orders` |
| Child -> Parent | `Context.Order[1].Customer` |
| Parent -> Child -> Grandchildren | `Context.Customer[1].Orders.Editor(1).OrderItems` |
| Child -> Parent -> Siblings | `Context.Order[1].Customer.Orders` |
| Create + navigate | `Context.Customer[1].Orders.Add(order).OrderItems.Add(item)` |

---

## Transaction Safety

All mutations through Editors and CollectionHandles require an active
transaction:

```csharp
Context.BeginTransaction();

Context.Customer[1]
    .Modify(c => c with { Name = "Updated" })
    .Orders.Add(new Order { TotalAmount = 50m, Status = "New" });

Context.Commit();   // or Context.Rollback()
```

Rollback reverts all mutations made through Editors and Handles, because
they operate on the same `StateChangeBuffer<T>` as direct `DbSet` operations.

See [Transactions](/docs/engine/transactions) for full transaction semantics.

---

## Performance Characteristics

| Operation | Time Complexity | Allocations |
|-----------|----------------|------------|
| `Context.Entity[id]` (create Editor) | O(1) | Zero (stack) |
| `Editor.Value` (read entity) | O(1) | Zero (returns by value) |
| `Editor.Update(value)` | O(1) | Zero |
| `Editor.Remove()` | O(1) | Zero |
| `Editor.RemoveCascade()` | O(children) | Zero |
| `Editor.Modify(func)` | O(1) | 1 delegate (if not cached) |
| `Handle.Add(item)` | O(1) amortized | Zero |
| `Handle.AddRange(items)` | O(N) | Zero |
| `Handle[childId]` | O(1) | Zero (lookup index) |
| `Handle.Count` | O(1) | Zero (index-maintained) |
| `Handle.GetAll()` | O(1) | Zero |
| `Handle.First()` / `Handle.TryGetFirst()` | O(1) | Zero |
| `Handle.Last()` / `Handle.TryGetLast()` | O(children) | Zero |
| `Handle.ToArray()` | O(children) | Array allocation |
| `Handle.ToList()` | O(children) | List allocation |
| `Handle.RemoveAll()` | O(children) | Zero (stack span) |
| `Handle.ModifyAll(func)` | O(children) | 1 delegate |
| `Handle.Transfer(id, newParent)` | O(1) | Zero |
| `foreach (var x in handle)` | O(children) | Zero (struct enumerator) |

---

## Error Handling

| Error Condition | Exception | When |
|----------------|-----------|------|
| Entity not found | `KeyNotFoundException` | `Editor.Value` on non-existent entity |
| Child not found | `KeyNotFoundException` | `Handle[childId]` on non-existent child |
| No active transaction | `InvalidOperationException` | Any mutation without `BeginTransaction()` |
| Empty collection | `InvalidOperationException` | `Handle.First()` or `Handle.Last()` on empty collection |

Use `Exists` and `TryGet` for safe access:

```csharp
var editor = Context.Customer[999];
if (editor.Exists)
{
    // Safe to access .Value
    Console.WriteLine(editor.Value.Name);
}

if (Context.Customer[1].Orders.TryGet(orderId, out var order))
{
    Console.WriteLine(order.TotalAmount);
}
```

---

## Complete Example

```csharp
Context.BeginTransaction();

// Create a customer with orders and items in one transaction
var newCustomer = new Customer { Name = "Alice" };
Context.Customers.Add(newCustomer);
var customer = Context.Customer[newCustomer.Id];

var order = customer.Orders.Add(new Order
{
    OrderDate = DateTime.UtcNow,
    TotalAmount = 149.98m,
    Status = "Pending",
    ShippingCountry = "US"
});

order.OrderItems.AddRange(new OrderItem[]
{
    new() { ProductId = 1, Quantity = 1, UnitPrice = 99.99m },
    new() { ProductId = 3, Quantity = 2, UnitPrice = 24.99m },
});

Context.Commit();

// ---- Read back ----
Customer alice = Context.Customer[customer.Id]; // implicit conversion
Console.WriteLine($"{alice.Name}: {customer.Orders.Count} orders");

foreach (var o in customer.Orders)
    Console.WriteLine($"  Order {o.Id}: {o.TotalAmount:C}");

// ---- Batch cancel all orders ----
Context.BeginTransaction();
customer.Orders.ModifyAll(o => o with { Status = "Cancelled" });
Context.Commit();

// ---- Transfer an order to another customer ----
Context.BeginTransaction();
var newBob = new Customer { Name = "Bob" };
Context.Customers.Add(newBob);
var bob = Context.Customer[newBob.Id];
customer.Orders.Transfer(orderId: order.Id, newParentId: bob.Id);
Context.Commit();

// ---- Deep watch for dashboard ----
IDisposable watch = Context.Customer[customer.Id].OnDeepChanged(
    (in StateChange<Customer> _) => RefreshDashboard());

// ---- Clean up ----
Context.BeginTransaction();
customer.RemoveCascade(); // removes customer + remaining orders + items
bob.RemoveCascade();
Context.Commit();

watch.Dispose();
```

---

## Generated Code Annotations

All generated types are marked with:
- `[GeneratedCode("ConjureDB.CodeGen", "1.0")]`
- `#pragma warning disable CS1591` (suppresses missing XML doc warnings)

This ensures clean static analysis integration and clear identification
of generated vs hand-written code.
