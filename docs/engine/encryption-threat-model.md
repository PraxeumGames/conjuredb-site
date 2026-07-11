# Encryption Threat Model

ConjureDB persistence encryption protects snapshot and journal files at rest for
mobile embedded game clients. It is a storage-hardening feature, not a complete
device-security boundary.

## Protected Assets

- Snapshot files, including entity payloads and schema metadata.
- Journal files, including committed state changes.
- Integrity of encrypted persistence chunks: corrupted ciphertext or tags must
  fail authentication during load.

## In Scope Threats

- Offline inspection of copied save files without the encryption password.
- Accidental or malicious modification of snapshot or journal bytes.
- Reuse of a copied encrypted file on another install when the application uses
  a per-install or per-player key derivation input.
- Truncated or partially written encrypted chunks after process kill or storage
  interruption.

## Out Of Scope Threats

- Key extraction from a rooted or jailbroken device.
- Runtime memory inspection, debugger attachment, code injection, or modified
  application binaries.
- Side-channel attacks against the device or cryptographic implementation.
- Server-side account compromise or attacker-controlled cloud backup restore.
- Cheating prevention by itself. Encryption raises the save-file tampering bar;
  authoritative validation still belongs in game logic or backend services.

## Cryptographic Contract

- ConjureDB uses AES-GCM for authenticated encryption of persistence files.
- Password-based keys are derived with PBKDF2 using the configured salt.
- Chunked encryption uses per-stream nonce salt and per-chunk nonce derivation so
  each chunk has a distinct nonce under the same stream key.
- The configured salt does not require confidentiality by itself, but it is part
  of the persisted key-derivation material. By default ConjureDB generates a
  new random salt per `EncryptionOptions` instance, so encrypted data can only
  be reopened across sessions when the same salt is persisted and reused.
- Authentication failure is terminal for the affected file. Do not continue with
  partially decrypted state.

## Key Management

- Use a high-entropy per-player or per-install secret when possible.
- Do not hardcode production encryption passwords in client source.
- Store secrets in the platform keystore when available.
- Treat lost keys as unrecoverable encrypted saves unless the game has a server
  recovery or account-linked key escrow flow.
- For key rotation, open with the old key, validate and load fully, then write a
  new snapshot and journal checkpoint using the new key. Do not rewrite only one
  side of the snapshot/journal pair.

## Operational Requirements

- Keep encryption enabled and disabled save paths tested separately.
- Test corrupted ciphertext, corrupted authentication tag, truncated chunk,
  wrong password, wrong salt, and plaintext/encrypted mode mismatch.
- Track upstream BouncyCastle security advisories for the bundled AES/GCM
  implementation port and update promptly when relevant vulnerabilities affect
  AES-GCM, PBKDF2, random generation, or authentication behavior.
- Record the app version, schema version, encryption mode, and durability mode in
  release QA notes so support can distinguish migration failures from key or
  corruption failures.

## Recommended Mobile Profiles

- For low-latency, non-critical local state: enable encryption and use
  `DurabilityPolicy.FastMobile` (the mobile-first default — journal writes are
  flushed by the adaptive background policy).
- For purchase, economy, or account-linked state: enable encryption and use
  `DurabilityPolicy.CriticalState`, which forces the journal to stable storage
  on every commit, requires journaling to be enabled, and requires
  `JournalCorruptionPolicy.Fail` so startup fails on journal corruption instead
  of accepting a partial replay.
- Encryption (`EncryptionOptions` / `DbContextBuilder.WithEncryption(...)`) and
  durability (`DbContextBuilder.WithDurabilityPolicy(...)`) are configured
  independently; there is no bundled named profile.
- Offline-only prototypes may disable encryption, but that must be a deliberate
  product decision and not a default production assumption.

## Failure Handling

When decryption or authentication fails:

1. Do not load partial state.
2. Report a corruption/key-mismatch diagnostic with file kind and recovery step.
3. Attempt recovery from the next valid snapshot or journal only if the configured
   corruption policy permits it.
4. For critical state, block startup or require explicit user/account recovery.

