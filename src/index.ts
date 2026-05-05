import {
  InstanceBase,
  InstanceStatus,
  runEntrypoint,
  type SomeCompanionConfigField,
} from '@companion-module/base'
import { type ModuleConfig, getConfigFields } from './config'
import { ApiError, CueProxApi } from './api'

// M1: HTTP-only connection (ping + room fetch).
// Socket.io integration is deferred to M1.5 pending token-auth support on the CueProX server.
// The main socket namespace (pages/api/socket.ts) only accepts session cookies (verifySessionCookie),
// not Bearer tokens. Fix needed: add a socket middleware branch checking
// socket.handshake.auth.token against the api_tokens table.

class ModuleInstance extends InstanceBase<ModuleConfig> {
  private api: CueProxApi | null = null
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
    this.api = null
    this.updateStatus(InstanceStatus.Connecting)

    const { host, token } = this.savedConfig

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
    this.updateStatus(InstanceStatus.Ok)
    this.log('info', `Connected to ${host}`)
  }
}

runEntrypoint(ModuleInstance, [])
