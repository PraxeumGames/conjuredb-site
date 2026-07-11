# Production Readiness

ConjureDB is production-ready only when the database runtime, compiler, generated
code, Unity package, and release artifacts pass one authoritative release gate on
a clean checkout.

This page defines the mobile embedded / Unity game-client readiness bar. It does
not require ANSI SQL compatibility, vectorized execution, distributed execution,
or a server multi-writer architecture.

---

## Release Definition

A release candidate is ready when all of the following are true:

| Area | Required proof |
|------|----------------|
| Runtime DB | Transaction atomicity, persistence recovery, secondary-index consistency, AES/corruption handling, and durability policy tests pass. |
| Compiler | Compiler, IR, integration, planning, emission, optimizer, measured replay, and search replay gates pass. |
| Codegen | Generated-code quality and generator drift gates pass; no generated `*.g.cs` file is manually edited. |
| Reactive | Reactive capability, correctness, fuzz, perf, signoff, and trend gates pass in release mode. |
| Materialized views / ReactiveAutoView | The materialized-view benchmark proof lane passes and emits summary artifacts, proving indexed reads avoid source-pipeline execution while Z-set maintenance stays bounded by change count, growth, and allocation ceilings. |
| Unity | The Unity package imports, compiles, and runs playmode package tests under a detected Unity Editor. |
| Reproducibility | Release reproducibility checks pass with zero warnings. |
| Documentation | The public docs snippet compile contract passes in required mode. |

The single command for this proof is:

```bash
bash ci/production-readiness-gate.sh
```

The gate writes logs and a release summary under
`TestResults/production-readiness/`. A green result from separate ad hoc commands
is useful for development, but it is not a production-ready signal.

The same proof is available through the `Production Readiness` GitHub Actions
workflow. It runs on a self-hosted runner because the release profile requires
Unity package validation and machine-stable performance evidence.

---

## Required Gate Behavior

`ci/production-readiness-gate.sh` is intentionally stricter than the default PR
lanes:

- it requires a clean working tree before execution;
- it runs runtime hardening and AES security coverage;
- it runs optimizer and reactive quality gates in release/required mode;
- it runs the schema-first materialized-view benchmark proof lane;
- it runs generated-code quality plus generator drift checks;
- it runs Unity validation and rejects a release if no Unity Editor was detected;
- it rejects tracked or untracked generated `*.g.cs` changes.

For local smoke checks, use the narrower subsystem gates. Do not lower the
production gate to advisory mode for release signoff.

---

## Durability Profiles

ConjureDB supports different durability/performance tradeoffs:

| Profile | Intended use | Contract |
|---------|--------------|----------|
| `FastMobile` | Non-critical game state where low latency matters most. | Journal and snapshot policies may optimize throughput, but corruption policies must remain explicit. |
| `CriticalState` | Purchases, currency, inventory, entitlement state. | Commit must use fail-fast recovery and durable flush semantics. |
| `ForceFlushEveryCommit` | Explicit alias of `CriticalState` for critical flows. | Each commit waits for durable journal flush and cannot use permissive corruption handling. |

`ForceFlushEveryCommit` is an explicit alias of `CriticalState` — identical
semantics (every commit forces a durable journal flush and requires
`JournalCorruptionPolicy.Fail`), not a stronger durability tier.

Critical durability profiles must fail fast on persistence corruption. They must
not silently stop replay, skip fsync failures, or continue with ambiguous state.

---

## Generated-Code Policy

Generated files are compiler outputs:

- never edit `*.g.cs` or files under `*/Generated/` by hand;
- fix the compiler, code generator, schema, or source input that produced the
  wrong output;
- regenerate with the approved generator command;
- prove the result with `python3 ci/generated_code_quality_gate.py --strict`
  and `bash ci/generator-drift-gate.sh`.

---

## Release Blockers

The following conditions block a production-ready claim:

- any open P0/P1 DB or compiler correctness defect;
- a failing or skipped required production-readiness step;
- generated-code drift without an approved regeneration command and evidence;
- Unity validation that only ran repo-native checks and did not detect Unity
  Editor playmode execution;
- persistence recovery that depends on permissive fallback for critical state;
- documentation snippets that do not compile against the current API.

P2/P3 items may remain only when they are documented with owner, risk, and a
follow-up plan, and when they do not affect the mobile embedded release profile.
