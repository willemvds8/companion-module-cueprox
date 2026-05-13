export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface Room {
  id: number
  name: string
  color: string | null
}

interface RoomsResponse {
  rooms: Room[]
}

export interface Alert {
  id: number
  text: string
  team_slugs: string[] | 'all'
  type: string
  created_at: string
  is_live: boolean
}

interface AlertsResponse {
  alerts: Alert[]
  live_alert_ids: number[]
}

export interface PingResponse {
  ok: true
  account_id: number
  token_id: number
}

export class CueProxApi {
  constructor(
    private readonly host: string,
    private readonly token: string,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.host.replace(/\/$/, '')}${path}`
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })

    if (!res.ok) {
      let code = 'UNKNOWN'
      let message = res.statusText
      try {
        const body = (await res.json()) as { code?: string; error?: string; message?: string }
        code    = body.code    ?? code
        message = body.error   ?? body.message ?? message
      } catch {
        // body was not JSON — keep statusText
      }
      throw new ApiError(res.status, code, message)
    }

    return res.json() as Promise<T>
  }

  async ping(): Promise<PingResponse> {
    return this.request<PingResponse>('/api/v1/ping')
  }

  async getRooms(): Promise<Room[]> {
    const data = await this.request<RoomsResponse>('/api/v1/rooms')
    return data.rooms ?? []
  }

  async nextCue(roomId: number): Promise<{ ok: true }> {
    return this.request(`/api/v1/rooms/${roomId}/cues/next`, { method: 'POST', body: '{}' })
  }

  async previousCue(roomId: number): Promise<{ ok: true }> {
    return this.request(`/api/v1/rooms/${roomId}/cues/previous`, { method: 'POST', body: '{}' })
  }

  async startSession(roomId: number, showId: number): Promise<{ ok: true }> {
    return this.request(`/api/v1/rooms/${roomId}/session/start`, {
      method: 'POST',
      body: JSON.stringify({ show_id: showId }),
    })
  }

  async endSession(roomId: number): Promise<{ ok: true }> {
    return this.request(`/api/v1/rooms/${roomId}/session/end`, { method: 'POST', body: '{}' })
  }

  async pauseSession(roomId: number): Promise<{ ok: true }> {
    return this.request(`/api/v1/rooms/${roomId}/session/pause`, { method: 'POST', body: '{}' })
  }

  async resumeSession(roomId: number): Promise<{ ok: true }> {
    return this.request(`/api/v1/rooms/${roomId}/session/resume`, { method: 'POST', body: '{}' })
  }

  async openQa(roomId: number): Promise<{ ok: true }> {
    return this.request(`/api/v1/rooms/${roomId}/qa/open`, { method: 'POST', body: '{}' })
  }

  async closeQa(roomId: number): Promise<{ ok: true }> {
    return this.request(`/api/v1/rooms/${roomId}/qa/close`, { method: 'POST', body: '{}' })
  }

  async getAlerts(roomId: number): Promise<Alert[]> {
    const data = await this.request<AlertsResponse>(`/api/v1/rooms/${roomId}/alerts`)
    return data.alerts ?? []
  }

  async pushAlert(roomId: number, alertId: number): Promise<{ ok: true }> {
    return this.request(`/api/v1/rooms/${roomId}/alerts/${alertId}/push`, { method: 'POST', body: '{}' })
  }

  async clearAlert(roomId: number): Promise<{ ok: true }> {
    return this.request(`/api/v1/rooms/${roomId}/alerts/clear`, { method: 'POST', body: '{}' })
  }
}
