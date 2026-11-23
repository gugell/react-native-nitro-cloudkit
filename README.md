# react-native-nitro-cloudkit

CloudKit for React Native on Apple's `CKSyncEngine`. Your app gets a sync server without running
one: each user's data lives in their own iCloud private database, end-to-end encrypted, synced by
the engine Apple's own apps use.

![Demo: a note saved on an iPhone reaches the Mac encrypted, offline edits on both merge per field](docs/demo/demo.gif)

[Watch the demo in full resolution (MP4)](docs/demo/demo.mp4)

## Why

- **No backend.** No server, auth, database hosting or per-user bill. Storage counts against the
  user's iCloud.
- **Private by default.** Every field goes to `CKRecord.encryptedValues`. You can't read user
  data, and neither can Apple.
- **Apple's sync engine.** CKSyncEngine schedules, batches, retries and wakes the app on silent
  pushes, and this package exposes it as a small, typed TypeScript API through Nitro (JSI).
- **Incremental, conflict-aware.** Pull changes since a token, and push over change tags, so a
  newer server version comes back to merge instead of being overwritten.
- **Testable anywhere.** An in-memory CloudKit with the same semantics runs your unit tests, web
  previews and Android builds, simulates several devices, and injects failures.
- **Expo-ready.** A config plugin writes the entitlements and merges with iCloud Documents.

```ts
import { createCloudKit } from 'react-native-nitro-cloudkit';
import { createNativeAdapter } from 'react-native-nitro-cloudkit/native';

const cloud = createCloudKit({
  adapter: createNativeAdapter(),
  containerIdentifier: 'iCloud.com.example.app',
  zoneName: 'Notes',
});
const { modified, token } = await cloud.fetchChanges(null);
```

## Packages

| Package                                                                                                   | What                                                                                                         |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [`react-native-nitro-cloudkit`](packages/react-native-nitro-cloudkit/README.md)                           | Core client, adapters (`native`, `memory`), the `record-store` port and the Expo config plugin               |
| [`react-native-nitro-cloudkit-watermelondb`](packages/react-native-nitro-cloudkit-watermelondb/README.md) | Sync a WatermelonDB database through CloudKit. Separate, so apps without WatermelonDB install nothing for it |

| Platform    | Support                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| iOS 17+     | Native adapter (CKSyncEngine)                                                                                                                                |
| macOS 14+   | Native adapter through react-native-macos                                                                                                                    |
| Android/web | No CloudKit: memory adapter for development and tests. See [Android](packages/react-native-nitro-cloudkit/README.md#android) for the options and a checklist |

> **Status: 0.x.** Verified against live iCloud (Production environment) with a release build of a
> real app on iPhone. See [Status](packages/react-native-nitro-cloudkit/README.md#status).

## Repository

| Path                                                | What                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `packages/react-native-nitro-cloudkit`              | The npm package: spec (`src/specs/*.nitro.ts`), TS core and adapters, Swift, Kotlin, Expo plugin |
| `packages/react-native-nitro-cloudkit-watermelondb` | WatermelonDB sync over the core, tested on WatermelonDB's real `synchronize()`                   |
| `apps/example`                                      | Expo app: native adapter on iOS 17+, memory adapter elsewhere                                    |
| `docs/`                                             | [Architecture](docs/architecture.md), [releasing](docs/releasing.md), [demo video](docs/demo/)   |
| `scripts/`                                          | Pack, generated-code, path and release-script checks                                             |

The layout follows Margelo's [build-nitro-modules](https://github.com/margelo/react-native-skills/tree/main/skills/build-nitro-modules)
skill.

## Develop

```sh
pnpm install
pnpm specs            # nitrogen → packages/react-native-nitro-cloudkit/nitrogen/generated (committed)
pnpm check            # build, typecheck, lint, format, lockfile, paths, release script, tests
pnpm pack:check       # pack → install into a clean project → import
pnpm example ios      # or: pnpm example android / web
node scripts/render-demo.mjs  # re-render docs/demo (Chrome + ffmpeg)
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
