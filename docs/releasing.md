# Releasing

The npm package is `react-native-nitro-cloudkit`. The example app and the repository root stay private. The release flow follows [Margelo's release-it guidance](https://github.com/margelo/react-native-skills/blob/main/skills/build-nitro-modules/references/release-it-publishing.md) and VisionCamera's two-pass script. Publishing requires npm package ownership and trusted publishing configured as described below.

## Before publication

Run the checks on a clean checkout:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm generated:check
pnpm pack:check
```

CI's `ios` and `android` jobs build the example app natively; they must be green on the release commit. Review the tarball contents. Record native build results separately. Confirm the public repository URL, license, support channel, package name availability, and package metadata before publishing. Never publish placeholder owner/repository metadata.

## release-it

`pnpm release` runs `scripts/release.sh`, which releases in two passes and forwards its arguments to both, so they agree on the increment:

1. every package under `packages/*` publishes **itself** to npm — `git` and `github` are disabled in the package's own `release-it` block, whose `before:init` hook runs `pnpm check` and whose `after:bump` hook rebuilds `lib/` (the tarball is packed with `prepack`, which builds again);
2. the repository root makes **one** version bump commit, tag and GitHub release — `npm.publish` is disabled there, `@release-it/bumper` writes the new version into the package and the example app, and `@release-it/conventional-changelog` writes the package changelog.

The root pass allows a dirty working directory on purpose: the packages have already bumped their own `package.json` by the time it runs. Configuration lives in the `release-it` block of each `package.json`; there is no separate config file.

The script resolves `GITHUB_TOKEN` from the environment, then `GH_TOKEN`, then `gh auth token`, and fails with instructions rather than releasing without one. `pnpm release:dry-run` skips that requirement and rehearses offline — no registry, GitHub or upstream contact — while still computing the version, changelog and tag from local history. A dry run must not be described as publication.

The first real publication can retain the prepared version with `pnpm release --no-increment` after the remote and credentials are configured. Later releases choose a semver increment appropriate to the public API change. Breaking configuration changes require migration notes and a matching major version when applicable.

## Prerelease channels

Pass `--preRelease=<id>` to publish `0.2.0-alpha.0` instead of `0.2.0`. It flows through both passes, so the published version and the tag agree:

```sh
pnpm release:dry-run --preRelease=alpha
pnpm release --preRelease=alpha
```

Three behaviors make this usable as a channel rather than a one-off, all of them release-it's own:

- **The dist-tag follows the prerelease id.** `resolveTag` returns the id for a prerelease version, so `0.2.0-alpha.0` publishes under `alpha` and `npm install react-native-nitro-cloudkit` keeps resolving `latest`. Installing a prerelease is opt-in with `react-native-nitro-cloudkit@alpha`.
- **Re-running advances the prerelease.** The next version is computed from the version already in the manifest, so `0.2.0-alpha.0` becomes `0.2.0-alpha.1`, then `alpha.2`. Nothing needs to be passed to say "the next one".
- **The GitHub release is marked as a prerelease.** release-it sets `prerelease` from the version itself.

Do not pass an increment positionally alongside `--preRelease` unless you mean to force it. With no positional increment, the base comes from the conventional commits for the first prerelease and from the current prerelease afterwards — which is what makes the sequence advance. Passing `patch` pins the base to a patch bump every time.

Graduating to stable is a release with no `--preRelease`: from `0.2.0-alpha.1` an ordinary `pnpm release` publishes `0.2.0` to `latest`.

The manifests start at `0.0.0`, so the first ordinary release (the commits recommend a minor bump) publishes `0.1.0`.

### From the Release workflow

`workflow_dispatch` takes two inputs:

| Input        | Options                                      | Meaning                                                                                                                                 |
| ------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `increment`  | `auto`, `patch`, `minor`, `major`, `initial` | `auto` passes no positional increment and lets the conventional commits decide; `initial` publishes the version already in the manifest |
| `prerelease` | `none`, `alpha`, `beta`, `rc`                | Adds `--preRelease=<id>` and publishes under that dist-tag                                                                              |

For an alpha channel, choose `increment: auto` and `prerelease: alpha`, and run it again for each subsequent alpha. `initial` combined with a prerelease is rejected before anything runs: `initial` means "publish what the manifest says", so there is no increment to qualify.

`scripts/check-release-script.sh` covers this path, asserting that `--preRelease` reaches **both** passes — if only the package pass saw it, the registry would carry `alpha.0` while the tag said `0.2.0`.

## Connecting npm to GitHub Actions

The workflow already publishes through **npm trusted publishing** (OIDC). There is no `NPM_TOKEN`, and there is no 2FA prompt to work around: the job mints a short-lived, scoped credential for that one run. A token that cannot be exfiltrated from a log is the point — this is stronger than an automation token, not a way around the 2FA requirement.

What the workflow already does:

- `permissions: id-token: write` on the job, so GitHub will issue the OIDC token.
- `npm install --global npm@11`, because trusted publishing needs npm CLI 11.5.1 or newer and the runner's bundled npm can be older.
- `environment: npm`, which must match the environment named in the npm settings.
- `concurrency: npm-release`, so two releases cannot race the same version.

What has to be done once, outside this repository:

1. **Create the GitHub environment.** Repository → Settings → Environments → New environment, named exactly `npm`. Add required reviewers here if you want a human gate before publishing.
2. **Publish the package once by hand.** A trusted publisher is configured on a package's own settings page, which does not exist until the package does. This is the bootstrap step, and the only one that involves a credential.
3. **Configure the trusted publisher.** `https://www.npmjs.com/package/react-native-nitro-cloudkit/access` → Trusted publishing → GitHub Actions. Fill in the organization or user, the repository, the workflow filename (`release.yml`, the filename alone, not a path) and the environment (`npm`). npm does not validate these when you save them: a typo appears only as a failed publish.
4. **Lock the package down.** On the same page, select "Require two-factor authentication and disallow tokens". After this, OIDC is the only way to publish, and any token that leaks is useless.

For step 2, prefer a local `npm publish` where npm prompts for your OTP interactively — the credential never leaves your machine and nothing needs storing. Use a granular automation token only if you must publish from CI before trusted publishing exists, and revoke it immediately afterwards; it exists to cover one publish.

Never store npm or GitHub tokens in the repository, in a workflow file, or in this documentation.

Two failure modes worth recognizing:

- **`npm error need auth`** in the workflow — the trusted publisher is not configured, or the repository, workflow filename or environment does not match what npm has.
- **Published, but no provenance attestation** — the `repository` field in `package.json` must match the configured repository exactly (it is `git+https://github.com/gugell/react-native-nitro-cloudkit.git`). The package's `publishArgs` already pass `--provenance`. Check the first published version for a provenance badge.

Inspect the workflow and `scripts/release.sh` for the supported path; do not create a duplicate manual publish for the same version.

Use [release-it's npm documentation](https://github.com/release-it/release-it/blob/main/docs/npm.md) and [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers) when configuring credentials.

After publication, install the published version into a fresh Expo app, run validation and prebuild, verify the registry tarball and tag correspond to the release commit, and attach exact verification evidence to release notes.
