# Sidebar session status investigation

## Trace

1. The reported session row rendered a pulsing green `role="status"` indicator.
2. Its accessible label was `Recently active session (last 10 minutes)`.
3. `SidebarProjectSessions` passes runtime execution through `isProcessing={activeSessions.has(session.id)}`.
4. `SidebarSessionItem` did not use `isProcessing` for the green dot. It showed that dot when the session was not processing but `sessionView.isActive` was true.
5. The running-sessions endpoint initially did not include the reported session while the green dot was visible, confirming that the dot represented recency rather than execution.

## Hypothesis and evidence

The green pulsing recency indicator was visually interpreted as a running/completed status. This was confirmed by its DOM classes (`animate-pulse bg-green-500`) and by the source condition that explicitly excluded processing sessions.

## Resolution

- Show a blue status dot only when `isProcessing` is true.
- Derive an explicit waiting state from actionable `permission_request` events, including `AskUserQuestion`.
- Show that waiting state in amber and keep it after the session is opened; only provider work, cancellation, or completion clears it.
- Show other runtime processing in blue, even when the session also has unread background activity.
- Show non-running attention state in amber.
- Do not render a status dot for recent activity alone.
- Keep tooltip and accessible text so status does not rely only on color.

## Side effects

- Recently active but idle sessions no longer have a left-side status dot; their relative age remains visible.
- Existing processing spinners remain unchanged.
- Provider lifecycle events are now reflected in frontend session activity; backend behavior is unchanged.
