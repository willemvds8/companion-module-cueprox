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

    // Step 3 — Open Socket.io connection for real-time events
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
