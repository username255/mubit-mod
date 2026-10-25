import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Feedback, Meta, Notice, ProjectRow, RequestFilter, Shadow, Summary, TaskRow, TraceRow, View } from '../types'

const PANE = 'mubit'

// Palette drawn from the reference: warm coral-orange as the one accent (Mubit's
// brand), with green/red/amber for pass, fail and attention. Hex reads on both
// dark and light terminals; dim gray for everything secondary.
const ORANGE = '#E8835A'
const GREEN = '#6FBF73'
const RED = '#E0564C'
const SOFT_RED = '#B0544C' // a down rating: duller than RED, since it isn't an error
const AMBER = '#D9A441'
const MUTED = '#7d7d7d' // a neutral fill for bars that aren't the accent
const INK = '#14110f' // text that sits on an orange fill

// Change a tag when the stored shape changes; it discards what an older version wrote.
const view = atom({ plugin: 'mubit', key: 'view' } as const, 'tasks' as View, { shape: 'view-1' })
const tasks = atom({ plugin: 'mubit', key: 'tasks' } as const, [] as TaskRow[], { shape: 'tasks-2' })
const traces = atom({ plugin: 'mubit', key: 'traces' } as const, [] as TraceRow[], { shape: 'traces-2' })
const meta = atom(
  { plugin: 'mubit', key: 'meta' } as const,
  { loadedAt: null, loading: false, error: null, signedOut: false, transient: false } as Meta,
  { shape: 'meta-2' },
)
const openTrace = atom({ plugin: 'mubit', key: 'openTrace' } as const, null as string | null, { shape: 'open-1' })
const draft = atom({ plugin: 'mubit', key: 'draft' } as const, '', { shape: 'draft-1' })
const notice = atom({ plugin: 'mubit', key: 'notice' } as const, null as Notice, { shape: 'notice-1' })
const activeProject = atom({ plugin: 'mubit', key: 'activeProject' } as const, null as string | null, { shape: 'proj-1' })
const projects = atom({ plugin: 'mubit', key: 'projects' } as const, [] as ProjectRow[], { shape: 'projects-1' })
const summary = atom({ plugin: 'mubit', key: 'summary' } as const, null as Summary, { shape: 'summary-1' })
const newProject = atom({ plugin: 'mubit', key: 'newProject' } as const, '', { shape: 'newproj-1' })
const requestFilter = atom({ plugin: 'mubit', key: 'requestFilter' } as const, 'all' as RequestFilter, { shape: 'filter-1' })
const traceCursor = atom({ plugin: 'mubit', key: 'traceCursor' } as const, null as string | null, { shape: 'cursor-1' })
const tracePages = atom({ plugin: 'mubit', key: 'tracePages' } as const, 1, { shape: 'pages-1' })
const requestStart = atom({ plugin: 'mubit', key: 'requestStart' } as const, 0, { shape: 'start-1' })

type Config = { command: string; project: string; refreshSeconds: number; requestLimit: number }

function readConfig(options: unknown): Config {
  const o = (options ?? {}) as Partial<Config>
  return {
    command: o.command?.trim() || 'mubit',
    project: o.project?.trim() || '',
    refreshSeconds: Math.max(10, Number(o.refreshSeconds) || 60),
    requestLimit: Math.max(1, Math.min(100, Number(o.requestLimit) || 20)),
  }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

// The CLI prints these when the saved sign-in has lapsed, or when the engine is briefly down.
const signedOutRe = /sign ?in|clerk|session_(required|expired)|not signed in/i
const transientRe = /\b5\d\d\b|engine_unreachable|unreachable|upstream_(failed|timeout|unreachable)|timed out|timeout/i

function firstLine(text: string): string {
  return (text.split('\n').find(l => l.trim()) ?? '').trim().slice(0, 240)
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(p => str((p as Record<string, unknown>)?.text)).join(' ').trim()
  return ''
}

function toTaskRow(l: Record<string, unknown>): TaskRow {
  const counts = (l.counts ?? {}) as Record<string, unknown>
  const live = l.live as Record<string, unknown> | null | undefined
  const shadow: Shadow | null = live
    ? {
        passes: num(live.passes),
        pairs: num(live.pairs),
        rate: Math.round(num(live.rate) * 100),
        need: Math.round(num(live.bar) * 100),
      }
    : null
  return {
    id: str(l.id),
    name: str(l.name) || str(l.label) || str(l.id),
    stage: str(l.stage),
    calls: num(counts.traces),
    up: num(counts.rated_up),
    down: num(counts.rated_down),
    unrated: num(counts.unrated),
    adapter: str(l.adapter_id),
    shadow,
  }
}

function toTraceRow(t: Record<string, unknown>): TraceRow {
  const up = (t.upstream ?? {}) as Record<string, unknown>
  const routing = (t.routing ?? {}) as Record<string, unknown>
  const resp = (t.response ?? {}) as Record<string, unknown>
  const req = (t.request ?? {}) as Record<string, unknown>
  const choices = Array.isArray(resp.choices) ? (resp.choices as Record<string, unknown>[]) : []
  const reply = messageText((choices[0]?.message as Record<string, unknown>)?.content)
  const msgs = Array.isArray(req.messages) ? (req.messages as Record<string, unknown>[]) : []
  const lastUser = [...msgs].reverse().find(mm => str(mm.role) === 'user')
  const feedback = Array.isArray(t.feedback) ? (t.feedback as Record<string, unknown>[]) : []
  const fb: Feedback[] = feedback.map(f => ({
    rating: str(f.rating),
    comment: str(f.comment),
    source: str(f.source),
    at: str(f.at),
  }))
  return {
    id: str(t.trace_id),
    time: str(t.created_at).slice(11, 19),
    purpose: str(t.purpose) || str(routing.decision),
    answeredBy: [str(up.vendor), str(up.model)].filter(Boolean).join(' '),
    model: str(resp.model) || str(up.model),
    ms: typeof up.latency_ms === 'number' ? Math.round(up.latency_ms as number) : null,
    status: typeof t.http_status === 'number' ? (t.http_status as number) : null,
    rating: str(fb.at(-1)?.rating),
    req: messageText(lastUser?.content),
    reply,
    fb,
  }
}

type RunResult = { exitCode: number; stdout: string; stderr: string }

// One CLI call for the chosen project, retried once on a transient 5xx/unreachable.
async function runCli($: EngineInterface, cfg: Config, project: string, args: string[]): Promise<RunResult> {
  const argv = [cfg.command, ...args, ...(project ? ['--project', project] : [])]
  let res = (await $.process.run(argv, { timeoutMs: 25_000 })) as RunResult
  if (res.exitCode !== 0 && transientRe.test(`${res.stderr}${res.stdout}`)) {
    await $.clock.sleep(1500)
    res = (await $.process.run(argv, { timeoutMs: 25_000 })) as RunResult
  }
  return res
}

const parse = (res: RunResult): any => {
  try {
    return JSON.parse(res.stdout || 'null')
  } catch {
    return null
  }
}

type TracePage = { rows: TraceRow[]; next: string | null }

// One page of calls through `traces --with-cursor`, from the start or from a cursor.
// A CLI from before paging knows neither flag: show its one page and offer no more.
async function tracePage($: EngineInterface, cfg: Config, project: string, filter: RequestFilter, cursor: string | null): Promise<TracePage | RunResult> {
  const base = ['traces', '--limit', String(cfg.requestLimit), '--json']
  let res = await runCli($, cfg, project, [...base, '--with-cursor', ...(filter === 'all' ? [] : ['--purpose', filter]), ...(cursor ? ['--cursor', cursor] : [])])
  if (res.exitCode !== 0 && /unknown option/i.test(res.stderr)) {
    if (cursor) return { rows: [], next: null }
    res = await runCli($, cfg, project, [...base, ...(filter === 'shadow' ? ['--shadow'] : [])])
  }
  if (res.exitCode !== 0) return res
  const out = parse(res)
  const list = Array.isArray(out) ? out : Array.isArray(out?.traces) ? out.traces : []
  return { rows: list.map(toTraceRow), next: Array.isArray(out) ? null : str(out?.next_cursor) || null }
}

// Fetch the page after the last one loaded and append it.
async function loadMore($: EngineInterface, cfg: Config): Promise<void> {
  const cursor = await read($, traceCursor)
  if (!cursor) return
  const project = (await read($, activeProject)) || cfg.project
  await update($, meta, m => ({ ...m, loading: true }))
  const page = await tracePage($, cfg, project, await read($, requestFilter), cursor)
  if ('exitCode' in page) {
    const message = firstLine(page.stderr) || firstLine(page.stdout) || `mubit exited ${page.exitCode}`
    await update($, meta, m => ({ ...m, loading: false, error: message, signedOut: signedOutRe.test(message), transient: transientRe.test(message) }))
    return
  }
  await update($, traces, old => {
    const ids = new Set(old.map(r => r.id))
    return [...old, ...page.rows.filter(r => !ids.has(r.id))]
  })
  await update($, traceCursor, () => page.next)
  await update($, tracePages, p => p + 1)
  await update($, meta, m => ({ ...m, loading: false, error: null }))
}

// Start the Requests list over: first page, top of the list.
async function resetRequests($: EngineInterface): Promise<void> {
  await update($, traces, () => [])
  await update($, traceCursor, () => null)
  await update($, tracePages, () => 1)
  await update($, requestStart, () => 0)
}

async function setFilter($: EngineInterface, cfg: Config, filter: RequestFilter): Promise<void> {
  await update($, requestFilter, () => filter)
  await update($, openTrace, () => null)
  await resetRequests($)
  await load($, cfg)
}

// Load what the current view needs. Keeps the last good data on a blip.
// Top-level so the module validator sees $ handed to a declared function.
async function load($: EngineInterface, cfg: Config): Promise<void> {
  const want = await read($, view)
  const project = (await read($, activeProject)) || cfg.project
  await update($, meta, m => ({ ...m, loading: true }))

  const fail = async (res: RunResult) => {
    const message = firstLine(res.stderr) || firstLine(res.stdout) || `mubit exited ${res.exitCode}`
    const transient = transientRe.test(message)
    await update($, meta, m => ({ ...m, loading: false, error: message, signedOut: signedOutRe.test(message), transient }))
  }

  try {
    if (want === 'projects') {
      const pr = await runCli($, cfg, '', ['projects', '--json'])
      if (pr.exitCode !== 0) return await fail(pr)
      const list = (parse(pr) ?? {}).projects ?? parse(pr) ?? []
      await update($, projects, () =>
        (Array.isArray(list) ? list : []).map((p: Record<string, unknown>) => ({
          slug: str(p.slug),
          name: str(p.name),
          status: str(p.status),
        })),
      )
      await update($, meta, () => ({ loadedAt: Date.now(), loading: false, error: null, signedOut: false, transient: false }))
      return
    }

    const tasksRes = await runCli($, cfg, project, ['tasks', '--json'])
    if (tasksRes.exitCode !== 0) return await fail(tasksRes)
    const lanes = parse(tasksRes)
    await update($, tasks, () => (Array.isArray(lanes) ? lanes.map(toTaskRow) : []))

    if (want === 'tasks') {
      // Best-effort extras for the summary: 24h traffic and the gate thresholds.
      const [mx, pol] = await Promise.all([
        runCli($, cfg, project, ['metrics', '--json']),
        runCli($, cfg, project, ['policy', '--json']),
      ])
      const t = (parse(mx) ?? {}).totals ?? {}
      const promo = ((parse(pol) ?? {}).effective ?? {}).promotion ?? {}
      await update($, summary, () => ({
        calls: num(t.calls),
        errors: num(t.errors),
        p50: Math.round(num(t.p50_ms)),
        minPairs: num(promo.min_pairs) || 50,
        bar: typeof promo.bar === 'number' ? promo.bar : 0.9,
      }))
    }

    if (want === 'requests') {
      const page = await tracePage($, cfg, project, await read($, requestFilter), null)
      if ('exitCode' in page) return await fail(page)
      if ((await read($, tracePages)) > 1) {
        // Older pages stay loaded: the newest page goes in front, the rest keep their place.
        const ids = new Set(page.rows.map(r => r.id))
        await update($, traces, old => [...page.rows, ...old.filter(r => !ids.has(r.id))])
      } else {
        await update($, traces, () => page.rows)
        await update($, traceCursor, () => page.next)
      }
    }
    await update($, meta, () => ({ loadedAt: Date.now(), loading: false, error: null, signedOut: false, transient: false }))
  } catch (err) {
    const message = firstLine(err instanceof Error ? err.message : String(err))
    await update($, meta, m => ({ ...m, loading: false, error: message, signedOut: signedOutRe.test(message), transient: transientRe.test(message) }))
  }
}

// Create a project, then refresh the list and switch to it.
async function createProject($: EngineInterface, cfg: Config, name: string): Promise<void> {
  if (!name.trim()) return
  await update($, notice, () => ({ text: 'Creating…', kind: 'ok' }))
  const res = (await $.process.run([cfg.command, 'project-create', name.trim(), '--json'], { timeoutMs: 25_000 })) as RunResult
  if (res.exitCode === 0) {
    const slug = str(((parse(res) ?? {}).project ?? {}).slug)
    await update($, newProject, () => '')
    await update($, notice, () => ({ text: `Created ${slug || name}.`, kind: 'ok' }))
    await load($, cfg)
  } else {
    await update($, notice, () => ({ text: firstLine(res.stderr) || `exited ${res.exitCode}`, kind: 'err' }))
  }
}

// Switch which project the pane shows, then go back to Tasks and reload.
async function pickProject($: EngineInterface, cfg: Config, slug: string | null): Promise<void> {
  await update($, activeProject, () => slug)
  await update($, view, () => 'tasks')
  await update($, notice, () => null)
  await resetRequests($)
  await load($, cfg)
}

// Submit a rating on one call, then refresh so its feedback shows.
async function rate($: EngineInterface, cfg: Config, id: string, rating: 'up' | 'down', comment: string): Promise<void> {
  await update($, notice, () => ({ text: 'Saving…', kind: 'ok' }))
  const args = ['rate', id, rating, ...(comment.trim() ? ['--comment', comment.trim()] : []), '--json']
  const res = (await $.process.run([cfg.command, ...args], { timeoutMs: 25_000 })) as RunResult
  if (res.exitCode === 0) {
    await update($, draft, () => '')
    await update($, notice, () => ({ text: `Saved: rated ${rating}.`, kind: 'ok' }))
    await load($, cfg)
  } else {
    const message = firstLine(res.stderr) || firstLine(res.stdout) || `rate exited ${res.exitCode}`
    await update($, notice, () => ({ text: message, kind: 'err' }))
  }
}

export const register: Register = (on, options) => {
  const cfg = readConfig(options)

  on('session.start', async ($, e, next) => {
    // `/mubit` belongs to the Mubit skill, so the pane's command is `/mubit-ui`.
    try {
      await $.command.register({ name: 'mubit-ui', description: 'Open the Mubit task-stats pane' })
    } catch (err) {
      $.ui.log(`mubit: command.register skipped: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
    }
    void $.ui.open({ id: PANE, title: 'Mubit' })
    void load($, cfg)
    $.clock.every(cfg.refreshSeconds * 1000, () => void load($, cfg))
    return next(e)
  })

  on('command.run', { command: 'mubit-ui' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Mubit' })
    void load($, cfg)
    return { text: 'Mubit pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const resolved = $.ui.resolve(e)
    const { Box, Text, Button } = resolved
    // Input is on the terminal/desktop tables but not every surface's; take it loosely
    // and guard its use, so the pane still renders where it's absent.
    const Input = (resolved as unknown as { Input?: any }).Input
    const [current, taskRows, traceRows, m, openId, draftText, note, active, projectRows, sum, newProj, filter, cursor, startAt] = await Promise.all([
      read($, view),
      read($, tasks),
      read($, traces),
      read($, meta),
      read($, openTrace),
      read($, draft),
      read($, notice),
      read($, activeProject),
      read($, projects),
      read($, summary),
      read($, newProject),
      read($, requestFilter),
      read($, traceCursor),
      read($, requestStart),
    ])
    const height = Math.max(6, e.props?.scroll?.bodyRows ?? e.viewport?.rows ?? 20)
    // Every view sits inside a one-column margin on each side; `cols` is the width within it.
    const cols = Math.max(24, (e.props?.bodyColumns ?? e.viewport?.columns ?? 80) - 2)
    const bodyRows = Math.max(1, height - 4) // title, rule, content, rule, footer => 4 chrome rows

    const clip = (s: string, n: number) => (n <= 1 ? '' : s.length > n ? `${s.slice(0, n - 1)}…` : s)
    const padR = (s: string, n: number) => clip(s, n).padEnd(n)
    const padL = (s: string, n: number) => clip(s, n).padStart(n)

    const switchTo = (v: View) => async () => {
      await update($, openTrace, () => null)
      await update($, notice, () => null)
      await update($, view, () => v)
      void load($, cfg)
    }

    const freshness = (): string => {
      const blip = m.transient ? ' · retrying' : ''
      if (m.loadedAt === null) return m.loading ? 'loading…' : ''
      const ago = Math.round((Date.now() - m.loadedAt) / 1000)
      return `${ago < 1 ? 'just now' : `${ago}s ago`}${m.loading ? ' · refreshing' : blip}`
    }

    // A dotted meter in the reference's style: a sparse `·` track with a textured
    // `▒…█` fill on top, the head brighter. Two spans so the fill alone is coloured.
    const dottedBar = (pct: number, w: number, color: string) => {
      const filled = Math.max(0, Math.min(w, Math.round((pct / 100) * w)))
      const fill = filled > 0 ? `${'▒'.repeat(Math.max(0, filled - 1))}█` : ''
      const track = '·'.repeat(w - filled)
      return (
        <Text>
          <Text color={color}>{fill}</Text>
          <Text dimColor>{track}</Text>
        </Text>
      )
    }

    const minPairs = sum?.minPairs ?? 50
    const shadowBlock = (s: Shadow) => {
      // Nothing graded yet reads as a 0% meter, which looks like failing; say so instead.
      if (s.pairs === 0) return <Text dimColor>shadow · no graded pairs yet</Text>
      const ok = s.rate >= s.need
      const c = ok ? GREEN : ORANGE
      return (
        <Box gap={1}>
          <Text dimColor>shadow {s.passes}/{s.pairs}</Text>
          {dottedBar(s.rate, Math.min(16, Math.max(8, cols - 44)), c)}
          <Text color={c} bold>{s.rate}%</Text>
          <Text dimColor>→ {s.need}%</Text>
          <Text dimColor>· {s.pairs}/{minPairs} pairs</Text>
        </Box>
      )
    }

    // A status glyph + colour per stage, echoing the reference's "+ running / ✓ done".
    const stageStyle = (stage: string): { g: string; c?: string } =>
      stage === 'serving' || stage === 'canary'
        ? { g: '●', c: GREEN }
        : stage === 'shadow'
          ? { g: '◆', c: ORANGE }
          : { g: '·', c: undefined }

    // A rating as a triangle that takes colour (an emoji can't): green up, soft red down.
    const ratingStyle = (rating: string): { g: string; c?: string } =>
      rating === 'up' ? { g: '▲', c: GREEN } : rating === 'down' ? { g: '▼', c: SOFT_RED } : { g: ' ', c: undefined }

    const tasksView = () => {
      if (taskRows.length === 0) return <Text dimColor>{m.loading ? 'Loading…' : 'No tasks yet.'}</Text>
      const shadowCount = taskRows.filter(t => t.shadow).length
      const totalCalls = taskRows.reduce((a, t) => a + t.calls, 0)
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text dimColor>
              {taskRows.length} tasks · {totalCalls} calls{shadowCount ? ` · ` : ''}
              {shadowCount > 0 && <Text color={ORANGE}>◆ {shadowCount} shadow</Text>}
            </Text>
            {sum && (
              <Text dimColor>
                24h: {sum.calls} calls · {sum.errors > 0 ? <Text color={RED}>{sum.errors} errors</Text> : '0 errors'} · p50 {sum.p50}ms
              </Text>
            )}
          </Box>
          {taskRows.slice(0, Math.max(1, Math.floor((bodyRows - 1) / 4))).map(t => {
            const { g, c } = stageStyle(t.stage)
            return (
              <Box key={t.id} flexDirection="column">
                <Box justifyContent="space-between">
                  <Text bold>{clip(t.name, cols - 14)}</Text>
                  <Text color={c}>{g} {t.stage}</Text>
                </Box>
                <Box gap={2}>
                  <Text dimColor>{t.calls} calls</Text>
                  <Text>
                    <Text color={GREEN}>+{t.up}</Text>
                    <Text dimColor> / </Text>
                    <Text color={RED}>−{t.down}</Text>
                  </Text>
                  {t.unrated > 0 && <Text dimColor>{t.unrated} unrated</Text>}
                </Box>
                {t.shadow && shadowBlock(t.shadow)}
              </Box>
            )
          })}
        </Box>
      )
    }

    // Which calls to list, as chips: the active one orange, the rest dim.
    const filterChips = () => (
      <Box gap={1}>
        <Text dimColor>Show</Text>
        {(['all', 'traffic', 'shadow'] as RequestFilter[]).map(f => (
          <Button key={`filter-${f}`} plain onPress={() => void setFilter($, cfg, f)}>
            {f === filter ? <Text bold color={ORANGE}>[{f}]</Text> : <Text dimColor>{f}</Text>}
          </Button>
        ))}
      </Box>
    )

    const requestsList = () => {
      if (traceRows.length === 0) {
        return (
          <Box flexDirection="column" gap={1}>
            {filterChips()}
            <Text dimColor>{m.loading ? 'Loading…' : filter === 'shadow' ? 'No silent-test calls found.' : 'No recent calls.'}</Text>
          </Box>
        )
      }
      const barW = 7
      const nameW = Math.max(12, cols - 9 - barW - 1 - 7 - 4 - 3)
      const head = `${padR('TIME', 9)}${padR('ANSWERED BY', nameW)}${padR('LATENCY', barW + 1 + 7)}${padL('ST', 4)}`
      // Chips, column heads, the pager and the blank rows around the table take five
      // rows; the calls get the rest.
      const visible = Math.max(1, bodyRows - 5)
      const start = Math.min(startAt, Math.max(0, traceRows.length - 1))
      const shown = traceRows.slice(start, start + visible)
      const maxMs = Math.max(1, ...shown.map(r => r.ms ?? 0))
      const older = async () => {
        // Near the end of what is loaded, fetch the next page first.
        if (start + 2 * visible > traceRows.length && cursor) await loadMore($, cfg)
        const total = (await read($, traces)).length
        if (start + visible < total) await update($, requestStart, () => start + visible)
      }
      const hasOlder = start + visible < traceRows.length || cursor !== null
      // A blank row after the chips and before the pager, as the Projects view spaces its list.
      return (
        <Box flexDirection="column" gap={1}>
          {filterChips()}
          <Box flexDirection="column">
            <Text dimColor bold>
              {head}
            </Text>
            {shown.map((r, i) => {
              const adapter = /vllm|qwen|adapter/i.test(r.answeredBy)
              const mark = ratingStyle(r.rating)
              const who = `${r.purpose === 'shadow' ? '◆ ' : ''}${r.answeredBy || r.purpose}`
              return (
                <Button key={`row-${r.id || start + i}`} plain onPress={() => void update($, openTrace, () => r.id)}>
                  <Text dimColor>{padR(r.time, 9)}</Text>
                  <Text color={adapter ? ORANGE : undefined}>{padR(who, nameW)}</Text>
                  {dottedBar(((r.ms ?? 0) / maxMs) * 100, barW, adapter ? ORANGE : MUTED)}
                  <Text dimColor> {padL(r.ms === null ? '' : `${r.ms}ms`, 7)}</Text>
                  <Text color={r.status === 200 ? GREEN : r.status ? RED : undefined}> {padL(String(r.status ?? ''), 3)}</Text>
                  <Text color={mark.c}> {mark.g}</Text>
                </Button>
              )
            })}
          </Box>
          <Box gap={2}>
            <Text dimColor>
              {start + 1}–{start + shown.length} of {traceRows.length}{cursor ? '+' : ''}
            </Text>
            {start > 0 && (
              <Button key="newer" plain onPress={() => void update($, requestStart, () => Math.max(0, start - visible))}>
                <Text color={ORANGE}>‹ Newer</Text>
              </Button>
            )}
            {hasOlder && (
              <Button key="older" plain onPress={() => void older()}>
                <Text color={ORANGE}>Older ›</Text>
              </Button>
            )}
          </Box>
        </Box>
      )
    }

    const requestDetail = (r: TraceRow) => {
      const w = cols - 2
      return (
        <Box flexDirection="column">
          <Button key="back" plain onPress={() => void update($, openTrace, () => null)}>
            <Text color={ORANGE}>← Back</Text>
          </Button>
          <Box gap={2}>
            <Text dimColor>{r.time}</Text>
            <Text color={/vllm|qwen|adapter/i.test(r.answeredBy) ? ORANGE : undefined}>{r.model || r.answeredBy}</Text>
            <Text color={r.status === 200 ? GREEN : RED}>{r.status ?? ''}</Text>
            {r.ms !== null && <Text dimColor>{r.ms}ms</Text>}
          </Box>
          <Text> </Text>
          <Text dimColor bold>REQUEST</Text>
          <Text wrap="wrap">{clip(r.req || '(none)', w * 2)}</Text>
          <Text dimColor bold>REPLY</Text>
          <Text wrap="wrap">{clip(r.reply || '(none)', w * 2)}</Text>
          <Text> </Text>
          {r.fb.length > 0 ? (
            <Box flexDirection="column">
              <Text dimColor bold>FEEDBACK</Text>
              {r.fb.slice(-3).map((f, i) => (
                <Text key={String(i)}>
                  <Text color={ratingStyle(f.rating).c}>{ratingStyle(f.rating).g}</Text> <Text dimColor>{clip(f.comment || '(no note)', w - 12)} · {f.source}</Text>
                </Text>
              ))}
            </Box>
          ) : (
            <Text dimColor>No feedback yet — add one below.</Text>
          )}
          {note && (
            <Text color={note.kind === "ok" ? GREEN : RED}>{note.text}</Text>
          )}
          <Text> </Text>
          {Input && (
            <Box width={Math.min(60, w)}>
              <Input
                key="comment"
                label="Note "
                placeholder="why (optional)"
                value={draftText}
                onInput={(v: string) => void update($, draft, () => v)}
                onSubmit={() => void rate($, cfg, r.id, 'up', draftText)}
              />
            </Box>
          )}
          <Box gap={2}>
            <Button key="up" plain onPress={() => void rate($, cfg, r.id, 'up', draftText)}>
              <Text color={GREEN}>▲ Rate up</Text>
            </Button>
            <Button key="down" plain onPress={() => void rate($, cfg, r.id, 'down', draftText)}>
              <Text color={SOFT_RED}>▼ Rate down</Text>
            </Button>
          </Box>
        </Box>
      )
    }

    const projectsView = () => (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>Pick the project the pane shows:</Text>
        <Box flexDirection="column">
          <Button key="proj-default" plain onPress={() => void pickProject($, cfg, null)}>
            <Text color={active === null ? ORANGE : undefined} bold={active === null}>
              {active === null ? '● ' : '  '}console default
            </Text>
          </Button>
          {projectRows.slice(0, Math.max(1, bodyRows - 5)).map(p => (
            <Button key={`proj-${p.slug}`} plain onPress={() => void pickProject($, cfg, p.slug)}>
              <Text color={active === p.slug ? ORANGE : undefined} bold={active === p.slug}>
                {active === p.slug ? '● ' : '  '}
                {padR(p.name, Math.min(26, cols - 26))}
              </Text>
              <Text dimColor> {p.slug} {p.status}</Text>
            </Button>
          ))}
        </Box>
        {note && <Text color={note.kind === 'ok' ? GREEN : RED}>{note.text}</Text>}
        {Input && (
          <Box gap={1}>
            <Text dimColor>+ new</Text>
            <Box width={Math.min(34, cols - 14)}>
              <Input
                key="newproj"
                placeholder="project name"
                value={newProj}
                onInput={(v: string) => void update($, newProject, () => v)}
                onSubmit={(v: string) => void createProject($, cfg, v)}
              />
            </Box>
            <Button key="create" plain onPress={() => void createProject($, cfg, newProj)}>
              <Text color={GREEN}>Create</Text>
            </Button>
          </Box>
        )}
      </Box>
    )

    const body = () => {
      if (m.signedOut) {
        return (
          <Box flexDirection="column" gap={1}>
            <Text color={AMBER}>Signed out.</Text>
            <Text dimColor>Run `mubit login` in a terminal, then Refresh.</Text>
          </Box>
        )
      }
      if (m.error && m.loadedAt === null) {
        return (
          <Box flexDirection="column" gap={1}>
            <Text color={m.transient ? AMBER : RED}>
              {m.transient ? 'Mubit is briefly unreachable — retrying.' : "Couldn't reach Mubit."}
            </Text>
            <Text dimColor wrap="wrap">{m.error}</Text>
          </Box>
        )
      }
      if (current === 'projects') return projectsView()
      if (current === 'tasks') return tasksView()
      if (openId) {
        const row = traceRows.find(r => r.id === openId)
        return row ? requestDetail(row) : <Text dimColor>That call is no longer in the list. ← Back with Refresh.</Text>
      }
      return requestsList()
    }

    // Tabs as `[ label ]`: the active one a solid orange chip with ink text,
    // the rest dim — straight from the reference's nav.
    const tab = (v: View, label: string) =>
      current === v ? (
        <Button key={v} plain onPress={switchTo(v)}>
          <Text bold backgroundColor={ORANGE} color={INK}>{` ${label} `}</Text>
        </Button>
      ) : (
        <Button key={v} plain onPress={switchTo(v)}>
          <Text dimColor>[ {label} ]</Text>
        </Button>
      )

    return (
      <Box flexDirection="column" height={height} paddingX={1}>
        <Box justifyContent="space-between">
          <Text>
            <Text bold color={ORANGE}>◈ MUBIT</Text>
            <Text dimColor> · {current === 'projects' ? 'Projects' : current === 'tasks' ? 'Tasks' : openId ? 'Call' : 'Requests'}</Text>
          </Text>
          <Text dimColor>{active ? (projectRows.find(p => p.slug === active)?.name ?? active) : 'default project'}</Text>
        </Box>
        <Text dimColor>{'─'.repeat(cols)}</Text>

        <Box flexDirection="column" flexGrow={1}>
          {body()}
        </Box>

        {/* Controls: tab selection on the left; Refresh pinned right, when it last ran just
            before it, so the changing time never moves the button. */}
        <Text dimColor>{'─'.repeat(cols)}</Text>
        <Box justifyContent="space-between">
          <Box gap={2}>
            {tab('tasks', 'Tasks')}
            {tab('requests', 'Requests')}
            {tab('projects', 'Projects')}
          </Box>
          <Box gap={1}>
            {freshness() && <Text dimColor>{freshness()} ·</Text>}
            <Button key="refresh" plain onPress={() => void load($, cfg)}>
              <Text dimColor>↻ Refresh</Text>
            </Button>
          </Box>
        </Box>
      </Box>
    )
  })
}
