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

const wire = (on: any) => {
  on('command.register', () => ({ value: { command: 'mubit' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => ({
    value: {
      exitCode: 0,
      stdout: e.argv.includes('traces') ? TRACES : e.argv.includes('rate') ? '{"feedback_count":1}' : TASKS,
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
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
