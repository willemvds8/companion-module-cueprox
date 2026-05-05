import { type SomeCompanionConfigField } from '@companion-module/base'

export interface ModuleConfig {
  host: string
  token: string
  roomId: number
}

export function getConfigFields(
  rooms: Array<{ id: number; label: string }>,
): SomeCompanionConfigField[] {
  const roomChoices =
    rooms.length > 0
      ? rooms.map((r) => ({ id: r.id, label: r.label }))
      : [{ id: 0, label: 'Configure host + token first' }]

  return [
    {
      type: 'textinput',
      id: 'host',
      label: 'CueProX host URL',
      default: 'https://app.cueprox.com',
      width: 12,
      tooltip: 'Base URL of your CueProX instance, e.g. https://app.cueprox.com',
    },
    {
      type: 'textinput',
      id: 'token',
      label: 'API token',
      default: '',
      width: 12,
      tooltip:
        'API token from CueProX Settings → API Tokens. Note: stored in plain text — run Companion on a secured machine.',
    },
    {
      type: 'dropdown',
      id: 'roomId',
      label: 'Room',
      choices: roomChoices,
      default: roomChoices[0]?.id ?? 0,
      width: 12,
    },
  ]
}
