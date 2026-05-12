# companion-module-cueprox

Bitfocus Companion module for **CueProX** — control shows, cues, alerts, and Q&A from a Stream Deck or other Companion-supported hardware.

## What this module does

- Connects to a CueProX room and reflects live session state (active cue, show timer, broadcast status)
- Triggers cue navigation (next, previous, jump-to-cue)
- Starts, ends, pauses, and resumes shows
- Pushes and clears director alerts to team output screens
- Exposes session and broadcast state as Companion variables and feedbacks

### Real-time updates

Once a room is selected, the module opens a Socket.io connection to CueProX and subscribes to live events: `session_state` (active cue, timer), `director_alert` (alert pushed/cleared), and `qa:updated` (Q&A state changes). These power feedbacks and variables added in M2/M3.

## Documentation

Full CueProX API and integration documentation: <https://docs.cueprox.com> _(placeholder — docs site coming soon)_

## Requirements

- [Bitfocus Companion](https://bitfocus.io/companion) 4.x (built-in Node runtime)
- Node.js 18+ (for local development / building only)
- A CueProX account with an API token (Settings → API Tokens)

## Development mode — local install

```bash
# 1. Clone this repo
git clone https://github.com/willemvds8/companion-module-cueprox.git
cd companion-module-cueprox

# 2. Install dependencies
npm install

# 3. Build
npm run build

# 4. Add to Companion
#    Companion → Settings → Developer modules → add the path to this folder
#    Click "Rescan modules" or restart Companion

# 5. Add an instance
#    Companion → Connections → Add connection → search "CueProX"
```

### Live rebuild during development

```bash
npm run dev   # tsc --watch — rebuilds on every save
```

After each rebuild, use the **Reload** button in Companion's developer module panel to pick up changes without a full restart.

## Configuration

| Field     | Description                                          |
|-----------|------------------------------------------------------|
| Host URL  | Base URL of your CueProX instance (e.g. `https://app.cueprox.com`) |
| API token | Bearer token from CueProX Settings → API Tokens. **Note:** Companion stores this in plain text — run Companion on a secured machine. |
| Room      | Populated automatically after a successful connection |

## Security note on API tokens

Companion's config UI does not support secret/masked fields. The API token will be visible in the Companion web interface and stored unencrypted in Companion's config file. Treat the machine running Companion as a trusted internal device.

## License

MIT © 2026 Willem van der Sluijs
