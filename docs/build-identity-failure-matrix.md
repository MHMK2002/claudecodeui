# Build identity and repair failure matrix

The canonical artifact is `.build-identity/build-identity.json` with exactly two
validated fields: `version` and `buildId`. Client and compiled-server builds copy
it byte-for-byte to `dist/build-identity.json` and
`dist-server/build-identity.json`; the service worker embeds the same buildId.
Every packaged consumer fails closed if a copy is missing, malformed,
synthetic, or inconsistent.

| Injection point | Filesystem outcome | Process/port outcome | User recovery |
| --- | --- | --- | --- |
| Empty or malformed package version/buildId | No distributable artifact is accepted | Server/Desktop do not start from an unidentified build | Rebuild with a valid identity |
| Canonical and `dist` identity differ | Bundle and Desktop staging fail | Existing server is untouched | Rebuild client and server from one build invocation |
| Health version/buildId mismatch on an owned server | Installed files remain available | PID, launch nonce, owner proof, process-start token, and origin are checked twice; the responding runtime accepts its private shutdown challenge, then the matching bundle starts | Automatic repair; terminal failure shows `Restart and repair` |
| Stale/forged marker, nonce mismatch, PID uncertainty, or alien listener | Marker is not trusted or rewritten | No signal is sent; matching server selects another loopback port | Workspace opens on the verified port, or Retry if startup fails |
| Concurrent Desktop open requests | No duplicate install writes | One in-process startup promise owns server selection and launch | All callers receive the same result |
| Missing/invalid checksum | Current installed runtime remains active | No archive process starts | `Restart and repair` after replacing the damaged bundle |
| Unsafe archive path, link, or special entry | Staged extraction is rejected and deleted | Current installed runtime remains untouched | Copy diagnostics and reinstall a valid Desktop build |
| Archive version/buildId/platform/architecture mismatch | Staged copy is rejected before activation | Current installed runtime remains untouched | Copy diagnostics and use a compatible bundle |
| New runtime fails post-launch health/identity | New process is stopped; staged activation is rolled back | Previous runtime is restored atomically when one existed | `Restart and repair`; diagnostics retain redacted startup logs |
| Desktop exits during archive activation | A restricted, validated journal retains only allowlisted stage/backup paths | The unconfirmed runtime is removed and the prior runtime is restored, including across a same-version rebuild | Automatic recovery followed by the normal compatibility check |
| Service-worker activation for a new build | Only the current application-owned cache remains | Existing tabs receive the new buildId and reload when mismatched | Network-first navigation; offline fallback never supplies old JS |
| API, health, WebSocket, Shell, or Voice request while offline | No runtime response is cached | Request fails normally; no stale server data is replayed | Contextual feature recovery |

Protected user data (`~/.cloudcli` databases, projects, credentials, task data,
schedule history, and Voice configuration) is outside server-runtime staging and
is never removed by identity repair. Diagnostics redact local paths and secrets.
