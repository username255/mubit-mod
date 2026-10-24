export type View = 'tasks' | 'requests' | 'projects'

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
  id: string
  time: string
  purpose: string
  answeredBy: string
  model: string
  ms: number | null
  status: number | null
  rating: string
  req: string
  reply: string
  fb: Feedback[]
}

export type ProjectRow = { slug: string; name: string; status: string }

// 24h traffic totals plus the gate thresholds, for the Tasks summary line.
export type Summary = {
  calls: number
  errors: number
  p50: number
  minPairs: number
  bar: number // 0..1
} | null

export type Meta = {
  loadedAt: number | null
  loading: boolean
  error: string | null
  signedOut: boolean
  transient: boolean
}

export type Notice = { text: string; kind: 'ok' | 'err' } | null

declare module 'claude-code' {
  interface PluginState {
    mubit: {
      view: Shaped<View>
      tasks: Shaped<TaskRow[]>
      traces: Shaped<TraceRow[]>
      meta: Shaped<Meta>
      openTrace: Shaped<string | null>
      draft: Shaped<string>
      notice: Shaped<Notice>
      activeProject: Shaped<string | null> // project the pane shows; null = console default
      projects: Shaped<ProjectRow[]>
      summary: Shaped<Summary>
      newProject: Shaped<string> // the new-project name being typed
    }
  }
}
