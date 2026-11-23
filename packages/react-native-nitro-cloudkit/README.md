# react-native-nitro-cloudkit

CloudKit for React Native, on Apple's [`CKSyncEngine`](https://developer.apple.com/documentation/cloudkit/cksyncengine)
(iOS 17+), built as a [Nitro module](https://nitro.margelo.com). It uses one container's **private database**
and one **custom record zone**. Every record field is **end-to-end encrypted**, files travel as
`CKAsset`s, and every call is async and rejects with a coded error instead of hanging.

The public API is a small TypeScript core with **pluggable adapters**. Nitro is one adapter, not the
API. The same code runs against CKSyncEngine on iOS and an in-memory CloudKit in tests, on the web
and on Android:

| Import                                     | What it is                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `react-native-nitro-cloudkit`              | `createCloudKit`, errors, token stores, types. Pure TypeScript, no native code.      |
| `react-native-nitro-cloudkit/native`       | `createNativeAdapter()`: CKSyncEngine through Nitro. iOS 17+, macOS 14+ (RN macOS).  |
| `react-native-nitro-cloudkit/memory`       | `createMemoryAdapter()`: CloudKit's semantics in memory, devices sharing a database. |
| `react-native-nitro-cloudkit/record-store` | `createRecordStore()`: the record-store port of a last-writer-wins sync engine.      |
| `react-native-nitro-cloudkit` (plugin)     | Expo config plugin: CloudKit entitlements and background mode.                       |

| `react-native-nitro-cloudkit-watermelondb` | Separate package: sync a [WatermelonDB](https://watermelondb.dev) database through CloudKit. See [its README](../react-native-nitro-cloudkit-watermelondb/README.md). |

> **Status: 0.x.** Verified against live iCloud (Production environment) with a release build of a
> real app on iPhone: uploads, downloads across devices, deletions, assets. The JS layer is unit
> tested, and the Swift and Kotlin compile in CI. See [Status](#status).

## Why

Apple already runs a sync server for every app: CloudKit's private database. This package gives a
React Native app that server without the parts that usually make it hard.

- **No backend to run.** No server, no auth system, no database bill. Each user's data lives in
  their own iCloud and counts against their storage, not yours.
- **Private by default.** Every field goes to `CKRecord.encryptedValues`, end-to-end encrypted with
  keys in the user's iCloud Keychain. You can't read user data, and neither can Apple.
- **Apple's sync engine.** `CKSyncEngine` (iOS 17+) handles scheduling, batching, silent pushes,
  retries after network loss and account changes. The same engine runs Apple's own apps.
- **Incremental and conflict-aware.** Pull only what changed since a token, and push over change
  tags, so a newer server version comes back as a conflict to merge instead of being overwritten.
- **Files included.** Photos and documents travel as `CKAsset`s in their own zone, downloaded only
  when you ask.
- **Testable without a device.** The `memory` adapter implements CloudKit's semantics in plain
  TypeScript: several "devices" on one database, account switches, injected failures. Unit tests,
  web previews and Android builds run the same code.
- **Fast and typed.** Nitro (JSI) instead of the bridge: typed structs, no JSON over a queue.
- **Fails loudly, never hangs.** Every call has a deadline, retries what's retryable (honouring
  CloudKit's `retryAfter`) and rejects with a typed error code.
- **Expo-ready.** A config plugin writes the entitlements and merges with iCloud Documents.

### When to use something else

- You need **Android or web users to share the same data**: CloudKit is Apple-only (see
  [Android](#android)). Use a cross-platform backend instead.
- You need **sharing between users** or **public data**: not built yet (`CKShare`, public database).
- You need **server-side logic** (queries across users, webhooks): CloudKit's private database is
  storage, not a backend.

## Install

```sh
npm install react-native-nitro-cloudkit react-native-nitro-modules
```

`react-native-nitro-modules` is needed for the native adapter. Use the version this package's
bindings were generated with (`>=0.37.2 <0.38.0`). It is a native module, so rebuild the app
(`npx expo prebuild` + `npx expo run:ios`). Expo Go cannot load it.

### Expo config plugin

```json
{
  "expo": {
    "plugins": [
      ["react-native-nitro-cloudkit", { "containerIdentifier": "iCloud.com.example.app" }]
    ]
  }
}
```

| Prop                   | Default                                   | Writes                                                      |
| ---------------------- | ----------------------------------------- | ----------------------------------------------------------- |
| `containerIdentifier`  | `iCloud.<ios.bundleIdentifier>`           | added to `com.apple.developer.icloud-container-identifiers` |
| `apsEnvironment`       | keeps the app's value, else `development` | `aps-environment`                                           |
| `containerEnvironment` | not set                                   | `com.apple.developer.icloud-container-environment`          |

It always adds `CloudKit` to `com.apple.developer.icloud-services` and `remote-notification` to
`UIBackgroundModes`. CKSyncEngine learns about changes from silent pushes.

The plugin **merges** and never replaces. Next to iCloud Documents (`ios.usesIcloudStorage`) the
result is `icloud-services: [CloudDocuments, CloudKit]`, with the `ubiquity-*` keys and app groups
untouched. Check the result with `npx expo config --type introspect`.

### What the App ID needs

Done in the Apple Developer portal, or synced by EAS Build. This package does not change it.

- **iCloud** with **CloudKit** checked and your container assigned.
- **Push Notifications** (silent pushes).
- A provisioning profile regenerated after those changes.

### Deploy the CloudKit schema before TestFlight

Development builds use the container's **Development** environment, where CloudKit creates record
types on first save. **TestFlight and App Store builds use Production, which has only what you
deploy.** Before your first TestFlight build:

1. Save every record type once from a development build, and upload one asset.
2. In [CloudKit Console](https://icloud.developer.apple.com), go to your container → Schema and
   check the types: yours, with **Encrypted String** fields, and `NitroCloudKitAsset` with an
   **Asset** field `file`.
3. **Deploy Schema Changes** to Production.

A type missing in Production surfaces as `misconfigured` or `server_rejected`.

## Usage

```ts
import { createCloudKit, createKeyValueTokenStore } from 'react-native-nitro-cloudkit';
import { createNativeAdapter } from 'react-native-nitro-cloudkit/native';
import { createMemoryAdapter } from 'react-native-nitro-cloudkit/memory';
import { MMKV } from 'react-native-mmkv';

const native = createNativeAdapter();

export const cloud = createCloudKit({
  adapter: native.isSupported ? native : createMemoryAdapter(), // CKSyncEngine, or memory elsewhere
  containerIdentifier: 'iCloud.com.example.app',
  zoneName: 'Notes',
  tokenStore: createKeyValueTokenStore(new MMKV()), // enables pull()
  retry: { attempts: 3, initialDelayMs: 500 }, // default; `false` disables
  timeoutMs: 60_000, // default
  logger: console, // or a react-native-nitro-loggerkit logger
});

// Pull: changes since the stored token. Commit after applying, so a crash fetches them again.
const changes = await cloud.pull();
apply(changes.modified, changes.deleted, changes.zoneWasDeleted);
await changes.commit();

// Push: a per-record outcome, with server versions for conflicts.
const result = await cloud.sendChanges({
  recordsToSave: [{ recordType: 'note', recordName: 'note.0b5d', encryptedFields: { text: json } }],
  recordsToDelete: [{ recordType: 'note', recordName: 'note.old' }],
});
// result.saved · result.deleted · result.conflicts · result.failed[].code

// Files
await cloud.putAsset('scan-1.jpg', 'file:///…/scan-1.jpg');
await cloud.getAsset('scan-1.jpg', 'file:///…/scan-1.jpg');

// Account and remote changes
cloud.onAccountChange((change) => change.type /* signIn | signOut | switchAccounts */);
cloud.onRemoteChange(() => void syncNow());
```

### `createCloudKit(options)`

| Option                | Default                                                   | Notes                                                                                                            |
| --------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `adapter`             | required                                                  | `createNativeAdapter()`, `createMemoryAdapter()`, or your own `CloudKitAdapter`.                                 |
| `containerIdentifier` | required                                                  | `iCloud.…`, in the app's entitlements.                                                                           |
| `zoneName`            | required                                                  | Custom zone: letters, digits, `_`, `-`, at most 64. Assets use `<zone>_assets`.                                  |
| `timeoutMs`           | `60000`                                                   | Per adapter call. Assets get at least 5 minutes.                                                                 |
| `automaticallySync`   | `true`                                                    | Let CKSyncEngine fetch after silent pushes and launches.                                                         |
| `retry`               | `{ attempts: 3, initialDelayMs: 500, maxDelayMs: 30000 }` | Retryable codes only. CloudKit's `retryAfter` wins over the computed back-off. `false` disables.                 |
| `tokenStore`          | none                                                      | Enables `pull()`. Use `createMemoryTokenStore()`, `createKeyValueTokenStore(mmkv)`, or your own.                 |
| `tokenKey`            | `nitro-cloudkit:<container>:<zone>`                       | Where the token lives in the token store.                                                                        |
| `logger`              | none                                                      | Structural `{ debug, info, warn, error }`. Logs operations, durations, retries and codes, never record contents. |

Options are checked when the client is created (`CloudKitError` `invalid_argument`). The store opens
on first use, or call `open()`.

### The client

| Member                                            | Notes                                                                                                                                                    |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adapter`, `containerIdentifier`, `zoneName`      | What it talks to.                                                                                                                                        |
| `isSupported`                                     | Whether the adapter works here.                                                                                                                          |
| `open()`                                          | Opens the store now.                                                                                                                                     |
| `getAccount()`                                    | `{ status, identity }`. `identity` is a SHA-256 of the container + user record id: the same on every device of that Apple ID, `null` unless `available`. |
| `onAccountChange(listener)`                       | `signIn`, `signOut`, `switchAccounts`. On sign-out or switch, the native adapter resets its local state first. Returns a remover.                        |
| `onRemoteChange(listener)`                        | The backend fetched changes on its own; pull them. Returns a remover.                                                                                    |
| `fetchChanges(token)`                             | `{ modified, deleted, token, zoneWasDeleted }`. You keep the token.                                                                                      |
| `pull()`                                          | Same, with the token read from the token store, plus `commit()` to store the new one.                                                                    |
| `fetchRecord(type, name)`                         | One record or `null`.                                                                                                                                    |
| `sendChanges({ recordsToSave, recordsToDelete })` | `{ saved, deleted, conflicts, failed }`.                                                                                                                 |
| `putAsset(name, fileUri)`                         | Uploads unless an asset of that name exists (assets are immutable).                                                                                      |
| `getAsset(name, fileUri)`                         | Downloads to `fileUri`, replacing it atomically. Rejects `asset_not_found`.                                                                              |
| `removeAsset(name)`                               | No error if it is already gone.                                                                                                                          |
| `reset()`                                         | Forgets local state and the stored token. Server data stays.                                                                                             |
| `deleteAllData()`                                 | Deletes both zones from iCloud, then resets.                                                                                                             |

`fileUri` is a `file://` URI or an absolute path.

### Records

- A record is `{ recordType, recordName, encryptedFields: Record<string, string> }`. **All fields
  go to `CKRecord.encryptedValues`**, end-to-end encrypted with keys in the user's iCloud Keychain.
  `recordType` and `recordName` are not encrypted, so keep names opaque.
- A save updates the fields it names. Fields it leaves out stay as they are. Send `''` to clear one.
- Fetched records carry `modifiedAt`, the server modification time in ms.

### Tokens

With the native adapter, the token is **CKSyncEngine's state serialization**. The caller owns
persistence: `pull()` and `commit()` do it for you, or pass tokens to `fetchChanges` yourself. Changes
CKSyncEngine fetches on its own wait in memory until the next fetch, which returns them together with
a token that covers them. If the app dies before you commit, the stored token is older and the same
changes come again. Nothing is lost.

`zoneWasDeleted: true` means the zone is gone on the server: the user deleted iCloud data, or another
device called `deleteAllData()`. Treat everything you believed stored as gone and push it again.

### Conflicts

Saves go over the record's last known **change tag**. The native adapter caches system fields in
Application Support, excluded from backup. When the server has a newer version, it comes back in
`conflicts` (`serverRecordChanged`). Merge it and send again. A lost cache costs one conflict round
per record, never data.

### Assets

Each asset is a `NitroCloudKitAsset` record (field `file`, a `CKAsset`) in a second zone,
`<zoneName>_assets`. That zone is excluded from CKSyncEngine fetches, so a sync never downloads files
in bulk. CloudKit always encrypts `CKAsset` contents. Assets cannot go in `encryptedValues`, so
end-to-end protection for them follows the user's Advanced Data Protection setting.

### Errors

Every rejection is a `CloudKitError` with `code`, `message`, `retryAfterSeconds` and `retryable`.

| Code                                                        | Meaning                                                |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| `unsupported_platform`, `unsupported_os`                    | Android or web with the native adapter, or iOS < 17    |
| `not_authenticated`, `account_temporarily_unavailable`      | No usable iCloud account                               |
| `network`, `service_unavailable`, `rate_limited`, `timeout` | Retryable: retried by the client, per `retry`          |
| `quota_exceeded`                                            | The user's iCloud storage is full                      |
| `zone_not_found`, `not_found`, `asset_not_found`            | Missing on the server                                  |
| `conflict`                                                  | Server has a newer version (sends report `conflicts`)  |
| `record_too_large`, `limit_exceeded`                        | Over 1 MB per record, or too much in one request       |
| `misconfigured`, `permission_denied`                        | Entitlements, container, schema, or module not linked  |
| `file_error`, `invalid_argument`                            | Local file problem, or bad input (checked in JS first) |
| `cancelled`, `server_rejected`, `unknown`                   | Everything else                                        |

## Adapters

### Native: `react-native-nitro-cloudkit/native`

`createNativeAdapter()` uses CKSyncEngine through a Nitro hybrid object.

| Platform         | Behaviour                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| iOS 17+          | Full implementation (Swift).                                                                                            |
| macOS 14+        | The same Swift through react-native-macos (podspec `:osx`); not built in CI.                                            |
| iOS < 17         | `isSupported` is `false`. Calls reject `unsupported_os`.                                                                |
| Android          | The Kotlin hybrid object loads, `isSupported` is `false`, calls reject `unsupported_platform`. See [Android](#android). |
| Web              | A stub (`browser` export) that reports unsupported.                                                                     |
| Expo Go/unlinked | `isSupported` is `false`. Opening rejects `misconfigured`.                                                              |

The SDK interface shows how it maps onto CKSyncEngine:

- A Swift actor is the `CKSyncEngineDelegate`. It handles `.stateUpdate` (the next token),
  `.fetchedDatabaseChanges` (zone deletion), `.fetchedRecordZoneChanges`, the sent-changes events
  (saved records, conflicts, failures, change tags) and `.accountChange`.
- Sends add pending changes for exactly their records. Batches come from an in-memory outbox.
  Missing-zone and stale-tag failures retry within the call.
- Fetches exclude the asset zone. Calls are queued and bounded by `timeoutMs`.

This follows Apple's [sample-cloudkit-sync-engine](https://github.com/apple/sample-cloudkit-sync-engine)
and WWDC23 "Sync to iCloud with CKSyncEngine".

### Memory: `react-native-nitro-cloudkit/memory`

`createMemoryAdapter({ database?, name?, copyFile? })` implements CloudKit's semantics without
CloudKit: tokens, change tags and `serverRecordChanged` conflicts, zone deletion, account changes, and
remote-change notifications. Give several adapters one `createMemoryDatabase()` to simulate several
devices. The database can switch accounts (`setAccount(identity | null)`) and inject failures
(`failNext('network', 2)`), which is useful for testing retries and offline paths. Assets record
their source URI. Pass `copyFile` to copy files on `getAsset`.

### Your own adapter

Implement `CloudKitAdapter` (`name`, `isSupported`, `openStore`) and return a
`CloudKitAdapterStore`. Reject with `CloudKitError`, or an `Error` whose message starts
`[nitro-cloudkit:<code>]`. The client adds input checks, deadlines, retries, token storage and
logging on top. A CloudKit Web Services or CloudKit JS adapter would plug in here.

### Record store: `react-native-nitro-cloudkit/record-store`

`createRecordStore(client, { codec?, fatalCodes? })` serves the record-store port of a
last-writer-wins sync engine:

- Methods: `isAvailable`, `identity`, `pull(token)`, `get`, `push` (saved keys + server versions on
  conflict), `purge`, and asset methods.
- Each record is a `VersionedRecord`: `{ type, id, updatedAt, deleted, data, assets }`.
- Default codec: a record type's dashes become underscores, names are `<type>.<id>`, and header and
  data travel as one encrypted JSON `payload` field. Replace any part with `codec`.
- `fatalCodes` (default `not_authenticated`, `quota_exceeded`, `network`, `misconfigured`) fail the
  whole push instead of leaving a record for the next run.

### WatermelonDB: `react-native-nitro-cloudkit-watermelondb`

A separate package, so apps that don't use WatermelonDB install nothing for it. It returns the
`pullChanges` and `pushChanges` that WatermelonDB's `synchronize()` asks for. Each row becomes one
record, each column an encrypted field, and concurrent edits merge per column:

```ts
const sync = createWatermelonSync(cloud, { tokenStore });
await synchronize({ database, ...sync, sendCreatedAsUpdated: true });
```

See [its README](../react-native-nitro-cloudkit-watermelondb/README.md).

## Android

**Android has no CloudKit.** On Android `createNativeAdapter()` loads, reports
`isSupported: false` and rejects `unsupported_platform`, so an app with Android users has three
choices:

1. **Apple devices sync, Android stays local.** This is the simplest and the default. Check
   `cloud.isSupported`, hide the iCloud switch on Android, and keep Android data on the device.
   The memory adapter keeps the same code path running in development.
2. **Write a CloudKit Web Services adapter.** Android talks to the same private database over
   Apple's REST API. It plugs in as [your own adapter](#your-own-adapter). The checklist below
   covers what that takes.
3. **Use a cross-platform backend** (Supabase, Firebase, your own server) when Android and iOS
   users must share data, or when the checklist below rules option 2 out.

### Checklist: a CloudKit Web Services adapter for Android

Not built in this package. Check the first two points before writing any code:

- [ ] **Encrypted fields.** This package writes every field to `encryptedValues`. Apple has not
      documented that CloudKit Web Services or CloudKit JS can read encrypted fields. An Apple
      engineer has pointed developers to CKTool JS (with a web auth token) for them. Prove it on
      a test record before going further. Otherwise Android needs unencrypted fields, which this
      package doesn't write.
- [ ] **Advanced Data Protection.** For users with ADP, iCloud data on the web is off by default.
      Test web access to your container with an ADP account and with "Access iCloud Data on the
      Web" turned off.
- [ ] **API token.** CloudKit Console → your container → Tokens & Keys → an API token for
      **Production**, with a sign-in callback URL your Android app handles (an App Link or a
      custom scheme).
- [ ] **Sign in with Apple ID.** Open the web sign-in in a Custom Tab, receive `ckWebAuthToken`
      on the callback, and store it encrypted (Android Keystore). Treat it as a session that can
      expire, and sign in again when it does.
- [ ] **The adapter.** Implement `CloudKitAdapter` over the REST endpoints: `zones/modify` (create
      the zone), `records/changes` with a `syncToken` (fetch), `records/modify` with
      `recordChangeTag` (saves and conflicts), and `assets/upload` plus download URLs (files).
      Reject with `CloudKitError` codes, and the client adds deadlines, retries and tokens.
- [ ] **No silent pushes.** CloudKit can't wake an Android app. Sync on launch, on resume and on a
      timer, or use WorkManager.
- [ ] **Same names on both sides.** The container, zone, record types and field names must match
      the iOS app's, and the schema must be deployed to Production.
- [ ] **Account identity.** `getAccount().identity` must hash the same user record id as on iOS,
      so data from different Apple IDs never mixes.
- [ ] **Tests.** Run the record-store and WatermelonDB test suites against the new adapter, and
      against a development container.

## Limits

- **1 MB per record, excluding assets.** Keys and values are counted as UTF-8 in JS before anything
  is sent. Put large data in assets.
- Record types: a letter, then letters, digits or `_`, at most 255. Record and asset names: printable
  ASCII without spaces, at most 255, not starting with `_`.
- One store and one zone per container per app run.
- Everything counts against the **user's** iCloud storage.
- **Deploy the schema to Production before TestFlight.**
- A missing CloudKit entitlement makes `CKContainer(identifier:)` raise an Objective-C exception (an
  Apple behaviour). Only use the native adapter in builds that have the entitlement.

## Status

**Verified:**

- **Live iCloud, Production environment, release build on iPhone** (November 2026, as the sync of
  an app in App Review): records saved and fetched across two iPhones, deletions propagated,
  assets uploaded and removed, one end-to-end encrypted payload per record.
- Unit tests cover the client, retries, tokens, the memory adapter, the record store, input checks,
  error parsing and the plugin's entitlement merge.
- CI compiles the Swift (iOS simulator build of the example app) and the Kotlin (Android build of the
  example app).
- A packed tarball is installed into a clean project, and its portable entry points import in Node.

**Not yet verified:** the macOS build in a shipping app, and account switching on a live device.

**Not built:**

- Shared database (`CKShare`), public database, queries, unencrypted fields, asset progress.
- A CloudKit Web Services adapter (see [Android](#android)).

## License

MIT
