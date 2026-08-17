# Full Product Journey Discovery & UX Audit

Audit date: 2026-08-16  
Product: CloudCLI Desktop / standalone web client  
Audit basis: reachable UI source, route and event wiring, Electron launcher/app/tray code, feature flags, service worker, responsive runtime traversal at desktop and 320 px, Storybook/test fixtures, and automated UX/accessibility checks.

## Scope and notation

- [D] is reachable in the default Desktop product.
- [W] is reachable only in standalone web or authenticated LAN/remote mode.
- [C] is Cloud-feature-gated and disabled in the default build.
- [P] is a core-owned plugin boundary whose inner journey is supplied dynamically by a third party.
- [O] is implemented or referenced but has no reachable product entry.
- STEP is a stable surface or durable state. Loading, empty, error, success, validation, permission, and action forks are BRANCH nodes below it.
- Cross-journey destinations are named explicitly. Browser/OS destinations are exits because the product no longer controls the path.

Discovery was completed before any evaluative finding below was written.

# Phase 1 — Exhaustive Journey Discovery

## Discovery coverage ledger

| Required discovery surface | Discovered product paths |
| --- | --- |
| Navigation menus | Native app/tray J06; expanded/collapsed/mobile sidebar J07; Settings groups J25–J31 |
| Header | Main workspace tabs/title/drawer/export S022; Git header S067/S073; Shell header S063–S065 |
| Sidebar | Project/session hierarchy, create/search/actions S023–S025/S034–S038; mobile variant S024 |
| Footer | Settings/About/product links and conditional Report Issue S130/J33; no Join Community path |
| Tabs | Main Chat/Files/Shell/Git/Tasks S022; Settings S108; Agents sub-tabs S117–S121; project drawer S096–S098 |
| Dropdowns/menus | Command palette S026; provider/model/permission menus S039–S043; copy/export S050–S051; Git branch/actions S073/S078–S080 |
| Context/overflow menus | Project/session S036–S037; file/folder S056; task/card S090; schedule S100–S102; branch S080 |
| Modals/overlays | Folder browser S029; provider login S013/S118; Settings S108; MCP S123; Skills S125; Browser fullscreen S135; updates S141–S143; Report Issue S146–S149 |
| Drawers | Canonical project drawer and Tasks/Schedules tabs S096–S098; mobile sidebar S024 |
| Search | Project/session S025; command palette S026; Files S055; Tasks S088; branches S078; Skills S125 |
| Filters/sort | File view controls S055; Task toolbar/drawer S088/S097; plugin/skill catalog controls S125/S137 |
| Settings | Appearance/Notifications J25; Voice J26; Agents J27; MCP/Skills J28; API/Git/Tasks/About J29; Browser J30; Plugins J31 |
| Profile/account | Standalone setup/login S009–S010; provider profiles S117–S120; missing standalone logout branch J03-B15 |
| Empty states | Projects/sessions S034/S039; Files S054; Tasks S082/S089; Schedules S099; MCP/Skills S122/S125; Plugins S137 |
| Error states | Launcher S003; auth S011; wizard S028–S033; Chat S040/S044; Files S054/S058/S062; Shell S065; Git S072/S074–S077; Tasks S086/S089/S091; Settings S111/S116/S120/S131/S136/S140; updates S143; route fallback S154/S158 |
| Success states | Workspace handoff S004; project result S033; exports S051; uploads/mutations S057–S058; save/commit S059/S071; Task setup/start S086/S092; schedule S101/S102/S107; Voice S114/S116; update S144 |
| Onboarding | Optional provider connections, provider terminal, Git configuration and completion S012–S015 |
| Authentication | Mode-aware resolver, standalone setup/login, Desktop browser recovery S008–S011; point-of-use provider auth S041/S118 |
| Account flows | Initial account and login J03; provider accounts/profiles J27; missing product Logout recorded as orphan capability |
| Notifications | Settings/permission S110; service-worker existing/new client click S155–S156 |
| Deep links | Root S150; session canonicalization/archive/fallback S151–S154; subagent S153; notification routes S155–S156 |
| Mobile navigation | 320 px header/sidebar S022/S024; drawer S096; terminal selection S066; compact Chat/Tasks/Settings/Skills/Browser/Plugins controls |
| Desktop navigation | Launcher/native commands J01/J06; docked sidebar S023/S024; docked project drawer S096; main workspace tabs S022 |
| Offline | Service-worker raw navigation fallback S157 |
| Feature-gated paths | Cloud environments J05 [C]; Hosted/Pro have no default entry; Report Issue conditionally absent; Tasks command mismatch mapped |
| Dynamically installed paths | Plugin core mount, plugin-defined inner CTA boundary, failure and return S137–S140 [P] |
| Orphan/unreachable paths | Product logout caller, SettingsMainTabs, skill removal UI, and default-disabled Cloud surfaces |

## Discovery boundary

All core-owned clickable controls, route entries, responsive variants, and state branches found in the inspected product are represented in the tree. Plugin-defined content after S139 cannot be enumerated before a specific plugin bundle is installed; the host mount, failure, external handoff, and return paths are fully represented. Cloud J05 is source-mapped but runtime-gated off in the default product. These boundaries are not treated as missing default journeys.

# Phase 2 — Complete Journey Tree

ROOT

├── [JOB JOB-01] Enter, authenticate, and configure the product
│   ├── [JOURNEY J01] Desktop local launch [D]
│   │   ├── [ENTRY J01-E01] Launch the installed Desktop application
│   │   ├── [ENTRY J01-E02] Reopen the launcher after closing or hiding the workspace
│   │   ├── [STEP S001] Desktop launcher — Local ready state
│   │   │   ├── [BRANCH J01-B01] Open Local Workspace → S002
│   │   │   ├── [BRANCH J01-B02] Open in browser → S002, then external browser
│   │   │   ├── [BRANCH J01-B03] Local Settings → J02/S005
│   │   │   └── [BRANCH J01-B04] Close window → native lifecycle S021
│   │   ├── [STEP S002] Local-server startup progress
│   │   │   ├── [BRANCH J01-B05] Starting local server → Checking compatibility → Opening workspace
│   │   │   ├── [BRANCH J01-B06] Compatible server and identity → S004
│   │   │   ├── [BRANCH J01-B07] Startup/server failure → S003
│   │   │   └── [BRANCH J01-B08] Copy diagnostics → remain on S002
│   │   ├── [STEP S003] Startup failure / compatibility repair
│   │   │   ├── [BRANCH J01-B09] Retry → S002
│   │   │   ├── [BRANCH J01-B10] Identity mismatch → Restart and repair → S002
│   │   │   ├── [BRANCH J01-B11] Copy diagnostics → clipboard feedback
│   │   │   └── [BRANCH J01-B12] Repeated failure → remain with logs
│   │   ├── [STEP S004] Local workspace handoff
│   │   │   ├── [BRANCH J01-B13] Embedded Desktop view → J07/S022
│   │   │   ├── [BRANCH J01-B14] Browser handoff → J03/S008
│   │   │   └── [BRANCH J01-B15] Expired one-time browser bootstrap → J03/S011
│   │   ├── [EXIT J01-X01] Local workspace opened
│   │   ├── [EXIT J01-X02] External browser opened
│   │   ├── [EXIT J01-X03] App quit/closed
│   │   └── [EXIT J01-X04] User abandons unresolved startup
│   │
│   ├── [JOURNEY J02] Desktop configuration and LAN access [D]
│   │   ├── [ENTRY J02-E01] Local Settings from launcher S001
│   │   ├── [ENTRY J02-E02] Desktop settings command from native menu/tray
│   │   ├── [STEP S005] Desktop Local Settings sheet
│   │   │   ├── [BRANCH J02-B01] Inspect local port/data/runtime information
│   │   │   ├── [BRANCH J02-B02] Change local options → validation remains on S005
│   │   │   ├── [BRANCH J02-B03] Enable LAN/remote access → S006
│   │   │   └── [BRANCH J02-B04] Close/cancel → launcher S001
│   │   ├── [STEP S006] LAN authentication configuration
│   │   │   ├── [BRANCH J02-B05] LAN off → passwordless loopback-only mode
│   │   │   ├── [BRANCH J02-B06] LAN on → authentication credentials required
│   │   │   ├── [BRANCH J02-B07] Invalid/missing credentials → inline validation
│   │   │   └── [BRANCH J02-B08] Valid change → S007
│   │   ├── [STEP S007] Apply configuration / restart state
│   │   │   ├── [BRANCH J02-B09] Apply and restart → startup S002
│   │   │   ├── [BRANCH J02-B10] Restart succeeds → workspace S004
│   │   │   ├── [BRANCH J02-B11] Restart fails → repair S003
│   │   │   └── [BRANCH J02-B12] Cancel → S005 with prior runtime unchanged
│   │   ├── [EXIT J02-X01] Return to launcher without changes
│   │   ├── [EXIT J02-X02] Restart into local workspace
│   │   └── [EXIT J02-X03] Restart into authenticated LAN mode
│   │
│   ├── [JOURNEY J03] Standalone authentication and session recovery [W]
│   │   ├── [ENTRY J03-E01] Open the standalone/LAN web URL
│   │   ├── [ENTRY J03-E02] Open Desktop in an external browser
│   │   ├── [ENTRY J03-E03] Return with an expired or invalid session
│   │   ├── [STEP S008] Protected-route authentication resolver
│   │   │   ├── [BRANCH J03-B01] Loading auth/runtime status → remain on S008
│   │   │   ├── [BRANCH J03-B02] Desktop-local bootstrap succeeds → J07/S022
│   │   │   ├── [BRANCH J03-B03] First standalone user needed → S009
│   │   │   ├── [BRANCH J03-B04] Existing unauthenticated user → S010
│   │   │   └── [BRANCH J03-B05] Desktop browser bootstrap invalid → S011
│   │   ├── [STEP S009] Initial administrator setup
│   │   │   ├── [BRANCH J03-B06] Enter username/password/confirmation
│   │   │   ├── [BRANCH J03-B07] Validation or server error → preserve form
│   │   │   └── [BRANCH J03-B08] Create account succeeds → onboarding S012
│   │   ├── [STEP S010] Standalone login
│   │   │   ├── [BRANCH J03-B09] Submit credentials
│   │   │   ├── [BRANCH J03-B10] Invalid credentials/network error → inline error
│   │   │   └── [BRANCH J03-B11] Login succeeds → onboarding S012 or workspace S022
│   │   ├── [STEP S011] Desktop browser session recovery
│   │   │   ├── [BRANCH J03-B12] Reopen via Desktop “Open in browser” → J01/S001
│   │   │   ├── [BRANCH J03-B13] Retry current bootstrap → S008
│   │   │   └── [BRANCH J03-B14] Recovery fails → remain with guidance
│   │   ├── [BRANCH J03-B15] [O] AuthContext logout exists, but standalone workspace exposes no logout/profile control
│   │   ├── [EXIT J03-X01] Authenticated workspace
│   │   ├── [EXIT J03-X02] Return to Desktop launcher for a new browser session
│   │   └── [EXIT J03-X03] Abandon login/recovery
│   │
│   ├── [JOURNEY J04] First-run onboarding and provider connection [D/W]
│   │   ├── [ENTRY J04-E01] First successful local or standalone authentication
│   │   ├── [ENTRY J04-E02] Provider connection action during onboarding
│   │   ├── [STEP S012] Agent Connections onboarding step
│   │   │   ├── [BRANCH J04-B01] Inspect Claude/Codex/Cursor/OpenCode cards and statuses
│   │   │   ├── [BRANCH J04-B02] Login on a provider → S013
│   │   │   ├── [BRANCH J04-B03] Refresh status after terminal closes
│   │   │   └── [BRANCH J04-B04] Continue without provider → S014
│   │   ├── [STEP S013] Provider CLI login terminal dialog
│   │   │   ├── [BRANCH J04-B05] Provider login command runs and streams output
│   │   │   ├── [BRANCH J04-B06] Success → close and refresh S012
│   │   │   ├── [BRANCH J04-B07] Failure → retry or close to S012
│   │   │   └── [BRANCH J04-B08] Cancel/close → S012
│   │   ├── [STEP S014] Git configuration onboarding step
│   │   │   ├── [BRANCH J04-B09] Enter optional Git name/email
│   │   │   ├── [BRANCH J04-B10] Save configuration → S015
│   │   │   └── [BRANCH J04-B11] Skip → S015
│   │   ├── [STEP S015] Onboarding completion
│   │   │   ├── [BRANCH J04-B12] Complete Setup → refresh onboarding state
│   │   │   ├── [BRANCH J04-B13] Completion succeeds → J07/S022
│   │   │   └── [BRANCH J04-B14] Completion fails → remain/retry
│   │   ├── [EXIT J04-X01] Workspace entered
│   │   └── [EXIT J04-X02] Onboarding abandoned
│   │
│   ├── [JOURNEY J05] Cloud environment management [C]
│   │   ├── [ENTRY J05-E01] Cloud launcher navigation when features.cloud is enabled
│   │   ├── [ENTRY J05-E02] Cloud environment refresh/deep action in a Cloud-enabled build
│   │   ├── [STEP S016] Cloud environments list
│   │   │   ├── [BRANCH J05-B01] Loading → list/empty/error
│   │   │   ├── [BRANCH J05-B02] Refresh environments
│   │   │   ├── [BRANCH J05-B03] Select environment → S018
│   │   │   └── [BRANCH J05-B04] Create/add environment → S017
│   │   ├── [STEP S017] Cloud environment configuration
│   │   │   ├── [BRANCH J05-B05] Enter endpoint/auth/configuration
│   │   │   ├── [BRANCH J05-B06] Validation/auth failure → remain
│   │   │   ├── [BRANCH J05-B07] Save succeeds → S016
│   │   │   └── [BRANCH J05-B08] Cancel → S016
│   │   ├── [STEP S018] Cloud environment start/open state
│   │   │   ├── [BRANCH J05-B09] Start/connect progress
│   │   │   ├── [BRANCH J05-B10] Ready → open hosted workspace
│   │   │   ├── [BRANCH J05-B11] Failure → retry/settings
│   │   │   └── [BRANCH J05-B12] Stop/disconnect → S016
│   │   ├── [EXIT J05-X01] Hosted workspace opened
│   │   ├── [EXIT J05-X02] Return to local launcher
│   │   └── [EXIT J05-X03] Cloud connection abandoned
│   │
│   └── [JOURNEY J06] Native application and tray commands [D]
│       ├── [ENTRY J06-E01] macOS/Windows/Linux application menu
│       ├── [ENTRY J06-E02] System tray icon/menu
│       ├── [ENTRY J06-E03] Window close/minimize/reopen event
│       ├── [STEP S019] Native application menu
│       │   ├── [BRANCH J06-B01] Show/open workspace → J01/S004
│       │   ├── [BRANCH J06-B02] Desktop settings → J02/S005
│       │   ├── [BRANCH J06-B03] Check for updates → J32/S141
│       │   └── [BRANCH J06-B04] Quit → application exit
│       ├── [STEP S020] System tray menu
│       │   ├── [BRANCH J06-B05] Open/Show CloudCLI → workspace or launcher
│       │   ├── [BRANCH J06-B06] Local Settings → J02/S005
│       │   ├── [BRANCH J06-B07] Update command → J32/S141
│       │   └── [BRANCH J06-B08] Quit
│       ├── [STEP S021] Window lifecycle
│       │   ├── [BRANCH J06-B09] Close hides or closes according to platform behavior
│       │   ├── [BRANCH J06-B10] Tray/dock reopen restores prior surface
│       │   └── [BRANCH J06-B11] External URL opens in system browser
│       ├── [EXIT J06-X01] Return to active product surface
│       ├── [EXIT J06-X02] External browser
│       └── [EXIT J06-X03] Application quit
│
├── [JOB JOB-02] Find, create, and manage projects and sessions
│   ├── [JOURNEY J07] Workspace navigation, search, and command palette [D/W]
│   │   ├── [ENTRY J07-E01] Successful launcher/auth/onboarding handoff
│   │   ├── [ENTRY J07-E02] Root route /
│   │   ├── [ENTRY J07-E03] Keyboard shortcut for the command palette
│   │   ├── [ENTRY J07-E04] Mobile Open menu control
│   │   ├── [STEP S022] Main workspace shell and header
│   │   │   ├── [BRANCH J07-B01] Chat/Files/Shell/Git/Tasks main tabs
│   │   │   ├── [BRANCH J07-B02] Project/session title and active context
│   │   │   ├── [BRANCH J07-B03] Project drawer handle → J22/S096
│   │   │   ├── [BRANCH J07-B04] Responsive desktop → mobile header
│   │   │   └── [BRANCH J07-B05] Main error boundary → J34/S158
│   │   ├── [STEP S023] Expanded desktop sidebar
│   │   │   ├── [BRANCH J07-B06] Projects and nested sessions → J09
│   │   │   ├── [BRANCH J07-B07] Search sessions → S025
│   │   │   ├── [BRANCH J07-B08] New project → J08/S027
│   │   │   ├── [BRANCH J07-B09] New session → J10/S042
│   │   │   ├── [BRANCH J07-B10] Settings → J25/S108
│   │   │   ├── [BRANCH J07-B11] Schedules/project tools → J22/J23
│   │   │   └── [BRANCH J07-B12] Collapse → S024
│   │   ├── [STEP S024] Collapsed desktop sidebar / mobile navigation drawer
│   │   │   ├── [BRANCH J07-B13] Desktop icon destinations mirror S023
│   │   │   ├── [BRANCH J07-B14] Expand desktop sidebar → S023
│   │   │   ├── [BRANCH J07-B15] Mobile hamburger opens overlay drawer
│   │   │   ├── [BRANCH J07-B16] Select destination closes mobile drawer
│   │   │   └── [BRANCH J07-B17] Backdrop/close control dismisses mobile drawer
│   │   ├── [STEP S025] Sidebar project/session search
│   │   │   ├── [BRANCH J07-B18] Type query → filtered projects/sessions
│   │   │   ├── [BRANCH J07-B19] Select result → J09/S034 or S035
│   │   │   └── [BRANCH J07-B20] Clear/no results → S023
│   │   ├── [STEP S026] Command palette
│   │   │   ├── [BRANCH J07-B21] Search commands and keyboard-select
│   │   │   ├── [BRANCH J07-B22] Go to Chat/Files/Shell/Git/Tasks
│   │   │   ├── [BRANCH J07-B23] Create project/session and open Settings
│   │   │   ├── [BRANCH J07-B24] Tasks-disabled command still shown → redirects to Chat
│   │   │   └── [BRANCH J07-B25] Escape/selection returns focus
│   │   ├── [EXIT J07-X01] Destination journey opened
│   │   ├── [EXIT J07-X02] Navigation dismissed, current context retained
│   │   └── [EXIT J07-X03] User loses context or abandons on navigation failure
│   │
│   ├── [JOURNEY J08] Create or clone a project [D/W]
│   │   ├── [ENTRY J08-E01] New Project from expanded/collapsed/mobile sidebar
│   │   ├── [ENTRY J08-E02] New Project from command palette
│   │   ├── [ENTRY J08-E03] Project empty-state CTA
│   │   ├── [STEP S027] Project wizard — choose source mode
│   │   │   ├── [BRANCH J08-B01] Open existing folder → S028
│   │   │   ├── [BRANCH J08-B02] Clone repository → S030
│   │   │   ├── [BRANCH J08-B03] Continue disabled until mode selected
│   │   │   └── [BRANCH J08-B04] Cancel → prior workspace
│   │   ├── [STEP S028] Existing-folder configuration
│   │   │   ├── [BRANCH J08-B05] Enter/paste path
│   │   │   ├── [BRANCH J08-B06] Browse → S029
│   │   │   ├── [BRANCH J08-B07] Invalid/unwritable/duplicate path → contextual recovery
│   │   │   └── [BRANCH J08-B08] Valid path → Review S032
│   │   ├── [STEP S029] Folder browser dialog
│   │   │   ├── [BRANCH J08-B09] Navigate parent/folders
│   │   │   ├── [BRANCH J08-B10] Select folder → S028
│   │   │   ├── [BRANCH J08-B11] Permission/loading/server failure → retry/choose another
│   │   │   └── [BRANCH J08-B12] Cancel → S028
│   │   ├── [STEP S030] Clone repository configuration
│   │   │   ├── [BRANCH J08-B13] Enter repository URL and destination
│   │   │   ├── [BRANCH J08-B14] Invalid URL/non-empty destination/missing Git/offline → recovery
│   │   │   ├── [BRANCH J08-B15] Private/auth failure → disclose credentials S031
│   │   │   └── [BRANCH J08-B16] Valid configuration → Review S032
│   │   ├── [STEP S031] Clone credential / GitHub authentication disclosure
│   │   │   ├── [BRANCH J08-B17] Use saved credential/profile
│   │   │   ├── [BRANCH J08-B18] Add/change credential
│   │   │   ├── [BRANCH J08-B19] Authentication failure → preserve URL/destination
│   │   │   └── [BRANCH J08-B20] Retry validation → S030/S032
│   │   ├── [STEP S032] Project operation review
│   │   │   ├── [BRANCH J08-B21] Review exact local registration/canonical destination
│   │   │   ├── [BRANCH J08-B22] Back → S028 or S030
│   │   │   ├── [BRANCH J08-B23] Open project → S033
│   │   │   └── [BRANCH J08-B24] Clone repository → S033
│   │   ├── [STEP S033] Register/clone progress and result
│   │   │   ├── [BRANCH J08-B25] Staged progress with attempt ID
│   │   │   ├── [BRANCH J08-B26] Cancel clone → scoped cleanup and S030
│   │   │   ├── [BRANCH J08-B27] Success → J09/S034 then Chat/Files
│   │   │   ├── [BRANCH J08-B28] Structured failure → matching retry/change action
│   │   │   └── [BRANCH J08-B29] Partial cleanup failure → diagnostics/recovery
│   │   ├── [EXIT J08-X01] New project selected in workspace
│   │   ├── [EXIT J08-X02] Wizard cancelled to prior context
│   │   └── [EXIT J08-X03] Clone/registration abandoned after failure
│   │
│   └── [JOURNEY J09] Project and session lifecycle [D/W]
│       ├── [ENTRY J09-E01] Project/session item in sidebar
│       ├── [ENTRY J09-E02] Sidebar search result
│       ├── [ENTRY J09-E03] Project or session overflow/context menu
│       ├── [ENTRY J09-E04] Session deep link
│       ├── [STEP S034] Project selection and expansion
│       │   ├── [BRANCH J09-B01] Select project → restore/select session
│       │   ├── [BRANCH J09-B02] Expand/collapse sessions
│       │   ├── [BRANCH J09-B03] Empty project → create first session
│       │   └── [BRANCH J09-B04] Loading/error → retry/refresh
│       ├── [STEP S035] Session selection and loading
│       │   ├── [BRANCH J09-B05] Select session → Chat S043
│       │   ├── [BRANCH J09-B06] Delayed history → skeleton
│       │   ├── [BRANCH J09-B07] Load failure/unknown → fallback J34/S154
│       │   └── [BRANCH J09-B08] Active-session title/route updates
│       ├── [STEP S036] Project actions menu
│       │   ├── [BRANCH J09-B09] Rename project → browser prompt → refresh
│       │   ├── [BRANCH J09-B10] Refresh project/sessions
│       │   ├── [BRANCH J09-B11] Delete/remove project → browser confirm
│       │   └── [BRANCH J09-B12] Create session or open project path-related action
│       ├── [STEP S037] Session actions menu
│       │   ├── [BRANCH J09-B13] Rename → browser prompt
│       │   ├── [BRANCH J09-B14] Delete → browser confirm and fallback selection
│       │   ├── [BRANCH J09-B15] Fork/export/copy ID → J12
│       │   └── [BRANCH J09-B16] Refresh/reload session
│       ├── [STEP S038] Lifecycle feedback and fallback selection
│       │   ├── [BRANCH J09-B17] Mutation succeeds → refresh list/route
│       │   ├── [BRANCH J09-B18] Mutation fails → alert or console-only path
│       │   ├── [BRANCH J09-B19] Deleted active item → select another/root
│       │   └── [BRANCH J09-B20] Archived project synthesized from deep link → J34/S152
│       ├── [EXIT J09-X01] Project/session context active
│       ├── [EXIT J09-X02] Item removed and fallback selected
│       └── [EXIT J09-X03] User abandons failed mutation
│
├── [JOB JOB-03] Collaborate with an AI provider
│   ├── [JOURNEY J10] Prepare a chat and provider [D/W]
│   │   ├── [ENTRY J10-E01] New session from sidebar/palette/project empty state
│   │   ├── [ENTRY J10-E02] Chat tab with no active session
│   │   ├── [ENTRY J10-E03] Provider/model/permission composer menus
│   │   ├── [STEP S039] Chat/provider empty state
│   │   │   ├── [BRANCH J10-B01] No project → choose/create project
│   │   │   ├── [BRANCH J10-B02] No provider selected → provider catalog
│   │   │   ├── [BRANCH J10-B03] Select provider/model/profile/permission mode
│   │   │   └── [BRANCH J10-B04] Provider requires login → S041
│   │   ├── [STEP S040] Provider catalog loading/failure
│   │   │   ├── [BRANCH J10-B05] Initial/delayed loading
│   │   │   ├── [BRANCH J10-B06] Valid catalog → S039/S042
│   │   │   ├── [BRANCH J10-B07] Contract/network failure → Retry
│   │   │   └── [BRANCH J10-B08] Open Agent Settings → J27/S117
│   │   ├── [STEP S041] Point-of-use provider connection
│   │   │   ├── [BRANCH J10-B09] Open provider login terminal → S013
│   │   │   ├── [BRANCH J10-B10] Login succeeds → refresh catalog/auth
│   │   │   └── [BRANCH J10-B11] Cancel/fail → preserve draft and selection
│   │   ├── [STEP S042] New session composer
│   │   │   ├── [BRANCH J10-B12] Enter instruction/attach/voice
│   │   │   ├── [BRANCH J10-B13] Configure provider/model/permissions
│   │   │   ├── [BRANCH J10-B14] Send creates session → J11/S043
│   │   │   └── [BRANCH J10-B15] Validation/auth failure → inline recovery
│   │   ├── [EXIT J10-X01] Ready/active chat
│   │   ├── [EXIT J10-X02] Agent Settings/provider login
│   │   └── [EXIT J10-X03] Draft abandoned
│   │
│   ├── [JOURNEY J11] Run and control an AI conversation [D/W]
│   │   ├── [ENTRY J11-E01] Send from new/existing chat
│   │   ├── [ENTRY J11-E02] Resume an existing session
│   │   ├── [ENTRY J11-E03] Permission/question/plan tool event
│   │   ├── [STEP S043] Idle conversation and composer
│   │   │   ├── [BRANCH J11-B01] Read transcript/scroll/new-message indicator
│   │   │   ├── [BRANCH J11-B02] Compose, attach, paste, voice, provider/model menus
│   │   │   ├── [BRANCH J11-B03] Send → S044
│   │   │   └── [BRANCH J11-B04] Message/transcript utilities → J12
│   │   ├── [STEP S044] Running/streaming conversation
│   │   │   ├── [BRANCH J11-B05] Activity/stream/tool status visible
│   │   │   ├── [BRANCH J11-B06] Stop replaces Send
│   │   │   ├── [BRANCH J11-B07] Completion → S043 with terminal state
│   │   │   ├── [BRANCH J11-B08] Network/provider failure → inline retry/reconnect
│   │   │   └── [BRANCH J11-B09] WebSocket reconnect → preserve run context
│   │   ├── [STEP S045] Queued message / editable next draft
│   │   │   ├── [BRANCH J11-B10] Queue while running
│   │   │   ├── [BRANCH J11-B11] Edit/cancel queued draft
│   │   │   └── [BRANCH J11-B12] Auto-send after run completes
│   │   ├── [STEP S046] Permission request panel/banner
│   │   │   ├── [BRANCH J11-B13] Inspect tool/command request
│   │   │   ├── [BRANCH J11-B14] Allow once/always or deny
│   │   │   ├── [BRANCH J11-B15] Multiple pending requests via banner
│   │   │   └── [BRANCH J11-B16] Submit failure → remain pending/retry
│   │   ├── [STEP S047] Ask-user question panel
│   │   │   ├── [BRANCH J11-B17] Choose single/multiple option or enter text
│   │   │   ├── [BRANCH J11-B18] Submit answer → S044
│   │   │   └── [BRANCH J11-B19] Validation/cancel path
│   │   ├── [STEP S048] Plan/task approval and tool results
│   │   │   ├── [BRANCH J11-B20] Review plan/tool result and expand details
│   │   │   ├── [BRANCH J11-B21] Approve/reject/answer action
│   │   │   ├── [BRANCH J11-B22] Paginated/large tool output
│   │   │   └── [BRANCH J11-B23] Subagent tool link → J12/S053
│   │   ├── [EXIT J11-X01] Conversation complete/idle
│   │   ├── [EXIT J11-X02] Run stopped
│   │   ├── [EXIT J11-X03] Provider/settings recovery
│   │   └── [EXIT J11-X04] Conversation abandoned after failure
│   │
│   └── [JOURNEY J12] Transcript utilities, export, fork, rewind, and subagents [D/W]
│       ├── [ENTRY J12-E01] Message hover/focus actions
│       ├── [ENTRY J12-E02] Single header Export control
│       ├── [ENTRY J12-E03] Session overflow actions
│       ├── [ENTRY J12-E04] Subagent tool result or deep link
│       ├── [STEP S049] Message utility controls
│       │   ├── [BRANCH J12-B01] Copy message → choose format S050
│       │   ├── [BRANCH J12-B02] Copy content to composer
│       │   ├── [BRANCH J12-B03] Speak/read aloud or stop speaking
│       │   └── [BRANCH J12-B04] Utility failure → inline status where implemented
│       ├── [STEP S050] Copy-format menu
│       │   ├── [BRANCH J12-B05] Copy plain/Markdown-formatted content
│       │   ├── [BRANCH J12-B06] Copy succeeds → transient copied status
│       │   └── [BRANCH J12-B07] Escape/outside click → S049
│       ├── [STEP S051] Session export menu and result
│       │   ├── [BRANCH J12-B08] Export Markdown/HTML/PDF/ZIP
│       │   ├── [BRANCH J12-B09] Download succeeds → file system
│       │   ├── [BRANCH J12-B10] Export fails → inline feedback
│       │   └── [BRANCH J12-B11] Close → chat
│       ├── [STEP S052] Fork or rewind session
│       │   ├── [BRANCH J12-B12] Fork at selected message → new session route
│       │   ├── [BRANCH J12-B13] Rewind to selected message → browser confirmation
│       │   ├── [BRANCH J12-B14] Confirm → truncate/reset history and resume
│       │   └── [BRANCH J12-B15] Cancel/failure → original session retained
│       ├── [STEP S053] Subagent transcript navigation
│       │   ├── [BRANCH J12-B16] Open subagent route/transcript
│       │   ├── [BRANCH J12-B17] Canonical redirect → J34/S153
│       │   ├── [BRANCH J12-B18] Return/back to parent session
│       │   └── [BRANCH J12-B19] Unknown subagent → parent/fallback
│       ├── [EXIT J12-X01] Downloaded/exported artifact
│       ├── [EXIT J12-X02] New forked or rewound session active
│       ├── [EXIT J12-X03] Parent/subagent session active
│       └── [EXIT J12-X04] Utility dismissed with transcript unchanged
│
├── [JOB JOB-04] Browse, edit, and execute within project artifacts
│   ├── [JOURNEY J13] File management [D/W]
│   │   ├── [ENTRY J13-E01] Files main tab
│   │   ├── [ENTRY J13-E02] File-tree header actions
│   │   ├── [ENTRY J13-E03] File/folder context menu or row
│   │   ├── [STEP S054] File tree browse state
│   │   │   ├── [BRANCH J13-B01] Initial/delayed loading
│   │   │   ├── [BRANCH J13-B02] Expand/collapse folder and select file → J14
│   │   │   ├── [BRANCH J13-B03] Empty folder success
│   │   │   ├── [BRANCH J13-B04] Permission/server error → Retry/contextual recovery
│   │   │   └── [BRANCH J13-B05] Refresh tree
│   │   ├── [STEP S055] File search and detailed/list controls
│   │   │   ├── [BRANCH J13-B06] Search/filter names
│   │   │   ├── [BRANCH J13-B07] Switch list/detail presentation
│   │   │   ├── [BRANCH J13-B08] Select result → editor S059
│   │   │   └── [BRANCH J13-B09] Clear/no matches → S054
│   │   ├── [STEP S056] File/folder context and overflow menu
│   │   │   ├── [BRANCH J13-B10] New file/folder
│   │   │   ├── [BRANCH J13-B11] Rename/copy path/download
│   │   │   ├── [BRANCH J13-B12] Delete → trash/Undo where supported or confirmation
│   │   │   └── [BRANCH J13-B13] Menu failure → refresh/error
│   │   ├── [STEP S057] Upload selection and progress
│   │   │   ├── [BRANCH J13-B14] Choose/drag files
│   │   │   ├── [BRANCH J13-B15] Per-file progress/cancel
│   │   │   ├── [BRANCH J13-B16] Success/partial success → refresh
│   │   │   └── [BRANCH J13-B17] Permission/network failure → retry
│   │   ├── [STEP S058] File mutation feedback
│   │   │   ├── [BRANCH J13-B18] Create/rename/delete success → tree refresh
│   │   │   ├── [BRANCH J13-B19] Undo trash action
│   │   │   ├── [BRANCH J13-B20] Mutation error → contextual recovery
│   │   │   └── [BRANCH J13-B21] Deleted open file → safe alternate state S062
│   │   ├── [EXIT J13-X01] File opened
│   │   ├── [EXIT J13-X02] File operation completed
│   │   └── [EXIT J13-X03] File journey abandoned after error
│   │
│   ├── [JOURNEY J14] File editing and preview [D/W]
│   │   ├── [ENTRY J14-E01] Select a file from tree/search
│   │   ├── [ENTRY J14-E02] Reopen currently selected file
│   │   ├── [STEP S059] Text/code editor
│   │   │   ├── [BRANCH J14-B01] Load document → editing state
│   │   │   ├── [BRANCH J14-B02] Edit → dirty state → Save
│   │   │   ├── [BRANCH J14-B03] Save progress/success/failure with input retained
│   │   │   └── [BRANCH J14-B04] External revision/deleted guard → reload/keep decision
│   │   ├── [STEP S060] Markdown preview
│   │   │   ├── [BRANCH J14-B05] Toggle source/preview
│   │   │   ├── [BRANCH J14-B06] Copy code block
│   │   │   └── [BRANCH J14-B07] Link/external content handoff
│   │   ├── [STEP S061] Image/media preview
│   │   │   ├── [BRANCH J14-B08] Image viewer zoom/pan/reset/download
│   │   │   ├── [BRANCH J14-B09] Audio/video/media display where supported
│   │   │   └── [BRANCH J14-B10] Media load failure → alternate state
│   │   ├── [STEP S062] Binary, unsupported, missing, and load-error state
│   │   │   ├── [BRANCH J14-B11] Binary metadata/download
│   │   │   ├── [BRANCH J14-B12] Missing/deleted file → close/reload tree
│   │   │   ├── [BRANCH J14-B13] Permission/server failure → Retry
│   │   │   └── [BRANCH J14-B14] Select another file → S054
│   │   ├── [EXIT J14-X01] File saved
│   │   ├── [EXIT J14-X02] External link/download
│   │   └── [EXIT J14-X03] Return to file tree/other workspace tab
│   │
│   └── [JOURNEY J15] Local project Shell [D]
│       ├── [ENTRY J15-E01] Shell main tab for a registered project
│       ├── [ENTRY J15-E02] Reconnect/restart action
│       ├── [STEP S063] Interactive terminal ready state
│       │   ├── [BRANCH J15-B01] Type/execute local shell commands
│       │   ├── [BRANCH J15-B02] Resize terminal
│       │   ├── [BRANCH J15-B03] Copy/paste/selection
│       │   └── [BRANCH J15-B04] Restart terminal
│       ├── [STEP S064] Connecting/reconnecting overlay
│       │   ├── [BRANCH J15-B05] Initial connection → S063
│       │   ├── [BRANCH J15-B06] Socket interruption → automatic reconnect
│       │   ├── [BRANCH J15-B07] Manual Reconnect/Restart
│       │   └── [BRANCH J15-B08] Delayed/failure → S065
│       ├── [STEP S065] Shell recovery state
│       │   ├── [BRANCH J15-B09] Missing project → choose/register project
│       │   ├── [BRANCH J15-B10] Missing cwd → Files/project recovery
│       │   ├── [BRANCH J15-B11] Shell unavailable/socket/auth failure → Retry
│       │   └── [BRANCH J15-B12] LAN/remote mode → Shell disabled
│       ├── [STEP S066] Mobile terminal selection/clipboard mode
│       │   ├── [BRANCH J15-B13] Enter selection mode and adjust handles
│       │   ├── [BRANCH J15-B14] Copy/paste and exit selection
│       │   └── [BRANCH J15-B15] Touch scroll vs selection behavior
│       ├── [EXIT J15-X01] Terminal work continues in project
│       ├── [EXIT J15-X02] Switch workspace tab with process state retained/reset as designed
│       └── [EXIT J15-X03] Shell unavailable; user returns to project recovery
│
├── [JOB JOB-05] Manage source control
│   ├── [JOURNEY J16] Review changes and commit [D/W]
│   │   ├── [ENTRY J16-E01] Git main tab → Changes
│   │   ├── [ENTRY J16-E02] Changed-file row/status
│   │   ├── [ENTRY J16-E03] Initialize repository recovery CTA
│   │   ├── [STEP S067] Changes overview and repository status
│   │   │   ├── [BRANCH J16-B01] Loading → repository/no-repository/error
│   │   │   ├── [BRANCH J16-B02] Branch and ahead/behind status
│   │   │   ├── [BRANCH J16-B03] Staged/unstaged/untracked groups
│   │   │   └── [BRANCH J16-B04] Refresh/fetch neutral actions
│   │   ├── [STEP S068] Changed-file diff and staging
│   │   │   ├── [BRANCH J16-B05] Select file → diff
│   │   │   ├── [BRANCH J16-B06] Stage/unstage file or all
│   │   │   ├── [BRANCH J16-B07] Discard → confirmation/temporary Undo
│   │   │   └── [BRANCH J16-B08] Binary/large/error diff states
│   │   ├── [STEP S069] Commit composer
│   │   │   ├── [BRANCH J16-B09] Enter/edit commit message
│   │   │   ├── [BRANCH J16-B10] Commit disabled with enabling explanation
│   │   │   ├── [BRANCH J16-B11] Generate message → S070
│   │   │   └── [BRANCH J16-B12] Commit selected staged snapshot → S071
│   │   ├── [STEP S070] AI commit-message suggestion
│   │   │   ├── [BRANCH J16-B13] Disclose provider/data and generate
│   │   │   ├── [BRANCH J16-B14] Progress/partial analysis/cancel
│   │   │   ├── [BRANCH J16-B15] Compare Use/Dismiss/Update/Keep current message
│   │   │   └── [BRANCH J16-B16] Catalog/provider/network failure → Retry/Review/Open Settings
│   │   ├── [STEP S071] Commit progress/result
│   │   │   ├── [BRANCH J16-B17] Commit success → refresh clean/remaining changes
│   │   │   ├── [BRANCH J16-B18] Hook/index/permission failure → preserve message
│   │   │   └── [BRANCH J16-B19] Snapshot changed → return to review
│   │   ├── [STEP S072] No repository / Git unavailable
│   │   │   ├── [BRANCH J16-B20] Initialize repository → S067
│   │   │   ├── [BRANCH J16-B21] Missing Git → Open Git Settings J29/S128
│   │   │   ├── [BRANCH J16-B22] Permission/init failure → Retry/recovery
│   │   │   └── [BRANCH J16-B23] Choose another project
│   │   ├── [EXIT J16-X01] Commit recorded
│   │   ├── [EXIT J16-X02] Changes retained without commit
│   │   └── [EXIT J16-X03] Repository/settings recovery
│   │
│   ├── [JOURNEY J17] Synchronize and recover Git operations [D/W]
│   │   ├── [ENTRY J17-E01] Fetch/Pull/Push/Publish in Changes header
│   │   ├── [ENTRY J17-E02] Ahead/behind or remote status
│   │   ├── [ENTRY J17-E03] Conflict/recovery banner
│   │   ├── [STEP S073] Git transport actions
│   │   │   ├── [BRANCH J17-B01] Fetch
│   │   │   ├── [BRANCH J17-B02] Pull
│   │   │   ├── [BRANCH J17-B03] Push
│   │   │   └── [BRANCH J17-B04] Publish branch when no upstream
│   │   ├── [STEP S074] Transport progress/result
│   │   │   ├── [BRANCH J17-B05] Progress → success and status refresh
│   │   │   ├── [BRANCH J17-B06] Missing remote/auth/network/non-fast-forward → matching recovery
│   │   │   ├── [BRANCH J17-B07] Detached HEAD/dirty state → branch/stash guidance
│   │   │   └── [BRANCH J17-B08] Retry/open Git Settings
│   │   ├── [STEP S075] Conflict detection and recovery banner
│   │   │   ├── [BRANCH J17-B09] Merge/rebase/conflict type and files shown
│   │   │   ├── [BRANCH J17-B10] Resolve conflicts → Files/editor
│   │   │   ├── [BRANCH J17-B11] Continue merge/rebase when resolved
│   │   │   └── [BRANCH J17-B12] Abort → confirmation S076
│   │   ├── [STEP S076] Destructive Git confirmation
│   │   │   ├── [BRANCH J17-B13] Confirm abort/reset/revert
│   │   │   ├── [BRANCH J17-B14] Cancel → recovery context retained
│   │   │   └── [BRANCH J17-B15] Action succeeds/fails → S077
│   │   ├── [STEP S077] Git recovery and Undo result
│   │   │   ├── [BRANCH J17-B16] Operation success → Changes S067
│   │   │   ├── [BRANCH J17-B17] Temporary patch Undo
│   │   │   ├── [BRANCH J17-B18] Recovery failure → Retry/details
│   │   │   └── [BRANCH J17-B19] Manual repair guidance
│   │   ├── [EXIT J17-X01] Repository synchronized
│   │   ├── [EXIT J17-X02] Conflict/recovery completed
│   │   └── [EXIT J17-X03] Operation abandoned with state preserved
│   │
│   └── [JOURNEY J18] Branches and worktrees [D/W]
│       ├── [ENTRY J18-E01] Git Branches tab/branch selector
│       ├── [ENTRY J18-E02] Branch row overflow menu
│       ├── [ENTRY J18-E03] Worktree controls
│       ├── [STEP S078] Branch list/search and current status
│       │   ├── [BRANCH J18-B01] Load local/remote branches
│       │   ├── [BRANCH J18-B02] Search/filter and keyboard-select
│       │   ├── [BRANCH J18-B03] Empty/error → refresh/recovery
│       │   └── [BRANCH J18-B04] Select branch → S079
│       ├── [STEP S079] Create or switch branch
│       │   ├── [BRANCH J18-B05] Create from current/selected base
│       │   ├── [BRANCH J18-B06] Switch clean branch
│       │   ├── [BRANCH J18-B07] Dirty/conflict/detached failure → contextual recovery
│       │   └── [BRANCH J18-B08] Success → Changes S067
│       ├── [STEP S080] Branch actions
│       │   ├── [BRANCH J18-B09] Rename
│       │   ├── [BRANCH J18-B10] Delete local/remote → confirmation
│       │   ├── [BRANCH J18-B11] Publish/set upstream
│       │   └── [BRANCH J18-B12] Failure → refresh/retry
│       ├── [STEP S081] Worktree list and actions
│       │   ├── [BRANCH J18-B13] Create worktree for branch/path
│       │   ├── [BRANCH J18-B14] Open/select registered worktree project
│       │   ├── [BRANCH J18-B15] Remove/prune → confirmation
│       │   └── [BRANCH J18-B16] Path/dirty/permission failure → recovery
│       ├── [EXIT J18-X01] Selected branch/worktree active
│       ├── [EXIT J18-X02] Branch/worktree mutation completed
│       └── [EXIT J18-X03] Mutation cancelled/abandoned
│
├── [JOB JOB-06] Plan, track, and schedule project work
│   ├── [JOURNEY J19] Set up Task Manager [D/W]
│   │   ├── [ENTRY J19-E01] Tasks tab when project is not initialized
│   │   ├── [ENTRY J19-E02] Set up Tasks from board/drawer
│   │   ├── [STEP S082] Task Manager not-initialized workspace
│   │   │   ├── [BRANCH J19-B01] Learn “What is TaskMaster?”
│   │   │   ├── [BRANCH J19-B02] Set up Tasks → S083
│   │   │   ├── [BRANCH J19-B03] Import/Create PRD → J21/S093
│   │   │   └── [BRANCH J19-B04] Choose project if missing
│   │   ├── [STEP S083] Analyze setup
│   │   │   ├── [BRANCH J19-B05] Analyze project/current configuration
│   │   │   ├── [BRANCH J19-B06] Progress/cancel
│   │   │   └── [BRANCH J19-B07] Analysis failure → Retry
│   │   ├── [STEP S084] Preview changes and confirm setup
│   │   │   ├── [BRANCH J19-B08] Review operations/default-model effects/backups
│   │   │   ├── [BRANCH J19-B09] Confirm → S085
│   │   │   ├── [BRANCH J19-B10] Back/reanalyze → S083
│   │   │   └── [BRANCH J19-B11] Cancel → S082
│   │   ├── [STEP S085] Apply setup progress
│   │   │   ├── [BRANCH J19-B12] Stream staged progress
│   │   │   ├── [BRANCH J19-B13] Cancel → rollback/repair result
│   │   │   ├── [BRANCH J19-B14] Success → S086
│   │   │   └── [BRANCH J19-B15] Failure → S086
│   │   ├── [STEP S086] Setup success/recovery
│   │   │   ├── [BRANCH J19-B16] Success → open Task board S087
│   │   │   ├── [BRANCH J19-B17] Retry failed operation
│   │   │   ├── [BRANCH J19-B18] Roll back or Repair
│   │   │   └── [BRANCH J19-B19] Cancel to S082 with status
│   │   ├── [EXIT J19-X01] Initialized Task board
│   │   ├── [EXIT J19-X02] Setup cancelled/rolled back
│   │   └── [EXIT J19-X03] Setup abandoned after failure
│   │
│   ├── [JOURNEY J20] Browse, create, and execute tasks [D/W]
│   │   ├── [ENTRY J20-E01] Tasks main tab
│   │   ├── [ENTRY J20-E02] Project drawer Tasks tab
│   │   ├── [ENTRY J20-E03] Next Task banner/card
│   │   ├── [STEP S087] Task board ready state
│   │   │   ├── [BRANCH J20-B01] Status columns/cards and next task
│   │   │   ├── [BRANCH J20-B02] Select task → S090
│   │   │   ├── [BRANCH J20-B03] Start selected next task → S091
│   │   │   └── [BRANCH J20-B04] Create task/PRD secondary path
│   │   ├── [STEP S088] Task toolbar
│   │   │   ├── [BRANCH J20-B05] Search
│   │   │   ├── [BRANCH J20-B06] Filter status/priority/tag
│   │   │   ├── [BRANCH J20-B07] Sort
│   │   │   └── [BRANCH J20-B08] Refresh
│   │   ├── [STEP S089] Task empty / filtered-empty state
│   │   │   ├── [BRANCH J20-B09] Truly empty → Create task
│   │   │   ├── [BRANCH J20-B10] Filtered empty → Clear filters
│   │   │   ├── [BRANCH J20-B11] Change sort/filter
│   │   │   └── [BRANCH J20-B12] Loading/error → Retry
│   │   ├── [STEP S090] Task detail and mutation
│   │   │   ├── [BRANCH J20-B13] Inspect description/subtasks/dependencies/status
│   │   │   ├── [BRANCH J20-B14] Edit/update task → browser dialog feedback
│   │   │   ├── [BRANCH J20-B15] Change status/delete → confirm path
│   │   │   └── [BRANCH J20-B16] Start task → S091
│   │   ├── [STEP S091] Start-task staged progress
│   │   │   ├── [BRANCH J20-B17] Start/prepare provider/session/task
│   │   │   ├── [BRANCH J20-B18] Cancel
│   │   │   ├── [BRANCH J20-B19] Success → chat/session and S092
│   │   │   └── [BRANCH J20-B20] Failure → Retry
│   │   ├── [STEP S092] Task execution result / next-task banner
│   │   │   ├── [BRANCH J20-B21] Open resulting chat/session
│   │   │   ├── [BRANCH J20-B22] Mark/update task status
│   │   │   ├── [BRANCH J20-B23] Start next task
│   │   │   └── [BRANCH J20-B24] Dismiss/details
│   │   ├── [EXIT J20-X01] Task session running
│   │   ├── [EXIT J20-X02] Board updated
│   │   └── [EXIT J20-X03] Task start abandoned after failure
│   │
│   ├── [JOURNEY J21] Create, import, and generate a PRD [D/W]
│   │   ├── [ENTRY J21-E01] Import/Create PRD from Task setup/empty/board
│   │   ├── [ENTRY J21-E02] Existing PRD edit action
│   │   ├── [STEP S093] PRD editor/intake
│   │   │   ├── [BRANCH J21-B01] Write/paste requirements
│   │   │   ├── [BRANCH J21-B02] Import existing file/content
│   │   │   ├── [BRANCH J21-B03] Generate/parse with provider → S094
│   │   │   └── [BRANCH J21-B04] Cancel/back → Tasks
│   │   ├── [STEP S094] PRD generation/progress
│   │   │   ├── [BRANCH J21-B05] Provider/model selection and generation
│   │   │   ├── [BRANCH J21-B06] Progress/cancel
│   │   │   ├── [BRANCH J21-B07] Success → editable result S093
│   │   │   └── [BRANCH J21-B08] Auth/network/provider error → browser alert/retry
│   │   ├── [STEP S095] PRD save/import result
│   │   │   ├── [BRANCH J21-B09] Save/overwrite → browser confirm
│   │   │   ├── [BRANCH J21-B10] Success → Task setup/board refresh
│   │   │   ├── [BRANCH J21-B11] Validation/write failure → preserve content
│   │   │   └── [BRANCH J21-B12] Cancel → editor
│   │   ├── [EXIT J21-X01] PRD saved/imported and Tasks updated
│   │   ├── [EXIT J21-X02] Return to Tasks without saving
│   │   └── [EXIT J21-X03] Generation/save abandoned
│   │
│   ├── [JOURNEY J22] Use the project drawer [D/W]
│   │   ├── [ENTRY J22-E01] Right-edge project drawer handle
│   │   ├── [ENTRY J22-E02] Tasks/Schedules navigation shortcut
│   │   ├── [STEP S096] Project drawer container and tab bar
│   │   │   ├── [BRANCH J22-B01] Open docked drawer and preserve workspace context
│   │   │   ├── [BRANCH J22-B02] Switch Tasks/Schedules tabs
│   │   │   ├── [BRANCH J22-B03] Resize/persist width where available
│   │   │   ├── [BRANCH J22-B04] Collapse/Close
│   │   │   └── [BRANCH J22-B05] Mobile drawer overlays workspace
│   │   ├── [STEP S097] Drawer Tasks tab
│   │   │   ├── [BRANCH J22-B06] Search/filter/sort/refresh tasks
│   │   │   ├── [BRANCH J22-B07] Select/run task → J20
│   │   │   └── [BRANCH J22-B08] Setup/create opens main Tasks workspace
│   │   ├── [STEP S098] Drawer Schedules tab
│   │   │   ├── [BRANCH J22-B09] Browse/run schedule → J23
│   │   │   ├── [BRANCH J22-B10] Create/edit opens main editor J24
│   │   │   └── [BRANCH J22-B11] Provider Connect → Agent Settings J27
│   │   ├── [EXIT J22-X01] Drawer closed to unchanged workspace context
│   │   ├── [EXIT J22-X02] Main Tasks/Schedule editor opened
│   │   └── [EXIT J22-X03] Mobile user trapped/abandons drawer
│   │
│   ├── [JOURNEY J23] Browse and act on schedules [D/W]
│   │   ├── [ENTRY J23-E01] Project drawer Schedules tab
│   │   ├── [ENTRY J23-E02] Schedule navigation/action from workspace
│   │   ├── [STEP S099] Schedule list
│   │   │   ├── [BRANCH J23-B01] Initial/delayed loading
│   │   │   ├── [BRANCH J23-B02] Empty → Create schedule J24/S103
│   │   │   ├── [BRANCH J23-B03] Error → Retry
│   │   │   └── [BRANCH J23-B04] Select/edit card → J24
│   │   ├── [STEP S100] Schedule card/status
│   │   │   ├── [BRANCH J23-B05] Enabled/disabled, next run, provider/profile
│   │   │   ├── [BRANCH J23-B06] Last run success/failure/missed/running
│   │   │   ├── [BRANCH J23-B07] Edit/toggle
│   │   │   └── [BRANCH J23-B08] Moved project/provider unavailable recovery
│   │   ├── [STEP S101] Run schedule now
│   │   │   ├── [BRANCH J23-B09] Run now → progress
│   │   │   ├── [BRANCH J23-B10] Success → session/run status
│   │   │   └── [BRANCH J23-B11] Duplicate/provider/server failure → Retry/Open Settings
│   │   ├── [STEP S102] Delete schedule confirmation/Undo
│   │   │   ├── [BRANCH J23-B12] Delete → confirmation
│   │   │   ├── [BRANCH J23-B13] Confirm → removal with Undo
│   │   │   ├── [BRANCH J23-B14] Undo → restore
│   │   │   └── [BRANCH J23-B15] Failure → restore card/retry
│   │   ├── [EXIT J23-X01] Schedule list remains active
│   │   ├── [EXIT J23-X02] Run/session opened
│   │   └── [EXIT J23-X03] Main schedule editor opened
│   │
│   └── [JOURNEY J24] Create or edit a schedule [D/W]
│       ├── [ENTRY J24-E01] Create schedule from empty/list/drawer
│       ├── [ENTRY J24-E02] Edit schedule card
│       ├── [STEP S103] Schedule editor basics
│       │   ├── [BRANCH J24-B01] Current project preselected
│       │   ├── [BRANCH J24-B02] Enter name/prompt and enable state
│       │   ├── [BRANCH J24-B03] Validation preserves fields
│       │   └── [BRANCH J24-B04] Back/cancel → schedule list
│       ├── [STEP S104] Recurrence, time, timezone, and preview
│       │   ├── [BRANCH J24-B05] Daily/Weekly/Custom time
│       │   ├── [BRANCH J24-B06] Detect/select timezone
│       │   ├── [BRANCH J24-B07] Preview next three runs including DST
│       │   └── [BRANCH J24-B08] Invalid recurrence/time → inline recovery
│       ├── [STEP S105] Schedule provider/profile/model
│       │   ├── [BRANCH J24-B09] Shared catalog loading/success
│       │   ├── [BRANCH J24-B10] Choose provider/profile/model
│       │   ├── [BRANCH J24-B11] Unavailable provider → Open Settings
│       │   └── [BRANCH J24-B12] Catalog error → Retry
│       ├── [STEP S106] Advanced schedule options
│       │   ├── [BRANCH J24-B13] Reveal raw cron/advanced options
│       │   ├── [BRANCH J24-B14] Validate cron
│       │   ├── [BRANCH J24-B15] Return to basic schedule
│       │   └── [BRANCH J24-B16] Execution caveat: Desktop/local server must remain active
│       ├── [STEP S107] Schedule save/result
│       │   ├── [BRANCH J24-B17] Save schedule
│       │   ├── [BRANCH J24-B18] Saving → success and list
│       │   ├── [BRANCH J24-B19] Validation/server failure → preserve and Retry
│       │   └── [BRANCH J24-B20] Run now remains secondary → J23/S101
│       ├── [EXIT J24-X01] Saved schedule list
│       ├── [EXIT J24-X02] Settings/provider recovery
│       └── [EXIT J24-X03] Cancel with no change
│
├── [JOB JOB-07] Configure preferences, agents, and integrations
│   ├── [JOURNEY J25] Settings navigation, appearance, and notifications [D/W]
│   │   ├── [ENTRY J25-E01] Settings from sidebar/collapsed nav/command palette
│   │   ├── [ENTRY J25-E02] Notification permission/action deep entry
│   │   ├── [STEP S108] Settings dialog and grouped navigation
│   │   │   ├── [BRANCH J25-B01] General: Appearance/Notifications/Voice
│   │   │   ├── [BRANCH J25-B02] AI & integrations: Agents/API Tokens/Browser/Plugins
│   │   │   ├── [BRANCH J25-B03] Project tools: Git/Tasks
│   │   │   ├── [BRANCH J25-B04] System: About
│   │   │   └── [BRANCH J25-B05] Escape/close → focus return
│   │   ├── [STEP S109] Appearance settings
│   │   │   ├── [BRANCH J25-B06] Light/dark/system theme
│   │   │   ├── [BRANCH J25-B07] Font/language/UI preferences present in build
│   │   │   └── [BRANCH J25-B08] Autosave → S111
│   │   ├── [STEP S110] Notification settings
│   │   │   ├── [BRANCH J25-B09] Enable browser/system notifications
│   │   │   ├── [BRANCH J25-B10] Permission denied → browser settings guidance
│   │   │   ├── [BRANCH J25-B11] Toggle notification event preferences
│   │   │   └── [BRANCH J25-B12] Test/permission request where supported
│   │   ├── [STEP S111] Settings autosave feedback
│   │   │   ├── [BRANCH J25-B13] Saving
│   │   │   ├── [BRANCH J25-B14] Saved
│   │   │   ├── [BRANCH J25-B15] Save fails internally
│   │   │   └── [BRANCH J25-B16] Close/navigate while save settles
│   │   ├── [BRANCH J25-B17] [O] SettingsMainTabs duplicate navigation component has no callers
│   │   ├── [EXIT J25-X01] Settings closed with preferences applied
│   │   ├── [EXIT J25-X02] Another settings group opened
│   │   └── [EXIT J25-X03] User leaves after silent save failure
│   │
│   ├── [JOURNEY J26] Configure and test Voice [D/W]
│   │   ├── [ENTRY J26-E01] Voice group in Settings
│   │   ├── [ENTRY J26-E02] Composer microphone/voice action needing setup
│   │   ├── [STEP S112] Voice Basic settings
│   │   │   ├── [BRANCH J26-B01] Enable voice input
│   │   │   ├── [BRANCH J26-B02] Select microphone/language/hold-to-talk/read-aloud
│   │   │   ├── [BRANCH J26-B03] Test voice input → S114
│   │   │   └── [BRANCH J26-B04] Advanced disclosure → S115
│   │   ├── [STEP S113] Microphone permission/device recovery
│   │   │   ├── [BRANCH J26-B05] Device loading/empty
│   │   │   ├── [BRANCH J26-B06] Permission denied → Open system/browser settings
│   │   │   ├── [BRANCH J26-B07] Device disappears → choose another
│   │   │   └── [BRANCH J26-B08] Retry permission/device scan
│   │   ├── [STEP S114] Voice test flow
│   │   │   ├── [BRANCH J26-B09] Listening
│   │   │   ├── [BRANCH J26-B10] Transcribing
│   │   │   ├── [BRANCH J26-B11] Sample result/playback
│   │   │   └── [BRANCH J26-B12] Test failure → retry/recovery
│   │   ├── [STEP S115] Voice Advanced settings
│   │   │   ├── [BRANCH J26-B13] Select provider and reveal relevant URL/API key
│   │   │   ├── [BRANCH J26-B14] Configure STT/TTS/model/context/cleanup
│   │   │   ├── [BRANCH J26-B15] Mask/store secret securely
│   │   │   └── [BRANCH J26-B16] Provider/profile error → inline recovery
│   │   ├── [STEP S116] Voice autosave result
│   │   │   ├── [BRANCH J26-B17] Saving → Saved
│   │   │   ├── [BRANCH J26-B18] Failed → Retry
│   │   │   ├── [BRANCH J26-B19] Secure-storage migration success/failure
│   │   │   └── [BRANCH J26-B20] Close Advanced → Basic
│   │   ├── [EXIT J26-X01] Voice configured and tested
│   │   ├── [EXIT J26-X02] Return to Chat composer
│   │   └── [EXIT J26-X03] Voice left disabled/unavailable
│   │
│   ├── [JOURNEY J27] Manage agent accounts, profiles, models, and permissions [D/W]
│   │   ├── [ENTRY J27-E01] Settings → Agents
│   │   ├── [ENTRY J27-E02] Chat catalog recovery “Open Agent Settings”
│   │   ├── [ENTRY J27-E03] Schedule/provider recovery
│   │   ├── [STEP S117] Agent provider overview
│   │   │   ├── [BRANCH J27-B01] Provider cards/auth status
│   │   │   ├── [BRANCH J27-B02] Login/connect → S118
│   │   │   ├── [BRANCH J27-B03] Configure provider → S119
│   │   │   └── [BRANCH J27-B04] Open provider sub-tabs including Permissions
│   │   ├── [STEP S118] Provider login dialog
│   │   │   ├── [BRANCH J27-B05] CLI login terminal stream
│   │   │   ├── [BRANCH J27-B06] Success → status refresh
│   │   │   └── [BRANCH J27-B07] Failure/cancel → overview
│   │   ├── [STEP S119] Provider settings and profile management
│   │   │   ├── [BRANCH J27-B08] Add/edit/select profile
│   │   │   ├── [BRANCH J27-B09] Provider URL/model/config fields
│   │   │   ├── [BRANCH J27-B10] Delete profile → browser confirm
│   │   │   └── [BRANCH J27-B11] Save/refresh
│   │   ├── [STEP S120] Provider/profile/model feedback
│   │   │   ├── [BRANCH J27-B12] Loading/empty/success
│   │   │   ├── [BRANCH J27-B13] Save/delete/catalog failure
│   │   │   ├── [BRANCH J27-B14] Retry/reconnect where present
│   │   │   └── [BRANCH J27-B15] Failure logged only where absent from UI
│   │   ├── [STEP S121] OpenCode Permissions tab
│   │   │   ├── [BRANCH J27-B16] Navigate OpenCode → Settings → Agents → Permissions
│   │   │   ├── [BRANCH J27-B17] Blank content; no permission controls
│   │   │   └── [BRANCH J27-B18] Back to another Agent sub-tab
│   │   ├── [EXIT J27-X01] Agent/provider configured
│   │   ├── [EXIT J27-X02] Return to originating Chat/Schedule flow
│   │   └── [EXIT J27-X03] Blank/error state abandoned
│   │
│   ├── [JOURNEY J28] Manage MCP servers and Skills [D/W]
│   │   ├── [ENTRY J28-E01] Agent/settings MCP section
│   │   ├── [ENTRY J28-E02] Skills button/dialog from supported provider settings
│   │   ├── [STEP S122] MCP server list/status
│   │   │   ├── [BRANCH J28-B01] Loading/empty/server cards
│   │   │   ├── [BRANCH J28-B02] Enable/disable/restart/status
│   │   │   ├── [BRANCH J28-B03] Add/Edit → S123
│   │   │   └── [BRANCH J28-B04] Delete → S124
│   │   ├── [STEP S123] Add/edit MCP server overlay
│   │   │   ├── [BRANCH J28-B05] Enter name/command/arguments/environment
│   │   │   ├── [BRANCH J28-B06] Validate/submit → browser alert feedback
│   │   │   ├── [BRANCH J28-B07] Success → list S122
│   │   │   └── [BRANCH J28-B08] Cancel/outside → S122
│   │   ├── [STEP S124] MCP destructive/status feedback
│   │   │   ├── [BRANCH J28-B09] Delete → browser confirm
│   │   │   ├── [BRANCH J28-B10] Restart/toggle result
│   │   │   ├── [BRANCH J28-B11] Failure → alert/retry
│   │   │   └── [BRANCH J28-B12] Success → refreshed list
│   │   ├── [STEP S125] Skills dialog and installed/available list
│   │   │   ├── [BRANCH J28-B13] Search/filter provider skills
│   │   │   ├── [BRANCH J28-B14] Inspect install destination disclosure
│   │   │   ├── [BRANCH J28-B15] Select/install → S126
│   │   │   └── [BRANCH J28-B16] Escape/Close → focus return
│   │   ├── [STEP S126] Skill installation/result
│   │   │   ├── [BRANCH J28-B17] Install progress
│   │   │   ├── [BRANCH J28-B18] Success → installed state
│   │   │   ├── [BRANCH J28-B19] Failure → retry/details
│   │   │   └── [BRANCH J28-B20] [O] Removal API exists, but installed-skill UI has no Remove action
│   │   ├── [EXIT J28-X01] MCP/Skill configuration applied
│   │   ├── [EXIT J28-X02] Dialog dismissed
│   │   └── [EXIT J28-X03] User abandons inaccessible/failed management action
│   │
│   ├── [JOURNEY J29] Configure API tokens, Git, Tasks, and view About [D/W]
│   │   ├── [ENTRY J29-E01] Corresponding Settings sidebar group
│   │   ├── [ENTRY J29-E02] Recovery link from Git/Tasks/provider flows
│   │   ├── [STEP S127] API token and GitHub credential settings
│   │   │   ├── [BRANCH J29-B01] List/add/edit credentials
│   │   │   ├── [BRANCH J29-B02] Mask/copy/test credential
│   │   │   ├── [BRANCH J29-B03] Delete → browser confirm
│   │   │   └── [BRANCH J29-B04] Mutation failure → console-only path
│   │   ├── [STEP S128] Git settings
│   │   │   ├── [BRANCH J29-B05] Inspect Git availability/version
│   │   │   ├── [BRANCH J29-B06] Configure identity/defaults
│   │   │   ├── [BRANCH J29-B07] Save/test
│   │   │   └── [BRANCH J29-B08] Failure → console-only or limited feedback
│   │   ├── [STEP S129] Tasks settings
│   │   │   ├── [BRANCH J29-B09] Enable/disable Tasks feature
│   │   │   ├── [BRANCH J29-B10] Configure TaskMaster/provider defaults
│   │   │   ├── [BRANCH J29-B11] Save/autosave feedback
│   │   │   └── [BRANCH J29-B12] Disabled Tasks hides main tab but palette command remains
│   │   ├── [STEP S130] About/build information
│   │   │   ├── [BRANCH J29-B13] Version/build identity
│   │   │   ├── [BRANCH J29-B14] Homepage/repository/documentation links
│   │   │   ├── [BRANCH J29-B15] Check update/version link → J32
│   │   │   └── [BRANCH J29-B16] Report Issue appears only when configured → J33
│   │   ├── [STEP S131] Settings mutation result/recovery
│   │   │   ├── [BRANCH J29-B17] Saving/Saved
│   │   │   ├── [BRANCH J29-B18] Failure visible where implemented
│   │   │   ├── [BRANCH J29-B19] Failure invisible/console-only where omitted
│   │   │   └── [BRANCH J29-B20] Retry/reopen settings
│   │   ├── [EXIT J29-X01] Configuration applied
│   │   ├── [EXIT J29-X02] External documentation/repository
│   │   └── [EXIT J29-X03] Settings closed with uncertain failed mutation
│   │
│   ├── [JOURNEY J30] Set up and monitor Browser automation [D/W]
│   │   ├── [ENTRY J30-E01] Settings → Browser
│   │   ├── [ENTRY J30-E02] Browser panel/tool action from supported workflow
│   │   ├── [STEP S132] Browser setup/status
│   │   │   ├── [BRANCH J30-B01] Loading → ready/setup-required/error
│   │   │   ├── [BRANCH J30-B02] Inspect service/runtime status
│   │   │   ├── [BRANCH J30-B03] Setup required → S133
│   │   │   └── [BRANCH J30-B04] Ready → S134
│   │   ├── [STEP S133] Browser configuration/install
│   │   │   ├── [BRANCH J30-B05] Configure/install dependencies
│   │   │   ├── [BRANCH J30-B06] Progress
│   │   │   ├── [BRANCH J30-B07] Success → S132
│   │   │   └── [BRANCH J30-B08] Failure → error without explicit Retry in Settings
│   │   ├── [STEP S134] Browser run/session monitor
│   │   │   ├── [BRANCH J30-B09] Live state/screenshot/logs
│   │   │   ├── [BRANCH J30-B10] Open fullscreen → S135
│   │   │   ├── [BRANCH J30-B11] Stop
│   │   │   └── [BRANCH J30-B12] Delete
│   │   ├── [STEP S135] Browser fullscreen overlay
│   │   │   ├── [BRANCH J30-B13] Inspect live browser content
│   │   │   ├── [BRANCH J30-B14] Stop/Delete session
│   │   │   ├── [BRANCH J30-B15] Close/back to monitor
│   │   │   └── [BRANCH J30-B16] Delete has no confirmation
│   │   ├── [STEP S136] Browser failure/recovery
│   │   │   ├── [BRANCH J30-B17] Setup/service/session error detail
│   │   │   ├── [BRANCH J30-B18] Reopen/reload surface as implicit retry
│   │   │   ├── [BRANCH J30-B19] Open dependencies/settings path
│   │   │   └── [BRANCH J30-B20] Abandon Browser
│   │   ├── [EXIT J30-X01] Browser ready/session running
│   │   ├── [EXIT J30-X02] Browser session stopped/deleted
│   │   └── [EXIT J30-X03] Setup/session abandoned
│   │
│   └── [JOURNEY J31] Configure plugins and enter plugin-defined journeys [D/W/P]
│       ├── [ENTRY J31-E01] Settings → Plugins
│       ├── [ENTRY J31-E02] Installed plugin tab/navigation contribution
│       ├── [STEP S137] Core plugin settings/catalog
│       │   ├── [BRANCH J31-B01] Loading/empty/list/error
│       │   ├── [BRANCH J31-B02] Inspect plugin metadata/documentation
│       │   ├── [BRANCH J31-B03] Enable/disable/configure/install action supplied by core
│       │   └── [BRANCH J31-B04] External plugin link
│       ├── [STEP S138] Plugin configuration/result
│       │   ├── [BRANCH J31-B05] Enter plugin-specific base configuration
│       │   ├── [BRANCH J31-B06] Save/load success
│       │   ├── [BRANCH J31-B07] Failure → core error/retry
│       │   └── [BRANCH J31-B08] Return to catalog
│       ├── [STEP S139] [P] Plugin runtime mount boundary
│       │   ├── [BRANCH J31-B09] Fetch plugin JavaScript with authenticated request
│       │   ├── [BRANCH J31-B10] Mount third-party-defined UI
│       │   ├── [BRANCH J31-B11] Every inner CTA/route/state is plugin-owned and not statically enumerable
│       │   └── [BRANCH J31-B12] Plugin asks core host for navigation/data
│       ├── [STEP S140] Plugin load/runtime failure and return
│       │   ├── [BRANCH J31-B13] Fetch/parse/mount/runtime error
│       │   ├── [BRANCH J31-B14] Retry/reload where exposed
│       │   ├── [BRANCH J31-B15] Disable/return to Plugins
│       │   └── [BRANCH J31-B16] External plugin support/docs
│       ├── [EXIT J31-X01] Plugin-defined journey continues outside core audit boundary
│       ├── [EXIT J31-X02] Return to core Settings/workspace
│       └── [EXIT J31-X03] External plugin documentation/support
│
└── [JOB JOB-08] Maintain, troubleshoot, and re-enter the product
    ├── [JOURNEY J32] Check and install Desktop updates [D]
    │   ├── [ENTRY J32-E01] Automatic update check
    │   ├── [ENTRY J32-E02] Native menu/tray Check for updates
    │   ├── [ENTRY J32-E03] About version/update action
    │   ├── [STEP S141] Update status / available-update prompt
    │   │   ├── [BRANCH J32-B01] Checking → no update/current
    │   │   ├── [BRANCH J32-B02] Update available → inspect version/release details
    │   │   ├── [BRANCH J32-B03] Download/install → S142
    │   │   └── [BRANCH J32-B04] Later/dismiss
    │   ├── [STEP S142] Update download/install progress
    │   │   ├── [BRANCH J32-B05] Download progress
    │   │   ├── [BRANCH J32-B06] Integrity/identity validation
    │   │   ├── [BRANCH J32-B07] Ready to restart/install
    │   │   └── [BRANCH J32-B08] Restart/install application
    │   ├── [STEP S143] Update failure/recovery
    │   │   ├── [BRANCH J32-B09] Network/feed/download/checksum/install error
    │   │   ├── [BRANCH J32-B10] Retry
    │   │   ├── [BRANCH J32-B11] Copy/open release diagnostics
    │   │   └── [BRANCH J32-B12] Dismiss and remain on current version
    │   ├── [STEP S144] Up-to-date / dismissed state
    │   │   ├── [BRANCH J32-B13] Current version confirmation
    │   │   ├── [BRANCH J32-B14] Return to About/workspace
    │   │   └── [BRANCH J32-B15] External release page where configured
    │   ├── [EXIT J32-X01] Updated app restarts into launcher
    │   ├── [EXIT J32-X02] Current app remains open
    │   └── [EXIT J32-X03] External release information
    │
    ├── [JOURNEY J33] Report an issue and share diagnostics [D/W]
    │   ├── [ENTRY J33-E01] Report Issue control when issueTrackerUrl is configured
    │   ├── [ENTRY J33-E02] About/help/report recovery entry
    │   ├── [STEP S145] Report Issue availability gate
    │   │   ├── [BRANCH J33-B01] Null tracker URL → control absent by design
    │   │   ├── [BRANCH J33-B02] Valid GitHub/GitLab URL → S146
    │   │   └── [BRANCH J33-B03] Invalid/insecure configuration rejected by build validation
    │   ├── [STEP S146] Redacted issue preview and consent
    │   │   ├── [BRANCH J33-B04] Review title/body/version/OS preview
    │   │   ├── [BRANCH J33-B05] Consent to version/OS prefill
    │   │   ├── [BRANCH J33-B06] Local paths/email/project names/URLs/tokens/secrets redacted
    │   │   └── [BRANCH J33-B07] Edit/cancel
    │   ├── [STEP S147] Diagnostics opt-in/copy
    │   │   ├── [BRANCH J33-B08] Separately opt in to diagnostics
    │   │   ├── [BRANCH J33-B09] Preview redacted diagnostics
    │   │   ├── [BRANCH J33-B10] Copy diagnostics → clipboard feedback
    │   │   └── [BRANCH J33-B11] Opt out → preview S146
    │   ├── [STEP S148] Issue tracker handoff
    │   │   ├── [BRANCH J33-B12] Open issue tracker
    │   │   ├── [BRANCH J33-B13] System browser receives encoded draft
    │   │   └── [BRANCH J33-B14] Browser-open failure → remain/copy
    │   ├── [STEP S149] Report Issue invalid/unavailable recovery
    │   │   ├── [BRANCH J33-B15] Tracker not configured → surface intentionally hidden
    │   │   ├── [BRANCH J33-B16] Diagnostics collection fails → report without diagnostics
    │   │   ├── [BRANCH J33-B17] Clipboard fails → select/copy manually
    │   │   └── [BRANCH J33-B18] External tracker unavailable → retain draft
    │   ├── [EXIT J33-X01] External issue form opened
    │   ├── [EXIT J33-X02] Diagnostics copied
    │   └── [EXIT J33-X03] Preview cancelled/retained
    │
    └── [JOURNEY J34] Notifications, deep links, route recovery, and offline [D/W]
        ├── [ENTRY J34-E01] Root route /
        ├── [ENTRY J34-E02] /session/:sessionId
        ├── [ENTRY J34-E03] /session/:sessionId/subagent/:subagentSessionId
        ├── [ENTRY J34-E04] Service-worker notification click
        ├── [ENTRY J34-E05] Browser navigation while offline
        ├── [STEP S150] Root-route bootstrap
        │   ├── [BRANCH J34-B01] Auth/runtime/onboarding resolution → J03/J04
        │   ├── [BRANCH J34-B02] Existing selection restored
        │   ├── [BRANCH J34-B03] No project/session → workspace empty state
        │   └── [BRANCH J34-B04] Initialization error → S158
        ├── [STEP S151] Session deep-link loading and canonicalization
        │   ├── [BRANCH J34-B05] Load session/project/provider history
        │   ├── [BRANCH J34-B06] Canonical alias differs → replace route
        │   ├── [BRANCH J34-B07] Active project/session → Chat S043
        │   └── [BRANCH J34-B08] Archived project → S152
        ├── [STEP S152] Archived-project synthesis
        │   ├── [BRANCH J34-B09] Create temporary archived project context
        │   ├── [BRANCH J34-B10] Render archived session transcript
        │   ├── [BRANCH J34-B11] Select another project/session
        │   └── [BRANCH J34-B12] Missing history → S154
        ├── [STEP S153] Subagent deep-link resolution
        │   ├── [BRANCH J34-B13] Resolve parent and subagent history
        │   ├── [BRANCH J34-B14] Redirect to canonical parent/subagent route
        │   ├── [BRANCH J34-B15] Render subagent transcript S053
        │   └── [BRANCH J34-B16] Unknown child → parent/fallback S154
        ├── [STEP S154] Unknown-session fallback
        │   ├── [BRANCH J34-B17] Unknown/deleted session → safe root/alternate selection
        │   ├── [BRANCH J34-B18] Session load failure → retry
        │   ├── [BRANCH J34-B19] Return to project/session list
        │   └── [BRANCH J34-B20] Abandon invalid deep link
        ├── [STEP S155] Notification click — existing client
        │   ├── [BRANCH J34-B21] Find existing window client
        │   ├── [BRANCH J34-B22] Focus client
        │   └── [BRANCH J34-B23] Navigate focused client to /session/:sessionId → S151
        ├── [STEP S156] Notification click — new client
        │   ├── [BRANCH J34-B24] No existing client
        │   ├── [BRANCH J34-B25] Open new /session/:sessionId window
        │   └── [BRANCH J34-B26] Continue through auth/deep-link resolution
        ├── [STEP S157] Offline navigation fallback
        │   ├── [BRANCH J34-B27] Service worker cannot fulfill navigation
        │   ├── [BRANCH J34-B28] Minimal raw HTML “Offline” page
        │   └── [BRANCH J34-B29] Browser retry/reload when connection returns
        ├── [STEP S158] Main error boundary / route recovery
        │   ├── [BRANCH J34-B30] Unexpected render error → fallback
        │   ├── [BRANCH J34-B31] Retry/reset boundary
        │   ├── [BRANCH J34-B32] Reset key/context change recovers
        │   └── [BRANCH J34-B33] Repeated failure → root/reload
        ├── [EXIT J34-X01] Requested session/subagent active
        ├── [EXIT J34-X02] Safe workspace fallback
        ├── [EXIT J34-X03] Offline page/reload
        └── [EXIT J34-X04] Invalid route abandoned

# Phase 3 — Step Fact Sheets and Step-Level UX Audit

Each sheet includes the required facts plus a five-part audit: information architecture (IA), journey integrity, CTA hierarchy, accessibility, and feedback/system status. “Pass” means no evidence-backed defect was found in this audit, not that the surface is mathematically defect-free. Finding IDs resolve in the Problems Report.

### STEP FACT SHEET — S001
Screen Name: Desktop launcher — Local ready state  
Journey: J01 Desktop local launch | Position: 1 of 4  
Primary User Job: Enter the local product.  
Primary CTA: Open Local Workspace | Secondary Actions: Open in browser; Local Settings; close.  
Entry Sources: Installed-app launch; launcher reopen | Next Step: S002 or S005 | Back Path: Native close/quit.  
Required Information: Local runtime readiness and intended opening mode | Dependencies: Electron launcher, product config.  
Potential Friction: None evidenced in CTA hierarchy.  
Notes: [D]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: launcher dialog-shell concern M-1 applies after opening Settings; Feedback: Pass.

### STEP FACT SHEET — S002
Screen Name: Local-server startup progress  
Journey: J01 Desktop local launch | Position: 2 of 4  
Primary User Job: Understand startup and wait or recover.  
Primary CTA: Current truthful stage; Retry only after failure | Secondary Actions: Copy diagnostics.  
Entry Sources: Open Local Workspace; Open in browser; retry/repair | Next Step: S004 or S003 | Back Path: Launcher after cancellation/close.  
Required Information: Server stage, version/build identity | Dependencies: bundled runtime, local server, identity check.  
Potential Friction: Long startup can become abandonment if stages stall without elapsed detail.  
Notes: [D]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: Pass; Feedback: loading/failure branches present.

### STEP FACT SHEET — S003
Screen Name: Startup failure / compatibility repair  
Journey: J01 Desktop local launch | Position: 3 of 4  
Primary User Job: Restore a compatible local runtime.  
Primary CTA: Retry, or Restart and repair for identity mismatch | Secondary Actions: Copy diagnostics.  
Entry Sources: Startup/identity failure | Next Step: S002 | Back Path: Remain on launcher or quit.  
Required Information: Failure class and retained logs | Dependencies: diagnostics, installer, server process control.  
Potential Friction: Repeated failure has no guided escalation when Report Issue is unconfigured.  
Notes: [D]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: Pass; Feedback: persistent stages and recovery present.

### STEP FACT SHEET — S004
Screen Name: Local workspace handoff  
Journey: J01 Desktop local launch | Position: 4 of 4  
Primary User Job: Reach the selected workspace host.  
Primary CTA: Automatic handoff | Secondary Actions: None during successful handoff.  
Entry Sources: Successful startup | Next Step: S022 or S008 | Back Path: Close workspace to launcher/native lifecycle.  
Required Information: Runtime mode and one-time browser bootstrap where applicable | Dependencies: Electron view host, local session bootstrap, router.  
Potential Friction: Expired external-browser bootstraps add a recovery loop.  
Notes: [D]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: Pass; Feedback: recovery S011 exists.

### STEP FACT SHEET — S005
Screen Name: Desktop Local Settings sheet  
Journey: J02 Desktop configuration and LAN access | Position: 1 of 3  
Primary User Job: Inspect or change Desktop runtime access settings.  
Primary CTA: Apply only after a change | Secondary Actions: Enable LAN; cancel/close.  
Entry Sources: Launcher; native app/tray settings | Next Step: S006 or S007 | Back Path: S001.  
Required Information: Runtime mode, port, local data and access settings | Dependencies: Electron IPC and local server config.  
Potential Friction: Sheet lacks dialog semantics, initial focus, containment, and reliable focus return (M-1).  
Notes: [D]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: M-1; Feedback: validation/restart states exist.

### STEP FACT SHEET — S006
Screen Name: LAN authentication configuration  
Journey: J02 Desktop configuration and LAN access | Position: 2 of 3  
Primary User Job: Secure explicit LAN/remote access.  
Primary CTA: Continue/Apply valid configuration | Secondary Actions: Disable LAN; cancel.  
Entry Sources: Enable LAN in S005 | Next Step: S007 | Back Path: S005.  
Required Information: LAN intent and required credentials | Dependencies: runtime-mode policy, auth service, restart.  
Potential Friction: Security consequences depend on clear language before restart.  
Notes: [D]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: M-1 inherited from sheet; Feedback: inline validation present.

### STEP FACT SHEET — S007
Screen Name: Apply configuration / restart state  
Journey: J02 Desktop configuration and LAN access | Position: 3 of 3  
Primary User Job: Activate the chosen access boundary safely.  
Primary CTA: Apply and restart | Secondary Actions: Cancel.  
Entry Sources: Valid S005/S006 change | Next Step: S002/S004 or S003 | Back Path: S005 before applying.  
Required Information: Changed mode and restart impact | Dependencies: process restart and auth configuration.  
Potential Friction: Restart disrupts context; failure returns to technical recovery.  
Notes: [D]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: M-1 inherited; Feedback: success/failure branches present.

### STEP FACT SHEET — S008
Screen Name: Protected-route authentication resolver  
Journey: J03 Standalone authentication and session recovery | Position: 1 of 4  
Primary User Job: Enter through the correct mode-aware auth boundary.  
Primary CTA: Automatic resolution | Secondary Actions: None while loading.  
Entry Sources: Standalone URL; browser handoff; expired session | Next Step: S009/S010/S011/S022 | Back Path: Browser back or Desktop launcher.  
Required Information: Runtime mode, auth status, onboarding status | Dependencies: auth/status APIs and local bootstrap.  
Potential Friction: Standalone users later have no reachable logout/profile action (B-1).  
Notes: [W/D browser]. Audit — IA: B-1; Journey: B-1; CTA: Pass; Accessibility: Pass; Feedback: loading and recovery differentiated.

### STEP FACT SHEET — S009
Screen Name: Initial administrator setup  
Journey: J03 Standalone authentication and session recovery | Position: 2 of 4  
Primary User Job: Create the first authenticated standalone account.  
Primary CTA: Create account | Secondary Actions: None beyond form editing.  
Entry Sources: S008 needs-setup branch | Next Step: S012 | Back Path: Browser close/back.  
Required Information: Username, password, password confirmation | Dependencies: auth setup API.  
Potential Friction: No product-level account-management destination is exposed afterward (B-1).  
Notes: [W]. Audit — IA: B-1 downstream; Journey: otherwise Pass; CTA: Pass; Accessibility: Pass; Feedback: validation/server error preserves form.

### STEP FACT SHEET — S010
Screen Name: Standalone login  
Journey: J03 Standalone authentication and session recovery | Position: 3 of 4  
Primary User Job: Authenticate to standalone/LAN mode.  
Primary CTA: Log in | Secondary Actions: Edit credentials.  
Entry Sources: S008 unauthenticated branch | Next Step: S012 or S022 | Back Path: Browser close/back.  
Required Information: Username and password | Dependencies: auth API/session storage.  
Potential Friction: No reachable Logout means shared-device users cannot intentionally end the session (B-1).  
Notes: [W]. Audit — IA: Pass on entry; Journey: B-1 on exit; CTA: Pass; Accessibility: Pass; Feedback: inline auth/network error present.

### STEP FACT SHEET — S011
Screen Name: Desktop browser session recovery  
Journey: J03 Standalone authentication and session recovery | Position: 4 of 4  
Primary User Job: Restore an expired one-time Desktop browser session.  
Primary CTA: Open in browser again from Desktop | Secondary Actions: Retry.  
Entry Sources: Invalid/expired browser bootstrap | Next Step: S001/S008 | Back Path: Browser back/close.  
Required Information: Why the bootstrap expired and where to restart it | Dependencies: launcher bootstrap endpoint.  
Potential Friction: Requires switching applications and repeating the handoff.  
Notes: [D browser]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: Pass; Feedback: contextual recovery present.

### STEP FACT SHEET — S012
Screen Name: Agent Connections onboarding step  
Journey: J04 First-run onboarding and provider connection | Position: 1 of 4  
Primary User Job: Optionally connect AI coding providers.  
Primary CTA: Continue | Secondary Actions: Per-provider Login; refresh; skip via continue.  
Entry Sources: First authenticated run | Next Step: S013 or S014 | Back Path: Previous onboarding state/browser close.  
Required Information: Provider availability and auth status | Dependencies: provider catalog/status APIs.  
Potential Friction: Several provider cards compete for attention, though authentication is correctly optional.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: Pass; Feedback: status refresh after login present.

### STEP FACT SHEET — S013
Screen Name: Provider CLI login terminal dialog  
Journey: J04 First-run onboarding and provider connection | Position: 2 of 4  
Primary User Job: Complete provider-owned CLI authentication.  
Primary CTA: Provider terminal action dictated by CLI | Secondary Actions: Close/cancel/retry.  
Entry Sources: Onboarding or Agent Settings/provider recovery | Next Step: S012/S117/S041 | Back Path: Close to origin.  
Required Information: Selected provider and terminal output | Dependencies: provider CLI, command-terminal WebSocket.  
Potential Friction: CLI text may be technical and provider-dependent.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: dialog behavior requires provider modal implementation; Feedback: streaming and terminal exit status present.

### STEP FACT SHEET — S014
Screen Name: Git configuration onboarding step  
Journey: J04 First-run onboarding and provider connection | Position: 3 of 4  
Primary User Job: Optionally establish Git identity.  
Primary CTA: Continue/Save and continue | Secondary Actions: Skip; Back.  
Entry Sources: S012 Continue | Next Step: S015 | Back Path: S012.  
Required Information: Optional Git name/email | Dependencies: Git configuration API.  
Potential Friction: Failure feedback must distinguish absent Git from invalid identity.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: Pass; Feedback: no runtime blocker observed.

### STEP FACT SHEET — S015
Screen Name: Onboarding completion  
Journey: J04 First-run onboarding and provider connection | Position: 4 of 4  
Primary User Job: Confirm setup and enter the workspace.  
Primary CTA: Complete Setup | Secondary Actions: Back.  
Entry Sources: Final onboarding step | Next Step: S022 | Back Path: S014.  
Required Information: Completion status | Dependencies: onboarding status API.  
Potential Friction: Completion failure retains users in setup but offers limited escalation.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: Pass; Feedback: success/retry branch present.

### STEP FACT SHEET — S016
Screen Name: Cloud environments list  
Journey: J05 Cloud environment management | Position: 1 of 3  
Primary User Job: Find or create a hosted environment.  
Primary CTA: Open selected environment or Create when empty | Secondary Actions: Refresh; return local.  
Entry Sources: Cloud launcher navigation/deep action | Next Step: S017/S018 | Back Path: Local launcher.  
Required Information: Cloud account, environment states | Dependencies: features.cloud and hosted services.  
Potential Friction: Not runtime-auditable in the default feature-disabled build.  
Notes: [C]. Audit — IA: Conditional; Journey: structurally mapped; CTA: state-dependent; Accessibility/Feedback: source-level only.

### STEP FACT SHEET — S017
Screen Name: Cloud environment configuration  
Journey: J05 Cloud environment management | Position: 2 of 3  
Primary User Job: Add or edit a hosted environment.  
Primary CTA: Save environment | Secondary Actions: Cancel.  
Entry Sources: Create/edit from S016 | Next Step: S016/S018 | Back Path: S016.  
Required Information: Endpoint and Cloud authentication/configuration | Dependencies: gated Cloud APIs.  
Potential Friction: Advanced endpoint/auth concepts risk premature configuration.  
Notes: [C]. Audit — IA: Conditional; Journey: structurally completable when enabled; CTA: Pass by source; Accessibility/Feedback: not runtime verified.

### STEP FACT SHEET — S018
Screen Name: Cloud environment start/open state  
Journey: J05 Cloud environment management | Position: 3 of 3  
Primary User Job: Start and enter a hosted workspace.  
Primary CTA: Open environment when ready | Secondary Actions: Retry; Stop; Settings.  
Entry Sources: Select environment in S016 | Next Step: Hosted workspace or S016 | Back Path: S016.  
Required Information: Environment readiness and connection status | Dependencies: gated Cloud runtime.  
Potential Friction: Long-running remote provisioning requires truthful stages and cancellation.  
Notes: [C]. Audit — IA: Conditional; Journey: source-mapped; CTA: state-dependent; Accessibility/Feedback: not runtime verified.

### STEP FACT SHEET — S019
Screen Name: Native application menu  
Journey: J06 Native application and tray commands | Position: 1 of 3  
Primary User Job: Invoke app-level commands.  
Primary CTA: Contextual native menu item | Secondary Actions: Settings; updates; quit.  
Entry Sources: Operating-system application menu | Next Step: S004/S005/S141 or exit | Back Path: Dismiss native menu.  
Required Information: Current app/window/update state | Dependencies: Electron native menu.  
Potential Friction: Platform-specific command placement can differ.  
Notes: [D]. Audit — IA: Pass; Journey: Pass; CTA: native convention; Accessibility: OS-owned; Feedback: destination-owned.

### STEP FACT SHEET — S020
Screen Name: System tray menu  
Journey: J06 Native application and tray commands | Position: 2 of 3  
Primary User Job: Restore or control the app from the background.  
Primary CTA: Open/Show CloudCLI | Secondary Actions: Local Settings; update; quit.  
Entry Sources: Tray icon | Next Step: S001/S004/S005/S141 | Back Path: Dismiss menu.  
Required Information: Window/server state | Dependencies: tray support per OS.  
Potential Friction: Tray availability and close behavior vary by platform.  
Notes: [D]. Audit — IA: Pass; Journey: Pass; CTA: native convention; Accessibility: OS-owned; Feedback: destination-owned.

### STEP FACT SHEET — S021
Screen Name: Window lifecycle  
Journey: J06 Native application and tray commands | Position: 3 of 3  
Primary User Job: Hide, restore, or leave the application predictably.  
Primary CTA: Platform window control | Secondary Actions: Dock/tray reopen; external-link handoff.  
Entry Sources: Close/minimize/reopen/external URL | Next Step: Prior surface or system browser | Back Path: Reopen window.  
Required Information: Platform close semantics | Dependencies: Electron window host.  
Potential Friction: Close-versus-hide ambiguity can leave a local server running unexpectedly.  
Notes: [D]. Audit — IA: Minor convention risk; Journey: Pass; CTA: OS-owned; Accessibility: OS-owned; Feedback: tray state should remain clear.

### STEP FACT SHEET — S022
Screen Name: Main workspace shell and header  
Journey: J07 Workspace navigation, search, and command palette | Position: 1 of 5  
Primary User Job: Orient within the active project/session and choose a work surface.  
Primary CTA: Active tab’s job | Secondary Actions: Tabs; drawer; menu; export when in Chat.  
Entry Sources: Root/deep link; launcher/auth/onboarding | Next Step: Main tab journey or S096 | Back Path: Sidebar/root route.  
Required Information: Active project, session, tab, responsive mode | Dependencies: app state, router, feature flags.  
Potential Friction: At 320 px the title collapses to zero width and Open menu is 32×32 (M-3).  
Notes: [D/W]. Audit — IA: M-3 orientation loss; Journey: Pass; CTA: tab-specific; Accessibility: M-3 and systemic M-5/M-7; Feedback: error boundary exists.

### STEP FACT SHEET — S023
Screen Name: Expanded desktop sidebar  
Journey: J07 Workspace navigation, search, and command palette | Position: 2 of 5  
Primary User Job: Find and switch projects, sessions, and global destinations.  
Primary CTA: Selected destination | Secondary Actions: Search; create; Settings; collapse; row menus.  
Entry Sources: Desktop workspace; expand control | Next Step: S025/J08/J09/J25 | Back Path: Collapse to S024.  
Required Information: Project/session hierarchy and active context | Dependencies: project/session stores.  
Potential Friction: Dense nested actions and systemic non-semantic click targets reduce keyboard confidence (M-5).  
Notes: [D/W]. Audit — IA: hierarchy generally clear; Journey: Pass; CTA: neutral navigation; Accessibility: M-5/M-6/M-7 scope; Feedback: loading/empty/error varies by data source.

### STEP FACT SHEET — S024
Screen Name: Collapsed desktop sidebar / mobile navigation drawer  
Journey: J07 Workspace navigation, search, and command palette | Position: 3 of 5  
Primary User Job: Reach global navigation in constrained space.  
Primary CTA: Chosen destination | Secondary Actions: Expand/close/backdrop.  
Entry Sources: Collapse control; mobile hamburger | Next Step: Destination/S023 | Back Path: Close/backdrop.  
Required Information: Current destination and drawer open state | Dependencies: responsive preferences and focus management.  
Potential Friction: Mobile drawer takes no initial focus, ignores Escape, and leaves background exposed to assistive tech (M-2).  
Notes: [D/W]. Audit — IA: Pass visually; Journey: M-2; CTA: Pass; Accessibility: M-2/M-5; Feedback: selection closes, keyboard dismissal fails.

### STEP FACT SHEET — S025
Screen Name: Sidebar project/session search  
Journey: J07 Workspace navigation, search, and command palette | Position: 4 of 5  
Primary User Job: Find a project or session by name.  
Primary CTA: Select result | Secondary Actions: Clear query.  
Entry Sources: Sidebar search control | Next Step: S034/S035 | Back Path: Clear/close to S023.  
Required Information: Search query and indexed loaded list | Dependencies: project/session store.  
Potential Friction: Search is scoped to already discoverable project/session metadata.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: systemic M-5 where click semantics apply; Feedback: no-result branch present.

### STEP FACT SHEET — S026
Screen Name: Command palette  
Journey: J07 Workspace navigation, search, and command palette | Position: 5 of 5  
Primary User Job: Navigate or invoke a common command from the keyboard.  
Primary CTA: Selected command | Secondary Actions: Search; Escape.  
Entry Sources: Keyboard shortcut/registered opener | Next Step: Destination journey | Back Path: Escape/outside/selection focus return.  
Required Information: Registered commands and feature flags | Dependencies: PaletteOps registry.  
Potential Friction: Go to Tasks remains visible when Tasks is disabled, then silently redirects to Chat (M-4).  
Notes: [D/W]. Audit — IA: M-4 false affordance; Journey: M-4; CTA: ambiguous affected command; Accessibility: keyboard path otherwise present; Feedback: missing disabled explanation.

### STEP FACT SHEET — S027
Screen Name: Project wizard — choose source mode  
Journey: J08 Create or clone a project | Position: 1 of 7  
Primary User Job: Choose existing folder versus repository clone.  
Primary CTA: Continue after selection | Secondary Actions: Cancel.  
Entry Sources: New Project sidebar/palette/empty state | Next Step: S028 or S030 | Back Path: Cancel to origin.  
Required Information: Source mode | Dependencies: project wizard.  
Potential Friction: Disabled Continue must keep its enabling explanation visible.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: Pass; Feedback: selection/disabled state explicit.

### STEP FACT SHEET — S028
Screen Name: Existing-folder configuration  
Journey: J08 Create or clone a project | Position: 2 of 7  
Primary User Job: Register a local folder.  
Primary CTA: Review | Secondary Actions: Browse; Back; Cancel.  
Entry Sources: Existing-folder choice | Next Step: S029/S032 | Back Path: S027.  
Required Information: Canonical folder path | Dependencies: workspace path API and permissions.  
Potential Friction: Raw paths are unavoidable here but errors must focus the exact field.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: Pass; Feedback: structured invalid/unwritable/duplicate branches.

### STEP FACT SHEET — S029
Screen Name: Folder browser dialog  
Journey: J08 Create or clone a project | Position: 3 of 7  
Primary User Job: Choose an accessible local directory.  
Primary CTA: Select folder | Secondary Actions: Parent navigation; cancel; retry.  
Entry Sources: Browse in S028 | Next Step: S028 | Back Path: Cancel to S028.  
Required Information: Directory hierarchy and permission status | Dependencies: directory browsing API and shared Dialog.  
Potential Friction: Deep folder traversal has limited breadcrumb space at narrow widths.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: shared dialog behavior; Feedback: loading/permission/server failure distinct.

### STEP FACT SHEET — S030
Screen Name: Clone repository configuration  
Journey: J08 Create or clone a project | Position: 4 of 7  
Primary User Job: Specify repository and destination.  
Primary CTA: Review | Secondary Actions: Back; Cancel; credential recovery after failure.  
Entry Sources: Clone choice | Next Step: S031/S032 | Back Path: S027.  
Required Information: Repository URL and destination | Dependencies: Git, clone validation API, network.  
Potential Friction: Numerous structured failure classes can overwhelm if shown before relevant.  
Notes: [D/W]. Audit — IA: progressive disclosure Pass; Journey: Pass; CTA: Pass; Accessibility: Pass; Feedback: structured recovery mapped.

### STEP FACT SHEET — S031
Screen Name: Clone credential / GitHub authentication disclosure  
Journey: J08 Create or clone a project | Position: 5 of 7  
Primary User Job: Authenticate only after a private-repository failure.  
Primary CTA: Retry validation/Continue | Secondary Actions: Add/change saved credential; cancel.  
Entry Sources: Auth-required clone validation | Next Step: S030/S032 | Back Path: S030.  
Required Information: Credential/profile and failed clone context | Dependencies: credential APIs and secure storage.  
Potential Friction: Credential mutation feedback inherits Settings console-only risk M-21.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: Pass; Feedback: original inputs preserved.

### STEP FACT SHEET — S032
Screen Name: Project operation review  
Journey: J08 Create or clone a project | Position: 6 of 7  
Primary User Job: Confirm the exact project operation and destination.  
Primary CTA: Open project or Clone repository | Secondary Actions: Back; Cancel.  
Entry Sources: Valid local/clone configuration | Next Step: S033 | Back Path: S028/S030.  
Required Information: Operation type and canonical path | Dependencies: validated wizard state.  
Potential Friction: None evidenced; review appropriately precedes mutation.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: one state-specific primary; Accessibility: Pass; Feedback: exact operation disclosed.

### STEP FACT SHEET — S033
Screen Name: Register/clone progress and result  
Journey: J08 Create or clone a project | Position: 7 of 7  
Primary User Job: Complete or safely recover the project operation.  
Primary CTA: Stage-dependent Open project or Retry | Secondary Actions: Cancel clone; choose another destination; diagnostics.  
Entry Sources: Confirmed review | Next Step: S034 or configuration | Back Path: Safe cancel to S030 where possible.  
Required Information: Attempt ID, progress stages, result/error type | Dependencies: project/clone services and scoped cleanup.  
Potential Friction: Partial cleanup failures are technical and need plain-language next steps.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: Pass; Feedback: progress, cancellation, terminal success/recovery present.

### STEP FACT SHEET — S034
Screen Name: Project selection and expansion  
Journey: J09 Project and session lifecycle | Position: 1 of 5  
Primary User Job: Activate a project and reveal its sessions.  
Primary CTA: Select project/session | Secondary Actions: Expand/collapse; create session; actions menu.  
Entry Sources: Sidebar/search/project creation | Next Step: S035/S036 | Back Path: Select prior project/root.  
Required Information: Project list, active ID, session summaries | Dependencies: project/session stores.  
Potential Friction: Refresh/mutation failures can use native dialogs or weak feedback (M-8).  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: systemic M-5; Feedback: M-8.

### STEP FACT SHEET — S035
Screen Name: Session selection and loading  
Journey: J09 Project and session lifecycle | Position: 2 of 5  
Primary User Job: Open a conversation in its project context.  
Primary CTA: Select session | Secondary Actions: Refresh; actions menu.  
Entry Sources: Sidebar/search/deep link | Next Step: S043 | Back Path: Prior session/project/root.  
Required Information: Session ID, provider, project, history | Dependencies: history transport and router.  
Potential Friction: Unknown/deleted histories detour to route fallback.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: Pass; Feedback: delayed skeleton and fallback present.

### STEP FACT SHEET — S036
Screen Name: Project actions menu  
Journey: J09 Project and session lifecycle | Position: 3 of 5  
Primary User Job: Rename, refresh, remove, or extend a project.  
Primary CTA: Chosen menu action | Secondary Actions: Other menu items/dismiss.  
Entry Sources: Project overflow/context menu | Next Step: S038 or J10 | Back Path: Dismiss to S034.  
Required Information: Target project and destructive impact | Dependencies: project APIs.  
Potential Friction: Rename/delete/refresh rely on browser prompt/confirm/alert patterns (M-8).  
Notes: [D/W]. Audit — IA: actions discoverable but overflow-hidden; Journey: M-8; CTA: native dialog hierarchy weak; Accessibility: browser-owned; Feedback: M-8.

### STEP FACT SHEET — S037
Screen Name: Session actions menu  
Journey: J09 Project and session lifecycle | Position: 4 of 5  
Primary User Job: Manage or reuse one session.  
Primary CTA: Chosen menu action | Secondary Actions: Rename; delete; refresh; fork/export/copy.  
Entry Sources: Session overflow/context menu | Next Step: S038/J12 | Back Path: Dismiss to S035.  
Required Information: Target session and active-state impact | Dependencies: session APIs/store.  
Potential Friction: Destructive and rename actions use browser dialogs; advanced utilities are hidden in overflow (M-8).  
Notes: [D/W]. Audit — IA: moderate discoverability cost; Journey: M-8; CTA: menu convention; Accessibility: systemic M-5; Feedback: M-8.

### STEP FACT SHEET — S038
Screen Name: Lifecycle feedback and fallback selection  
Journey: J09 Project and session lifecycle | Position: 5 of 5  
Primary User Job: Confirm a mutation and retain a valid context.  
Primary CTA: Contextual Retry/select fallback | Secondary Actions: Dismiss.  
Entry Sources: Project/session mutation result | Next Step: S034/S035/root | Back Path: Original list when mutation failed.  
Required Information: Result and replacement active item | Dependencies: refreshed stores/router.  
Potential Friction: Some failures surface as alert or console-only output, disrupting or hiding recovery (M-8).  
Notes: [D/W]. Audit — IA: Pass when visible; Journey: M-8; CTA: inconsistent; Accessibility: browser dialogs; Feedback: M-8.

### STEP FACT SHEET — S039
Screen Name: Chat/provider empty state  
Journey: J10 Prepare a chat and provider | Position: 1 of 4  
Primary User Job: Establish the minimum project/provider context for Chat.  
Primary CTA: Select provider or create/choose project, depending missing prerequisite | Secondary Actions: Model/profile/permission choices.  
Entry Sources: Chat without session/provider/project | Next Step: S040/S041/S042 | Back Path: Sidebar/project selection.  
Required Information: Project and provider selection catalog | Dependencies: catalog, auth status, project store.  
Potential Friction: Multiple prerequisites can compete if more than one is missing.  
Notes: [D/W]. Audit — IA: state-specific primary; Journey: Pass; CTA: Pass; Accessibility: Pass; Feedback: distinct catalog failure branch.

### STEP FACT SHEET — S040
Screen Name: Provider catalog loading/failure  
Journey: J10 Prepare a chat and provider | Position: 2 of 4  
Primary User Job: Restore provider selection without losing the draft.  
Primary CTA: Retry | Secondary Actions: Open Agent Settings.  
Entry Sources: Catalog request during Chat setup | Next Step: S039/S042/S117 | Back Path: Remain in Chat.  
Required Information: Typed catalog failure/status | Dependencies: selection-catalog API.  
Potential Friction: Persistent service failure blocks AI work but recovery is contextual.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: Pass; Feedback: input preservation and two recovery options present.

### STEP FACT SHEET — S041
Screen Name: Point-of-use provider connection  
Journey: J10 Prepare a chat and provider | Position: 3 of 4  
Primary User Job: Connect the selected AI provider only when needed.  
Primary CTA: Log in to selected provider | Secondary Actions: Cancel; open Agent Settings.  
Entry Sources: Provider-auth-required Chat state | Next Step: S013 then S042 | Back Path: Close to draft.  
Required Information: Provider and preserved draft | Dependencies: provider login terminal and auth status.  
Potential Friction: Provider CLI terminology can be unfamiliar.  
Notes: [D/W]. Audit — IA: progressive disclosure Pass; Journey: Pass; CTA: Pass; Accessibility: provider dialog dependent; Feedback: draft preserved on failure/cancel.

### STEP FACT SHEET — S042
Screen Name: New session composer  
Journey: J10 Prepare a chat and provider | Position: 4 of 4  
Primary User Job: Send the first instruction.  
Primary CTA: Send | Secondary Actions: Attach; voice; provider/model/permission menus.  
Entry Sources: New Session; resolved Chat empty state | Next Step: S043/S044 | Back Path: Project/session navigation.  
Required Information: Instruction, project, provider; model/permission optional | Dependencies: session store, Chat WebSocket.  
Potential Friction: Small mobile utility targets can affect secondary actions.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: systemic target debt; Feedback: inline validation/auth recovery present.

### STEP FACT SHEET — S043
Screen Name: Idle conversation and composer  
Journey: J11 Run and control an AI conversation | Position: 1 of 6  
Primary User Job: Read context and send the next instruction.  
Primary CTA: Send | Secondary Actions: Attach; voice; provider/model; export; message utilities.  
Entry Sources: Session load; completed/stopped run | Next Step: S044/J12 | Back Path: Prior project/session.  
Required Information: Transcript, draft, provider and run state | Dependencies: session history/store and WebSocket.  
Potential Friction: Long transcripts increase navigation/scroll burden.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: M-9 on mobile copy utility; Feedback: idle/run state clear.

### STEP FACT SHEET — S044
Screen Name: Running/streaming conversation  
Journey: J11 Run and control an AI conversation | Position: 2 of 6  
Primary User Job: Monitor or stop active inference.  
Primary CTA: Stop | Secondary Actions: Queue/edit next draft; inspect activity/tool output.  
Entry Sources: Send/resume/start task | Next Step: S043/S045/S046/S047/S048 | Back Path: Stop returns idle.  
Required Information: Streaming text, activity, provider, connection state | Dependencies: Chat WebSocket and realtime handlers.  
Potential Friction: Provider/network recovery can be cognitively complex mid-run.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Send correctly replaced by Stop; Accessibility: status text required; Feedback: stream/reconnect/terminal states present.

### STEP FACT SHEET — S045
Screen Name: Queued message / editable next draft  
Journey: J11 Run and control an AI conversation | Position: 3 of 6  
Primary User Job: Prepare the next instruction without interrupting the run.  
Primary CTA: Queue/save next message | Secondary Actions: Edit; cancel queued draft.  
Entry Sources: Compose while S044 runs | Next Step: Auto-send to S044 or cancel to S043 | Back Path: Edit/cancel.  
Required Information: Current run state and queued content | Dependencies: queued-message logic and session ownership.  
Potential Friction: Users may not distinguish queued from already sent content.  
Notes: [D/W]. Audit — IA: status must remain adjacent; Journey: Pass; CTA: Pass; Accessibility: Pass; Feedback: queue/edit/auto-send branches exist.

### STEP FACT SHEET — S046
Screen Name: Permission request panel/banner  
Journey: J11 Run and control an AI conversation | Position: 4 of 6  
Primary User Job: Decide whether an AI tool action may proceed.  
Primary CTA: Allow once or Deny, according to policy | Secondary Actions: Always allow; inspect details; cycle pending.  
Entry Sources: Provider permission event | Next Step: S044 | Back Path: Deny/cancel retains conversation.  
Required Information: Requested tool/command, scope, consequence | Dependencies: permission registry and WebSocket response.  
Potential Friction: Multiple pending requests and permanent choices increase decision risk.  
Notes: [D/W]. Audit — IA: Pass if consequence shown; Journey: Pass; CTA: risk-dependent; Accessibility: keyboard decision path required; Feedback: pending/submit failure mapped.

### STEP FACT SHEET — S047
Screen Name: Ask-user question panel  
Journey: J11 Run and control an AI conversation | Position: 5 of 6  
Primary User Job: Answer a provider-generated question.  
Primary CTA: Submit answer | Secondary Actions: Select options; enter text; cancel when supported.  
Entry Sources: Ask-user tool event | Next Step: S044 | Back Path: Validation/cancel remains in panel.  
Required Information: Question, constraints, selected response | Dependencies: interactive tool renderer.  
Potential Friction: Mixed single/multiple/free-text modes need clear selection semantics.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: form semantics required; Feedback: validation branch present.

### STEP FACT SHEET — S048
Screen Name: Plan/task approval and tool results  
Journey: J11 Run and control an AI conversation | Position: 6 of 6  
Primary User Job: Understand and respond to structured AI output.  
Primary CTA: Contextual Approve/Reject/Answer | Secondary Actions: Expand; paginate; open subagent.  
Entry Sources: Plan, tool, or subagent event | Next Step: S044 or S053 | Back Path: Collapse/return to transcript.  
Required Information: Proposed action/result and downstream effect | Dependencies: interactive renderer registry.  
Potential Friction: Large/paginated results can obscure the decision point.  
Notes: [D/W]. Audit — IA: context-dependent; Journey: Pass; CTA: should remain singular per renderer; Accessibility: structured semantics needed; Feedback: paginated status present.

### STEP FACT SHEET — S049
Screen Name: Message utility controls  
Journey: J12 Transcript utilities, export, fork, rewind, and subagents | Position: 1 of 5  
Primary User Job: Reuse or listen to one message.  
Primary CTA: Chosen utility | Secondary Actions: Copy; copy to composer; speak/stop.  
Entry Sources: Message hover/focus | Next Step: S050 or composer | Back Path: Blur/dismiss.  
Required Information: Message content/type | Dependencies: clipboard, speech, copy helpers.  
Potential Friction: Hover discoverability is weak for touch and keyboard users.  
Notes: [D/W]. Audit — IA: hidden secondary actions; Journey: Pass; CTA: neutral; Accessibility: M-9 at copy-format trigger; Feedback: copied/speaking status present.

### STEP FACT SHEET — S050
Screen Name: Copy-format menu  
Journey: J12 Transcript utilities, export, fork, rewind, and subagents | Position: 2 of 5  
Primary User Job: Choose how message content is copied.  
Primary CTA: Select format | Secondary Actions: Escape/outside dismiss.  
Entry Sources: Message Copy control | Next Step: Clipboard then S049 | Back Path: Escape/outside click.  
Required Information: Plain versus Markdown choice | Dependencies: clipboard API and ActionMenu.  
Potential Friction: At mobile width “Select copy format” measures about 20×16, far below 44×44 (M-9).  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: M-9; Feedback: transient copied state only.

### STEP FACT SHEET — S051
Screen Name: Session export menu and result  
Journey: J12 Transcript utilities, export, fork, rewind, and subagents | Position: 3 of 5  
Primary User Job: Export the current conversation.  
Primary CTA: Chosen Markdown/HTML/PDF/ZIP export | Secondary Actions: Close.  
Entry Sources: Single header Export control | Next Step: Download or Chat | Back Path: Close/Escape.  
Required Information: Active session and export format | Dependencies: session store, export APIs, PDF/ZIP helpers.  
Potential Friction: Large exports need durable progress; format differences may be unclear.  
Notes: [D/W]. Audit — IA: one discoverable Export control; Journey: Pass; CTA: Pass; Accessibility: menu semantics; Feedback: inline failure rather than alert.

### STEP FACT SHEET — S052
Screen Name: Fork or rewind session  
Journey: J12 Transcript utilities, export, fork, rewind, and subagents | Position: 4 of 5  
Primary User Job: Continue from an earlier conversation point.  
Primary CTA: Confirm Fork/Rewind | Secondary Actions: Cancel.  
Entry Sources: Session/message actions | Next Step: New/reset session | Back Path: Cancel retains original.  
Required Information: Selected revision and destructive history impact | Dependencies: fork/rewind APIs and revision registry.  
Potential Friction: Rewind uses a browser confirmation, separating consequence from transcript context (M-10).  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: M-10; Accessibility: browser-owned dialog; Feedback: original retained on cancel/failure.

### STEP FACT SHEET — S053
Screen Name: Subagent transcript navigation  
Journey: J12 Transcript utilities, export, fork, rewind, and subagents | Position: 5 of 5  
Primary User Job: Inspect a subagent’s work and return to its parent.  
Primary CTA: Open/return transcript | Secondary Actions: Browser back; transcript utilities.  
Entry Sources: Tool result; subagent deep link | Next Step: S153 or parent Chat | Back Path: Parent route/browser back.  
Required Information: Parent and child session IDs | Dependencies: router and provider histories.  
Potential Friction: Canonical redirect and unknown-child fallback can make orientation fragile.  
Notes: [D/W]. Audit — IA: parent relationship must remain visible; Journey: Pass; CTA: Pass; Accessibility: Pass; Feedback: fallback mapped.

### STEP FACT SHEET — S054
Screen Name: File tree browse state  
Journey: J13 File management | Position: 1 of 5  
Primary User Job: Find and open a project file.  
Primary CTA: File selection/opening | Secondary Actions: Expand; refresh; search; upload.  
Entry Sources: Files tab/project selection | Next Step: S055/S056/S057/S059 | Back Path: Project/sidebar/tab switch.  
Required Information: Canonical project tree and permission state | Dependencies: file-tree API.  
Potential Friction: Deep nesting can obscure location without breadcrumbs.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: tree keyboard semantics tested; Feedback: loading, empty, permission and server failure distinct.

### STEP FACT SHEET — S055
Screen Name: File search and detailed/list controls  
Journey: J13 File management | Position: 2 of 5  
Primary User Job: Narrow the tree and open a result.  
Primary CTA: Select result | Secondary Actions: Clear; switch presentation.  
Entry Sources: File-tree search/view controls | Next Step: S059-S062 | Back Path: Clear to S054.  
Required Information: Query and file metadata | Dependencies: loaded tree/search implementation.  
Potential Friction: Search scope and nested-path matching are not prominent.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: keyboard selection expected; Feedback: no-result state present.

### STEP FACT SHEET — S056
Screen Name: File/folder context and overflow menu  
Journey: J13 File management | Position: 3 of 5  
Primary User Job: Perform a file-system action on one target.  
Primary CTA: Selected action | Secondary Actions: New; rename; copy path; download; delete; dismiss.  
Entry Sources: Context click/row overflow | Next Step: S058 or editor/download | Back Path: Dismiss to S054.  
Required Information: Target type/path and destructive effect | Dependencies: file mutation APIs.  
Potential Friction: Overflow hides actions; deletion capability varies between Trash/Undo and confirmation.  
Notes: [D/W]. Audit — IA: discoverability cost; Journey: Pass; CTA: destructive separation required; Accessibility: keyboard menu path tested; Feedback: recovery mapped.

### STEP FACT SHEET — S057
Screen Name: Upload selection and progress  
Journey: J13 File management | Position: 4 of 5  
Primary User Job: Add files to the selected project folder.  
Primary CTA: Upload | Secondary Actions: Choose/drag; cancel per file; retry.  
Entry Sources: File-tree Upload/drag-and-drop | Next Step: S058/S054 | Back Path: Cancel/close selector.  
Required Information: Destination and selected files | Dependencies: upload API/XHR and runtime-mode headers.  
Potential Friction: Partial success needs per-file recovery and persistent results.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: drag has file-picker alternative; Feedback: persistent progress/result mapped.

### STEP FACT SHEET — S058
Screen Name: File mutation feedback  
Journey: J13 File management | Position: 5 of 5  
Primary User Job: Confirm or recover create/rename/delete/upload work.  
Primary CTA: Contextual Retry/Undo | Secondary Actions: Dismiss; select another file.  
Entry Sources: File mutation result | Next Step: S054/S062 | Back Path: Original tree/context.  
Required Information: Operation, target, result | Dependencies: refreshed tree and trash/undo support.  
Potential Friction: Capability-dependent delete behavior can be inconsistent.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: status not color-only required; Feedback: success/error/Undo present.

### STEP FACT SHEET — S059
Screen Name: Text/code editor  
Journey: J14 File editing and preview | Position: 1 of 4  
Primary User Job: Read, edit, and save a text file.  
Primary CTA: Save when dirty | Secondary Actions: Close/select another; preview where supported.  
Entry Sources: File selection/search | Next Step: Saved editor or S062 | Back Path: Tree/previous file.  
Required Information: File content, revision, dirty status | Dependencies: editor, file API, document guard.  
Potential Friction: Concurrent/deleted revision decisions can interrupt flow.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: state-specific Save; Accessibility: editor keyboard support; Feedback: load/save/conflict states present.

### STEP FACT SHEET — S060
Screen Name: Markdown preview  
Journey: J14 File editing and preview | Position: 2 of 4  
Primary User Job: Inspect rendered Markdown while retaining source access.  
Primary CTA: Toggle source/preview | Secondary Actions: Copy code; open link.  
Entry Sources: Markdown file/editor toggle | Next Step: S059 or external link | Back Path: Source view/tree.  
Required Information: Markdown source | Dependencies: renderer and safe link handling.  
Potential Friction: External destinations break product context.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: rendered headings/code/link semantics expected; Feedback: copy status present.

### STEP FACT SHEET — S061
Screen Name: Image/media preview  
Journey: J14 File editing and preview | Position: 3 of 4  
Primary User Job: Inspect supported media.  
Primary CTA: View content | Secondary Actions: Zoom; pan; reset; download.  
Entry Sources: Select image/media file | Next Step: Remain or download | Back Path: Tree/previous file.  
Required Information: Media type and source | Dependencies: viewer and file endpoint.  
Potential Friction: Two project images lack alt text in automated inventory, affecting nonvisual interpretation (M-7).  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: neutral viewer; Accessibility: M-7; Feedback: media-load alternate state present.

### STEP FACT SHEET — S062
Screen Name: Binary, unsupported, missing, and load-error state  
Journey: J14 File editing and preview | Position: 4 of 4  
Primary User Job: Understand why a file cannot be edited and choose recovery.  
Primary CTA: Retry or select another file | Secondary Actions: Download; close; refresh tree.  
Entry Sources: Unsupported/binary/deleted/failed file load | Next Step: S054/S059/download | Back Path: Tree.  
Required Information: File type and error class | Dependencies: file metadata/API.  
Potential Friction: Technical binary/load language can obscure the available outcome.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: Pass; Feedback: distinct alternate states and retry.

### STEP FACT SHEET — S063
Screen Name: Interactive terminal ready state  
Journey: J15 Local project Shell | Position: 1 of 4  
Primary User Job: Work in the registered project’s local login shell.  
Primary CTA: Terminal input | Secondary Actions: Restart; copy/paste; selection.  
Entry Sources: Shell tab/reconnect success | Next Step: Continues locally or S064 | Back Path: Switch tab/project.  
Required Information: Registered project ID and resolved cwd | Dependencies: interactive-terminal WebSocket and OS shell.  
Potential Friction: Terminal conventions are expert-oriented but appropriate to the job.  
Notes: [D]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: keyboard primary path; Feedback: connection state visible.

### STEP FACT SHEET — S064
Screen Name: Connecting/reconnecting overlay  
Journey: J15 Local project Shell | Position: 2 of 4  
Primary User Job: Understand connection progress and recover.  
Primary CTA: Automatic connect or Reconnect after failure | Secondary Actions: Restart.  
Entry Sources: Enter Shell; socket interruption | Next Step: S063/S065 | Back Path: Switch tab.  
Required Information: Connection stage/error | Dependencies: WebSocket/auth and shell process.  
Potential Friction: Repeated reconnect loops can obscure whether the process survived.  
Notes: [D]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: overlay status announced; Feedback: connecting/reconnecting/failure differentiated.

### STEP FACT SHEET — S065
Screen Name: Shell recovery state  
Journey: J15 Local project Shell | Position: 3 of 4  
Primary User Job: Restore an unavailable local terminal.  
Primary CTA: Contextual Retry/Reconnect or choose project | Secondary Actions: Open Files/settings where relevant.  
Entry Sources: Missing project/cwd/shell/socket; remote mode | Next Step: S063 or recovery journey | Back Path: Workspace tab.  
Required Information: Failure category and project path status | Dependencies: project registry, runtime mode, shell availability.  
Potential Friction: LAN/remote Shell is intentionally unavailable, which must be stated before effort.  
Notes: [D; remote disabled]. Audit — IA: Pass; Journey: Pass within product boundary; CTA: Pass; Accessibility: Pass; Feedback: contextual failures mapped.

### STEP FACT SHEET — S066
Screen Name: Mobile terminal selection/clipboard mode  
Journey: J15 Local project Shell | Position: 4 of 4  
Primary User Job: Select and transfer terminal text by touch.  
Primary CTA: Copy selected text | Secondary Actions: Adjust; paste; exit selection.  
Entry Sources: Long-press/touch gesture in terminal | Next Step: S063 | Back Path: Exit selection.  
Required Information: Selection range and clipboard availability | Dependencies: mobile terminal selection utility.  
Potential Friction: Scroll and selection gestures can conflict at 320 px.  
Notes: [D mobile]. Audit — IA: specialized; Journey: Pass; CTA: Pass; Accessibility: touch affordance needs 44 px; Feedback: selection state visible.

### STEP FACT SHEET — S067
Screen Name: Changes overview and repository status  
Journey: J16 Review changes and commit | Position: 1 of 6  
Primary User Job: Understand current branch and working-tree state.  
Primary CTA: Commit appears in composer, not transport actions | Secondary Actions: Refresh; fetch; file selection.  
Entry Sources: Git tab/project switch | Next Step: S068/S069/S072/S075 | Back Path: Workspace tab/project.  
Required Information: Repository, branch, ahead/behind and change groups | Dependencies: Git repository-state API.  
Potential Friction: Dense status information can compete with commit preparation.  
Notes: [D/W]. Audit — IA: branch/status above fold; Journey: Pass; CTA: transport neutral; Accessibility: status text accompanies color; Feedback: repository/error variants.

### STEP FACT SHEET — S068
Screen Name: Changed-file diff and staging  
Journey: J16 Review changes and commit | Position: 2 of 6  
Primary User Job: Decide exactly what enters the commit.  
Primary CTA: Stage/unstage selection as task action | Secondary Actions: Inspect diff; discard.  
Entry Sources: Changed-file row/group control | Next Step: S069/S077 | Back Path: Changes list.  
Required Information: Diff, file status, staged state | Dependencies: Git stage/diff/discard APIs.  
Potential Friction: Discard consequence and binary/large diff limitations require explicit recovery.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Commit remains sole primary; Accessibility: keyboard/status semantics; Feedback: confirm/Undo branches mapped.

### STEP FACT SHEET — S069
Screen Name: Commit composer  
Journey: J16 Review changes and commit | Position: 3 of 6  
Primary User Job: Record selected staged changes with an accurate message.  
Primary CTA: Commit | Secondary Actions: Generate message; cancel suggestion; transport actions.  
Entry Sources: Git Changes with staged files | Next Step: S070/S071 | Back Path: Continue reviewing changes.  
Required Information: Staged snapshot and commit message | Dependencies: Git commit API and suggestion controller.  
Potential Friction: Disabled Commit needs a nearby explanation for both missing message and missing staged files.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: Pass; Feedback: message retained on failure.

### STEP FACT SHEET — S070
Screen Name: AI commit-message suggestion  
Journey: J16 Review changes and commit | Position: 4 of 6  
Primary User Job: Draft a bounded, reviewable commit message.  
Primary CTA: Commit remains primary; suggestion decisions are neutral | Secondary Actions: Generate; Cancel; Use; Dismiss; Update; Keep current; Retry.  
Entry Sources: Generate message in S069 | Next Step: S069 | Back Path: Cancel/dismiss.  
Required Information: Provider, staged snapshot, data disclosure, existing draft | Dependencies: provider catalog and completion API.  
Potential Friction: Many comparison actions increase decision complexity.  
Notes: [D/W]. Audit — IA: disclosure/context strong; Journey: Pass; CTA: Pass; Accessibility: Pass; Feedback: progress/partial/cancel/recovery present.

### STEP FACT SHEET — S071
Screen Name: Commit progress/result  
Journey: J16 Review changes and commit | Position: 5 of 6  
Primary User Job: Confirm commit completion or repair a failed commit.  
Primary CTA: Retry/Review staged changes after failure | Secondary Actions: Dismiss success.  
Entry Sources: Commit from S069 | Next Step: S067/S069 | Back Path: Composer with message retained.  
Required Information: Snapshot, hook/index result, commit ID | Dependencies: Git commit/repository state APIs.  
Potential Friction: Concurrent snapshot change requires a safe re-review loop.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: status text; Feedback: terminal success and contextual errors present.

### STEP FACT SHEET — S072
Screen Name: No repository / Git unavailable  
Journey: J16 Review changes and commit | Position: 6 of 6  
Primary User Job: Establish source control or recover Git availability.  
Primary CTA: Initialize repository | Secondary Actions: Open Git Settings; choose project.  
Entry Sources: Git tab without repository/Git | Next Step: S067/S128 | Back Path: Other workspace tab.  
Required Information: Repository and Git availability | Dependencies: Git init/status APIs.  
Potential Friction: Git-not-installed versus no-repository must remain distinct.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: Pass; Feedback: distinct recovery branches.

### STEP FACT SHEET — S073
Screen Name: Git transport actions  
Journey: J17 Synchronize and recover Git operations | Position: 1 of 5  
Primary User Job: Synchronize the local branch with its remote.  
Primary CTA: Contextual Fetch/Pull/Push/Publish action, styled neutral beside Commit | Secondary Actions: Other safe transport actions.  
Entry Sources: Changes header/ahead-behind status | Next Step: S074/S075 | Back Path: Changes overview.  
Required Information: Remote, upstream, branch and working-tree state | Dependencies: Git transport APIs/network/credentials.  
Potential Friction: Four adjacent transport verbs can be unclear to novice users.  
Notes: [D/W]. Audit — IA: moderate expertise burden; Journey: Pass; CTA: neutral per contract; Accessibility: keyboard controls; Feedback: progress state follows.

### STEP FACT SHEET — S074
Screen Name: Transport progress/result  
Journey: J17 Synchronize and recover Git operations | Position: 2 of 5  
Primary User Job: Know whether synchronization succeeded and recover safely.  
Primary CTA: Contextual Retry/Publish/Open Settings | Secondary Actions: Dismiss/details.  
Entry Sources: Fetch/Pull/Push/Publish | Next Step: S067/S075/S128 | Back Path: Changes.  
Required Information: Operation, remote, error category | Dependencies: Git error normalization.  
Potential Friction: Auth, network, upstream, detached, and dirty-state recoveries can create branching overload.  
Notes: [D/W]. Audit — IA: Pass when normalized; Journey: Pass; CTA: context-specific; Accessibility: status text; Feedback: distinct recovery branches.

### STEP FACT SHEET — S075
Screen Name: Conflict detection and recovery banner  
Journey: J17 Synchronize and recover Git operations | Position: 3 of 5  
Primary User Job: Resolve an active merge/rebase conflict.  
Primary CTA: Resolve conflicts, then Continue merge/rebase | Secondary Actions: Abort with confirmation.  
Entry Sources: Conflict status/failed transport | Next Step: Files editor/S076/S077 | Back Path: Remain in conflict context.  
Required Information: Operation type and unresolved files | Dependencies: Git repository-state/recovery APIs.  
Potential Friction: Switching to Files can weaken orientation unless the recovery banner persists.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: sequential primary state; Accessibility: status not color-only; Feedback: active operation explicit.

### STEP FACT SHEET — S076
Screen Name: Destructive Git confirmation  
Journey: J17 Synchronize and recover Git operations | Position: 4 of 5  
Primary User Job: Confirm or cancel an irreversible recovery action.  
Primary CTA: Confirm named destructive outcome | Secondary Actions: Cancel.  
Entry Sources: Abort/reset/revert/delete action | Next Step: S077 | Back Path: S075/S067.  
Required Information: Exact action and data at risk | Dependencies: shared ConfirmActionModal.  
Potential Friction: Multiple Git destructive actions require operation-specific copy.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: destructive explicit; Accessibility: shared dialog focus behavior; Feedback: pending/result path.

### STEP FACT SHEET — S077
Screen Name: Git recovery and Undo result  
Journey: J17 Synchronize and recover Git operations | Position: 5 of 5  
Primary User Job: Verify recovery or undo a temporary patch action.  
Primary CTA: Undo or Retry when available | Secondary Actions: Details/manual guidance.  
Entry Sources: Git recovery/destructive result | Next Step: S067/S075 | Back Path: Changes/conflict state.  
Required Information: Operation result and undo window | Dependencies: Git undo/recovery service.  
Potential Friction: Manual repair guidance may remain expert-heavy.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: status text; Feedback: success, Undo, retry, manual recovery present.

### STEP FACT SHEET — S078
Screen Name: Branch list/search and current status  
Journey: J18 Branches and worktrees | Position: 1 of 4  
Primary User Job: Find and understand a branch.  
Primary CTA: Select/switch branch | Secondary Actions: Search; create; refresh; row menu.  
Entry Sources: Git Branches tab/selector | Next Step: S079/S080 | Back Path: Changes tab.  
Required Information: Local/remote branches and current/upstream status | Dependencies: branches API.  
Potential Friction: Local versus remote naming and detached state are expert concepts.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: keyboard search/selection; Feedback: empty/error recovery.

### STEP FACT SHEET — S079
Screen Name: Create or switch branch  
Journey: J18 Branches and worktrees | Position: 2 of 4  
Primary User Job: Move work to the intended branch safely.  
Primary CTA: Create/Switch | Secondary Actions: Cancel; choose base.  
Entry Sources: Branch selection/create action | Next Step: S067/S078 | Back Path: S078.  
Required Information: Branch name/base and working-tree safety | Dependencies: branch API/repository state.  
Potential Friction: Dirty/conflict recovery can interrupt the path without a direct safe action.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: form/menu semantics; Feedback: state-specific recovery.

### STEP FACT SHEET — S080
Screen Name: Branch actions  
Journey: J18 Branches and worktrees | Position: 3 of 4  
Primary User Job: Rename, publish, or delete a branch.  
Primary CTA: Selected mutation | Secondary Actions: Cancel/dismiss.  
Entry Sources: Branch row overflow menu | Next Step: S078/S074 | Back Path: Dismiss to S078.  
Required Information: Branch, remote/upstream, destructive impact | Dependencies: branch/transport APIs.  
Potential Friction: Important actions are overflow-hidden and deletion variants need precise confirmation.  
Notes: [D/W]. Audit — IA: discoverability cost; Journey: Pass; CTA: destructive separated; Accessibility: keyboard menu; Feedback: refresh/retry branch.

### STEP FACT SHEET — S081
Screen Name: Worktree list and actions  
Journey: J18 Branches and worktrees | Position: 4 of 4  
Primary User Job: Create, open, or remove an isolated branch workspace.  
Primary CTA: Create/Open worktree | Secondary Actions: Remove; prune; cancel.  
Entry Sources: Worktree controls in Branches | Next Step: New project/worktree context | Back Path: S078.  
Required Information: Branch, destination, registration and dirty state | Dependencies: Git worktree and project APIs.  
Potential Friction: Filesystem path plus Git branch concepts create a high knowledge burden.  
Notes: [D/W]. Audit — IA: complex but coherent; Journey: Pass; CTA: state-specific; Accessibility: dialog/menu semantics; Feedback: path/dirty/permission recovery.

### STEP FACT SHEET — S082
Screen Name: Task Manager not-initialized workspace  
Journey: J19 Set up Task Manager | Position: 1 of 5  
Primary User Job: Decide to initialize task management.  
Primary CTA: Set up Tasks | Secondary Actions: What is TaskMaster?; Import/Create PRD; choose project.  
Entry Sources: Tasks tab/drawer before initialization | Next Step: S083 or S093 | Back Path: Another workspace tab.  
Required Information: Active project and setup consequence | Dependencies: Tasks feature flag and project.  
Potential Friction: PRD choices can compete with the setup path if overemphasized.  
Notes: [D/W when enabled]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: Pass; Feedback: missing-project branch present.

### STEP FACT SHEET — S083
Screen Name: Analyze Task setup  
Journey: J19 Set up Task Manager | Position: 2 of 5  
Primary User Job: Inspect what setup would change.  
Primary CTA: Analyze | Secondary Actions: Cancel.  
Entry Sources: Set up Tasks | Next Step: S084 | Back Path: S082.  
Required Information: Project and existing TaskMaster/config state | Dependencies: task setup analyze API.  
Potential Friction: Technical analysis stages can be opaque without plain-language progress.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: progress announced; Feedback: progress/cancel/retry present.

### STEP FACT SHEET — S084
Screen Name: Preview changes and confirm Task setup  
Journey: J19 Set up Task Manager | Position: 3 of 5  
Primary User Job: Approve the exact, backed-up project changes.  
Primary CTA: Confirm setup | Secondary Actions: Back/reanalyze; cancel.  
Entry Sources: Successful analysis | Next Step: S085 | Back Path: S083/S082.  
Required Information: Planned operations, backup, before/after model/config | Dependencies: analysis plan.  
Potential Friction: Long technical operation lists may hide the most consequential default change.  
Notes: [D/W]. Audit — IA: consequence hierarchy essential; Journey: Pass; CTA: Pass; Accessibility: Pass; Feedback: no mutation before confirmation.

### STEP FACT SHEET — S085
Screen Name: Apply Task setup progress  
Journey: J19 Set up Task Manager | Position: 4 of 5  
Primary User Job: Monitor or safely cancel project initialization.  
Primary CTA: Current progress; Cancel when safe | Secondary Actions: None.  
Entry Sources: Confirmed setup plan | Next Step: S086 | Back Path: Cancel invokes rollback/recovery.  
Required Information: Attempt and operation stage | Dependencies: streamed initializer, project lock, backup.  
Potential Friction: Cancellation/rollback takes time and needs unambiguous terminal status.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: status announced; Feedback: streamed progress/cancel/success/failure.

### STEP FACT SHEET — S086
Screen Name: Task setup success/recovery  
Journey: J19 Set up Task Manager | Position: 5 of 5  
Primary User Job: Enter the board or repair a failed setup.  
Primary CTA: Open Task board, Retry, Roll back, or Repair by state | Secondary Actions: Cancel/details.  
Entry Sources: S085 terminal result | Next Step: S087/S083/S082 | Back Path: S082 after safe rollback.  
Required Information: Result, backup and recommended recovery | Dependencies: setup result/repair APIs.  
Potential Friction: Multiple recovery choices can be hard to distinguish.  
Notes: [D/W]. Audit — IA: state-specific; Journey: Pass; CTA: one primary per state; Accessibility: status text; Feedback: terminal success/recovery present.

### STEP FACT SHEET — S087
Screen Name: Task board ready state  
Journey: J20 Browse, create, and execute tasks | Position: 1 of 6  
Primary User Job: Identify and start the selected next task.  
Primary CTA: Start task | Secondary Actions: Select task; Create task/PRD; toolbar controls.  
Entry Sources: Tasks tab/setup success | Next Step: S090/S091 | Back Path: Another workspace tab/project.  
Required Information: Task statuses, priorities, dependencies, next-task selection | Dependencies: TaskMaster API/context.  
Potential Friction: Board density and multiple card actions can dilute the next-task hierarchy.  
Notes: [D/W]. Audit — IA: Pass by contract; Journey: Pass; CTA: Pass; Accessibility: systemic click-target debt may apply; Feedback: ready state distinct.

### STEP FACT SHEET — S088
Screen Name: Task toolbar  
Journey: J20 Browse, create, and execute tasks | Position: 2 of 6  
Primary User Job: Narrow and reorder task visibility.  
Primary CTA: None; these are secondary controls supporting board work | Secondary Actions: Search; filter; sort; refresh.  
Entry Sources: Ready board/drawer tasks | Next Step: S087/S089 | Back Path: Clear/reset controls.  
Required Information: Query/filter/sort state | Dependencies: task context.  
Potential Friction: Compact controls become sub-44 px in the project drawer (M-11).  
Notes: [D/W]. Audit — IA: grouped; Journey: Pass; CTA: neutral; Accessibility: M-11; Feedback: filtered-empty state exists.

### STEP FACT SHEET — S089
Screen Name: Task empty / filtered-empty state  
Journey: J20 Browse, create, and execute tasks | Position: 3 of 6  
Primary User Job: Create work or recover hidden tasks.  
Primary CTA: Create task when truly empty; Clear filters when filtered empty | Secondary Actions: Change sort/filter; Import/Create PRD.  
Entry Sources: Board data/filter result | Next Step: S087/S090 or J21 | Back Path: Clear filters/project switch.  
Required Information: Whether emptiness is real or filter-caused | Dependencies: task/filter state.  
Potential Friction: None evidenced; the two empty causes are explicitly distinct.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: state-specific Pass; Accessibility: Pass; Feedback: loading/error/empty differentiated.

### STEP FACT SHEET — S090
Screen Name: Task detail and mutation  
Journey: J20 Browse, create, and execute tasks | Position: 4 of 6  
Primary User Job: Understand and update one task.  
Primary CTA: Save/Start according to edit state | Secondary Actions: Status; delete; close; subtasks/dependencies.  
Entry Sources: Task card/next-task banner | Next Step: S087/S091 | Back Path: Close to board.  
Required Information: Task body, status, dependencies and edits | Dependencies: TaskMaster mutation API.  
Potential Friction: Update/status/delete feedback uses browser dialog patterns, breaking context (M-12).  
Notes: [D/W]. Audit — IA: Pass; Journey: M-12; CTA: risk of competing mutation actions; Accessibility: browser dialogs; Feedback: M-12.

### STEP FACT SHEET — S091
Screen Name: Start-task staged progress  
Journey: J20 Browse, create, and execute tasks | Position: 5 of 6  
Primary User Job: Launch the task into an AI session.  
Primary CTA: Start, then current progress; Retry on failure | Secondary Actions: Cancel.  
Entry Sources: Board/detail/drawer Run | Next Step: S092/S043 | Back Path: Cancel to board.  
Required Information: Task, provider and stage | Dependencies: task start workflow, provider/session APIs.  
Potential Friction: Drawer Run target measures about 52×25 and is too short for touch (M-11).  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: M-11 at drawer entry; Feedback: stages/cancel/retry present.

### STEP FACT SHEET — S092
Screen Name: Task execution result / next-task banner  
Journey: J20 Browse, create, and execute tasks | Position: 6 of 6  
Primary User Job: Continue the started session or choose the next task.  
Primary CTA: Open session/Start next task by state | Secondary Actions: Update status; dismiss; details.  
Entry Sources: Start-task terminal result/Chat completion | Next Step: S043/S087/S091 | Back Path: Board.  
Required Information: Created session, task result, next task | Dependencies: task/session synchronization.  
Potential Friction: Several follow-up actions can compete after success.  
Notes: [D/W]. Audit — IA: needs clear state hierarchy; Journey: Pass; CTA: one primary per state required; Accessibility: Pass; Feedback: result visible.

### STEP FACT SHEET — S093
Screen Name: PRD editor/intake  
Journey: J21 Create, import, and generate a PRD | Position: 1 of 3  
Primary User Job: Create or import product requirements for tasks.  
Primary CTA: Save/Generate according to state | Secondary Actions: Import; cancel; edit.  
Entry Sources: Task setup/empty/board PRD action | Next Step: S094/S095 | Back Path: Tasks workspace.  
Required Information: Requirements content and target project | Dependencies: PRD editor and TaskMaster APIs.  
Potential Friction: Save/generate actions and browser dialogs can compete and disrupt context (M-13).  
Notes: [D/W]. Audit — IA: requires state-specific primary; Journey: M-13; CTA: M-13; Accessibility: editor support; Feedback: content preservation expected.

### STEP FACT SHEET — S094
Screen Name: PRD generation/progress  
Journey: J21 Create, import, and generate a PRD | Position: 2 of 3  
Primary User Job: Generate structured requirements with a provider.  
Primary CTA: Generate, then progress/Retry | Secondary Actions: Cancel; provider choice.  
Entry Sources: Generate from S093 | Next Step: S093/S095 | Back Path: Cancel to editor.  
Required Information: Source requirements and provider | Dependencies: provider completion and PRD APIs.  
Potential Friction: Failure uses browser alert and separates recovery from preserved content (M-13).  
Notes: [D/W]. Audit — IA: Pass; Journey: M-13; CTA: Pass; Accessibility: alert browser-owned; Feedback: M-13.

### STEP FACT SHEET — S095
Screen Name: PRD save/import result  
Journey: J21 Create, import, and generate a PRD | Position: 3 of 3  
Primary User Job: Persist the PRD and refresh Tasks.  
Primary CTA: Save/Overwrite after explicit decision | Secondary Actions: Cancel; return editor.  
Entry Sources: Save/import from S093 | Next Step: S082/S087 | Back Path: S093.  
Required Information: Destination, overwrite consequence, content | Dependencies: file/TaskMaster save APIs.  
Potential Friction: Browser confirmation/alert provides weak contextual, accessible feedback (M-13).  
Notes: [D/W]. Audit — IA: Pass; Journey: M-13; CTA: M-13; Accessibility: browser-owned; Feedback: content preserved but presentation weak.

### STEP FACT SHEET — S096
Screen Name: Project drawer container and tab bar  
Journey: J22 Use the project drawer | Position: 1 of 3  
Primary User Job: Inspect project tasks/schedules without losing workspace context.  
Primary CTA: Active tab’s job | Secondary Actions: Tabs; resize; Collapse/Close.  
Entry Sources: Right-edge handle/navigation shortcut | Next Step: S097/S098 | Back Path: Collapse/Close to workspace.  
Required Information: Project, active tab, persisted width/open state | Dependencies: drawer state hook and responsive layout.  
Potential Friction: At 320 px the 340 px drawer puts its only close control at x=-64; sidebar and drawer can coexist (B-2, M-14).  
Notes: [D/W]. Audit — IA: B-2/M-14; Journey: B-2; CTA: active tab; Accessibility: B-2; Feedback: open state visible but dismissal fails.

### STEP FACT SHEET — S097
Screen Name: Drawer Tasks tab  
Journey: J22 Use the project drawer | Position: 2 of 3  
Primary User Job: Inspect/filter/run project tasks in context.  
Primary CTA: Run selected next task | Secondary Actions: Search; filters; sort; refresh; open main setup/create.  
Entry Sources: Drawer Tasks tab | Next Step: J20/S091 or main Tasks | Back Path: S096 close/tab.  
Required Information: Project tasks/filter state | Dependencies: TaskMaster context.  
Potential Friction: Filters are about 29 px high, Refresh 32×32, and Run 52×25 (M-11); B-2 can prevent exit.  
Notes: [D/W]. Audit — IA: compact; Journey: B-2/M-11; CTA: Pass; Accessibility: M-11/B-2; Feedback: task states inherited.

### STEP FACT SHEET — S098
Screen Name: Drawer Schedules tab  
Journey: J22 Use the project drawer | Position: 3 of 3  
Primary User Job: Inspect and act on project schedules.  
Primary CTA: Active schedule-state action | Secondary Actions: Create/edit; Run now; Provider Connect.  
Entry Sources: Drawer Schedules tab | Next Step: J23/J24/J27 | Back Path: S096 close/tab.  
Required Information: Schedule and provider status | Dependencies: scheduled-runs context.  
Potential Friction: Mobile exit remains blocked by B-2; cross-journey transitions must close the drawer.  
Notes: [D/W]. Audit — IA: Pass; Journey: B-2; CTA: state-specific; Accessibility: B-2; Feedback: inherited schedule states.

### STEP FACT SHEET — S099
Screen Name: Schedule list  
Journey: J23 Browse and act on schedules | Position: 1 of 4  
Primary User Job: Find or create a project schedule.  
Primary CTA: Create schedule when empty; otherwise selected schedule action | Secondary Actions: Retry; edit card.  
Entry Sources: Drawer Schedules/workspace shortcut | Next Step: S100/J24 | Back Path: Close drawer/workspace.  
Required Information: Project schedules and status | Dependencies: scheduled-runs API/context.  
Potential Friction: Drawer accessibility B-2 affects this otherwise complete path on mobile.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass desktop/B-2 mobile; CTA: state-specific; Accessibility: B-2 via container; Feedback: loading/empty/error distinct.

### STEP FACT SHEET — S100
Screen Name: Schedule card/status  
Journey: J23 Browse and act on schedules | Position: 2 of 4  
Primary User Job: Understand one schedule and its latest execution.  
Primary CTA: Edit/Open according to selection | Secondary Actions: Toggle; Run now; delete.  
Entry Sources: Schedule list | Next Step: S101/S102/J24 | Back Path: List.  
Required Information: Enabled state, next/last run, provider/profile, missed/failure status | Dependencies: schedule/run records.  
Potential Friction: Dense schedule and run metadata can reduce scannability.  
Notes: [D/W]. Audit — IA: grouping required; Journey: Pass; CTA: Run now secondary; Accessibility: status text not color-only; Feedback: missed/success/failure visible.

### STEP FACT SHEET — S101
Screen Name: Run schedule now  
Journey: J23 Browse and act on schedules | Position: 3 of 4  
Primary User Job: Trigger a one-off execution while preserving the schedule.  
Primary CTA: Run now only within this explicit action state | Secondary Actions: Cancel/Retry/Open Settings.  
Entry Sources: Schedule card/editor | Next Step: Run/session or S100 | Back Path: Schedule list.  
Required Information: Schedule/provider/server availability and duplicate state | Dependencies: scheduled-runs service.  
Potential Friction: Product must distinguish one-off execution from changing future recurrence.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: neutral in editor, contextual here; Accessibility: Pass; Feedback: duplicate/provider/server recovery mapped.

### STEP FACT SHEET — S102
Screen Name: Delete schedule confirmation/Undo  
Journey: J23 Browse and act on schedules | Position: 4 of 4  
Primary User Job: Remove a schedule safely.  
Primary CTA: Confirm Delete | Secondary Actions: Cancel; Undo after removal.  
Entry Sources: Schedule card/editor Delete | Next Step: S099 or restored S100 | Back Path: Cancel/Undo.  
Required Information: Schedule identity and destructive consequence | Dependencies: delete/restore behavior.  
Potential Friction: Undo timing must remain visible long enough.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: destructive explicit; Accessibility: modal/undo focus; Feedback: confirmation and Undo present.

### STEP FACT SHEET — S103
Screen Name: Schedule editor basics  
Journey: J24 Create or edit a schedule | Position: 1 of 5  
Primary User Job: Define the schedule’s purpose in its current project.  
Primary CTA: Save schedule once valid | Secondary Actions: Back/cancel; enabled toggle.  
Entry Sources: Create/edit schedule | Next Step: S104-S107 | Back Path: S099.  
Required Information: Project, name, prompt, enabled state | Dependencies: main-workspace editor.  
Potential Friction: Prompt and scheduling controls can create a long form at narrow widths.  
Notes: [D/W]. Audit — IA: one main-workspace job; Journey: Pass; CTA: Pass; Accessibility: form labels; Feedback: validation preserves input.

### STEP FACT SHEET — S104
Screen Name: Recurrence, time, timezone, and preview  
Journey: J24 Create or edit a schedule | Position: 2 of 5  
Primary User Job: Choose when work should run and verify upcoming occurrences.  
Primary CTA: Save remains primary | Secondary Actions: Daily/Weekly/Custom; timezone.  
Entry Sources: Schedule editor | Next Step: S105/S107 | Back Path: S103/cancel.  
Required Information: Recurrence, time, timezone and next three runs | Dependencies: cron/time utilities.  
Potential Friction: DST and Custom terminology can be misread despite preview.  
Notes: [D/W]. Audit — IA: preview supports comprehension; Journey: Pass; CTA: Pass; Accessibility: grouped inputs; Feedback: validation and three-run preview.

### STEP FACT SHEET — S105
Screen Name: Schedule provider/profile/model  
Journey: J24 Create or edit a schedule | Position: 3 of 5  
Primary User Job: Select the AI execution context.  
Primary CTA: Save remains primary | Secondary Actions: Provider/profile/model; Retry; Open Settings.  
Entry Sources: Schedule editor | Next Step: S107/J27 | Back Path: Editor basics.  
Required Information: Shared catalog and auth/availability | Dependencies: provider selection catalog.  
Potential Friction: Provider unavailability interrupts a time-focused job.  
Notes: [D/W]. Audit — IA: grouped integration section; Journey: Pass; CTA: recovery secondary; Accessibility: labeled selects; Feedback: loading/error/Open Settings.

### STEP FACT SHEET — S106
Screen Name: Advanced schedule options  
Journey: J24 Create or edit a schedule | Position: 4 of 5  
Primary User Job: Configure exceptional scheduling behavior.  
Primary CTA: Save remains primary | Secondary Actions: Reveal/hide Advanced; raw cron.  
Entry Sources: Advanced disclosure in editor | Next Step: S107 | Back Path: Hide Advanced/S103.  
Required Information: Cron and advanced execution options | Dependencies: cron parser.  
Potential Friction: Raw cron is inherently error-prone; server-active caveat may be overlooked.  
Notes: [D/W]. Audit — IA: progressive disclosure Pass; Journey: Pass; CTA: Pass; Accessibility: disclosure state; Feedback: cron validation and run preview.

### STEP FACT SHEET — S107
Screen Name: Schedule save/result  
Journey: J24 Create or edit a schedule | Position: 5 of 5  
Primary User Job: Persist a valid schedule and know it will only run while local server is active.  
Primary CTA: Save schedule | Secondary Actions: Run now; Retry after failure.  
Entry Sources: Valid editor | Next Step: S099/S101 | Back Path: Editor with values retained.  
Required Information: Complete schedule, execution caveat, save result | Dependencies: scheduled-runs API.  
Potential Friction: Users may assume missed jobs replay or run while Desktop is closed.  
Notes: [D/W]. Audit — IA: caveat required before Save; Journey: Pass; CTA: Pass; Accessibility: status announced; Feedback: saving/success/failure recovery.

### STEP FACT SHEET — S108
Screen Name: Settings dialog and grouped navigation  
Journey: J25 Settings navigation, appearance, and notifications | Position: 1 of 4  
Primary User Job: Find and change one settings group.  
Primary CTA: Active group’s job; no global competing save | Secondary Actions: Group navigation; close.  
Entry Sources: Sidebar/palette/recovery links | Next Step: S109/S110/J26-J31 | Back Path: Close/Escape to origin.  
Required Information: Current group and save state | Dependencies: shared Dialog and settings controller.  
Potential Friction: Some controls and useful text violate touch/opacity rules (M-16, M-26).  
Notes: [D/W]. Audit — IA: grouped at ≤4 destinations; Journey: Pass; CTA: Pass; Accessibility: M-16/M-26; Feedback: S111 is incomplete.

### STEP FACT SHEET — S109
Screen Name: Appearance settings  
Journey: J25 Settings navigation, appearance, and notifications | Position: 2 of 4  
Primary User Job: Choose visual preferences.  
Primary CTA: None; settings autosave | Secondary Actions: Theme switch/selects.  
Entry Sources: Settings → Appearance | Next Step: S111 | Back Path: Settings navigation/close.  
Required Information: Current theme and preferences | Dependencies: UI preference hook/controller.  
Potential Friction: Dark Mode switch is 48×28 and selects measure roughly 38–42 px high (M-16).  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: autosave appropriate; Accessibility: M-16/M-26; Feedback: M-15 on failed autosave.

### STEP FACT SHEET — S110
Screen Name: Notification settings  
Journey: J25 Settings navigation, appearance, and notifications | Position: 3 of 4  
Primary User Job: Enable and scope product notifications.  
Primary CTA: Enable notifications when permission is unset | Secondary Actions: Event checkboxes; test/request permission.  
Entry Sources: Settings → Notifications; permission recovery | Next Step: S111 or browser settings | Back Path: Settings navigation/close.  
Required Information: Browser/OS permission and event preferences | Dependencies: Notifications API/service worker.  
Potential Friction: Enable button is ~36 px high and checkboxes 16×16 (M-16).  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: M-16/M-26; Feedback: permission-denied guidance present, save failure M-15.

### STEP FACT SHEET — S111
Screen Name: Settings autosave feedback  
Journey: J25 Settings navigation, appearance, and notifications | Position: 4 of 4  
Primary User Job: Know whether a preference was saved.  
Primary CTA: Retry on failure should be present | Secondary Actions: Continue editing/navigation.  
Entry Sources: Any autosaved settings mutation | Next Step: Saved state or retry | Back Path: Original setting remains editable.  
Required Information: Saving/saved/error state and failed field | Dependencies: settings controller.  
Potential Friction: Controller sets saveStatus=error, but Settings renders only success; failure and Retry are invisible (M-15).  
Notes: [D/W]. Audit — IA: M-15; Journey: M-15; CTA: missing recovery; Accessibility: status absent; Feedback: M-15 violates state completeness/MCTA-3.

### STEP FACT SHEET — S112
Screen Name: Voice Basic settings  
Journey: J26 Configure and test Voice | Position: 1 of 5  
Primary User Job: Enable and validate common voice input behavior.  
Primary CTA: Test voice input | Secondary Actions: Enable; device; hold-to-talk; read-aloud; language; Advanced.  
Entry Sources: Settings → Voice; composer recovery | Next Step: S113/S114/S115 | Back Path: Settings navigation/Chat.  
Required Information: Enable state, microphone, permission and language | Dependencies: media devices and voice config.  
Potential Friction: Several basic controls compete for scanning but follow the contract.  
Notes: [D/W]. Audit — IA: progressive disclosure Pass; Journey: Pass; CTA: Pass; Accessibility: controls require 44 px; Feedback: permission/test/autosave states.

### STEP FACT SHEET — S113
Screen Name: Microphone permission/device recovery  
Journey: J26 Configure and test Voice | Position: 2 of 5  
Primary User Job: Restore access to an input device.  
Primary CTA: Retry permission/device scan or Open Settings | Secondary Actions: Choose another device.  
Entry Sources: Missing/denied/disconnected device | Next Step: S112/S114 | Back Path: Leave Voice disabled.  
Required Information: Permission and device state | Dependencies: MediaDevices/OS permissions.  
Potential Friction: OS/browser settings handoff differs by platform.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: outcome-oriented; Accessibility: status announced; Feedback: empty/denied/disconnected distinct.

### STEP FACT SHEET — S114
Screen Name: Voice test flow  
Journey: J26 Configure and test Voice | Position: 3 of 5  
Primary User Job: Verify capture and transcription before Chat.  
Primary CTA: Test/Retry voice input | Secondary Actions: Stop/playback where offered.  
Entry Sources: Test voice input | Next Step: Sample result/S112 | Back Path: Stop/return Basic.  
Required Information: Audio input, provider config, stage and transcript | Dependencies: media capture and voice API.  
Potential Friction: Permission/provider failures can occur after a user starts speaking.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: stage announcement; Feedback: Listening → Transcribing → Sample result.

### STEP FACT SHEET — S115
Screen Name: Voice Advanced settings  
Journey: J26 Configure and test Voice | Position: 4 of 5  
Primary User Job: Configure a non-default voice provider or model.  
Primary CTA: None; autosave | Secondary Actions: Provider; URL/key; STT/TTS; model/context/cleanup; hide Advanced.  
Entry Sources: Advanced disclosure | Next Step: S116/S114 | Back Path: Hide to S112.  
Required Information: Provider-specific fields and secret | Dependencies: catalog, secure storage and voice API.  
Potential Friction: Credentials and model terminology are complex despite conditional fields.  
Notes: [D/W]. Audit — IA: progressive disclosure Pass; Journey: Pass; CTA: autosave; Accessibility: secret labels/status; Feedback: inline provider/profile recovery.

### STEP FACT SHEET — S116
Screen Name: Voice autosave result  
Journey: J26 Configure and test Voice | Position: 5 of 5  
Primary User Job: Confirm secure persistence or retry.  
Primary CTA: Retry when failed | Secondary Actions: Continue editing/return Basic.  
Entry Sources: Voice setting mutation/migration | Next Step: Saved/failed state | Back Path: Original field remains.  
Required Information: Saving state and secure-storage migration result | Dependencies: voice config and Desktop secure storage.  
Potential Friction: Secret migration failure must not erase the legacy value prematurely.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: status announced; Feedback: Saving/Saved/Failed—Retry present.

### STEP FACT SHEET — S117
Screen Name: Agent provider overview  
Journey: J27 Manage agent accounts, profiles, models, and permissions | Position: 1 of 5  
Primary User Job: Understand and configure provider availability.  
Primary CTA: Connect/configure selected provider | Secondary Actions: Provider/sub-tab navigation; refresh.  
Entry Sources: Settings → Agents; recovery links | Next Step: S118-S121 | Back Path: Settings navigation/close.  
Required Information: Provider auth/status and available sub-tabs | Dependencies: provider catalog/status.  
Potential Friction: OpenCode Permissions leads to a blank destination (B-3).  
Notes: [D/W]. Audit — IA: B-3 false destination; Journey: B-3; CTA: otherwise state-specific; Accessibility: settings target debt; Feedback: provider state visible.

### STEP FACT SHEET — S118
Screen Name: Provider login dialog  
Journey: J27 Manage agent accounts, profiles, models, and permissions | Position: 2 of 5  
Primary User Job: Authenticate a selected provider.  
Primary CTA: Provider CLI flow | Secondary Actions: Close/cancel/retry.  
Entry Sources: Provider overview or point-of-use recovery | Next Step: S117/S120 | Back Path: Close to origin.  
Required Information: Provider and terminal output | Dependencies: CLI and command-terminal WebSocket.  
Potential Friction: Technical terminal auth can be unfamiliar.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: provider-owned; Accessibility: modal/terminal support; Feedback: stream and exit result.

### STEP FACT SHEET — S119
Screen Name: Provider settings and profile management  
Journey: J27 Manage agent accounts, profiles, models, and permissions | Position: 3 of 5  
Primary User Job: Maintain provider profiles/configuration.  
Primary CTA: Save/Add profile according to state | Secondary Actions: Select; edit; delete; refresh.  
Entry Sources: Provider Configure/sub-tab | Next Step: S120 | Back Path: S117.  
Required Information: Profile/model/provider configuration | Dependencies: provider profile APIs.  
Potential Friction: Profile delete uses browser confirmation and some failures lack in-context recovery (M-17).  
Notes: [D/W]. Audit — IA: Pass; Journey: M-17; CTA: destructive separation weak in browser dialog; Accessibility: browser-owned; Feedback: M-17.

### STEP FACT SHEET — S120
Screen Name: Provider/profile/model feedback  
Journey: J27 Manage agent accounts, profiles, models, and permissions | Position: 4 of 5  
Primary User Job: Verify provider configuration or recover.  
Primary CTA: Retry/Reconnect when available | Secondary Actions: Return/edit.  
Entry Sources: Provider mutation/catalog result | Next Step: S117/S119 | Back Path: Profile form.  
Required Information: Operation and error category | Dependencies: provider APIs/catalog.  
Potential Friction: Some error paths are console-only or rely on browser dialogs (M-17).  
Notes: [D/W]. Audit — IA: M-17; Journey: M-17; CTA: recovery inconsistent; Accessibility: missing visible status; Feedback: M-17.

### STEP FACT SHEET — S121
Screen Name: OpenCode Permissions tab  
Journey: J27 Manage agent accounts, profiles, models, and permissions | Position: 5 of 5  
Primary User Job: Inspect or change OpenCode permission policy.  
Primary CTA: None rendered | Secondary Actions: Navigate away.  
Entry Sources: Settings → Agents → OpenCode → Permissions | Next Step: None for the stated job | Back Path: Another Agent sub-tab.  
Required Information: Permission rules, current policy and editing controls | Dependencies: Missing render branch.  
Potential Friction: The reachable tab is completely blank; the job cannot be completed (B-3).  
Notes: [D/W]. Audit — IA: B-3; Journey: B-3 dead end; CTA: missing; Accessibility: blank region; Feedback: no loading/empty/error explanation.

### STEP FACT SHEET — S122
Screen Name: MCP server list/status  
Journey: J28 Manage MCP servers and Skills | Position: 1 of 5  
Primary User Job: Understand and control configured MCP servers.  
Primary CTA: Add server when empty; otherwise selected server action | Secondary Actions: Enable; disable; restart; edit; delete.  
Entry Sources: Agent/Settings MCP section | Next Step: S123/S124 | Back Path: Settings navigation.  
Required Information: Server configs and runtime status | Dependencies: MCP APIs.  
Potential Friction: Many server actions compete and funnel into inaccessible/raw overlays (M-18, M-19).  
Notes: [D/W]. Audit — IA: dense; Journey: M-18/M-19; CTA: state-specific; Accessibility: downstream M-18; Feedback: list states present.

### STEP FACT SHEET — S123
Screen Name: Add/edit MCP server overlay  
Journey: J28 Manage MCP servers and Skills | Position: 2 of 5  
Primary User Job: Define a valid MCP server.  
Primary CTA: Add/Save server | Secondary Actions: Cancel/close.  
Entry Sources: Add/Edit from S122 | Next Step: S122 | Back Path: Cancel to list.  
Required Information: Name, command, arguments and environment | Dependencies: MCP mutation API.  
Potential Friction: Raw fixed overlay has no dialog role/name, initial focus, containment, or hidden background; Settings stays exposed (M-18).  
Notes: [D/W]. Audit — IA: Pass visually; Journey: M-18; CTA: Pass; Accessibility: M-18; Feedback: browser alerts compound M-19.

### STEP FACT SHEET — S124
Screen Name: MCP destructive/status feedback  
Journey: J28 Manage MCP servers and Skills | Position: 3 of 5  
Primary User Job: Confirm and understand MCP mutations.  
Primary CTA: Confirm Delete/Retry according to state | Secondary Actions: Cancel/dismiss.  
Entry Sources: Delete/restart/toggle/submit | Next Step: S122 | Back Path: Cancel/original config.  
Required Information: Target server, action, result | Dependencies: MCP APIs.  
Potential Friction: Submit/delete/restart paths use browser alert/confirm, fragmenting feedback (M-19).  
Notes: [D/W]. Audit — IA: M-19; Journey: M-19; CTA: inconsistent native dialogs; Accessibility: browser-owned; Feedback: M-19.

### STEP FACT SHEET — S125
Screen Name: Skills dialog and installed/available list  
Journey: J28 Manage MCP servers and Skills | Position: 4 of 5  
Primary User Job: Find a skill and understand its installation destination.  
Primary CTA: Install selected skill | Secondary Actions: Search/filter; disclosure; close.  
Entry Sources: Skills action in provider settings | Next Step: S126 | Back Path: Close/Escape to origin.  
Required Information: Provider, available/installed skills and destination | Dependencies: Skills API and shared Dialog.  
Potential Friction: Close is 32×32 and “Where will this install?” is roughly 123×16 (M-20).  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: M-20; Feedback: list states present.

### STEP FACT SHEET — S126
Screen Name: Skill installation/result  
Journey: J28 Manage MCP servers and Skills | Position: 5 of 5  
Primary User Job: Install, verify, or remove a skill.  
Primary CTA: Install/Retry | Secondary Actions: Return to list.  
Entry Sources: Skill selection in S125 | Next Step: Installed state/S125 | Back Path: S125.  
Required Information: Skill, provider, destination and operation result | Dependencies: Skills install/remove APIs.  
Potential Friction: Removal API exists but installed-skill UI exposes no Remove action, blocking lifecycle completion (B-4).  
Notes: [D/W/O removal]. Audit — IA: B-4; Journey: B-4; CTA: removal missing; Accessibility: M-20; Feedback: install result present, remove path unreachable.

### STEP FACT SHEET — S127
Screen Name: API token and GitHub credential settings  
Journey: J29 Configure API tokens, Git, Tasks, and view About | Position: 1 of 5  
Primary User Job: Maintain integration credentials securely.  
Primary CTA: Add/Save credential | Secondary Actions: Copy; test; edit; delete.  
Entry Sources: Settings → API Tokens or clone recovery | Next Step: S131/origin flow | Back Path: Settings navigation.  
Required Information: Credential label/type/secret | Dependencies: credential APIs/secure storage.  
Potential Friction: Delete uses browser confirmation and some mutation errors only reach console (M-21).  
Notes: [D/W]. Audit — IA: Pass; Journey: M-21; CTA: destructive separation; Accessibility: browser-owned; Feedback: M-21.

### STEP FACT SHEET — S128
Screen Name: Git settings  
Journey: J29 Configure API tokens, Git, Tasks, and view About | Position: 2 of 5  
Primary User Job: Verify Git and configure identity/defaults.  
Primary CTA: Save/Test according to state | Secondary Actions: Edit fields; return to Git.  
Entry Sources: Settings → Git; Git recovery link | Next Step: S131/J16 | Back Path: Settings navigation/origin.  
Required Information: Git availability/version and identity | Dependencies: Git settings API.  
Potential Friction: Failures can be console-only, leaving Git recovery unresolved (M-21).  
Notes: [D/W]. Audit — IA: Pass; Journey: M-21; CTA: Pass; Accessibility: settings target debt M-16; Feedback: M-21.

### STEP FACT SHEET — S129
Screen Name: Tasks settings  
Journey: J29 Configure API tokens, Git, Tasks, and view About | Position: 3 of 5  
Primary User Job: Enable and configure task tooling.  
Primary CTA: None; autosave/settings mutation | Secondary Actions: Enable; provider/default options.  
Entry Sources: Settings → Tasks; Task recovery | Next Step: S131/J19 | Back Path: Settings navigation.  
Required Information: Feature state and TaskMaster/provider defaults | Dependencies: settings and feature gates.  
Potential Friction: Disabling Tasks hides the tab but leaves the command-palette destination active (M-4).  
Notes: [D/W]. Audit — IA: M-4 across navigation; Journey: M-4; CTA: autosave; Accessibility: M-16; Feedback: M-15/M-21 depending mutation.

### STEP FACT SHEET — S130
Screen Name: About/build information  
Journey: J29 Configure API tokens, Git, Tasks, and view About | Position: 4 of 5  
Primary User Job: Identify the build and reach trusted product resources.  
Primary CTA: None; informational | Secondary Actions: Version/update; homepage; repository; docs; Report Issue when configured.  
Entry Sources: Settings → About | Next Step: J32/J33/external browser | Back Path: Settings navigation/close.  
Required Information: Product/version/build and centralized links | Dependencies: product config/build identity.  
Potential Friction: Version link is about 51×20 and below the touch target minimum (M-16).  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: neutral; Accessibility: M-16; Feedback: update journey handles result.

### STEP FACT SHEET — S131
Screen Name: Settings mutation result/recovery  
Journey: J29 Configure API tokens, Git, Tasks, and view About | Position: 5 of 5  
Primary User Job: Confirm configuration persistence or retry.  
Primary CTA: Retry should appear on failure | Secondary Actions: Return/edit.  
Entry Sources: Credential/Git/Tasks mutation | Next Step: Saved/origin flow | Back Path: Editable setting.  
Required Information: Operation and error | Dependencies: settings/credential/Git APIs.  
Potential Friction: Git/API/GitHub mutations can log failures only to console, so users cannot recover in context (M-21).  
Notes: [D/W]. Audit — IA: M-21; Journey: M-21; CTA: missing on affected failures; Accessibility: absent status; Feedback: MCTA-3/M-21.

### STEP FACT SHEET — S132
Screen Name: Browser setup/status  
Journey: J30 Set up and monitor Browser automation | Position: 1 of 5  
Primary User Job: Determine whether Browser automation is ready.  
Primary CTA: Set up when required; open monitor when ready | Secondary Actions: Inspect status.  
Entry Sources: Settings → Browser; supported tool workflow | Next Step: S133/S134/S136 | Back Path: Settings navigation.  
Required Information: Service/dependency/runtime status | Dependencies: browser-use service.  
Potential Friction: Error states expose details but do not provide an explicit Retry (M-22).  
Notes: [D/W]. Audit — IA: Pass; Journey: M-22; CTA: M-22 on error; Accessibility: M-16 settings targets; Feedback: MCTA-3/M-22.

### STEP FACT SHEET — S133
Screen Name: Browser configuration/install  
Journey: J30 Set up and monitor Browser automation | Position: 2 of 5  
Primary User Job: Install/configure Browser dependencies.  
Primary CTA: Set up/Install | Secondary Actions: Cancel/return.  
Entry Sources: Setup-required S132 | Next Step: S132/S136 | Back Path: S132.  
Required Information: Missing dependencies and installation impact | Dependencies: browser service/runtime installation.  
Potential Friction: Failed installation lacks direct Retry and requires an implicit reopen/reload (M-22).  
Notes: [D/W]. Audit — IA: Pass; Journey: M-22; CTA: missing recovery; Accessibility: status needed; Feedback: M-22.

### STEP FACT SHEET — S134
Screen Name: Browser run/session monitor  
Journey: J30 Set up and monitor Browser automation | Position: 3 of 5  
Primary User Job: Observe and control a Browser session.  
Primary CTA: Active monitoring; Stop is the main control for a running session | Secondary Actions: Fullscreen; Delete.  
Entry Sources: Ready Browser/tool run | Next Step: S135/S136 | Back Path: Settings/workspace.  
Required Information: Live state, screenshot/logs and session ID | Dependencies: browser-use service.  
Potential Friction: Stop/Delete targets are small and destructive Delete lacks confirmation in fullscreen (M-23).  
Notes: [D/W]. Audit — IA: Pass; Journey: M-23; CTA: destructive hierarchy concern; Accessibility: M-23; Feedback: live status present.

### STEP FACT SHEET — S135
Screen Name: Browser fullscreen overlay  
Journey: J30 Set up and monitor Browser automation | Position: 4 of 5  
Primary User Job: Inspect the live Browser session at larger size.  
Primary CTA: Continue inspection/Stop running session | Secondary Actions: Close; Delete.  
Entry Sources: Fullscreen from S134 | Next Step: S134 or deleted/stopped | Back Path: Close to monitor.  
Required Information: Live Browser content and run state | Dependencies: raw overlay and browser service.  
Potential Friction: Raw modal lacks robust dialog/focus behavior; Stop/Delete are small and Delete is immediate without confirmation (M-23).  
Notes: [D/W]. Audit — IA: Pass visually; Journey: M-23; CTA: destructive conflict; Accessibility: M-23; Feedback: deletion safety missing.

### STEP FACT SHEET — S136
Screen Name: Browser failure/recovery  
Journey: J30 Set up and monitor Browser automation | Position: 5 of 5  
Primary User Job: Restore setup/service/session operation.  
Primary CTA: Explicit Retry is missing in affected Settings error states | Secondary Actions: Reopen/reload; dependencies/settings.  
Entry Sources: Browser setup/service/session error | Next Step: S132-S134 | Back Path: Leave Browser.  
Required Information: Error category and recovery outcome | Dependencies: browser service.  
Potential Friction: Users must infer that reopening/reloading retries the operation (M-22).  
Notes: [D/W]. Audit — IA: M-22; Journey: M-22; CTA: missing; Accessibility: recovery not discoverable; Feedback: MCTA-3.

### STEP FACT SHEET — S137
Screen Name: Core plugin settings/catalog  
Journey: J31 Configure plugins and enter plugin-defined journeys | Position: 1 of 4  
Primary User Job: Find and configure an available plugin.  
Primary CTA: Install/Enable selected plugin as state requires | Secondary Actions: Docs; disable; configure; external links.  
Entry Sources: Settings → Plugins | Next Step: S138/S139/external | Back Path: Settings navigation.  
Required Information: Plugin metadata/status/source | Dependencies: plugin catalog/API.  
Potential Friction: Numerous plugin links/buttons measure 16–40 px and violate touch minimums (M-24).  
Notes: [D/W]. Audit — IA: plugin-dependent; Journey: M-24; CTA: state-specific; Accessibility: M-24/M-26; Feedback: core loading/empty/error mapped.

### STEP FACT SHEET — S138
Screen Name: Plugin configuration/result  
Journey: J31 Configure plugins and enter plugin-defined journeys | Position: 2 of 4  
Primary User Job: Provide core-supported configuration and verify it loads.  
Primary CTA: Save/Enable | Secondary Actions: Return; documentation.  
Entry Sources: Configure plugin | Next Step: S137/S139/S140 | Back Path: S137.  
Required Information: Plugin-specific configuration accepted by core | Dependencies: plugin API/runtime.  
Potential Friction: Third-party terminology and small core controls reduce clarity/accessibility (M-24).  
Notes: [D/W/P]. Audit — IA: conditional; Journey: M-24; CTA: plugin-dependent; Accessibility: M-24; Feedback: core error path present.

### STEP FACT SHEET — S139
Screen Name: Plugin runtime mount boundary  
Journey: J31 Configure plugins and enter plugin-defined journeys | Position: 3 of 4  
Primary User Job: Enter the installed plugin’s experience.  
Primary CTA: Plugin-defined | Secondary Actions: Plugin-defined; core return where host retains it.  
Entry Sources: Installed plugin tab/contribution | Next Step: Plugin-owned journey | Back Path: Core Settings/navigation if retained.  
Required Information: Dynamically fetched authenticated JavaScript | Dependencies: third-party plugin implementation.  
Potential Friction: Inner CTAs, routes, states, focus, touch and feedback are dynamically unbounded; core cannot guarantee the UX contract (M-24).  
Notes: [P]. Audit — IA/CTA/Accessibility/Feedback: not statically enumerable; Journey: core boundary mapped, governance gap M-24.

### STEP FACT SHEET — S140
Screen Name: Plugin load/runtime failure and return  
Journey: J31 Configure plugins and enter plugin-defined journeys | Position: 4 of 4  
Primary User Job: Recover from or leave a failed plugin.  
Primary CTA: Retry or Return/Disable | Secondary Actions: Support/docs.  
Entry Sources: Fetch/parse/mount/runtime exception | Next Step: S137/S139/external | Back Path: Core navigation.  
Required Information: Failure source and safe return path | Dependencies: plugin host error boundary.  
Potential Friction: A plugin runtime can fail before rendering its own recovery.  
Notes: [D/W/P]. Audit — IA: core return essential; Journey: conditional; CTA: outcome-oriented; Accessibility: core fallback required; Feedback: failure boundary mapped.

### STEP FACT SHEET — S141
Screen Name: Update status / available-update prompt  
Journey: J32 Check and install Desktop updates | Position: 1 of 4  
Primary User Job: Decide whether to install an available trusted update.  
Primary CTA: Download/Install update when available | Secondary Actions: Later; release details.  
Entry Sources: Automatic check; menu/tray; About | Next Step: S142/S144 | Back Path: Dismiss to origin.  
Required Information: Current/new version and release details | Dependencies: Desktop updater/update feed.  
Potential Friction: Update timing can interrupt active work; deferral must be clear.  
Notes: [D]. Audit — IA: Pass; Journey: Pass; CTA: state-specific; Accessibility: modal focus expected; Feedback: checking/current/available differentiated.

### STEP FACT SHEET — S142
Screen Name: Update download/install progress  
Journey: J32 Check and install Desktop updates | Position: 2 of 4  
Primary User Job: Monitor a verified update and restart safely.  
Primary CTA: Restart and install when ready | Secondary Actions: Continue waiting/dismiss if safe.  
Entry Sources: Accept available update | Next Step: Restart launcher or S143 | Back Path: Current version if cancelled safely.  
Required Information: Progress, integrity/identity and restart impact | Dependencies: updater, checksum/build identity.  
Potential Friction: Restart can lose unsaved work if readiness is not coordinated.  
Notes: [D]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: progress announced; Feedback: progress/validation/ready states.

### STEP FACT SHEET — S143
Screen Name: Update failure/recovery  
Journey: J32 Check and install Desktop updates | Position: 3 of 4  
Primary User Job: Retry or remain safely on the current version.  
Primary CTA: Retry | Secondary Actions: Diagnostics/release info; dismiss.  
Entry Sources: Feed/network/download/checksum/install failure | Next Step: S141/S142/S144 | Back Path: Current app.  
Required Information: Failure stage and current-version safety | Dependencies: updater diagnostics.  
Potential Friction: Technical integrity errors need plain-language consequences.  
Notes: [D]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: status text; Feedback: terminal recovery present.

### STEP FACT SHEET — S144
Screen Name: Up-to-date / dismissed state  
Journey: J32 Check and install Desktop updates | Position: 4 of 4  
Primary User Job: Confirm no immediate update action is needed.  
Primary CTA: Return/Close | Secondary Actions: Release page where configured.  
Entry Sources: No update; dismiss; recover on current version | Next Step: About/workspace/external | Back Path: Origin.  
Required Information: Current version | Dependencies: updater/product links.  
Potential Friction: None evidenced.  
Notes: [D]. Audit — IA: Pass; Journey: Pass; CTA: neutral; Accessibility: Pass; Feedback: current-version confirmation.

### STEP FACT SHEET — S145
Screen Name: Report Issue availability gate  
Journey: J33 Report an issue and share diagnostics | Position: 1 of 5  
Primary User Job: Offer reporting only when a trusted tracker exists.  
Primary CTA: Report Issue only when configured | Secondary Actions: None when hidden.  
Entry Sources: About/help/recovery control | Next Step: S146 or no surface | Back Path: Origin.  
Required Information: Central issueTrackerUrl | Dependencies: shared product config validation.  
Potential Friction: Default null intentionally removes escalation from unresolved failures.  
Notes: [D/W]. Audit — IA: boundary correct; Journey: conditional; CTA: hidden by design; Accessibility: no dead control; Feedback: build validation handles invalid URL.

### STEP FACT SHEET — S146
Screen Name: Redacted issue preview and consent  
Journey: J33 Report an issue and share diagnostics | Position: 2 of 5  
Primary User Job: Review exactly what will leave the app.  
Primary CTA: Open issue tracker | Secondary Actions: Edit; diagnostics opt-in; cancel.  
Entry Sources: Configured Report Issue control | Next Step: S147/S148 | Back Path: Cancel to origin.  
Required Information: Draft, consent, redacted version/OS fields | Dependencies: report issue helper and product config.  
Potential Friction: Dense privacy information can make redaction hard to verify.  
Notes: [D/W conditional]. Audit — IA: Pass; Journey: Pass; CTA: only primary; Accessibility: dialog semantics expected; Feedback: preview retained.

### STEP FACT SHEET — S147
Screen Name: Diagnostics opt-in/copy  
Journey: J33 Report an issue and share diagnostics | Position: 3 of 5  
Primary User Job: Decide whether and how to share redacted diagnostics.  
Primary CTA: Open issue tracker remains primary | Secondary Actions: Opt in/out; Copy diagnostics.  
Entry Sources: Report preview | Next Step: S146/S148 | Back Path: Opt out/preview.  
Required Information: Redacted diagnostics and explicit consent | Dependencies: diagnostics and clipboard.  
Potential Friction: Users may not understand which local identifiers were removed.  
Notes: [D/W conditional]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: checkbox/clipboard status; Feedback: copy/failure branches.

### STEP FACT SHEET — S148
Screen Name: Issue tracker handoff  
Journey: J33 Report an issue and share diagnostics | Position: 4 of 5  
Primary User Job: Continue the reviewed report in the canonical tracker.  
Primary CTA: Open issue tracker | Secondary Actions: Copy if browser opening fails.  
Entry Sources: Consented preview | Next Step: External GitHub/GitLab form | Back Path: Product preview remains.  
Required Information: Valid tracker URL and encoded draft | Dependencies: system browser.  
Potential Friction: Context leaves the product and final submission is outside product control.  
Notes: [D/W conditional]. Audit — IA: Pass; Journey: core-completable to handoff; CTA: Pass; Accessibility: external; Feedback: browser-open failure retains draft.

### STEP FACT SHEET — S149
Screen Name: Report Issue invalid/unavailable recovery  
Journey: J33 Report an issue and share diagnostics | Position: 5 of 5  
Primary User Job: Preserve a report when an optional support dependency fails.  
Primary CTA: Contextual Copy/Retry or report without diagnostics | Secondary Actions: Cancel.  
Entry Sources: Diagnostics/clipboard/browser/tracker failure | Next Step: S146-S148 | Back Path: Origin with draft retained.  
Required Information: Failed operation and retained content | Dependencies: tracker/browser/clipboard/diagnostics.  
Potential Friction: When tracker URL is null there is intentionally no product reporting route.  
Notes: [D/W conditional]. Audit — IA: Pass within config boundary; Journey: conditional; CTA: Pass; Accessibility: status needed; Feedback: partial-success branches mapped.

### STEP FACT SHEET — S150
Screen Name: Root-route bootstrap  
Journey: J34 Notifications, deep links, route recovery, and offline | Position: 1 of 9  
Primary User Job: Restore a valid workspace context from /.  
Primary CTA: Automatic resolution | Secondary Actions: Empty-state project/session creation after resolution.  
Entry Sources: Root URL/app load | Next Step: S008/S012/S022/S158 | Back Path: Browser/app close.  
Required Information: Runtime/auth/onboarding and persisted selection | Dependencies: router and app stores.  
Potential Friction: Multiple bootstrap gates can prolong an apparently blank/loading start.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: automatic; Accessibility: loading status; Feedback: error boundary.

### STEP FACT SHEET — S151
Screen Name: Session deep-link loading and canonicalization  
Journey: J34 Notifications, deep links, route recovery, and offline | Position: 2 of 9  
Primary User Job: Open the exact referenced session.  
Primary CTA: Automatic load | Secondary Actions: Select fallback if load fails.  
Entry Sources: /session/:sessionId; notification | Next Step: S043/S152/S154 | Back Path: Browser back/sidebar.  
Required Information: Session ID, provider history and project | Dependencies: route resolver/history APIs.  
Potential Friction: Alias replacement can feel like unexpected route change without visible context.  
Notes: [D/W]. Audit — IA: active title needed; Journey: Pass; CTA: automatic; Accessibility: skeleton/status; Feedback: canonical/archive/unknown branches.

### STEP FACT SHEET — S152
Screen Name: Archived-project synthesis  
Journey: J34 Notifications, deep links, route recovery, and offline | Position: 3 of 9  
Primary User Job: Read a session whose original project is no longer active.  
Primary CTA: View transcript/select another context | Secondary Actions: Session utilities where safe.  
Entry Sources: Deep link to archived project history | Next Step: S043/S154 | Back Path: Sidebar/root.  
Required Information: Archived session and synthesized project metadata | Dependencies: history provider and session store.  
Potential Friction: Synthetic archived context can be mistaken for a live registered project.  
Notes: [D/W]. Audit — IA: archive labeling essential; Journey: Pass; CTA: neutral; Accessibility: status text; Feedback: missing-history fallback.

### STEP FACT SHEET — S153
Screen Name: Subagent deep-link resolution  
Journey: J34 Notifications, deep links, route recovery, and offline | Position: 4 of 9  
Primary User Job: Open a referenced subagent under its parent.  
Primary CTA: Automatic resolution | Secondary Actions: Return to parent/fallback.  
Entry Sources: /session/:sessionId/subagent/:subagentSessionId | Next Step: S053/S154 | Back Path: Parent/browser back.  
Required Information: Parent and child IDs/history | Dependencies: router/history APIs.  
Potential Friction: Redirects and missing children weaken orientation.  
Notes: [D/W]. Audit — IA: parent label needed; Journey: Pass; CTA: automatic; Accessibility: loading status; Feedback: canonical/unknown branches.

### STEP FACT SHEET — S154
Screen Name: Unknown-session fallback  
Journey: J34 Notifications, deep links, route recovery, and offline | Position: 5 of 9  
Primary User Job: Recover from a deleted, unknown, or failed session link.  
Primary CTA: Return to project/session list or Retry | Secondary Actions: Root fallback.  
Entry Sources: Failed session/subagent resolution | Next Step: S150/S034/S035 | Back Path: Browser back.  
Required Information: Whether missing versus temporarily failed | Dependencies: router/store.  
Potential Friction: If the distinction is unclear, users cannot know whether retry is useful.  
Notes: [D/W]. Audit — IA: Pass if cause explicit; Journey: Pass; CTA: Pass; Accessibility: focus recovery; Feedback: safe fallback.

### STEP FACT SHEET — S155
Screen Name: Notification click — existing client  
Journey: J34 Notifications, deep links, route recovery, and offline | Position: 6 of 9  
Primary User Job: Return to the notified session without opening a duplicate app.  
Primary CTA: Notification click (OS-owned) | Secondary Actions: OS dismiss.  
Entry Sources: Service-worker notification click | Next Step: S151 | Back Path: Prior history/browser back.  
Required Information: Session ID and existing client | Dependencies: service worker Clients API.  
Potential Friction: Focus/navigate behavior can interrupt work in another active session.  
Notes: [D/W/PWA]. Audit — IA: Pass; Journey: Pass; CTA: OS-owned; Accessibility: notification platform-owned; Feedback: focused destination should orient.

### STEP FACT SHEET — S156
Screen Name: Notification click — new client  
Journey: J34 Notifications, deep links, route recovery, and offline | Position: 7 of 9  
Primary User Job: Open the notified session when no window exists.  
Primary CTA: Notification click (OS-owned) | Secondary Actions: OS dismiss.  
Entry Sources: Notification with no open client | Next Step: S008/S151 | Back Path: Close/new-window history.  
Required Information: Session ID and auth state | Dependencies: service worker openWindow.  
Potential Friction: Auth/onboarding gates can separate notification intent from destination.  
Notes: [D/W/PWA]. Audit — IA: Pass; Journey: Pass; CTA: OS-owned; Accessibility: platform-owned; Feedback: route resolver handles fallback.

### STEP FACT SHEET — S157
Screen Name: Offline navigation fallback  
Journey: J34 Notifications, deep links, route recovery, and offline | Position: 8 of 9  
Primary User Job: Understand the product is offline and recover navigation.  
Primary CTA: Browser Retry/Reload when online | Secondary Actions: Browser back.  
Entry Sources: PWA navigation without network/cache | Next Step: S150/S151 after reconnect | Back Path: Browser back.  
Required Information: Offline status | Dependencies: service-worker fallback.  
Potential Friction: Minimal raw HTML Offline page lacks the product shell, contextual destination, live reconnect, and an explicit in-page Retry (M-25).  
Notes: [W/PWA]. Audit — IA: M-25; Journey: M-25; CTA: missing in-page; Accessibility: unverified raw page; Feedback: only static status.

### STEP FACT SHEET — S158
Screen Name: Main error boundary / route recovery  
Journey: J34 Notifications, deep links, route recovery, and offline | Position: 9 of 9  
Primary User Job: Recover from an unexpected rendering failure.  
Primary CTA: Retry/reset | Secondary Actions: Change context/root/reload.  
Entry Sources: Main workspace render error | Next Step: Re-render S022 or root | Back Path: Context/browser back when viable.  
Required Information: Safe user-facing error and reset scope | Dependencies: React error boundary.  
Potential Friction: Repeated failures have limited escalation when Report Issue is hidden.  
Notes: [D/W]. Audit — IA: Pass; Journey: Pass; CTA: Pass; Accessibility: focus fallback; Feedback: retry/reset and repeated-failure route.

# Phase 4 — UX Audit

## Audit evidence

- Desktop and 320 px runtime traversal covered launcher handoff, workspace, mobile sidebar, project drawer, Chat, Files, Shell, Git, Tasks, Schedules, and every Settings group using desktop-local mocked APIs.
- Source tracing covered all wired routes, Electron app/tray commands, service-worker notification clicks, provider/status branches, feature gates, context/overflow menus, shared dialogs, and orphan actions.
- The fresh static UX inventory reports no new regression against its existing baseline, but the baseline itself contains the following debt:

| Rule inventory | Count |
| --- | ---: |
| Non-semantic click targets without complete keyboard semantics | 24 |
| Suppressed focus outline without explicit focus-visible replacement | 1 |
| Images without alt | 2 |
| Browser alert/confirm feedback calls | 18 |
| Raw color values | 138 |
| Raw modal surfaces | 30 |
| Palette-specific Tailwind colors | 2,346 |
| Opacity-dimmed useful text | 94 |
| Unnamed icon buttons detected by the static rule | 0 |
| Statically detectable touch-target violations | 0 |

The static touch rule does not measure rendered geometry; runtime inspection found the sub-44 px controls recorded in M-3, M-9, M-11, M-16, M-20, M-23, and M-24.

## Every-step audit roll-up

The fact sheets above contain the individual audit. This matrix proves coverage of every stable STEP and rolls the result up by journey.

| Journey | STEP coverage | IA / orientation | Journey integrity | CTA hierarchy | Accessibility | Feedback / system status |
| --- | --- | --- | --- | --- | --- | --- |
| J01 Desktop local launch | S001–S004 | Pass | Pass | Pass | Pass | Loading, repair, success and diagnostics present |
| J02 Desktop configuration/LAN | S005–S007 | Pass visually | Pass | Pass | M-1 | Validation/restart recovery present |
| J03 Standalone authentication | S008–S011 | B-1 account exit missing | B-1 | Entry CTAs pass | Pass on rendered forms | Auth errors recover; logout absent |
| J04 Onboarding/provider connection | S012–S015 | Pass | Pass | Pass | Provider-terminal dependent | Status/progress/result present |
| J05 Cloud environments | S016–S018 | Conditional [C] | Source-mapped only | Conditional | Not runtime verified | Source branches mapped |
| J06 Native app/tray | S019–S021 | Pass by OS convention | Pass | Native convention | OS-owned | Destination feedback |
| J07 Workspace navigation | S022–S026 | M-3/M-4 | M-2/M-4 | False Tasks affordance M-4 | M-2/M-3/M-5/M-6 | Navigation result weak for M-4 |
| J08 Create/clone project | S027–S033 | Pass | Pass | Pass | Pass | Complete structured states |
| J09 Project/session lifecycle | S034–S038 | Actions overflow-hidden | M-8 | M-8 native dialogs | M-5/M-8 | M-8 contextual feedback gap |
| J10 Prepare Chat/provider | S039–S042 | Pass | Pass | Pass | Pass | Catalog/auth recovery preserves draft |
| J11 Run conversation | S043–S048 | Pass | Pass | Send→Stop state passes | Renderer-dependent | Streaming, reconnect and tools visible |
| J12 Transcript utilities | S049–S053 | Utilities partly hidden | Pass | M-10 | M-9/M-10 | Export inline; rewind native dialog |
| J13 File management | S054–S058 | Pass | Pass | Pass | Keyboard tree tested | Complete file states and Undo where supported |
| J14 File editing/preview | S059–S062 | Pass | Pass | Pass | M-7 | Load/save/conflict/alternate states |
| J15 Local Shell | S063–S066 | Pass | Pass within local-only boundary | Pass | Touch selection needs monitoring | Connection/recovery states complete |
| J16 Review/commit | S067–S072 | Pass | Pass | Commit remains sole primary | Pass | Complete status/suggestion/recovery |
| J17 Git sync/conflicts | S073–S077 | Expert complexity, coherent | Pass | Sequential conflict CTA passes | Pass | Normalized recovery and Undo present |
| J18 Branches/worktrees | S078–S081 | Expert complexity | Pass | Pass | Pass | Error/confirmation branches present |
| J19 Task setup | S082–S086 | Pass | Pass | One primary per stage | Pass | Analyze→preview→apply→terminal recovery |
| J20 Task board/execution | S087–S092 | Dense but coherent | M-12 | M-12 in mutations | M-11/M-12 | Start flow complete; mutations fragmented |
| J21 PRD | S093–S095 | Pass | M-13 | M-13 | Browser-dialog dependent | M-13 |
| J22 Project drawer | S096–S098 | B-2/M-14 | B-2 | Active-tab CTA concept passes | B-2/M-11/M-14 | Exit/dismissal fails at 320 px |
| J23 Schedule list/actions | S099–S102 | Pass | Desktop pass; B-2 via mobile container | Pass | B-2 inherited | Complete schedule states/Undo |
| J24 Schedule create/edit | S103–S107 | Pass | Pass | Save sole primary; Run now neutral | Pass | Complete recurrence/catalog/save states |
| J25 Appearance/notifications | S108–S111 | Pass grouping; m-3 stale duplicate | M-15 | Missing Retry M-15 | M-16/M-26 | Saving error invisible M-15 |
| J26 Voice | S112–S116 | Pass progressive disclosure | Pass | Test Voice primary | M-16/M-26 systemic | Complete test/autosave recovery |
| J27 Agents/profiles/permissions | S117–S121 | B-3 | B-3/M-17 | Missing CTA on S121 | B-3/M-16/M-17 | Blank state and inconsistent errors |
| J28 MCP/Skills | S122–S126 | B-4 lifecycle gap | B-4/M-18/M-19 | Remove missing; browser dialogs | M-18/M-20 | M-19; install result otherwise present |
| J29 API/Git/Tasks/About | S127–S131 | M-4 cross-nav | M-21 | Missing Retry on affected errors | M-16/M-26 | Console-only failures M-21 |
| J30 Browser automation | S132–S136 | Pass until error | M-22/M-23 | Retry missing; Delete unsafe | M-23 | M-22/M-23 |
| J31 Plugins/runtime | S137–S140 | Plugin-dependent | Core boundary mapped; inner path unbounded | Plugin-dependent | M-24 | Core fallback only |
| J32 Desktop updates | S141–S144 | Pass | Pass | Pass | Pass | Complete update/recovery states |
| J33 Report Issue | S145–S149 | Pass within configured boundary | Conditional but complete to handoff | Pass | Pass | Consent, redaction and partial recovery |
| J34 Deep links/offline | S150–S158 | M-25 offline | M-25 | In-page Retry missing offline | M-25 | Deep-link recovery passes; offline is static |

## Cross-product audit conclusions

- Information architecture: grouped Settings, main workspace tabs, project/session hierarchy, and task/schedule separation are coherent. The blank Permissions tab, stale duplicate Settings navigation, false Tasks command, collapsed mobile title, and dynamic plugin boundary are the material exceptions.
- Journey integrity: no default desktop launcher, project creation, file, shell, Git, task setup, schedule edit, update, or configured Report Issue dead end was found. Four jobs are impossible at specific endpoints: logout, mobile drawer dismissal, OpenCode permission management, and skill removal.
- CTA hierarchy: the product generally follows the one-primary-action registry. The material exceptions are missing recovery actions, browser-native dialog detours, unsafe Browser deletion, and false/undersized affordances.
- Accessibility: automated contrast tokens pass, but runtime target geometry and modal/focus behavior do not. Static source debt includes 24 non-semantic click targets, one suppressed focus, two missing alt attributes, and 94 opacity-dimmed useful text usages.
- Feedback/system status: the newest launcher, create-project, Files, Chat, Shell, Git, Task setup, Schedules, Voice, updates, and Report Issue flows contain explicit loading/error/success/recovery states. Settings, credentials/Git, Browser, project/session mutations, PRD, Tasks detail, MCP, and profile deletion retain older alert/confirm, invisible, or console-only feedback paths.

# Phase 5 — Journey-Level Analysis

### J01 — Desktop local launch

1. Discoverable: Yes; it is the installed app’s default surface.
2. Understandable: Yes; one Local primary action and staged startup.
3. Completable: Yes in tested default local mode.
4. Friction: Repeated technical startup failure and unavailable issue escalation.
5. Likely abandonment: S003 after repeated repair failure.
6. Unnecessary: No material step.
7. Missing: Guided escalation when the tracker is intentionally unconfigured.
8. Simplify: Keep diagnostics secondary and add plain-language terminal causes.
9. UX law: No material violation evidenced.
10. Heuristic: Recovery is strong; “help users recover from errors” weakens only after repeated failure.

### J02 — Desktop configuration and LAN access

1. Discoverable: Yes from launcher and native commands.
2. Understandable: Mostly; mode change and restart are explicit.
3. Completable: Yes with valid credentials.
4. Friction: Non-semantic sheets and restart disruption.
5. Likely abandonment: S006/S007 when security or restart impact is unclear.
6. Unnecessary: No material step.
7. Missing: Dialog focus lifecycle.
8. Simplify: Use the shared Dialog and focus the first field/error.
9. UX law: Jakob’s Law—custom sheet behavior differs from expected dialogs.
10. Heuristic: Consistency and standards; user control and freedom.

### J03 — Standalone authentication and session recovery

1. Discoverable: Login/setup is automatic; logout is not discoverable.
2. Understandable: Entry is clear; account lifecycle is incomplete.
3. Completable: Login is; intentional logout is not.
4. Friction: App switching for browser bootstrap and missing session exit.
5. Likely abandonment: Expired bootstrap loop or shared-device security concern.
6. Unnecessary: No entry step.
7. Missing: Reachable profile/session menu with Logout.
8. Simplify: One account menu for identity and session termination in [W] modes only.
9. UX law: Mental Models—authentication implies an available sign-out inverse.
10. Heuristic: User control and freedom; match between system and real world.

### J04 — First-run onboarding and provider connection

1. Discoverable: Yes, automatically on first run.
2. Understandable: Yes; provider login is explicitly optional.
3. Completable: Yes without a provider.
4. Friction: Technical provider CLI output.
5. Likely abandonment: Provider login failure despite the available skip.
6. Unnecessary: No required provider step; optional cards are appropriate.
7. Missing: Plain-language provider failure translation.
8. Simplify: Keep Continue visually dominant over provider cards.
9. UX law: Hick’s Law risk from several provider choices, acceptably bounded.
10. Heuristic: Flexibility and efficiency; error recovery could improve.

### J05 — Cloud environment management

1. Discoverable: Only when the Cloud feature is explicitly enabled.
2. Understandable: Structurally, but not runtime-verified in the default build.
3. Completable: Indeterminate without an enabled Cloud backend.
4. Friction: Endpoint/auth/provisioning complexity.
5. Likely abandonment: Remote start/auth failure.
6. Unnecessary: Entire path is correctly absent from default Desktop.
7. Missing: Runtime evidence for an enabled build.
8. Simplify: Preserve the gate and reveal remote configuration only on demand.
9. UX law: Tesler’s Law—remote environment complexity cannot be removed, only placed.
10. Heuristic: Visibility of system status is the critical requirement.

### J06 — Native application and tray commands

1. Discoverable: Yes through OS conventions, subject to tray platform support.
2. Understandable: Mostly; close-versus-hide varies by OS.
3. Completable: Yes.
4. Friction: Platform inconsistency and background server ambiguity.
5. Likely abandonment: Users may think the app quit when it only hid.
6. Unnecessary: Duplicated app/tray entries are justified for reachability.
7. Missing: Clear running/background state where the OS does not imply it.
8. Simplify: Keep command labels identical across app and tray.
9. UX law: Jakob’s Law supports using native conventions.
10. Heuristic: Consistency and standards across platform-specific variants.

### J07 — Workspace navigation, search, and command palette

1. Discoverable: Desktop yes; mobile menu visible but undersized.
2. Understandable: Desktop yes; 320 px title disappears.
3. Completable: Mouse/touch mostly; mobile keyboard/modal behavior is impaired.
4. Friction: Missing focus containment, false Tasks command, dense sidebar.
5. Likely abandonment: Mobile drawer confusion or Tasks redirect.
6. Unnecessary: Go to Tasks while Tasks is disabled.
7. Missing: Modal mobile-nav semantics and reserved title width.
8. Simplify: Filter palette commands by feature availability and enforce one mobile overlay.
9. UX law: Fitts’s Law and Jakob’s Law.
10. Heuristic: Visibility of system status; consistency; error prevention.

### J08 — Create or clone a project

1. Discoverable: Yes from sidebar, palette, and empty state.
2. Understandable: Yes; source mode is the first decision.
3. Completable: Yes across structured local/clone branches.
4. Friction: Filesystem/Git/auth error complexity.
5. Likely abandonment: Private auth, destination conflict, or partial cleanup failure.
6. Unnecessary: No material step; review is risk-reducing.
7. Missing: No material journey gap found.
8. Simplify: Continue keeping credentials hidden until an auth failure.
9. UX law: Progressive disclosure reduces Hick’s Law burden.
10. Heuristic: Error prevention and recovery are strong.

### J09 — Project and session lifecycle

1. Discoverable: Selection is; lifecycle actions are overflow-dependent.
2. Understandable: Mostly, until browser prompts/alerts detach context.
3. Completable: Yes, with significant feedback friction.
4. Friction: Native prompt/confirm/alert and weak failed-mutation states.
5. Likely abandonment: Failed rename/delete/refresh.
6. Unnecessary: Repeated browser-dialog patterns.
7. Missing: In-product named confirmation and contextual Retry.
8. Simplify: One reusable mutation sheet/status row with focus return.
9. UX law: Doherty Threshold—dialog interruptions break flow.
10. Heuristic: User control, consistency, and error recovery.

### J10 — Prepare a chat and provider

1. Discoverable: Yes from New Session and Chat empty states.
2. Understandable: Yes; provider failure names Retry and Settings.
3. Completable: Yes when a provider is available/authenticated.
4. Friction: Multiple missing prerequisites and provider CLI terminology.
5. Likely abandonment: Persistent catalog or login failure.
6. Unnecessary: No premature authentication.
7. Missing: No material core gap.
8. Simplify: Show only the currently missing prerequisite.
9. UX law: Hick’s Law is managed by state-specific disclosure.
10. Heuristic: Recognition over recall; error recovery passes.

### J11 — Run and control an AI conversation

1. Discoverable: Yes after a session is ready.
2. Understandable: Yes; Send becomes Stop and activity is visible.
3. Completable: Yes across stop, permissions, questions, and plans.
4. Friction: Large tool output and multiple pending decisions.
5. Likely abandonment: Provider/network failure during a long run.
6. Unnecessary: No material core step.
7. Missing: No evidence-backed journey gap.
8. Simplify: Keep the current blocking request adjacent to run status.
9. UX law: Goal-Gradient Effect supports truthful progress.
10. Heuristic: Visibility of system status and user control pass.

### J12 — Transcript utilities, export, fork, rewind, and subagents

1. Discoverable: Export is; message actions are hover/focus dependent.
2. Understandable: Export yes; rewind consequence is browser-dialog separated.
3. Completable: Yes, except touch usability is materially degraded.
4. Friction: 20×16 copy control and native rewind confirmation.
5. Likely abandonment: Mobile copy or uncertain rewind consequence.
6. Unnecessary: No utility duplication; one Export is correct.
7. Missing: In-context rewind confirmation.
8. Simplify: Persistent/focus-visible utility affordance on touch and keyboard.
9. UX law: Fitts’s Law.
10. Heuristic: Error prevention and consistency.

### J13 — File management

1. Discoverable: Yes through Files and familiar tree actions.
2. Understandable: Yes; empty and failure states differ.
3. Completable: Yes.
4. Friction: Deep nesting, overflow actions, capability-dependent deletion.
5. Likely abandonment: Permission/server or partial upload failure.
6. Unnecessary: No material step.
7. Missing: No evidence-backed core gap.
8. Simplify: Preserve contextual Retry/Undo and visible destination during upload.
9. UX law: Law of Proximity supports action grouping by target.
10. Heuristic: Error prevention and recovery pass.

### J14 — File editing and preview

1. Discoverable: Yes from the tree/search.
2. Understandable: Yes, with clear alternate file states.
3. Completable: Yes for supported files.
4. Friction: Revision conflicts and missing media alt.
5. Likely abandonment: Save conflict or permission failure.
6. Unnecessary: No material step.
7. Missing: Alt text on two detected images.
8. Simplify: Keep reload/keep decision tied to the affected document.
9. UX law: No material flow-law violation; accessibility semantics fail.
10. Heuristic: Error prevention; accessibility compatibility.

### J15 — Local project Shell

1. Discoverable: Yes as a primary project tab.
2. Understandable: Yes for terminal users; local-only boundary is explicit.
3. Completable: Yes in Desktop-local mode.
4. Friction: Expert shell conventions and mobile gesture conflicts.
5. Likely abandonment: Missing cwd/shell or repeated socket failure.
6. Unnecessary: Provider auth is correctly absent.
7. Missing: No material core gap within remote-Shell non-goal.
8. Simplify: Continue matching each failure to one outcome-oriented action.
9. UX law: Tesler’s Law—the terminal’s inherent complexity remains.
10. Heuristic: Match with real world and visibility of status pass.

### J16 — Review changes and commit

1. Discoverable: Yes through Git → Changes.
2. Understandable: Yes; branch/status and selected changes precede Commit.
3. Completable: Yes, including no-repository recovery.
4. Friction: Git expertise and suggestion comparison choices.
5. Likely abandonment: Hook/index failure or staged snapshot change.
6. Unnecessary: No material step; suggestion is optional.
7. Missing: No evidence-backed gap.
8. Simplify: Keep AI actions neutral and collapsed until requested.
9. UX law: Hick’s Law risk is controlled by the sole Commit primary.
10. Heuristic: Error prevention and user control pass.

### J17 — Synchronize and recover Git operations

1. Discoverable: Yes, though Git verbs assume knowledge.
2. Understandable: Experts yes; novice transport/rebase terms less so.
3. Completable: Yes across normalized conflict/recovery states.
4. Friction: Many distinct remote and repository failure modes.
5. Likely abandonment: Auth/non-fast-forward/conflict/manual repair.
6. Unnecessary: No safe step can be removed.
7. Missing: Plain-language explanations for advanced Git errors.
8. Simplify: Promote only the valid next action for current repository state.
9. UX law: Tesler’s Law.
10. Heuristic: Help users recognize, diagnose, and recover from errors.

### J18 — Branches and worktrees

1. Discoverable: Yes under Git/Branches; row actions are overflow-hidden.
2. Understandable: Experts yes; worktree paths and remote branches are complex.
3. Completable: Yes.
4. Friction: Dirty state, path, base, remote, and destructive decisions.
5. Likely abandonment: Dirty switch or worktree path failure.
6. Unnecessary: No material step.
7. Missing: No evidence-backed core gap.
8. Simplify: Show only actions valid for the selected branch/worktree.
9. UX law: Tesler’s Law and Hick’s Law.
10. Heuristic: Error prevention and recognition over recall.

### J19 — Set up Task Manager

1. Discoverable: Yes from Tasks and not-initialized states.
2. Understandable: Yes; analysis and preview precede writes.
3. Completable: Yes across cancel, rollback, repair and success.
4. Friction: Technical operation previews and recovery choices.
5. Likely abandonment: Apply failure/rollback uncertainty.
6. Unnecessary: No material step; preview is protective.
7. Missing: No evidence-backed gap.
8. Simplify: Summarize the highest-impact change before detailed operations.
9. UX law: Goal-Gradient Effect supports streamed stages.
10. Heuristic: Error prevention and user control pass.

### J20 — Browse, create, and execute tasks

1. Discoverable: Yes from main Tasks and drawer.
2. Understandable: Main board yes; compact drawer and native mutation dialogs weaken it.
3. Completable: Yes, with significant touch/feedback friction.
4. Friction: Dense board, tiny drawer controls, browser dialogs.
5. Likely abandonment: Mobile Run/filter interaction or failed update/start.
6. Unnecessary: Native dialog detours.
7. Missing: In-product mutation feedback.
8. Simplify: Move full mutations to main workspace; keep drawer for inspect/run.
9. UX law: Fitts’s Law.
10. Heuristic: Consistency, error recovery, and minimalist design.

### J21 — Create, import, and generate a PRD

1. Discoverable: Yes from several Task states.
2. Understandable: Core intent yes; Save/Generate dialog feedback is fragmented.
3. Completable: Yes with significant friction.
4. Friction: Browser alerts/confirms and potentially competing Save/Generate states.
5. Likely abandonment: Provider failure or overwrite uncertainty.
6. Unnecessary: Browser-dialog detours.
7. Missing: Persistent inline progress/error/overwrite confirmation.
8. Simplify: One editor state machine with one primary action at a time.
9. UX law: Doherty Threshold.
10. Heuristic: Visibility of status; consistency; error prevention.

### J22 — Use the project drawer

1. Discoverable: Yes from the edge handle/shortcuts.
2. Understandable: Desktop yes; mobile overlay stacking is confusing.
3. Completable: Desktop yes; dismissal is blocked at 320 px.
4. Friction: 340 px width, x=-64 close control, simultaneous sidebar, tiny Task controls.
5. Likely abandonment: Any mobile drawer entry.
6. Unnecessary: Simultaneous mobile sidebar and project drawer.
7. Missing: Viewport-capped width and always-reachable close/focus path.
8. Simplify: Enforce mutual exclusion and full-width mobile sheet with fixed header.
9. UX law: Fitts’s Law.
10. Heuristic: User control and freedom; error prevention.

### J23 — Browse and act on schedules

1. Discoverable: Yes through the project drawer.
2. Understandable: Yes; missed and last-run states are explicit.
3. Completable: Desktop yes; mobile inherits drawer blocker.
4. Friction: Dense cards and inaccessible mobile container.
5. Likely abandonment: Mobile drawer or provider/run failure.
6. Unnecessary: No schedule step.
7. Missing: Independent mobile-safe entry/container.
8. Simplify: Close drawer before opening main editor/run session.
9. UX law: Fitts’s Law via inherited drawer failure.
10. Heuristic: User control and freedom.

### J24 — Create or edit a schedule

1. Discoverable: Yes from empty/list/card.
2. Understandable: Yes; Basic recurrence and next runs precede cron.
3. Completable: Yes.
4. Friction: Timezone/DST/provider concepts and server-active caveat.
5. Likely abandonment: Catalog failure or invalid custom recurrence.
6. Unnecessary: No material step.
7. Missing: No evidence-backed gap.
8. Simplify: Keep raw cron exclusively in Advanced.
9. UX law: Progressive disclosure controls Hick’s Law.
10. Heuristic: Error prevention and visibility of system status pass.

### J25 — Settings navigation, appearance, and notifications

1. Discoverable: Yes from three global paths.
2. Understandable: Grouping is clear.
3. Completable: Mutations may occur, but users cannot verify a failed autosave.
4. Friction: Silent failure, small controls, dim useful text, stale duplicate code.
5. Likely abandonment: Permission denial or uncertain save.
6. Unnecessary: Unused SettingsMainTabs implementation.
7. Missing: Failed—Retry rendering.
8. Simplify: One shared autosave status/retry component for all groups.
9. UX law: Fitts’s Law and Doherty Threshold.
10. Heuristic: Visibility of system status; consistency.

### J26 — Configure and test Voice

1. Discoverable: Yes in Settings and at point of use.
2. Understandable: Yes; Basic/Advanced disclosure is strong.
3. Completable: Yes with device/provider availability.
4. Friction: OS permission handoff and advanced provider terminology.
5. Likely abandonment: Denied microphone or failed transcription.
6. Unnecessary: No material basic field.
7. Missing: No evidence-backed core gap.
8. Simplify: Preserve current provider-specific conditional fields.
9. UX law: Progressive disclosure reduces Hick’s Law burden.
10. Heuristic: Visibility of status and error recovery pass.

### J27 — Manage agent accounts, profiles, models, and permissions

1. Discoverable: Yes, including the broken Permissions tab.
2. Understandable: Provider cards are; blank Permissions is not.
3. Completable: Profiles mostly; OpenCode permissions cannot be completed.
4. Friction: Blank tab, browser confirmation, inconsistent profile errors.
5. Likely abandonment: S121 or failed profile mutation.
6. Unnecessary: A reachable tab with no render branch.
7. Missing: Permissions content or removal of the false destination.
8. Simplify: Render explicit unsupported state until controls exist.
9. UX law: Mental Models and Jakob’s Law.
10. Heuristic: Visibility of system status; match; error recovery.

### J28 — Manage MCP servers and Skills

1. Discoverable: Yes in integration settings.
2. Understandable: Lists are; raw MCP overlay and missing removal are not.
3. Completable: Add/install yes; skill removal no.
4. Friction: Non-modal-semantics overlay, alerts/confirms, small targets.
5. Likely abandonment: MCP keyboard interaction or attempted skill cleanup.
6. Unnecessary: Stacked raw overlay and native dialog detours.
7. Missing: Remove Skill action and accessible MCP Dialog.
8. Simplify: Reuse shared Dialog and one mutation-result pattern.
9. UX law: Fitts’s Law and Jakob’s Law.
10. Heuristic: User control; consistency; error recovery.

### J29 — Configure API tokens, Git, Tasks, and view About

1. Discoverable: Yes through Settings and recovery links.
2. Understandable: Fields are; silent failures are not.
3. Completable: Mutations may fail without a user-recoverable state.
4. Friction: Console-only errors, native confirmation, small controls, false Tasks command.
5. Likely abandonment: Failed credential/Git mutation.
6. Unnecessary: Disabled Tasks palette command.
7. Missing: Visible Failed—Retry on every mutation.
8. Simplify: Route all settings mutations through the shared status component.
9. UX law: Doherty Threshold.
10. Heuristic: Visibility of system status and error recovery.

### J30 — Set up and monitor Browser automation

1. Discoverable: Yes in Settings/tool-supported paths.
2. Understandable: Ready/setup states are; error recovery and fullscreen deletion are not.
3. Completable: Happy path yes; affected error states lack direct Retry.
4. Friction: Implicit retry, raw fullscreen modal, small destructive controls.
5. Likely abandonment: Setup/service failure.
6. Unnecessary: Immediate unconfirmed Delete.
7. Missing: Explicit Retry and safe accessible confirmation.
8. Simplify: One shared monitor surface; fullscreen only changes layout.
9. UX law: Fitts’s Law.
10. Heuristic: Error prevention; user control; recovery.

### J31 — Configure plugins and enter plugin-defined journeys

1. Discoverable: Yes through Settings and installed contributions.
2. Understandable: Core catalog is; plugin-defined content varies.
3. Completable: Core handoff is; inner completion cannot be guaranteed statically.
4. Friction: Small core targets and unbounded third-party interaction quality.
5. Likely abandonment: Fetch/mount/runtime failure.
6. Unnecessary: No known core step.
7. Missing: Enforced plugin accessibility/state/return contract.
8. Simplify: Keep a persistent core-owned return and error boundary.
9. UX law: Jakob’s Law—plugins can violate host conventions.
10. Heuristic: Consistency and standards; help recover from errors.

### J32 — Check and install Desktop updates

1. Discoverable: Yes automatically, from native menus, and About.
2. Understandable: Yes; available/progress/failure/current states differ.
3. Completable: Yes.
4. Friction: Restart timing and technical integrity errors.
5. Likely abandonment: Network/checksum failure.
6. Unnecessary: No material step.
7. Missing: No evidence-backed gap.
8. Simplify: Preserve work-aware deferral and one Retry.
9. UX law: Peak-End Rule favors a clear safe restart/result.
10. Heuristic: Visibility of status and error recovery pass.

### J33 — Report an issue and share diagnostics

1. Discoverable: Only when the central tracker URL is configured, by design.
2. Understandable: Yes; preview, consent and diagnostics are separated.
3. Completable: Core handoff is complete; external submission is tracker-owned.
4. Friction: Privacy review density and browser context switch.
5. Likely abandonment: Concern about diagnostics or unavailable tracker.
6. Unnecessary: No material step.
7. Missing: No core gap when configured; deliberately absent by default.
8. Simplify: Keep diagnostics opt-in separate and Open issue tracker sole primary.
9. UX law: No material violation evidenced.
10. Heuristic: User control, privacy/error prevention, and visibility pass.

### J34 — Notifications, deep links, route recovery, and offline

1. Discoverable: Deep links/notifications are externally initiated; fallback is automatic.
2. Understandable: Session recovery mostly; raw Offline page loses context.
3. Completable: Deep links yes; offline recovery depends on browser reload.
4. Friction: Auth gates, canonical redirects, synthetic archive context, static offline page.
5. Likely abandonment: Unknown session or prolonged offline state.
6. Unnecessary: No resolution step.
7. Missing: Product-shell Offline page with explicit Retry/reconnect status.
8. Simplify: Preserve destination intent through auth/offline recovery.
9. UX law: Jakob’s Law—raw fallback departs from the product shell.
10. Heuristic: Visibility of system status; help recover from errors.

# Phase 6 — Severity Classification

Severity follows the requested outcome-based definition, not implementation effort:

- Blocker: a mapped user job cannot be completed.
- Major: completion remains possible, but material usability, safety, feedback, or accessibility friction remains.
- Minor: consistency, maintainability, or polish debt with no material completion impact evidenced.

| Severity | Count | Finding IDs |
| --- | ---: | --- |
| Blocker | 4 | B-1–B-4 |
| Major | 26 | M-1–M-26 |
| Minor | 3 | m-1–m-3 |
| Total | 33 | All findings below |

# Problems Report

## Summary

Jobs mapped: 8

Journeys discovered: 34

Steps discovered: 158

Branches discovered: 616

Entries discovered: 89

Exits discovered: 105

Problems found: 33

Blocker: 4

Major: 26

Minor: 3

---

## Journey: J01 — Desktop local launch

### Blocker

None found.

### Major

None found.

### Minor

None found.

---

## Journey: J02 — Desktop configuration and LAN access

### Blocker

None found.

### Major

[M-1]

Code: LAUNCHER-DIALOG-SEMANTICS

Where: S005–S007, Desktop launcher Local Settings/LAN sheets.

What: Launcher settings sheets are raw overlays without a dialog role/name, deterministic initial focus, modal focus containment, Escape lifecycle, and focus return equivalent to the shared application Dialog.

Impact: Keyboard and screen-reader users can move into launcher content behind the sheet, lose their point of return, or fail to understand that a modal configuration task is active.

Fix: Rebuild both sheets on one accessible launcher-dialog primitive; set an accessible title, focus the first meaningful field/error, trap focus while modal, support Escape, hide background content, and restore focus to Local Settings.

Rule Violated: Dialog interaction contract; complete primary jobs must be keyboard-operable.

UX Law: Jakob’s Law.

Heuristic: Consistency and standards; user control and freedom.

---

### Minor

None found.

---

## Journey: J03 — Standalone authentication and session recovery

### Blocker

[B-1]

Code: AUTH-LOGOUT-ORPHAN

Where: S008–S010 and the authenticated standalone workspace; AuthContext implements logout(), but no reachable profile/account/logout control calls it.

What: A standalone or authenticated LAN user can log in but cannot intentionally terminate the product session from the UI.

Impact: The logout/account journey is impossible, particularly unsafe on shared devices; clearing storage or using developer tools is not an acceptable user path.

Fix: Add a mode-gated account menu in standalone-web/desktop-lan/platform modes with identity, Logout, pending-work warning where needed, visible progress/error, and post-logout focus/route recovery. Keep desktop-local passwordless and account-free.

Rule Violated: Account-flow completeness; every journey needs an exit/back path.

UX Law: Mental Models.

Heuristic: User control and freedom; match between system and the real world.

---

### Major

None found.

### Minor

None found.

---

## Journey: J04 — First-run onboarding and provider connection

### Blocker

None found.

### Major

None found.

### Minor

None found.

---

## Journey: J05 — Cloud environment management

### Blocker

None found in the statically mapped gated path.

### Major

None classified; runtime completion is out of default-build scope because features.cloud is false.

### Minor

None found.

---

## Journey: J06 — Native application and tray commands

### Blocker

None found.

### Major

None found.

### Minor

None found.

---

## Journey: J07 — Workspace navigation, search, and command palette

### Blocker

None found.

### Major

[M-2]

Code: MOBILE-NAV-MODALITY

Where: S024, mobile sidebar at 320 px.

What: Opening the mobile sidebar does not move focus into it, Escape does not close it, and the workspace behind it remains exposed in the accessibility tree.

Impact: Keyboard and screen-reader users can operate hidden background controls, lose orientation, and cannot use the standard dismissal path.

Fix: Treat the mobile-only sidebar as a modal navigation dialog: initial focus on its heading/first destination, focus containment, Escape/backdrop close, background inert/aria-hidden, and focus return to Open menu. Keep desktop sidebar non-modal.

Rule Violated: Dialog/menu accessibility; keyboard-operable complete job.

UX Law: Jakob’s Law.

Heuristic: User control and freedom; consistency and standards.

---

[M-3]

Code: MOBILE-HEADER-TARGET-ORIENTATION

Where: S022 at 320 px; Open menu renders 32×32 and the project/session title collapses to zero visual width.

What: The sole navigation opener is smaller than 44×44 and the header removes the user’s “where am I?” label.

Impact: Touch users are more likely to miss the entry control, and all users lose project/session orientation before navigating.

Fix: Reserve at least 44×44 for the menu, reserve a nonzero min-width for a one-line ellipsized title, keep action width bounded, and expose the full title on focus/accessible name.

Rule Violated: 44×44 target; orientation and information hierarchy.

UX Law: Fitts’s Law.

Heuristic: Visibility of system status; recognition rather than recall.

---

[M-4]

Code: DISABLED-TASKS-PALETTE

Where: S026 and S129; command palette always registers Go to Tasks while MainContent redirects Tasks to Chat when the feature is disabled.

What: A visible command promises a destination that the current configuration makes unavailable.

Impact: Users repeatedly select a false affordance and land somewhere unrelated, reducing trust in keyboard navigation.

Fix: Register the command only when Tasks is enabled, or render it disabled with a nearby explanation and an Enable Tasks recovery action.

Rule Violated: No broken branches; MCTA-5; next-step clarity.

UX Law: Principle of Least Astonishment.

Heuristic: Match between system and real world; error prevention.

---

[M-5]

Code: NONSEMANTIC-CLICK-TARGETS

Where: Cross-product interactive source used from S022–S026 and downstream journeys; static inventory detects 24 non-semantic onClick targets without complete keyboard semantics.

What: Div/span-style click targets are not consistently equivalent to buttons, links, options, or rows for keyboard and assistive technology.

Impact: Keyboard-only users can miss actions or receive incomplete role/state/activation behavior even when pointer paths work.

Fix: Replace each with the correct native element or shared semantic primitive; where a composite widget is required, implement role, tab order, Enter/Space, state, focus-visible, and tests.

Rule Violated: Complete primary jobs are keyboard-operable; semantic control requirement.

UX Law: Jakob’s Law.

Heuristic: Consistency and standards; accessibility.

---

[M-6]

Code: FOCUS-SUPPRESSION

Where: Cross-product interactive source reachable from workspace journeys; static inventory detects one control that suppresses outline without an explicit focus-visible replacement.

What: A keyboard focus location can become visually invisible.

Impact: Keyboard users can lose position and activate the wrong nearby control.

Fix: Remove unconditional outline suppression or add a semantic-token focus-visible ring with sufficient contrast; cover it in keyboard/visual regression tests.

Rule Violated: Every interactive control has a visible focus-visible state.

UX Law: Fitts’s Law applied to keyboard acquisition.

Heuristic: Visibility of system status.

---

### Minor

None found.

---

## Journey: J08 — Create or clone a project

### Blocker

None found.

### Major

None found in the core wizard; credential settings inherit M-21.

### Minor

None found.

---

## Journey: J09 — Project and session lifecycle

### Blocker

None found.

### Major

[M-8]

Code: PROJECT-SESSION-BROWSER-DIALOGS

Where: S036–S038; project/session rename, delete, and refresh failure paths.

What: Lifecycle actions use window prompt/confirm/alert or console-adjacent feedback rather than an in-product, target-named mutation state.

Impact: Context and focus are interrupted; errors cannot preserve a coherent retry path; destructive consequences are inconsistently presented.

Fix: Use the shared Dialog for rename/delete, an inline status row for refresh, preserve entered names, focus the first error, provide Retry, and restore focus to the originating row.

Rule Violated: State completeness; contextual recovery; dialog accessibility.

UX Law: Doherty Threshold.

Heuristic: Error prevention; help users recover from errors; consistency.

---

### Minor

None found.

---

## Journey: J10 — Prepare a chat and provider

### Blocker

None found.

### Major

None found.

### Minor

None found.

---

## Journey: J11 — Run and control an AI conversation

### Blocker

None found.

### Major

None found.

### Minor

None found.

---

## Journey: J12 — Transcript utilities, export, fork, rewind, and subagents

### Blocker

None found.

### Major

[M-9]

Code: CHAT-COPY-TARGET

Where: S049–S050 at 320 px; Select copy format measures about 20×16.

What: The message copy-format trigger is far below the 44×44 touch target required by the product contract.

Impact: Touch users can miss the utility or activate adjacent message actions.

Fix: Give the trigger a minimum 44×44 hit area without enlarging the glyph, keep its accessible name, and preserve menu focus return.

Rule Violated: Touch/mobile targets are at least 44×44.

UX Law: Fitts’s Law.

Heuristic: Error prevention; flexibility and efficiency.

---

[M-10]

Code: REWIND-NATIVE-CONFIRM

Where: S052, Chat rewind confirmation.

What: A history-altering action delegates consequence and choice to window.confirm instead of showing the selected revision in transcript context.

Impact: Users can approve an irreversible-looking action without enough context; focus and recovery differ by browser.

Fix: Use a shared confirmation Dialog that names the rewind point, states what is retained/removed, defaults focus to Cancel, preserves the original session on failure, and returns focus to the action.

Rule Violated: Destructive actions explicit and confirmed in context; dialog accessibility.

UX Law: Peak-End Rule.

Heuristic: Error prevention; user control and freedom.

---

### Minor

None found.

---

## Journey: J13 — File management

### Blocker

None found.

### Major

None found.

### Minor

None found.

---

## Journey: J14 — File editing and preview

### Blocker

None found.

### Major

[M-7]

Code: IMAGE-ALT-MISSING

Where: Image-bearing product source reachable from S061 and related product surfaces; static inventory detects two img elements without alt.

What: Two images provide neither an accessible text alternative nor explicit decorative treatment.

Impact: Screen-reader users cannot determine the image’s purpose/content, and an unlabeled image may be announced as a filename/URL.

Fix: Add meaningful alt text when the image conveys content; use empty alt only for truly decorative images; add a source rule/test to prevent recurrence.

Rule Violated: Screen-reader support; accessible image naming.

UX Law: Inclusive design constraint rather than a behavioral law.

Heuristic: Match between system and real world; accessibility.

---

### Minor

None found.

---

## Journey: J15 — Local project Shell

### Blocker

None found.

### Major

None found.

### Minor

None found.

---

## Journey: J16 — Review changes and commit

### Blocker

None found.

### Major

None found.

### Minor

None found.

---

## Journey: J17 — Synchronize and recover Git operations

### Blocker

None found.

### Major

None found.

### Minor

None found.

---

## Journey: J18 — Branches and worktrees

### Blocker

None found.

### Major

None found.

### Minor

None found.

---

## Journey: J19 — Set up Task Manager

### Blocker

None found.

### Major

None found.

### Minor

None found.

---

## Journey: J20 — Browse, create, and execute tasks

### Blocker

None found.

### Major

[M-12]

Code: TASK-MUTATION-BROWSER-DIALOGS

Where: S090, task detail update/status/delete paths.

What: Task mutations rely on browser alert/confirm feedback rather than keeping edit, task identity, validation, progress, and recovery inside the task detail surface.

Impact: Users lose context and keyboard focus; failed updates are harder to diagnose/retry and may leave board state uncertain.

Fix: Add an in-detail mutation state with explicit saving/success/failure, preserve edits, confirm destructive/status changes in a named shared Dialog, and refresh the card only after success.

Rule Violated: State completeness; contextual recovery; one primary job.

UX Law: Doherty Threshold.

Heuristic: Visibility of system status; error recovery.

---

### Minor

None found.

---

## Journey: J21 — Create, import, and generate a PRD

### Blocker

None found.

### Major

[M-13]

Code: PRD-BROWSER-DIALOGS

Where: S093–S095, PRD generate/save/overwrite and error paths.

What: Browser alert/confirm is used for generation/save feedback, detaching progress, errors, and overwrite consequence from the PRD content.

Impact: Users can lose orientation, cannot compare the affected content while deciding, and lack a durable, accessible Retry state.

Fix: Model PRD intake as explicit idle/generating/generated/saving/saved/failed states; use a shared overwrite Dialog with content/destination context and keep editor input intact.

Rule Violated: Long-running feedback; errors preserve input and recover in context; MCTA-3.

UX Law: Doherty Threshold.

Heuristic: Visibility of system status; error prevention; recovery.

---

### Minor

None found.

---

## Journey: J22 — Use the project drawer

### Blocker

[B-2]

Code: MOBILE-DRAWER-EXIT-OFFSCREEN

Where: S096–S098 at 320 px; the only Collapse/Close control is x=-64 with width 44.

What: The 340 px project drawer overflows a 320 px viewport and positions its sole dismissal control completely offscreen; keyboard focus also lands offscreen.

Impact: Touch users cannot close the drawer, and keyboard users cannot see the focused exit. The required return-to-workspace job is impossible.

Fix: Cap mobile drawer width at 100vw, place a fixed 44×44 close control inside the visible leading/trailing header, focus it/heading on open, support Escape/back, and restore focus to the handle.

Rule Violated: Required back/exit path; 320 px smoke contract; 44×44 reachable target.

UX Law: Fitts’s Law.

Heuristic: User control and freedom.

---

### Major

[M-11]

Code: DRAWER-TASK-TOUCH-TARGETS

Where: S097/S088/S091 at 320 px; filters are about 29 px high, Refresh 32×32, and Run 52×25.

What: Frequently used task filtering, refresh, and execution controls do not meet the 44×44 mobile target minimum.

Impact: Touch users make errors or cannot reliably operate compact project-task controls.

Fix: Apply minimum 44 px block/inline hit areas, enlarge spacing without overemphasizing secondary controls, and runtime-test geometry at 320 px.

Rule Violated: Touch/mobile targets are at least 44×44.

UX Law: Fitts’s Law.

Heuristic: Error prevention; flexibility and efficiency.

---

[M-14]

Code: MOBILE-DRAWER-WIDTH-STACK

Where: S024 and S096 at 320 px.

What: Project drawer stays 340 px wide in a 320 px viewport, and the mobile sidebar and project drawer may be open simultaneously.

Impact: Content overflows, two competing navigation/context layers obscure the workspace, focus ownership is ambiguous, and orientation deteriorates.

Fix: Add a single mobile-overlay coordinator: opening one closes the other; use viewport width, one backdrop, one focus owner, and one z-index/lifecycle contract.

Rule Violated: One primary job; no competing overlays; orientation; mobile smoke contract.

UX Law: Hick’s Law.

Heuristic: Aesthetic and minimalist design; user control.

---

### Minor

None found.

---

## Journey: J23 — Browse and act on schedules

### Blocker

No independent defect; mobile completion inherits B-2 from the project-drawer container.

### Major

None independent.

### Minor

None found.

---

## Journey: J24 — Create or edit a schedule

### Blocker

None found.

### Major

None found.

### Minor

None found.

---

## Journey: J25 — Settings navigation, appearance, and notifications

### Blocker

None found.

### Major

[M-15]

Code: SETTINGS-SAVE-ERROR-HIDDEN

Where: S111 and all Settings groups using useSettingsController.

What: The controller sets saveStatus to error, but Settings renders only successful status; users see neither failure nor Retry.

Impact: Users may close Settings believing a preference, credential-adjacent option, or notification setting persisted when it did not.

Fix: Render shared Saving, Saved, and Failed—Retry states; associate failure with the changed control, retain its value, announce status, and block false success.

Rule Violated: State completeness; recovery in context; MCTA-3.

UX Law: Doherty Threshold.

Heuristic: Visibility of system status; help users recover from errors.

---

[M-16]

Code: SETTINGS-TOUCH-TARGETS

Where: S109–S110 and S127–S130 at mobile size: Dark Mode switch 48×28, selects about 38–42 px high, Notifications Enable 36 px, checkboxes 16×16, About version 51×20.

What: Multiple Settings controls have rendered hit areas below the 44×44 product minimum.

Impact: Touch users are more likely to miss, toggle the wrong preference, or fail to open small links.

Fix: Give each control/label pair a minimum 44×44 hit region, increase row height, make checkbox labels clickable, and add rendered-geometry assertions at 320 px.

Rule Violated: Touch/mobile targets are at least 44×44.

UX Law: Fitts’s Law.

Heuristic: Error prevention; flexibility and efficiency.

---

[M-26]

Code: USEFUL-TEXT-OPACITY

Where: Cross-product surfaces including Settings; static inventory detects 94 useful-text opacity/low-alpha usages.

What: Useful text is visually dimmed using opacity or low-alpha color even where token contrast pairs pass in isolation.

Impact: Effective contrast varies with background and layering; low-vision users have materially reduced readability and status/secondary information can appear disabled.

Fix: Replace opacity dimming with tested semantic text tokens at full opacity, preserve hierarchy through size/weight/spacing, and run component-level contrast checks on real composed backgrounds.

Rule Violated: Useful text is not dimmed with opacity and has at least 4.5:1 contrast.

UX Law: Signal-to-Noise Ratio.

Heuristic: Visibility of system status; accessibility.

---

### Minor

[m-1]

Code: SEMANTIC-COLOR-DEBT

Where: Cross-product styling; static inventory detects 138 raw color values and 2,346 palette-specific Tailwind color usages.

What: Large parts of the UI bypass semantic design tokens.

Impact: Current tested token pairs pass contrast, but theme consistency, future contrast fixes, and state meaning require broad mechanical changes.

Fix: Migrate by shared primitive/surface to semantic foreground, surface, border, focus, success, warning, and destructive tokens; lock new violations in CI.

Rule Violated: Repository semantic visual-language contract.

UX Law: Law of Similarity.

Heuristic: Consistency and standards.

---

[m-2]

Code: RAW-MODAL-SURFACE-DEBT

Where: Cross-product styling; static inventory detects 30 raw modal-surface patterns.

What: Modal-looking surfaces are repeatedly assembled ad hoc instead of using one dialog/sheet primitive.

Impact: Visual spacing and layering vary, and future accessibility fixes must be repeated; the known semantic failures are separately classified as M-1, M-18, and M-23.

Fix: Inventory the 30 locations, separate true modal/docked/popover patterns, migrate true modals to shared Dialog, and prohibit new raw fixed-overlay shells.

Rule Violated: Consistent dialog and modal interaction contract.

UX Law: Jakob’s Law.

Heuristic: Consistency and standards.

---

[m-3]

Code: STALE-SETTINGS-NAV

Where: SettingsMainTabs.tsx; no callers, while S108 uses SettingsSidebar.

What: A stale duplicate Settings navigation component remains in source.

Impact: It creates maintenance ambiguity and risks future work updating or reviving the wrong information architecture.

Fix: Verify no dynamic imports, then remove it or document/deprecate it explicitly; retain SettingsSidebar as the only canonical navigation.

Rule Violated: One canonical journey/navigation implementation.

UX Law: Occam’s Razor.

Heuristic: Consistency and standards.

---

## Journey: J26 — Configure and test Voice

### Blocker

None found.

### Major

No Voice-specific defect; rendered control/text issues inherit M-16 and M-26.

### Minor

None found.

---

## Journey: J27 — Manage agent accounts, profiles, models, and permissions

### Blocker

[B-3]

Code: AGENT-PERMISSIONS-BLANK

Where: S121, Settings → Agents → OpenCode → Permissions.

What: The navigation path is reachable, but no render branch supplies content, loading, empty, unsupported, error, or permission controls.

Impact: Users cannot inspect or change OpenCode permissions and encounter an unexplained dead end.

Fix: Implement the permission management surface with complete states, or remove/disable the tab with an explicit “Not supported” explanation and supported alternative until implementation exists.

Rule Violated: No dead ends/broken branches; one primary job and next step per screen.

UX Law: Principle of Least Astonishment.

Heuristic: Visibility of system status; match between system and real world.

---

### Major

[M-17]

Code: AGENT-PROFILE-FEEDBACK

Where: S119–S120; provider profile delete and provider/model/profile mutation failures.

What: Profile deletion uses browser confirmation, and some failures are browser-dialog or console-only rather than inline with the affected profile.

Impact: Users lose context and may not know whether credentials/configuration changed, especially when returning to Chat or Schedules.

Fix: Use one profile mutation state, shared confirmation Dialog, retained form values, visible Failed—Retry, status announcement, and focus return to the profile row.

Rule Violated: State completeness; contextual recovery; dialog accessibility.

UX Law: Doherty Threshold.

Heuristic: Visibility of system status; error prevention/recovery.

---

### Minor

None found.

---

## Journey: J28 — Manage MCP servers and Skills

### Blocker

[B-4]

Code: SKILL-REMOVE-ORPHAN

Where: S126; a skill-removal API exists, but the installed-skills UI has no Remove action.

What: Users can install a skill but cannot reverse that installation from the product.

Impact: The skill lifecycle cannot be completed; unwanted, broken, or unsafe skill content remains installed unless users leave the UI and manipulate files/APIs.

Fix: Add Remove on installed skill rows with destination/provider context, explicit confirmation, progress, failure recovery, success refresh, and focus fallback.

Rule Violated: User control and freedom; complete account/integration lifecycle; reachable inverse action.

UX Law: Mental Models.

Heuristic: User control and freedom.

---

### Major

[M-18]

Code: MCP-MODAL-SEMANTICS

Where: S123; Add/Edit MCP server raw fixed overlay stacked over the Settings Dialog.

What: The overlay has no dialog role/name, initial focus, focus containment, background hiding, or deterministic return; the underlying Settings dialog stays exposed.

Impact: Keyboard and screen-reader users can move between two active layers and cannot reliably understand or complete the MCP form.

Fix: Use the shared nested Dialog pattern or move MCP editing into the Settings content pane; set title/description, initial error/field focus, containment, Escape, inert background, and origin focus return.

Rule Violated: Modal dialog accessibility; one primary job; MCTA-6.

UX Law: Jakob’s Law.

Heuristic: Consistency and standards; user control.

---

[M-19]

Code: MCP-NATIVE-DIALOG-FEEDBACK

Where: S123–S124; MCP submit/delete/restart result paths.

What: MCP mutations rely on browser alert/confirm instead of persistent in-product states.

Impact: Configuration input and list context are fragmented; errors have weak retry/focus behavior; destructive intent is inconsistently expressed.

Fix: Preserve form input, show inline validation/server errors, use a named shared delete Dialog, and provide persistent per-server progress/success/failure with Retry.

Rule Violated: State completeness; contextual recovery; dialog accessibility.

UX Law: Doherty Threshold.

Heuristic: Error prevention; help users recover from errors.

---

[M-20]

Code: SKILLS-TOUCH-TARGETS

Where: S125; Close measures 32×32 and “Where will this install?” about 123×16.

What: Important dismiss/disclosure controls do not meet the 44×44 mobile target minimum.

Impact: Touch users can miss the close or destination explanation, which is material before installing code/content.

Fix: Provide 44×44 hit areas, make the entire disclosure row clickable, retain visible focus and accessible expanded state, and test at 320 px.

Rule Violated: Touch/mobile targets are at least 44×44.

UX Law: Fitts’s Law.

Heuristic: Error prevention; recognition rather than recall.

---

### Minor

None found.

---

## Journey: J29 — Configure API tokens, Git, Tasks, and view About

### Blocker

None independent; Tasks navigation inherits M-4.

### Major

[M-21]

Code: CREDENTIAL-GIT-SILENT-FAILURES

Where: S127–S131; API/GitHub credential mutations and Git settings.

What: Several mutation failures are logged only to the developer console; credential deletion also uses browser confirmation.

Impact: Users cannot tell whether security-sensitive credentials or Git configuration changed and receive no contextual Retry.

Fix: Route all mutations through a typed visible result model; preserve fields/secrets safely, show Failed—Retry beside the affected item, use shared confirmation, announce status, and log only supplemental diagnostics.

Rule Violated: State completeness; MCTA-3; logging is not user feedback.

UX Law: Doherty Threshold.

Heuristic: Visibility of system status; error recovery.

---

### Minor

None found.

---

## Journey: J30 — Set up and monitor Browser automation

### Blocker

None found.

### Major

[M-22]

Code: BROWSER-ERROR-NO-RETRY

Where: S132–S133 and S136, Browser Settings setup/service errors.

What: Errors are exposed, but affected states provide no explicit Retry; users must infer that reopening or reloading retries setup/status.

Impact: A recoverable transient failure appears terminal and users abandon Browser automation.

Fix: Add outcome-labeled Retry in the error surface, retain setup/configuration, show progress and terminal result, and keep dependencies/settings as secondary recovery.

Rule Violated: MCTA-3; recovery in context; next-step clarity.

UX Law: Principle of Least Astonishment.

Heuristic: Help users recognize, diagnose, and recover from errors.

---

[M-23]

Code: BROWSER-FULLSCREEN-DESTRUCTIVE

Where: S134–S135; Browser fullscreen raw overlay and Stop/Delete controls.

What: Fullscreen uses an ad hoc modal surface with incomplete dialog/focus behavior; Stop/Delete are small, and Delete has no confirmation.

Impact: Keyboard users can lose layer/focus context, touch users can mis-hit controls, and a Browser session can be deleted accidentally.

Fix: Make fullscreen a semantic Dialog or non-modal layout mode with clear return; provide ≥44×44 controls, visually separate Delete, and confirm deletion with session identity and safe focus defaults.

Rule Violated: Dialog accessibility; 44×44 target; destructive actions confirmed.

UX Law: Fitts’s Law.

Heuristic: Error prevention; user control and freedom.

---

### Minor

None found.

---

## Journey: J31 — Configure plugins and enter plugin-defined journeys

### Blocker

None in the core-owned boundary.

### Major

[M-24]

Code: PLUGIN-TARGET-GOVERNANCE

Where: S137–S140; core Plugins settings contains numerous 16–40 px links/buttons, while S139 mounts dynamically fetched third-party UI without a statically enforceable journey/accessibility contract.

What: Core controls fail mobile geometry, and plugin-defined CTAs, focus, states, errors, and exits can diverge from host behavior.

Impact: Touch completion is materially harder before mount, and installed plugin journeys may become inaccessible or trap users without a reliable core return.

Fix: Bring core targets to ≥44×44; keep a core-owned header/Back/ErrorBoundary; publish and enforce a plugin host contract for semantics, focus, Escape, status states, navigation, security, and responsive geometry.

Rule Violated: Touch target and complete-journey accessibility; consistent product boundary.

UX Law: Jakob’s Law.

Heuristic: Consistency and standards; error recovery.

---

### Minor

None found.

---

## Journey: J32 — Check and install Desktop updates

### Blocker

None found.

### Major

None found.

### Minor

None found.

---

## Journey: J33 — Report an issue and share diagnostics

### Blocker

None found within the configured-tracker boundary.

### Major

None found.

### Minor

None found.

---

## Journey: J34 — Notifications, deep links, route recovery, and offline

### Blocker

None found.

### Major

[M-25]

Code: OFFLINE-RECOVERY

Where: S157, service-worker navigation fallback.

What: Offline navigation renders minimal raw HTML with only an “Offline” message; it loses the product shell, intended destination context, live reconnection status, and explicit in-page Retry.

Impact: Users cannot tell whether/when the app can recover and must know to use browser controls, creating likely abandonment.

Fix: Serve an accessible branded offline shell with destination-safe Retry, online-event reconnection, current status, cached-safe navigation where supported, and automatic return to the original route after recovery.

Rule Violated: State completeness; contextual recovery; next-step clarity.

UX Law: Jakob’s Law.

Heuristic: Visibility of system status; help users recover from errors.

---

### Minor

None found.

---

## Quick Wins

1. Hide or disable Go to Tasks in the command palette when Tasks is disabled.
2. Render Settings Failed—Retry from the existing saveStatus=error state.
3. Add an explicit Retry button to Browser Settings errors.
4. Increase the mobile menu, Chat copy, drawer Task, Settings, Skills, Browser, Plugin, and About hit areas to 44×44.
5. Cap the mobile project drawer at 100vw and place its close button inside the fixed visible header.
6. Make mobile sidebar and project drawer mutually exclusive.
7. Add alt or explicit decorative alt to the two detected images.
8. Remove the one focus-outline suppression or add focus-visible styling.
9. Render an explicit unsupported state in OpenCode Permissions until controls exist.
10. Add Remove to installed Skills using the existing removal API.
11. Remove the unused SettingsMainTabs component after a final dynamic-import check.
12. Replace the raw Offline page with a small branded page containing Retry and online status.

## Structural Fixes

1. Establish one responsive overlay coordinator for mobile sidebar, project drawer, Settings, nested MCP editing, Browser fullscreen, and other dialogs. It must own mutual exclusion, inert background, Escape, initial focus, containment, return focus, viewport width, and z-index.
2. Replace the 18 browser alert/confirm calls with shared, context-preserving mutation state machines and a single accessible confirmation primitive. Prioritize project/session lifecycle, PRD, Tasks detail, MCP, credential/profile deletion, and Chat rewind.
3. Create a shared mutation feedback contract—idle, validating, saving/running, partial success, success, failed with typed Retry—and apply it to Settings, credentials, Git, providers, MCP, Browser, project/session actions, PRD, and Tasks.
4. Add a runtime accessibility gate at 320 px that measures every interactive bounding box, opens every overlay, checks one visible focus owner, exercises Escape/backdrop/return focus, and fails on horizontal overflow or offscreen controls.
5. Migrate ad hoc interactive elements to native/shared semantic primitives, closing all 24 non-semantic click-target findings and the focus-suppression finding.
6. Migrate raw/palette-specific colors and opacity-dimmed text to semantic tokens by shared primitive and surface; verify contrast on composed backgrounds, not token pairs alone.
7. Complete reversible lifecycle IA: standalone Logout, Skill Remove, safe Browser Delete, and contextual project/session/task/provider/MCP deletion.
8. Make SettingsSidebar the sole settings IA, and centralize section metadata, feature visibility, command-palette destinations, titles, and recovery links from the same registry.
9. Define and enforce a plugin host UX contract with a core-owned return path, loading/error boundary, semantic control rules, focus lifecycle, responsive limits, and security restrictions.
10. Retain the product’s strongest patterns as canonical templates: create-project structured errors, Chat catalog recovery, Git commit/sync recovery, Task setup stages, Schedule editor progressive disclosure, Voice test/autosave, update verification, and Report Issue privacy preview.
