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

  // --- M2/M3: session control, cue navigation, alerts ---
  // async startSession(roomId: number, showId: number): Promise<{ ok: true; session_id: number; show_id: number }>
  // async endSession(roomId: number): Promise<{ ok: true; ended_session_id: number | null }>
  // async pauseSession(roomId: number): Promise<{ ok: true }>
  // async resumeSession(roomId: number): Promise<{ ok: true }>
  // async nextCue(roomId: number): Promise<{ ok: true }>
  // async previousCue(roomId: number): Promise<{ ok: true }>
  // async getAlertDrafts(roomId: number): Promise<unknown[]>
  // async pushAlert(roomId: number, alertId: number): Promise<{ ok: true }>
  // async flashAlert(roomId: number, text: string, teamSlugs: string[] | 'all'): Promise<{ ok: true }>
  // async clearAlert(roomId: number, teamSlugs: string[] | 'all'): Promise<{ ok: true }>
}
