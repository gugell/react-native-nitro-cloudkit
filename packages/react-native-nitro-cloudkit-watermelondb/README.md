# react-native-nitro-cloudkit-watermelondb

Sync a [WatermelonDB](https://watermelondb.dev) database through the user's own iCloud, with no
server, accounts or backend bill. It supplies the `pullChanges` and `pushChanges` that
WatermelonDB's [`synchronize()`](https://watermelondb.dev/docs/Sync/Frontend) asks for, built on
[react-native-nitro-cloudkit](../react-native-nitro-cloudkit/README.md).

```ts
import { synchronize } from '@nozbe/watermelondb/sync';
import { createWatermelonSync } from 'react-native-nitro-cloudkit-watermelondb';

const sync = createWatermelonSync(cloud, { tokenStore });

await synchronize({ database, ...sync, sendCreatedAsUpdated: true });
```

## Why

- **No backend.** WatermelonDB's sync protocol normally needs a server you write and run. Here the
  server is CloudKit: the user's private database, paid for by the user's iCloud storage.
- **End-to-end encrypted.** Every column goes to `CKRecord.encryptedValues`. Neither Apple nor you
  can read it.
- **Per-column merges.** Two devices edit different columns of the same row offline, and both
  edits survive, on pull (WatermelonDB's own merge) and on push (this package's merge over
  CloudKit's change tags).
- **Crash-safe tokens.** A pull's CloudKit token counts only once WatermelonDB has applied the
  changes. A crash fetches them again and never skips them.
- **Nothing extra to install.** This package imports nothing from WatermelonDB at runtime. It runs
  against your app's copy, so WatermelonDB is a peer dependency and the core
  `react-native-nitro-cloudkit` doesn't depend on it at all.

## Install

```sh
npm install react-native-nitro-cloudkit react-native-nitro-cloudkit-watermelondb
# already in your app: @nozbe/watermelondb, react-native-nitro-modules
```

Set up the core first: the Expo plugin, the App ID's iCloud and push capabilities, and the schema
deployed to Production before TestFlight. See the
[core README](../react-native-nitro-cloudkit/README.md#install).

## Use

```ts
import { synchronize } from '@nozbe/watermelondb/sync';
import { createCloudKit, createKeyValueTokenStore } from 'react-native-nitro-cloudkit';
import { createNativeAdapter } from 'react-native-nitro-cloudkit/native';
import { createWatermelonSync } from 'react-native-nitro-cloudkit-watermelondb';
import { MMKV } from 'react-native-mmkv';

const cloud = createCloudKit({
  adapter: createNativeAdapter(),
  containerIdentifier: 'iCloud.com.example.app',
  zoneName: 'Notes',
});

const sync = createWatermelonSync(cloud, {
  tokenStore: createKeyValueTokenStore(new MMKV()),
  tables: ['notes', 'tags'], // optional: default syncs every table
});

let running: Promise<void> | null = null;
export function syncNow() {
  // WatermelonDB rejects concurrent syncs: share the one in flight.
  running ??= synchronize({ database, ...sync, sendCreatedAsUpdated: true }).finally(() => {
    running = null;
  });
  return running;
}

cloud.onRemoteChange(() => void syncNow()); // another device changed something
```

Run `syncNow()` on launch, when the app returns to the foreground, after local writes (debounced),
and on `onRemoteChange`. A sync that fails rejects and leaves every local change pending in
WatermelonDB, so the next one sends it again.

### `createWatermelonSync(cloud, options)`

| Option           | Default                                             | Notes                                                                                                                                     |
| ---------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `tokenStore`     | required                                            | Persistent (`createKeyValueTokenStore(mmkv)`). Holds CloudKit tokens per pull.                                                            |
| `tokenKey`       | `nitro-cloudkit-watermelondb:<container>:<zone>`    | Where they live in the store.                                                                                                             |
| `tables`         | every table                                         | Tables to sync. Other tables' rows aren't uploaded (WatermelonDB still marks them synced), and pulled records of other types are skipped. |
| `codec`          | table = record type, `<table>.<id>`, JSON per field | Replace any part: record types, record names, value encoding.                                                                             |
| `conflictRounds` | `3`                                                 | Merge-and-resend rounds when the server has newer versions. Then the sync fails.                                                          |
| `onZoneDeleted`  | none                                                | The user deleted iCloud data or another device called `deleteAllData()`.                                                                  |

Pass **`sendCreatedAsUpdated: true`** to `synchronize`. CloudKit doesn't say whether a record is
new to this device, so every pulled record comes as an update, which WatermelonDB then creates or
updates.

## How it maps

| WatermelonDB          | CloudKit                                                       |
| --------------------- | -------------------------------------------------------------- |
| table `notes`         | record type `notes`                                            |
| row `id` `a1b2`       | record name `notes.a1b2` (not encrypted, so ids stay opaque)   |
| column `title`        | encrypted field `title`, value as JSON (`"Trip"`, `3`, `true`) |
| `_status`, `_changed` | never uploaded                                                 |
| `lastPulledAt`        | key to the CloudKit token kept in `tokenStore`                 |
| deleted row           | deleted record                                                 |

**Pull.** Changes since the token stored under `lastPulledAt` (everything on first sync), with a
new `timestamp`. The new token is kept next to the confirmed one until WatermelonDB passes that
timestamp back, which it does only after applying.

**Push.** Created and updated rows are saved with all their columns, and deleted rows are deleted.
If another device saved a row since this device last saw it, CloudKit refuses with its newer
version. The package then takes the server's values, puts this device's changed columns (from
`_changed`) on top, and sends again. A per-record failure such as `record_too_large` fails the
sync, and WatermelonDB keeps the row pending.

## Limits

- **iOS 17+ and macOS 14+** through the native adapter. On Android the adapter reports
  `isSupported: false`, so run sync only where it's true. See
  [Android](../react-native-nitro-cloudkit/README.md#android).
- **1 MB per row.** Keep files out of columns. Store them with `cloud.putAsset` and keep the asset
  name in a column.
- No WatermelonDB **migration syncs** (`migrationsEnabledAtVersion`). A new column arrives with the
  next save of each row.
- Record types follow table names: start with a letter, then letters, digits and `_`.
- Turbo login (`unsafeTurbo`) isn't supported.

## Tests

The tests run WatermelonDB's real `synchronize()` on LokiJS databases, two devices over one
in-memory CloudKit (`react-native-nitro-cloudkit/memory`). They cover creates, edits and deletes
across devices, per-column merges on pull and on push, failures that leave changes pending,
refetching changes that weren't applied, table filters and zone deletion.

```sh
pnpm --filter react-native-nitro-cloudkit-watermelondb test
```

## License

MIT
