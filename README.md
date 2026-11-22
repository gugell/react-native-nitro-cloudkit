# react-native-nitro-cloudkit

CloudKit for React Native on Apple's `CKSyncEngine`. It covers the private database, a custom zone,
end-to-end encrypted fields and assets, with a TypeScript core and pluggable adapters:

- **native**: CKSyncEngine through [Nitro](https://nitro.margelo.com), iOS 17+.
- **memory**: CloudKit's semantics in memory, for tests, web, Android and multi-device demos.
- **record-store**: the port of a last-writer-wins sync engine.

Includes an Expo config plugin that adds the CloudKit entitlements and merges with iCloud Documents.

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

**[Package documentation →](packages/react-native-nitro-cloudkit/README.md)**

> **Pre-release (0.x).** Tested in JS and compiled natively in CI. The native CKSyncEngine paths have
> not yet run against a live iCloud account.

## Repository

| Path                                   | What                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `packages/react-native-nitro-cloudkit` | The npm package: spec (`src/specs/*.nitro.ts`), TS core and adapters, Swift, Kotlin, Expo plugin |
| `apps/example`                         | Expo app: native adapter on iOS 17+, memory adapter elsewhere                                    |
| `docs/`                                | [Architecture](docs/architecture.md), [releasing](docs/releasing.md)                             |
| `scripts/`                             | Pack, generated-code, path and release-script checks                                             |

The layout follows Margelo's [build-nitro-modules](https://github.com/margelo/react-native-skills/tree/main/skills/build-nitro-modules)
skill.

## Develop

```sh
pnpm install
pnpm specs            # nitrogen → packages/react-native-nitro-cloudkit/nitrogen/generated (committed)
pnpm check            # build, typecheck, lint, format, lockfile, paths, release script, tests
pnpm pack:check       # pack → install into a clean project → import
pnpm example ios      # or: pnpm example android / web
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
