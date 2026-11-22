# Contributing

Use Node.js 24+ and the pnpm version pinned in `package.json`.

```sh
pnpm install
pnpm check
pnpm pack:check
```

Read [architecture](docs/architecture.md). Add tests that show the behaviour you changed: the memory
adapter covers most client behaviour without native code. After editing a `*.nitro.ts` spec, run
`pnpm specs` and commit `nitrogen/generated` (`pnpm generated:check` verifies it).

Native changes: build the example app on the platform you touched:

- iOS: `pnpm example prebuild --platform ios`, `pod install`, then a simulator build.
- Android: `pnpm example prebuild --platform android`, then `./gradlew :app:assembleDebug`.

Record what you could not build. CloudKit behaviour needs a real iCloud account and a container you
own. Say whether you ran it.

Use conventional commit messages. Explain the problem, the resulting behaviour, the validation you
performed, and the remaining limits. Never commit credentials. Releases follow
[docs/releasing.md](docs/releasing.md). Issues and pull requests:
<https://github.com/gugell/react-native-nitro-cloudkit>.
