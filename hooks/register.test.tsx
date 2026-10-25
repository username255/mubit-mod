import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'mubit',
  component: 'Pane',
  requestId: 'mubit',
  props: {
    title: 'Mubit',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 24 },
    view: {},
  },
} as const

const TASKS = JSON.stringify([
  {
    id: 'ln_abc',
    name: 'Decide whether number',
    stage: 'shadow',
    adapter_id: 'ad_lane_x',
    counts: { traces: 308, rated_up: 197, rated_down: 101, unrated: 10 },
    live: { passes: 7, pairs: 13, rate: 0.54, bar: 0.9, floor: 0.75 },
  },
])

const TRACES = JSON.stringify([
  {
    trace_id: 'trc_fb',
    created_at: '2026-10-24T01:25:10.000Z',
    purpose: 'traffic',
    routing: { decision: 'direct' },
    upstream: { vendor: 'openai', model: 'gpt-6-luna', latency_ms: 1557 },
    response: { model: 'gpt-6-luna', choices: [{ message: { content: 'even' } }] },
    request: { messages: [{ role: 'user', content: 'Is 52418 odd or even?' }] },
    http_status: 200,
    feedback: [{ rating: 'up', comment: 'correct: 52418 is even', source: 'human', at: '2026-10-24T01:28:44Z' }],
  },
  {
    trace_id: 'trc_new',
    created_at: '2026-10-24T01:30:00.000Z',
    purpose: 'traffic',
    routing: { decision: 'direct' },
    upstream: { vendor: 'openai', model: 'gpt-6-luna', latency_ms: 980 },
    response: { model: 'gpt-6-luna', choices: [{ message: { content: 'odd' } }] },
    request: { messages: [{ role: 'user', content: 'Is 4711 odd or even?' }] },
    http_status: 200,
    feedback: [],
  },
])

const PROJECTS = JSON.stringify({
  projects: [
    { slug: 'ws-aaa', name: 'mubit-hack', status: 'healthy' },
    { slug: 'ws-bbb', name: 'clean-project', status: 'new' },
  ],
})
const METRICS = JSON.stringify({ totals: { calls: 320, errors: 0, p50_ms: 1272 } })
const POLICY = JSON.stringify({ effective: { promotion: { min_pairs: 50, bar: 0.9 } } })

const stdoutFor = (argv: readonly string[]) =>
  argv.includes('traces') ? TRACES
  : argv.includes('rate') ? '{"feedback_count":1}'
  : argv.includes('projects') ? PROJECTS
  : argv.includes('metrics') ? METRICS
  : argv.includes('policy') ? POLICY
  : TASKS

const wire = (on: any) => {
  on('command.register', () => ({ value: { command: 'mubit' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => ({
    value: { exitCode: 0, stdout: stdoutFor(e.argv), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
}

test('tasks view shows stats and the shadow meter', async ($, on) => {
  wire(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'refresh' })

  expect(await ui.find({ type: 'Text', text: /Decide whether number/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /308 calls/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /shadow 7\/13/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /p50 1272ms/ })).toBeDefined()
  await ui.unmount()
})

test('projects view lists projects and switches the active one', async ($, on) => {
  wire(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'projects' })

  expect(await ui.find({ type: 'Text', text: /clean-project/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /console default/ })).toBeDefined()

  await ui.press({ key: 'proj-ws-bbb' }) // switch to clean-project -> back to Tasks
  expect(await ui.find({ type: 'Text', text: /clean-project/ })).toBeDefined() // now in the header
  await ui.unmount()
})

test('a request opens its detail and shows existing feedback', async ($, on) => {
  wire(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'requests' })
  await ui.press({ key: 'row-trc_fb' })

  expect(await ui.find({ type: 'Text', text: /Is 52418 odd or even/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /correct: 52418 is even/ })).toBeDefined()
  await ui.unmount()
})

test('a request with no feedback can be rated', async ($, on) => {
  wire(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'requests' })
  await ui.press({ key: 'row-trc_new' })

  expect(await ui.find({ type: 'Text', text: /No feedback yet/ })).toBeDefined()
  await ui.press({ key: 'up' })
  expect(await ui.find({ type: 'Text', text: /Saved/ })).toBeDefined()
  await ui.unmount()
})

// The paging CLI's `traces --with-cursor` shape: a first page with a cursor, then the last page.
const call = (id: string, text: string, purpose = 'traffic') => ({
  trace_id: id,
  created_at: '2026-10-23T21:23:00.000Z',
  purpose,
  routing: { decision: purpose === 'shadow' ? 'adapter' : 'direct' },
  upstream: purpose === 'shadow' ? { vendor: 'vllm', model: 'Qwen/Qwen3-4B', latency_ms: 51 } : { vendor: 'openai', model: 'gpt-6-luna', latency_ms: 1200 },
  response: { choices: [{ message: { content: 'even' } }] },
  request: { messages: [{ role: 'user', content: text }] },
  http_status: 200,
  feedback: [],
})
const PAGE_1 = JSON.stringify({ traces: [call('trc_p1', 'Is 190 odd or even?')], next_cursor: 't1~200~1~abc', pages: 3 })
const PAGE_2 = JSON.stringify({ traces: [call('trc_p2', '-2518 Wrong answers only')], next_cursor: null, pages: 1 })
const SHADOW = JSON.stringify({ traces: [call('trc_s1', 'MCCXL Wrong answers only', 'shadow')], next_cursor: null, pages: 29 })

const wirePaged = (on: any, seen: string[][]) => {
  on('command.register', () => ({ value: { command: 'mubit' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    seen.push([...e.argv])
    const stdout = !e.argv.includes('traces') ? stdoutFor(e.argv)
      : e.argv.includes('shadow') ? SHADOW
      : e.argv.includes('--cursor') ? PAGE_2
      : PAGE_1
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

test('Older fetches the next page with the CLI cursor', async ($, on) => {
  const seen: string[][] = []
  wirePaged(on, seen)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'requests' })
  expect(await ui.find({ type: 'Text', text: /1–1 of 1\+/ })).toBeDefined()

  await ui.press({ key: 'older' })
  expect(seen.some(a => a.includes('--cursor') && a.includes('t1~200~1~abc'))).toBe(true)
  await ui.press({ key: 'row-trc_p2' })
  expect(await ui.find({ type: 'Text', text: /-2518 Wrong answers only/ })).toBeDefined()
  await ui.unmount()
})

test('the shadow filter lists silent-test calls only', async ($, on) => {
  const seen: string[][] = []
  wirePaged(on, seen)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'requests' })
  await ui.press({ key: 'filter-shadow' })

  const traces = seen.filter(a => a.includes('traces')).at(-1) ?? []
  expect(traces.join(' ')).toBe('mubit traces --limit 20 --json --with-cursor --purpose shadow')
  expect(await ui.find({ type: 'Text', text: /◆ vllm Qwen/ })).toBeDefined()
  await ui.unmount()
})

test('a signed-out CLI shows the login hint', async ($, on) => {
  on('command.register', () => ({ value: { command: 'mubit' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '', stderr: 'Clerk has no active session for this cookie: sign in again.', isStdoutTruncated: false, isStderrTruncated: false },
  }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'refresh' })

  expect(await ui.find({ type: 'Text', text: /mubit login/ })).toBeDefined()
  await ui.unmount()
})
