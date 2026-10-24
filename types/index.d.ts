export type View = 'tasks' | 'requests'

export type Shadow = { passes: number; pairs: number; rate: number; need: number }

export type TaskRow = {
  id: string
  name: string
  stage: string
  calls: number
  up: number
  down: number
  unrated: number
  adapter: string
  shadow: Shadow | null
}

export type Feedback = { rating: string; comment: string; source: string; at: string }

export type TraceRow = {
  id: string // trace_id
  time: string // HH:MM:SS
  purpose: string // traffic | shadow
  answeredBy: string // e.g. "openai gpt-6-luna"
  model: string
  ms: number | null
  status: number | null
  rating: string // latest rating: up | down | ""
  req: string // the user message
  reply: string // the assistant reply
  fb: Feedback[] // every rating on the call
}

export type Meta = {
  loadedAt: number | null
  loading: boolean
  error: string | null
  signedOut: boolean
  transient: boolean // a 5xx/unreachable blip; last-good data still shown
}

export type Notice = { text: string; kind: 'ok' | 'err' } | null

declare module 'claude-code' {
  interface PluginState {
    mubit: {
      view: Shaped<View>
      tasks: Shaped<TaskRow[]>
      traces: Shaped<TraceRow[]>
      meta: Shaped<Meta>
      openTrace: Shaped<string | null> // the call being viewed, null = list
      draft: Shaped<string> // the feedback comment being typed
      notice: Shaped<Notice> // last feedback result
    }
  }
}
