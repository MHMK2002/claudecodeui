# Desktop releases and automatic updates

CloudCLI Desktop uses GitHub Releases in `MHMK2002/claudecodeui` as its canonical public update source. Packaged apps check through `electron-updater`; browser and standalone-server installs keep the existing Git/NPM update path.

## Supported artifacts

| Platform | Architecture | Install artifacts | Update artifact |
| --- | --- | --- | --- |
| macOS | x64 | signed/notarized DMG | signed/notarized ZIP |
| macOS | arm64 | signed/notarized DMG | signed/notarized ZIP |
| Windows | x64 | signed NSIS EXE | signed NSIS EXE |
| Linux | x64 | AppImage | AppImage |

Every platform build embeds a matching local-server archive. The release also contains all four server archives and their SHA-256 sidecars for recovery downloads.

## Required GitHub Actions secrets

The release workflow deliberately fails when signing credentials are missing. Add these in repository **Settings → Secrets and variables → Actions**:

- `MACOS_CSC_LINK`: base64-encoded Developer ID Application `.p12` or a protected download URL.
- `MACOS_CSC_KEY_PASSWORD`: password for that certificate.
- `APPLE_ID`: Apple Developer account used for notarization.
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific Apple ID password.
- `APPLE_TEAM_ID`: Apple Developer Team ID.
- `WINDOWS_CSC_LINK`: base64-encoded trusted code-signing `.pfx` or a protected download URL.
- `WINDOWS_CSC_KEY_PASSWORD`: password for that certificate.
- `NPM_TOKEN`: required only while the NPM package remains part of the release.

Never put a PAT, certificate, or certificate password in source, workflow YAML, an update feed, or an app bundle.

## Release flow

1. Run the `Release` workflow with the version increment. Before mutation it requires a successful `push` CI run for the exact source SHA, then creates the version commit and stable tag, publishes NPM, and creates a **draft** GitHub release.
2. The workflow fetches the remote tag and `main`, verifies that the dereferenced tag commit is on remote `main`, and records that final commit SHA.
3. `Release` dispatches `CI` against the immutable tag with the exact SHA and a unique gate ID. It accepts only the matching `workflow_dispatch` run and waits for terminal success; mismatched, stale, failed, cancelled, skipped, or timed-out runs cannot open the gate.
4. Immediately before dispatching `Desktop Release`, the workflow fetches and verifies the remote tag and `main` again. It passes both the tag and required expected SHA and dispatches the workflow from the immutable tag ref.
5. Direct stable tag pushes also start `Desktop Release`; that entry path peels the event's exact tag object to its commit before pinning it. Manual dispatches require an explicit expected commit SHA.
6. `Desktop Release` dereferences the remote tag, requires it to equal the pinned SHA and be an ancestor of remote `main`, waits for a successful `push` or identity-checked `workflow_dispatch` CI run for that exact SHA, then re-fetches and revalidates immediately before the build matrix.
7. Native runners build the four targets from the pinned commit with one shared `version + commit SHA` build identity. Every build, metadata, and publish checkout uses that same resolved SHA.
8. The workflow verifies native signatures, notarization, package smoke tests, updater SHA-512 metadata, local-server archives, and architecture coverage.
9. Versioned binaries and checksums are uploaded first. `latest.yml`, `latest-mac.yml`, and `latest-linux.yml` are uploaded last.
10. Only after all uploads succeed is the draft published and marked latest. Drafts are invisible to the updater.

Assets are immutable: the workflow never uses `--clobber` and refuses to modify an already-published release. If a draft upload is interrupted, inspect it, delete the incomplete draft assets (or the draft), and manually rerun `Desktop Release` for the same existing tag.

## Runtime behavior

- Update checks start shortly after launch and repeat every four hours.
- Downloading happens in the background and exposes real byte/percentage progress.
- Installation requires the explicit `Restart and update` action.
- Before installation, Desktop stops the local server it owns even if “keep running” is enabled.
- If installer preparation or launch fails, Desktop restores only the owned workspace and enabled notifications stopped by that install attempt; recovery is idempotent and recovery diagnostics are redacted.
- Updater IPC is available only to the exact verified loopback workspace origin.
- Development/unpackaged Electron builds never contact the binary update service.
