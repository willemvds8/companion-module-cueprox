import {
  InstanceBase,
  InstanceStatus,
  runEntrypoint,
  type SomeCompanionConfigField,
} from '@companion-module/base'
import { type ModuleConfig, getConfigFields } from './config'
import { ApiError, CueProxApi, type ApiRoomState } from './api'
import { CueProxSocket, type LiveSessionState, type LiveAlertPayload } from './socket-client'

class ModuleInstance extends InstanceBase<ModuleConfig> {
  private api: CueProxApi | null = null
  private socket: CueProxSocket | null = null
  private rooms: Array<{ id: number; label: string }> = []
  private savedConfig: ModuleConfig = { host: 'https://app.cueprox.com', token: '', roomId: 0 }
  private timerInterval: ReturnType<typeof setInterval> | null = null
  private moduleState = {
    sessionActive:      false,
    activeCueId:        null as number | null,
    currentCueTitle:    '',
    currentCueDurationMs: 0,
    nextCueTitle:       '',
    timerStartedAt:     null as number | null,
    timerPausedAt:      null as number | null,
    timerPauseOffsetMs: 0,
    timerIsRunning:     false,
    qaOpen:             false,
    alertText:          '',
    broadcastStreaming:  false,
    broadcastRecording:  false,
  }

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
    this.stopTimerTicker()
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

  // ── Variables & Feedbacks (M3) ─────────────────────────────────────────────

  private initVariables(): void {
    this.setVariableDefinitions([
      { variableId: 'current_cue_name',    name: 'Current cue name' },
      { variableId: 'current_cue_number',  name: 'Current cue number (position)' },
      { variableId: 'current_cue_type',    name: 'Current cue type slug' },
      { variableId: 'next_cue_name',       name: 'Next cue name' },
      { variableId: 'next_cue_number',     name: 'Next cue number (position)' },
      { variableId: 'cue_time_elapsed',    name: 'Cue time elapsed (mm:ss)' },
      { variableId: 'cue_time_remaining',  name: 'Cue time remaining (mm:ss)' },
      { variableId: 'active_alert_text',   name: 'Active alert text' },
      { variableId: 'qa_open',             name: 'Q&A open state' },
      { variableId: 'session_active',      name: 'Session active' },
      { variableId: 'broadcast_streaming', name: 'Broadcast streaming' },
      { variableId: 'broadcast_recording', name: 'Broadcast recording' },
    ])
    this.setVariableValues({
      current_cue_name:    '',
      current_cue_number:  '',
      current_cue_type:    '',
      next_cue_name:       '',
      next_cue_number:     '',
      cue_time_elapsed:    '00:00',
      cue_time_remaining:  '--:--',
      active_alert_text:   '',
      qa_open:             'closed',
      session_active:      'no',
      broadcast_streaming: 'no',
      broadcast_recording: 'no',
    })
  }

  private initFeedbacks(): void {
    this.setFeedbackDefinitions({
      session_active: {
        type: 'boolean',
        name: 'Session is active',
        description: 'True when a session is running in the configured room',
        defaultStyle: { bgcolor: 0x00b894, color: 0xffffff },
        options: [],
        callback: () => this.moduleState.sessionActive,
      },
      qa_is_open: {
        type: 'boolean',
        name: 'Q&A is open',
        description: 'True when Q&A is open in the configured room',
        defaultStyle: { bgcolor: 0xf59e0b, color: 0xffffff },
        options: [],
        callback: () => this.moduleState.qaOpen,
      },
      alert_is_live: {
        type: 'boolean',
        name: 'Alert is live',
        description: 'True when an alert is currently active',
        defaultStyle: { bgcolor: 0xe74c3c, color: 0xffffff },
        options: [],
        callback: () => this.moduleState.alertText !== '',
      },
      broadcast_streaming: {
        type: 'boolean',
        name: 'Broadcast streaming',
        description: 'True when broadcast source is streaming',
        defaultStyle: { bgcolor: 0xe74c3c, color: 0xffffff },
        options: [],
        callback: () => this.moduleState.broadcastStreaming,
      },
    })
  }

  private applyRoomState(state: ApiRoomState): void {
    const s = state.session
    this.moduleState.sessionActive      = s !== null
    this.moduleState.activeCueId        = s?.active_cue_id ?? null
    this.moduleState.timerStartedAt     = s?.timer_started_at ?? null
    this.moduleState.timerPausedAt      = s?.timer_paused_at ?? null
    this.moduleState.timerPauseOffsetMs = s?.timer_pause_offset_ms ?? 0
    this.moduleState.timerIsRunning     = s?.is_running ?? false
    this.moduleState.currentCueTitle    = state.cue.current?.title ?? ''
    this.moduleState.currentCueDurationMs = state.cue.current?.duration_ms ?? 0
    this.moduleState.nextCueTitle       = state.cue.next?.title ?? ''
    this.moduleState.qaOpen             = state.qa?.qa_open_override === 1
    this.moduleState.broadcastStreaming  = state.broadcast?.streaming ?? false
    this.moduleState.broadcastRecording  = state.broadcast?.recording ?? false

    this.setVariableValues({
      current_cue_name:    this.moduleState.currentCueTitle,
      current_cue_number:  state.cue.current?.position != null ? String(state.cue.current.position) : '',
      current_cue_type:    state.cue.current?.type_slug ?? '',
      next_cue_name:       this.moduleState.nextCueTitle,
      next_cue_number:     state.cue.next?.position != null ? String(state.cue.next.position) : '',
      session_active:      this.moduleState.sessionActive     ? 'yes'  : 'no',
      qa_open:             this.moduleState.qaOpen            ? 'open' : 'closed',
      broadcast_streaming: this.moduleState.broadcastStreaming ? 'yes' : 'no',
      broadcast_recording: this.moduleState.broadcastRecording ? 'yes' : 'no',
    })
    this.checkFeedbacks('session_active', 'qa_is_open', 'broadcast_streaming')

    if (this.moduleState.sessionActive && this.moduleState.timerIsRunning) {
      this.startTimerTicker()
    } else {
      this.stopTimerTicker()
      this.updateTimerVariables()
    }
  }

  private async refreshFromRoomState(): Promise<void> {
    if (!this.api || !(this.savedConfig.roomId > 0)) return
    try {
      const state = await this.api.getRoomState(this.savedConfig.roomId)
      this.applyRoomState(state)
    } catch (err) {
      this.log('warn', `Failed to refresh room state: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private formatMmSs(ms: number): string {
    const totalSec = Math.max(0, Math.floor(ms / 1000))
    const m = Math.floor(totalSec / 60)
    const s = totalSec % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  private computeElapsedMs(): number {
    const { timerStartedAt, timerPausedAt, timerPauseOffsetMs } = this.moduleState
    if (timerStartedAt === null) return 0
    const ref = timerPausedAt !== null ? timerPausedAt : Date.now()
    return Math.max(0, ref - timerStartedAt - timerPauseOffsetMs)
  }

  private updateTimerVariables(): void {
    const { sessionActive, timerStartedAt, currentCueDurationMs } = this.moduleState
    if (!sessionActive || timerStartedAt === null) {
      this.setVariableValues({ cue_time_elapsed: '00:00', cue_time_remaining: '--:--' })
      return
    }
    const elapsed = this.computeElapsedMs()
    this.setVariableValues({
      cue_time_elapsed:   this.formatMmSs(elapsed),
      cue_time_remaining: currentCueDurationMs > 0
        ? this.formatMmSs(Math.max(0, currentCueDurationMs - elapsed))
        : '--:--',
    })
  }

  private startTimerTicker(): void {
    if (this.timerInterval !== null) return
    this.timerInterval = setInterval(() => this.updateTimerVariables(), 1000)
  }

  private stopTimerTicker(): void {
    if (this.timerInterval === null) return
    clearInterval(this.timerInterval)
    this.timerInterval = null
  }

  // ── Actions (M2) ───────────────────────────────────────────────────────────

  private async initActions(): Promise<void> {
    const { roomId } = this.savedConfig

    // Fetch shows + alerts for dropdowns at registration time.
    // initActions() is called on every (re)connect so lists stay fresh.
    let showChoices: Array<{ id: number | string; label: string }> = []
    let alertChoices: Array<{ id: number | string; label: string }> = []
    if (this.api && roomId > 0) {
      const [showsResult, alertsResult] = await Promise.allSettled([
        this.api.getShows(roomId),
        this.api.getAlerts(roomId),
      ])
      if (showsResult.status === 'fulfilled') {
        showChoices = showsResult.value.map((s) => ({ id: s.id, label: s.name }))
      } else {
        this.log('warn', `Could not fetch shows for dropdown: ${showsResult.reason instanceof Error ? showsResult.reason.message : String(showsResult.reason)}`)
      }
      if (alertsResult.status === 'fulfilled') {
        alertChoices = alertsResult.value.map((a) => ({ id: a.id, label: a.text }))
      } else {
        this.log('warn', `Could not fetch alerts for dropdown: ${alertsResult.reason instanceof Error ? alertsResult.reason.message : String(alertsResult.reason)}`)
      }
    }
    if (showChoices.length === 0) {
      showChoices = [{ id: 0, label: '(no active event — start an event first)' }]
    }
    if (alertChoices.length === 0) {
      alertChoices = [{ id: 0, label: 'No alerts found — re-open config to refresh' }]
    }

    const broadcastRoomChoices: Array<{ id: number | string; label: string }> =
      this.rooms.length > 0
        ? this.rooms.map((r) => ({ id: r.id, label: r.label }))
        : [{ id: 0, label: 'Configure connection first' }]

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
            type: 'dropdown',
            id: 'show_id',
            label: 'Show',
            choices: showChoices,
            default: showChoices[0]?.id ?? 0,
          },
        ],
        callback: async (action) => {
          if (!guard()) return
          const showId = Number(action.options.show_id)
          if (showId === 0) {
            this.log('warn', 'No show selected')
            return
          }
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
      update_broadcast_state: {
        name: 'Update broadcast state',
        options: [
          {
            type: 'dropdown',
            id: 'room_id',
            label: 'Room',
            choices: broadcastRoomChoices,
            default: broadcastRoomChoices[0]?.id ?? 0,
          },
          {
            type: 'checkbox',
            id: 'streaming',
            label: 'Streaming',
            default: false,
          },
          {
            type: 'checkbox',
            id: 'recording',
            label: 'Recording',
            default: false,
          },
          {
            type: 'textinput',
            id: 'scene',
            label: 'Scene (supports variables, e.g. $(obs:current_scene))',
            default: '',
            useVariables: true,
          },
          {
            type: 'dropdown',
            id: 'source',
            label: 'Source',
            choices: [
              { id: 'obs',       label: 'OBS' },
              { id: 'vmix',      label: 'vMix' },
              { id: 'atem',      label: 'ATEM' },
              { id: 'companion', label: 'Companion' },
              { id: 'other',     label: 'Other' },
            ],
            default: 'companion',
          },
        ],
        callback: async (action, context) => {
          if (!this.api) {
            this.log('warn', 'CueProX not connected')
            return
          }
          const roomId = Number(action.options.room_id)
          if (!(roomId > 0)) {
            this.log('warn', 'No room selected for update_broadcast_state')
            return
          }
          const streaming = Boolean(action.options.streaming)
          const recording = Boolean(action.options.recording)
          const rawScene  = String(action.options.scene ?? '')
          const parsed    = await context.parseVariablesInString(rawScene)
          const scene     = parsed.trim() !== '' ? parsed.trim() : null
          const source    = String(action.options.source ?? 'companion')
          try {
            await this.api.updateBroadcastState(roomId, { streaming, recording, scene, source })
            this.log('info', `Action update_broadcast_state executed (streaming=${streaming}, recording=${recording}, scene=${scene ?? 'null'}, source=${source})`)
          } catch (err) {
            this.log('error', `Action update_broadcast_state failed: ${err instanceof Error ? err.message : String(err)}`)
          }
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

    // Step 3 — Register variables, feedbacks, and actions
    this.initVariables()
    this.initFeedbacks()
    await this.initActions()

    // Step 4 — Seed variables from REST state snapshot (needs roomId)
    if (roomId > 0) {
      await this.refreshFromRoomState()
    }

    // Step 5 — Open Socket.io connection for real-time events
    if (roomId > 0) {
      const socket = new CueProxSocket({
        host,
        token,
        roomId,
        logger: this.log.bind(this),
      })

      socket.on('connected', () => {
        this.updateStatus(InstanceStatus.Ok, 'Connected')
        this.refreshFromRoomState().catch((err) =>
          this.log('warn', `Post-connect state refresh failed: ${err instanceof Error ? err.message : String(err)}`),
        )
      })
      socket.on('disconnected', ({ reason }: { reason: string }) => {
        this.stopTimerTicker()
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

      // ── Real-time state updates (M3) ────────────────────────────────────────
      socket.on('session_state', (payload: LiveSessionState) => {
        const prevCueId = this.moduleState.activeCueId
        this.moduleState.sessionActive      = payload.sessionId !== null
        this.moduleState.activeCueId        = payload.activeCueId ?? null
        this.moduleState.timerStartedAt     = payload.timerStartedAt ?? null
        this.moduleState.timerPausedAt      = payload.timerPausedAt ?? null
        this.moduleState.timerPauseOffsetMs = payload.timerPauseOffsetMs ?? 0
        this.moduleState.timerIsRunning     = payload.isRunning ?? false

        this.setVariableValues({ session_active: this.moduleState.sessionActive ? 'yes' : 'no' })
        this.checkFeedbacks('session_active')

        if (this.moduleState.sessionActive && this.moduleState.timerIsRunning) {
          this.startTimerTicker()
        } else {
          this.stopTimerTicker()
          this.updateTimerVariables()
        }

        if (payload.activeCueId !== prevCueId) {
          this.refreshFromRoomState().catch((err) =>
            this.log('warn', `Cue-change state refresh failed: ${err instanceof Error ? err.message : String(err)}`),
          )
        }
      })

      socket.on('director_alert', (payload: LiveAlertPayload) => {
        this.moduleState.alertText = payload?.text ?? ''
        this.setVariableValues({ active_alert_text: this.moduleState.alertText })
        this.checkFeedbacks('alert_is_live')
      })

      socket.on('alert_cleared', () => {
        this.moduleState.alertText = ''
        this.setVariableValues({ active_alert_text: '' })
        this.checkFeedbacks('alert_is_live')
      })

      socket.on('qa_updated', () => {
        this.refreshFromRoomState().catch((err) =>
          this.log('warn', `qa_updated state refresh failed: ${err instanceof Error ? err.message : String(err)}`),
        )
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
