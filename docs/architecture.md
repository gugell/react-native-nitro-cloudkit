# Architecture

The public API is a TypeScript core. Nitro is the implementation of one adapter, not the API. This
is the shape of [react-native-nitro-loggerkit](https://github.com/iauti/react-native-nitro-logger),
applied to storage. It lets the same app code run against CKSyncEngine on iOS and against an
in-memory CloudKit in tests, web previews and Android builds.

## Layers

```
app code
  └─ createCloudKit(options)          core: checks, deadlines, retries, tokens, logging
       └─ CloudKitAdapter              port: openStore → CloudKitAdapterStore
            ├─ /native                 Nitro hybrid object → Swift core (SyncStore) → CKSyncEngine
            ├─ /memory                 in-memory database (devices share one)
            └─ your adapter            e.g. CloudKit Web Services
  └─ /record-store                     sync-engine port over a client (codec is replaceable)
```

- **Core** (`src/createCloudKit.ts`): validates options at creation, opens the store lazily (once,
  retried after a failure), checks input before the adapter sees it (record size, names), bounds
  every call with a deadline, retries retryable codes with back-off (CloudKit's `retryAfter` wins),
  stores tokens for `pull()` and commits them only on request, and logs operations without contents.
- **Ports** are structural: `CloudKitAdapter`, `TokenStore` (memory, MMKV, anything with
  `getString`/`set`/`delete`) and `CloudKitLogger` (console, loggerkit).
- **Errors** cross every boundary as `CloudKitError` with a code. Native code encodes the code in
  the message (`[nitro-cloudkit:<code>;retryAfter=<s>] …`), because Nitro turns a Swift error into a
  JS `Error` with the error's description. The core parses it.

## Native adapter

The Nitro spec lives in `src/specs/`. `CloudKit` is the autolinked root, with `isSupported` and
`openStore`. `CloudKitStore` is returned by the factory and is not autolinked, following Margelo's
factory pattern.

The Swift is in two layers:

- **`ios/Core/`** has no Nitro: Codable value types that mirror the TS specs (`CoreRecord`,
  `CoreChanges`, …) and `CloudKitStoreCore`, which opens one store per container, queues calls,
  bounds each with the timeout and codes errors. It builds for iOS 17+ and macOS 14+, so another
  host (a Node-API addon in an Electron main process) can compile the same sources and pass the
  values as JSON. On macOS it reads the process's entitlements and rejects `misconfigured`
  instead of letting `CKContainer` trap.
- **`ios/Nitro/`** has the hybrid objects, which only map Nitro's structs to the core's and back.
  Opening a store also registers for remote notifications, so CKSyncEngine fetches on CloudKit's
  silent pushes.

The work happens in `SyncStore`, a Swift actor that is the `CKSyncEngineDelegate`:

- **Token = state serialization.** `.stateUpdate` events update the next token. The engine is
  rebuilt from whatever token the caller passes, so the caller owns persistence.
- **Inbox.** Changes CKSyncEngine fetches on its own (`automaticallySync`) wait until the next fetch,
  which hands them out with the token covering them. Nothing is lost if the app dies first.
- **Outbox.** A send adds pending changes for exactly its records and drops leftovers.
  `nextRecordZoneChangeBatch` builds batches from the outbox. Missing-zone and stale-tag failures
  retry within the call.
- **Change tags.** System fields are cached per record, so saves go over the server version.
  `serverRecordChanged` returns the server's record as a conflict.
- **Assets** live in `<zone>_assets`, which is excluded from fetches and read and written with direct
  database calls.
- **Accounts.** `CKAccountChanged` and `.accountChange` compare a hashed identity. A sign-out or
  switch resets local state, then emits.

Android has no CloudKit. The Kotlin hybrid object loads and rejects `unsupported_platform`. The web
entry (`browser` export) is a JS stub.

## Decisions

- **Adapters over platform branches.** Callers pick a backend once. The core is portable and
  testable without native code.
- **Errors as data where they are per record.** `sendChanges` reports saved, conflicts and failed
  per record. Only whole-call failures reject.
- **No queries, no plain fields (yet).** Sync engines fetch zone changes. Every field is encrypted
  by default.
- **Plugin as CommonJS** (`app.plugin.cjs`) in an ESM package. Expo loads config plugins with
  `require`.
