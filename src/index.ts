import {
  InstanceBase,
  InstanceStatus,
  runEntrypoint,
  type SomeCompanionConfigField,
} from '@companion-module/base'
import { type ModuleConfig, getConfigFields } from './config'
import { ApiError, CueProxApi } from './api'
import { CueProxSocket } from './socket-client'

class ModuleInstance extends InstanceBase<ModuleConfig> {
  private api: CueProxApi | null = null
  private socket: CueProxSocket | null = null
  private rooms: Array<{ id: number; label: string }> = []
  private savedConfig: ModuleConfig = { host: 'https://app.cueprox.com', token: '', roomId: 0 }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async init(config: ModuleConfig, _isFirstInit: boolean, _secrets: undefined): Promise<void> {
    this.savedConfig = config
    await this.setupConnection()
  }

  async configUpdated(config: ModuleConfig, _secrets: undefined): Promise<void> {
    this.savedConfig = config
    await this.setupConnection()
  }

  async destroy(): Promise<void> {
    this.socket?.disconnect()
    this.socket = null
    this.api = null
    this.log('debug', 'Module destroyed')
  }

  getConfigFields(): SomeCompanionConfigField[] {
    // Called each time the user opens the config panel.
    // After a successful connect, this.rooms is populated and the Room dropdown shows real choices.
    return getConfigFields(this.rooms)
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  private async initActions(): Promise<void> {
    const { roomId } = this.savedConfig

    // Fetch alert choices for the alert_push dropdown at registration time.
    // initActions() is called on every (re)connect so the list stays fresh
    // whenever the user reconfigures the module. Falls back to empty on error.
    let alertChoices: Array<{ id: number | string; label: string }> = []
    if (this.api && roomId > 0) {
      try {
        const alerts = await this.api.getAlerts(roomId)
        alertChoices = alerts.map((a) => ({ id: a.id, label: a.text }))
      } catch (err) {
        this.log('warn', `Could not fetch alerts for dropdown: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (alertChoices.length === 0) {
      alertChoices = [{ id: 0, label: 'No alerts found — re-open config to refresh' }]
    }

    const guard = (): boolean => {
      if (!this.api) {
        this.log('warn', 'CueProX not connected')
        return false
      }
      if (!(this.savedConfig.roomId > 0)) {
        this.log('warn', 'No room selected — configure the connection first')
        return false
      }
      return true
    }

    const run = async (actionId: string, fn: () => Promise<unknown>): Promise<void> => {
      try {
        await fn()
        this.log('info', `Action ${actionId} executed`)
      } catch (err) {
        this.log('error', `Action ${actionId} failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    this.setActionDefinitions({
      cue_next: {
        name: 'Next cue',
        options: [],
        callback: async () => {
          if (!guard()) return
          await run('cue_next', () => this.api!.nextCue(this.savedConfig.roomId))
        },
      },
      cue_previous: {
        name: 'Previous cue',
        options: [],
        callback: async () => {
          if (!guard()) return
          await run('cue_previous', () => this.api!.previousCue(this.savedConfig.roomId))
        },
      },
      session_start: {
        name: 'Start session',
        options: [
          {
            type: 'number',
            id: 'show_id',
            label: 'Show ID',
            min: 1,
            max: 999999,
            default: 1,
            required: true,
          },
        ],
        callback: async (action) => {
          if (!guard()) return
          const showId = Number(action.options.show_id)
          await run('session_start', () => this.api!.startSession(this.savedConfig.roomId, showId))
        },
      },
      session_end: {
        name: 'End session',
        options: [],
        callback: async () => {
          if (!guard()) return
          await run('session_end', () => this.api!.endSession(this.savedConfig.roomId))
        },
      },
      session_pause: {
        name: 'Pause session',
        options: [],
        callback: async () => {
          if (!guard()) return
          await run('session_pause', () => this.api!.pauseSession(this.savedConfig.roomId))
        },
      },
      session_resume: {
        name: 'Resume session',
        options: [],
        callback: async () => {
          if (!guard()) return
          await run('session_resume', () => this.api!.resumeSession(this.savedConfig.roomId))
        },
      },
      qa_open: {
        name: 'Open Q&A',
        options: [],
        callback: async () => {
          if (!guard()) return
          await run('qa_open', () => this.api!.openQa(this.savedConfig.roomId))
        },
      },
      qa_close: {
        name: 'Close Q&A',
        options: [],
        callback: async () => {
          if (!guard()) return
          await run('qa_close', () => this.api!.closeQa(this.savedConfig.roomId))
        },
      },
      alert_push: {
        name: 'Push alert',
        options: [
          {
            type: 'dropdown',
            id: 'alert_id',
            label: 'Alert',
            choices: alertChoices,
            default: alertChoices[0]?.id ?? 0,
          },
        ],
        callback: async (action) => {
          if (!guard()) return
          const alertId = Number(action.options.alert_id)
          await run('alert_push', () => this.api!.pushAlert(this.savedConfig.roomId, alertId))
        },
      },
      alert_clear: {
        name: 'Clear alert',
        options: [],
        callback: async () => {
          if (!guard()) return
          await run('alert_clear', () => this.api!.clearAlert(this.savedConfig.roomId))
        },
      },
    })
  }

  // ── Connection ─────────────────────────────────────────────────────────────

  private async setupConnection(): Promise<void> {
    // Disconnect any existing socket before rebuilding clients.
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
    this.api = null
    this.updateStatus(InstanceStatus.Connecting)

    const { host, token, roomId } = this.savedConfig

    if (!host || !token) {
      this.updateStatus(InstanceStatus.BadConfig, 'Host URL and API token are required')
      return
    }

    const api = new CueProxApi(host, token)

    // Step 1 — Validate credentials via GET /api/v1/ping
    try {
      await api.ping()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        this.updateStatus(InstanceStatus.AuthenticationFailure, 'Invalid API token (401)')
      } else if (err instanceof ApiError) {
        this.updateStatus(InstanceStatus.ConnectionFailure, `HTTP ${err.status}: ${err.message}`)
      } else {
        this.updateStatus(
          InstanceStatus.ConnectionFailure,
          err instanceof Error ? err.message : String(err),
        )
      }
      return
    }

    // Step 2 — Fetch rooms (non-fatal; populates dropdown on next config-panel open)
    try {
      const rooms = await api.getRooms()
      this.rooms = rooms.map((r) => ({ id: r.id, label: r.name }))
    } catch (err) {
      this.log(
        'warn',
        `Failed to fetch rooms — re-open config to retry. ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    this.api = api
    this.log('info', `Connected to ${host}`)

    // Step 3 — Register actions now that the API client is ready
    await this.initActions()

    // Step 4 — Open Socket.io connection for real-time events
    if (roomId > 0) {
      const socket = new CueProxSocket({
        host,
        token,
        roomId,
        logger: this.log.bind(this),
      })

      socket.on('connected', () => {
        this.updateStatus(InstanceStatus.Ok, 'Connected')
      })
      socket.on('disconnected', ({ reason }: { reason: string }) => {
        this.updateStatus(InstanceStatus.Disconnected, `Disconnected: ${reason}`)
      })
      socket.on('reconnecting', () => {
        this.updateStatus(InstanceStatus.Connecting, 'Reconnecting…')
      })
      socket.on('auth_failed', () => {
        this.updateStatus(InstanceStatus.AuthenticationFailure, 'Invalid token')
      })
      socket.on('scope_denied', ({ message }: { message?: string }) => {
        this.updateStatus(InstanceStatus.BadConfig, message ?? 'Token not authorized for this room')
      })
      socket.on('connection_error', () => {
        this.updateStatus(InstanceStatus.UnknownError, 'Socket connection error')
      })
      // Real-time event handlers — M1-B only logs, no Companion vars/feedbacks yet
      socket.on('session_state', (payload: { activeCueId?: number | null }) => {
        this.log('debug', `session_state: activeCue=${payload?.activeCueId ?? 'null'}`)
      })
      socket.on('director_alert', (payload: unknown) => {
        this.log('debug', `director_alert: ${JSON.stringify(payload).slice(0, 200)}`)
      })
      socket.on('qa_updated', () => {
        this.log('debug', 'qa_updated event received')
      })
      socket.on('cue_note_updated', (payload: { cueId?: number; teamId?: number }) => {
        this.log('debug', `cue_note_updated: cueId=${payload?.cueId}, teamId=${payload?.teamId}`)
      })

      this.socket = socket
      socket.connect()
    } else {
      this.updateStatus(InstanceStatus.Ok, 'Select a room in config to enable live updates')
    }
  }
}

runEntrypoint(ModuleInstance, [])
