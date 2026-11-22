# Agent instructions

Read `docs/architecture.md` before changing behaviour. The public API is the TypeScript core and its
adapter entry points (`/native`, `/memory`, `/record-store`). Nitro specs are private to the native
adapter. Keep the core free of native imports.

Follow Margelo's build-nitro-modules guidance:

- Specs in `src/specs/*.nitro.ts`, with named types in their own files.
- Run `pnpm specs` after a spec change and commit `nitrogen/generated`.
- Swift: one type per file. `ios/Core/` never imports Nitro (it also builds for macOS 14 hosts); `ios/Nitro/` holds the `Hybrid*` classes and the struct mapping. Extensions live in `ios/Core/Extensions/Type+operation.swift`.
- Kotlin classes annotated `@Keep @DoNotStrip`.

Use pnpm, catalog versions and the committed lockfile. Before claiming readiness, run the relevant
tests plus `pnpm check` and `pnpm pack:check`. Report unit tests, prebuild, native compilation and
device or iCloud behaviour separately, and never infer one from another.

Commit per meaningful change with a conventional, lowercase subject. Stage explicit paths. Never
commit generated native projects (`apps/*/ios`, `apps/*/android`) or build output.

Every pull request answers `.github/pull_request_template.md` from evidence. Do not publish, tag,
push or create external resources without the owner's authorization. Never log record contents,
tokens or file paths.
