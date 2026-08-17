# Stale tool `Running` status investigation

## Trace

1. Session `a270328d-de30-45ec-bdff-12d2e67ad16e` is still present in
   `/api/providers/sessions/running` and maps to Codex thread
   `01a00a9a-e649-7f51-bcce-60981c51036f`.
2. The thread still has a live Codex process, so the blue session-level
   processing state is truthful while that process remains active.
3. Earlier tool cards in the same transcript still displayed `Running` even
   though later assistant messages proved those tools had finished.
4. The Codex runtime forwards tool events only after SDK `item.completed` and
   stores the terminal `status`, `output`, `exitCode`, `result`, or `error`
   directly on the normalized `tool_use` event.
5. `normalizedToChatMessages` previously derived completion only from a
   separate `tool_result`. Codex does not emit that separate row, so its
   terminal metadata was discarded and `deriveToolStatus(undefined)` returned
   `running` forever.
6. Successful status metadata was also deliberately hidden by `ToolRenderer`,
   preventing a terminal success label from appearing even when completion was
   known.

## Hypotheses and evidence

- **Confirmed:** the stale labels were caused by the frontend ignoring Codex's
  inline terminal tool metadata. The reproduction showed many earlier tools as
  `Running`, while their subsequent assistant messages and Codex event adapter
  proved execution had advanced past them.
- **Rejected:** the session registry alone caused the stale tool labels. The
  registry explains the session-level blue indicator, but individual tool
  status is derived independently from each normalized message.

## Resolution

- Convert terminal Codex `tool_use` metadata into the `toolResult` shape already
  consumed by the chat UI.
- Preserve `running`/`in_progress` as non-terminal.
- Map non-zero exit codes, failure statuses, and inline errors to `Error`.
- Display successful terminal status as the compact textual label `Done` beside
  the tool timestamp for both individual and grouped tool rows.

## Side effects

- Completed Codex Bash, file-change, MCP, and other tool rows can now expose
  their inline output through the existing result rendering path.
- Claude and other providers retain their existing paired
  `tool_use`/`tool_result` behavior.
- The session-level Running indicator remains independent and stays active
  while a provider process is genuinely running.

## Verification

- The regression tests first failed against the stale behavior and passed after
  the fix.
- A rebuilt live view of the reported session rendered 24 `Done`, 8 `Error`,
  0 `Running`, and 0 timestamp-only tool metadata rows.
- The session itself remained in the running endpoint because its Codex process
  still had an active `gh run watch` child; no process was stopped or rewritten
  as completed by the UI fix.
