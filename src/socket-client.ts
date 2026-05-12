import { EventEmitter } from 'events'
import { io, Socket } from 'socket.io-client'
import type { LogLevel } from '@companion-module/base'

export type SocketState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'scope_denied'

export interface LiveSessionState {
  activeCueId: number | null
  liveAlertIds: number[]
  liveAlerts: unknown[]
  timer: {
    startedAt: number | null
    pausedAt: number | null
    pauseOffsetMs: number
  } | null
  qa: { qa_open_override: 0 | 1 | null } | null
}

export interface LiveAlertPayload {
  id: number
  text: string
  teamSlugs: string[] | 'all'
  timestamp: number
}

interface CueProxSocketOptions {
  host: string
  token: string
  roomId: number
  logger: (level: LogLevel, message: string) => void
}

export class CueProxSocket extends EventEmitter {
  private socket: Socket | null = null
  private state: SocketState = 'idle'
  private activeCueId: number | null = null
  private reconnectHandler: (() => void) | null = null

  private readonly host: string
  private readonly token: string
  private readonly roomId: number
  private readonly logger: (level: LogLevel, message: string) => void

  constructor({ host, token, roomId, logger }: CueProxSocketOptions) {
    super()
    this.host = host
    this.token = token
    this.roomId = roomId
    this.logger = logger
  }

  getState(): SocketState {
    return this.state
  }

  getActiveCueId(): number | null {
    return this.activeCueId
  }

  connect(): void {
    if (this.socket) return

    this.state = 'connecting'
    this.logger('debug', `CueProxSocket: connecting to ${this.host}`)

    const socket = io(this.host, {
      auth: { token: this.token },
      autoConnect: false,
    })

    // reconnect_attempt is a Manager-level event in socket.io-client v4
    this.reconnectHandler = () => {
      this.state = 'reconnecting'
      this.logger('debug', 'CueProxSocket: reconnecting…')
      this.emit('reconnecting')
    }
    socket.io.on('reconnect_attempt', this.reconnectHandler)

    socket.on('connect', () => {
      this.state = 'connected'
      this.logger('debug', `CueProxSocket: connect handler fired, roomId=${this.roomId}`)
      if (this.roomId > 0) {
        this.logger('debug', `CueProxSocket: emitting join_room roomId=${this.roomId}`)
        socket.emit('join_room', { roomId: this.roomId })
        this.logger('debug', `CueProxSocket: join_room emitted`)
      }
      this.emit('connected')
    })

    socket.on('disconnect', (reason) => {
      this.state = 'idle'
      this.logger('debug', `CueProxSocket: disconnected — ${reason}`)
      this.emit('disconnected', { reason })
    })

    socket.on('connect_error', (err) => {
      const msg = err.message.toLowerCase()
      const isAuth =
        msg.includes('401') ||
        msg.includes('403') ||
        msg.includes('unauthorized') ||
        msg.includes('forbidden')
      if (isAuth) {
        this.state = 'failed'
        this.logger('warn', `CueProxSocket: auth failed — ${err.message}`)
        this.emit('auth_failed')
      } else {
        this.state = 'failed'
        this.logger('warn', `CueProxSocket: connection error — ${err.message}`)
        this.emit('connection_error')
      }
    })

    socket.on('session_state', (payload: LiveSessionState) => {
      this.logger('info', `CueProxSocket: received session_state — activeCueId=${payload?.activeCueId ?? 'null'}`)
      this.activeCueId = payload?.activeCueId ?? null
      this.emit('session_state', payload)
    })

    socket.on('director_alert', (payload: LiveAlertPayload) => {
      this.logger('info', `CueProxSocket: received director_alert — id=${payload?.id} text="${payload?.text}"`)
      this.emit('director_alert', payload)
    })

    socket.on('director_alert_clear', (payload: unknown) => {
      this.logger('info', `CueProxSocket: received director_alert_clear`)
      this.emit('alert_cleared', payload)
    })

    socket.on('qa:updated', () => {
      this.logger('info', `CueProxSocket: received qa:updated`)
      this.emit('qa_updated')
    })

    socket.on('cue_note_updated', (payload: { cueId: number; teamId: number }) => {
      this.logger('info', `CueProxSocket: received cue_note_updated — cueId=${payload?.cueId} teamId=${payload?.teamId}`)
      this.emit('cue_note_updated', payload)
    })

    socket.on('error', (payload: unknown) => {
      if (
        typeof payload === 'object' &&
        payload !== null &&
        (payload as { code?: string }).code === 'token_scope_denied'
      ) {
        const msg = (payload as { message?: string }).message
        this.state = 'scope_denied'
        this.logger('warn', `CueProxSocket: scope denied — ${msg ?? ''}`)
        this.emit('scope_denied', { message: msg })
      }
    })

    this.socket = socket
    socket.connect()
  }

  disconnect(): void {
    if (!this.socket) return
    if (this.reconnectHandler) {
      this.socket.io.off('reconnect_attempt', this.reconnectHandler)
      this.reconnectHandler = null
    }
    this.socket.removeAllListeners()
    this.socket.disconnect()
    this.socket = null
    this.state = 'idle'
  }
}
