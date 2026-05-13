# CueProX Companion Module

Control your live show from a Stream Deck or any Bitfocus Companion-supported hardware. This module connects [Bitfocus Companion](https://bitfocus.io/companion) to [CueProX](https://app.cueprox.com), giving you physical buttons for cue navigation, session control, alerts, and Q&A — plus live variables and feedbacks that reflect the current state of your room.

## What is CueProX?

CueProX is a real-time live show control platform for churches, theaters, conferences, and broadcast productions. It lets a director run a show from a web browser: manage cues, push alerts to team output screens, control Q&A, and monitor broadcast sources — all in one place. Visit [app.cueprox.com](https://app.cueprox.com) to create an account.

## Features

- **11 actions** — session start/end/pause/resume, cue next/previous, alert push/clear, Q&A open/close, broadcast state forwarding
- **12 variables** — active cue name, position and type, next cue, live timer (elapsed + remaining), active alert text, Q&A state, session state, broadcast streaming/recording
- **4 feedbacks** — session active, Q&A open, alert live, broadcast streaming (button background color changes)
- **Broadcast forwarding** — push streaming/recording/scene state from OBS, vMix, ATEM or any Companion-integrated tool into CueProX
- **Token-scoped access** — use account-wide or room-restricted API tokens

## Requirements

- Bitfocus Companion 4.x
- A CueProX account with at least one room
- An API token from CueProX (Dashboard → Settings → API Tokens)

## Installation

### Option 1 — Bitfocus module store (preferred)

Search for "CueProX" in Companion's **Add connection** dialog. *(Pending review — not yet in the store.)*

### Option 2 — Manual install from this repo

```bash
git clone https://github.com/willemvds8/companion-module-cueprox.git
cd companion-module-cueprox
npm install
npm run build
```

Then in Companion:

1. **Settings → Developer modules** → add the path to the cloned folder
2. Click **Rescan modules** (or restart Companion)
3. **Connections → Add connection** → search "CueProX"

## Configuration

| Field      | Description |
|------------|-------------|
| Server URL | Base URL of your CueProX instance. Default: `https://app.cueprox.com` |
| API token  | Bearer token starting with `cprx_`. Stored in plain text — run Companion on a trusted machine. |
| Room       | Populated automatically after a successful connection. Select the room this instance should control. |

### Getting an API token

1. Log in to CueProX → **Settings → API Tokens → Create new token**
2. Choose a scope:
   - **Account-wide** — the token can access all rooms in your account
   - **Specific rooms** — the token is restricted to the rooms you select (recommended for Companion)
3. Copy the token; you will not be able to view it again

## Actions

| Action ID | Name | Options |
|---|---|---|
| `cue_next` | Next cue | — |
| `cue_previous` | Previous cue | — |
| `session_start` | Start session | Show (dropdown) |
| `session_end` | End session | — |
| `session_pause` | Pause session | — |
| `session_resume` | Resume session | — |
| `qa_open` | Open Q&A | — |
| `qa_close` | Close Q&A | — |
| `alert_push` | Push alert | Alert (dropdown) |
| `alert_clear` | Clear alert | — |
| `update_broadcast_state` | Update broadcast state | Room, Streaming, Recording, Scene, Source |

All actions except `update_broadcast_state` operate on the room selected in the module's connection config. `update_broadcast_state` has its own room picker so you can forward broadcast state to any room from a single Companion instance.

## Variables

Reference variables in button labels as `$(CueProX:variable_id)` (replace `CueProX` with your instance label if you renamed it).

| Variable ID | Description | Example value |
|---|---|---|
| `current_cue_name` | Active cue title | `Welcome` |
| `current_cue_number` | Active cue position in show | `3` |
| `current_cue_type` | Active cue type slug | `speaker` |
| `next_cue_name` | Next cue title | `Worship set` |
| `next_cue_number` | Next cue position in show | `4` |
| `cue_time_elapsed` | Time elapsed on active cue (mm:ss) | `02:34` |
| `cue_time_remaining` | Time remaining on active cue (mm:ss) | `07:26` — `--:--` if no duration set |
| `active_alert_text` | Text of the currently live alert | `Offering now` |
| `qa_open` | Q&A open state | `open` or `closed` |
| `session_active` | Whether a session is running | `yes` or `no` |
| `broadcast_streaming` | Broadcast source streaming state | `yes` or `no` |
| `broadcast_recording` | Broadcast source recording state | `yes` or `no` |

Variables are seeded from the REST API on connect and updated in real time via the Socket.io event stream.

## Feedbacks

Feedbacks change a button's background color when a condition is true.

| Feedback ID | Description | Default color |
|---|---|---|
| `session_active` | A session is running in the configured room | Green `#00b894` |
| `qa_is_open` | Q&A is currently open | Amber `#f59e0b` |
| `alert_is_live` | An alert is currently visible on output screens | Red `#e74c3c` |
| `broadcast_streaming` | Broadcast source is streaming | Red `#e74c3c` |

## Broadcast forwarding (advanced)

CueProX displays a broadcast pill in the director view showing whether your broadcast tool is live. The `update_broadcast_state` action lets you push that state from within Companion using triggers from your existing OBS, vMix, or ATEM module — no server-side configuration needed.

**Example — forward OBS streaming state:**

1. Create a trigger: **OBS: Streaming started**
2. Action: **CueProX → Update broadcast state**
   - Room: `Hoofdzaal`
   - Streaming: enabled
   - Scene: `$(obs:current_scene)` *(resolves at trigger time)*
   - Source: `OBS`
3. Create a matching trigger for **OBS: Streaming stopped** with Streaming disabled

CueProX immediately reflects the state in the broadcast pill and updates the `broadcast_streaming` variable, which in turn can flip your Companion feedbacks.

## Troubleshooting

**Connection fails or shows "unauthorized"**
Check that the token belongs to the correct environment. Tokens issued on `app.cueprox.com` will not work against `dev.cueprox.com` and vice versa.

**Variables show `$NA` on buttons**
Variable references are case-sensitive and must match your instance label exactly. If you renamed the connection to `CPX`, use `$(CPX:current_cue_name)`. Check **Connections** for the exact label shown there.

**Actions execute (log shows "executed") but nothing changes in CueProX**
Confirm the token's scope includes the target room. A room-scoped token that does not list the target room will silently reject the join and no state changes will be applied.

**Timer variables stop updating**
The timer ticker stops when the session ends or the socket disconnects. Disable and re-enable the connection in Companion to re-seed state from the REST API.

## Development

```bash
npm install        # install dependencies
npm run build      # compile TypeScript → dist/
npm run dev        # tsc --watch, rebuilds on save
```

Branch model: `feature/*` → `develop` → `main`.

Validate the Companion manifest:

```bash
npx --yes -p @companion-module/tools companion-module-check
```

## License

MIT — see [LICENSE](LICENSE).

## Links

- CueProX: [app.cueprox.com](https://app.cueprox.com)
- Integration docs: [app.cueprox.com/docs/companion](https://app.cueprox.com/docs/companion) *(coming soon)*
- Bitfocus Companion: [bitfocus.io/companion](https://bitfocus.io/companion)
- GitHub: [github.com/willemvds8/companion-module-cueprox](https://github.com/willemvds8/companion-module-cueprox)
