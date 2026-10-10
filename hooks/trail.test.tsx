// What these tests do NOT cover, stated rather than left to be assumed:
//
//   - `session.end`. The kit exposes no `$.session.end` noun and its `$.classic`
//     reaches only the settings-hook chain, not a hooks module, so the
//     clear-on-/clear reset cannot be staged here. Verify it by running a
//     /clear in a live session.
//   - Hot reload. A reload resets module-scope variables while `$.state`
//     survives, which is why the seq is derived from the trail rather than
//     counted in a module variable. No test can reload the module under test.
//   - `seq` versus index matching. Seq is derived from the trail so a reply
//     that lands after a reload or a /clear finds no row rather than the wrong
//     one. Staging that needs one of the two events above. The scenarios that
//     CAN be staged — a reply landing out of order, a reply landing after the
//     trail scrolled — are correct under index matching too, and are asserted
//     here as regression cover rather than as proof the seq is required.
//   - The toast. The kit has no `$.ui.toast` implementation, so every run
//     reports it dropped and nothing can assert on it.
//   - Model input truncation (MAX_INPUT) and the code-point slicing in `shorten`.
//     Neither has an observable through the band: both act on the request the
//     model receives and on characters the band then clips.

import { test, expect } from 'claude-code/testing'
import type { RenderSurface } from 'claude-code'

const BAND = {
  plugin: 'prompt-trail',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop'] as const

// What the summarising model answers, per test. The kit has no mock.model, so
// the model's noun is stood in by a hook on the test's own `on`, which sits
// beneath the plugin.
//
// Returning a Promise is not an option: a hook must answer with plain data
// (`not plain data: The object can not be cloned`), so an out-of-order reply is
// staged by holding the calls in hand and releasing them by hand — see
// `deferredModel`.
type Reply = (prompt: string) => string | undefined

const answer = (text: string | undefined) => ({
  value:
    text === undefined
      ? { isAnswered: false, reason: 'empty-reply', usage: {} }
      : { isAnswered: true, text, usage: {} },
})

const engine = (on: any, reply?: Reply) => {
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))

  if (reply) {
    // A hook answers in `{ value }`. A bare result is read as neither an answer
    // nor a refusal, so the engine skips the hook and the plugin's own call
    // falls through to the real model.
    on('model.complete', (_$: any, e: any) => answer(reply(String(e.prompt))))
  }
}

// The kit has no `$.session.end` noun: nothing raises the mod's own
// `session.end` event, and `$.classic.SessionEnd` reaches only the settings-hook
// chain, not a hooks module. So the clear-on-/clear behaviour — the reason this
// hook exists — is not covered by a test here. What is covered is that the
// classic event the kit CAN raise does not disturb the trail, which is the
// closest reachable neighbour of the same boundary.
const engineEnding = (on: any, reply?: Reply) => {
  engine(on, reply)
  on('classic.SessionEnd', (_$: any, e: any) => ({ continue: true, reason: e.reason }))
}

const classicEnded = ($: any, reason: string) => $.classic.SessionEnd({ reason } as never)

// A model whose replies are held until the test releases them, so a reply can
// land long after its row was appended. This is the only way to stage the case
// the seq exists for: index matching captures `list.length` at submit time and
// writes `list[at]` when the reply lands, which is wrong the moment the list
// shifts — and it only shifts when the CAP trims the front or a later prompt is
// appended. `reply` covers every call except the ones the test wants held, so a
// single stub serves both the filler prompts and the stalled one.
//
// Releasing a promise is how the plugin's await continues; the engine never
// sees it, only the value it resolves to.
const deferredModel = (on: any, reply: Reply) => {
  const held: Array<{ prompt: string; release: (text: string) => void }> = []

  engine(on)
  on('model.complete', (_$: any, e: any) => {
    const prompt = String(e.prompt)
    const text = reply(prompt)

    if (text !== undefined) return answer(text)

    return new Promise(resolve => {
      held.push({
        prompt,
        release: (held_: string) => resolve(answer(held_) as never),
      })
    }) as never
  })

  return held
}

const typed = ($: any, text: string) =>
  $.prompt.submit({ text, origin: { kind: 'composer' } })

const bandText = async (ui: any) => {
  const rows = await ui.findAll({ type: 'Text' })

  return rows.map(row => row.text).join('\n')
}

// The summary is written off the hook's own await, so a test that wants to see
// it has to let the microtask queue drain first.
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

test('waits with a placeholder until the person has typed a prompt', async ($, on) => {
  engine(on)

  for (const surface of SURFACES satisfies readonly RenderSurface[]) {
    const ui = await $.ui.mount({ ...BAND, surface })

    const text = await bandText(ui)
    expect(text).toContain('waiting for your first prompt')

    const body = await ui.find({ type: 'Text', text: /waiting/ })
    expect(body?.props.dimColor).toBe(true)
    expect(body?.props.color).toBeUndefined()

    const chip = await ui.find({ type: 'Text', text: /Trail/ })
    expect(chip?.props.backgroundColor).toBe('inactive')

    expect(await ui.find({ key: 'toggle' })).toBeUndefined()

    await ui.unmount()
  }
})

test('the placeholder gives way to the prompt once one is typed', async ($, on) => {
  engine(on)

  await typed($, 'the real thing')
  await settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const text = await bandText(ui)

  expect(text).toContain('the real thing')
  expect(text).not.toContain('waiting')

  await ui.unmount()
})

test('shows the raw prompt before the summary lands', async ($, on) => {
  engine(on)

  await typed($, 'start the app for me')
  await settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await bandText(ui)).toContain('start the app for me')

  await ui.unmount()
})

test('replaces the raw prompt with the one line the model wrote', async ($, on) => {
  engine(on, () => '▶ build the installer')

  await typed($, 'now please go and build the installer for the macos pkg')
  await settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const text = await bandText(ui)

  expect(text).toContain('build the installer')
  // The paste it came from is gone, not merely pushed off the row.
  expect(text).not.toContain('now please go and build')

  await ui.unmount()
})

test('keeps the mark that says whether the prompt continued or turned', async ($, on) => {
  // Every call's prompt carries a "Previous line" section, so the stub keys off
  // the submitted text instead: the first row has no line to continue from and
  // the model marks it ·, the second continues the first and is marked ▶.
  engine(on, prompt =>
    prompt.includes('second thing') ? '▶ 继续修 statusline' : '· 第一件事',
  )

  await typed($, 'first thing')
  await settle()
  await typed($, 'second thing')
  await settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const text = await bandText(ui)

  expect(text).toContain('1 · 第一件事')
  expect(text).toContain('2 ▶ 继续修 statusline')

  await ui.unmount()
})

test('hands the previous line to the model so it can judge the turn', async ($, on) => {
  const seen: string[] = []
  engine(on, prompt => {
    seen.push(prompt)
    return '· line'
  })

  await typed($, 'first thing')
  await settle()
  await typed($, 'second thing')
  await settle()

  // The second call carries the first call's line, which is what makes ▶ and ↩
  // mean anything: the model judges against the trail, not in a vacuum.
  expect(seen[0]).toContain('no previous line')
  expect(seen[1]).toContain('· line')
  expect(seen[1]).toContain('second thing')

  await (await $.ui.mount({ ...BAND, surface: 'terminal' })).unmount()
})

test('a reply that lands after its row scrolled off changes nothing', async ($, on) => {
  // Index matching captures `list.length` when the prompt is typed and writes
  // `list[at]` when the reply lands. Staging a case where those disagree needs
  // the list to get SHORTER between the two moments, which the CAP trim does.
  //
  // Asserted as a no-op rather than as proof that seq is required — see the
  // coverage note at the top of this file.
  const held = deferredModel(on, prompt =>
    prompt.includes('the first thing') ? undefined : '· filler',
  )

  await typed($, 'the first thing')
  await settle()

  // Fill past the cap so the front of the trail scrolls off.
  for (let i = 0; i < 205; i++) {
    await typed($, `filler ${i}`)
  }
  await settle()

  // Now release the reply, long after its row is gone.
  held[0].release('· the first line')
  await settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const rows = (await ui.findAll({ type: 'Text' })).map(r => r.text)

  // Its row is gone (trimmed), so nothing should carry its line — and in
  // particular no surviving row, such as the newest, should have taken it.
  expect(rows.some(r => r.includes('the first line'))).toBe(false)
  expect(rows.some(r => r.includes('the first thing'))).toBe(false)

  await ui.unmount()
})

test('a reply that lands after a later prompt still fills its own row', async ($, on) => {
  const held = deferredModel(on, () => undefined)

  await typed($, 'first thing')
  await typed($, 'second thing')
  await settle()

  expect(held.length).toBe(2)

  // Out of order on purpose: the later reply lands first.
  held[1].release('· the second line')
  await settle()
  held[0].release('· the first line')
  await settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const rows = (await ui.findAll({ type: 'Text' })).map(r => r.text)

  expect(rows.some(r => /^\s*1 · the first line$/.test(r))).toBe(true)
  expect(rows.some(r => /^\s*2 · the second line$/.test(r))).toBe(true)

  await ui.unmount()
})

test('a session-end signal the kit can raise leaves the trail alone', async ($, on) => {
  // COVERAGE NOTE: this stands in for the mod's `session.end` handler, which
  // the kit cannot raise — nothing exposes a `$.session.end` noun, and
  // `$.classic.SessionEnd` reaches only the settings-hook chain. The clearing
  // behaviour on a real /clear is therefore unverified by this suite; verify it
  // by running a /clear in a live session.
  engineEnding(on, () => '· a line')

  await typed($, 'still here')
  await settle()

  await classicEnded($, 'clear')
  await settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  // The row is still the one typed before the signal, numbered from one.
  expect(await bandText(ui)).toContain('1 · a line')

  await ui.unmount()
})

test('keeps the raw prompt when the model refuses to answer', async ($, on) => {
  // An empty reply is the realistic failure: a stub that answers undefined.
  engine(on, () => undefined)

  await typed($, 'the original prompt survives')
  await settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await bandText(ui)).toContain('the original prompt survives')

  await ui.unmount()
})

test('marks a failed summary as a first rather than leaving it bare', async ($, on) => {
  engine(on, () => undefined)

  await typed($, 'the original prompt survives')
  await settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  // A row with no mark reads as "nothing to say here" rather than "this is the
  // first prompt of the run".
  expect((await ui.findAll({ type: 'Text' })).some(r => /^\s*1 · /.test(r.text))).toBe(true)

  await ui.unmount()
})

test('clips a reply that runs past the line length', async ($, on) => {
  const long = 'word '.repeat(40).trim()
  engine(on, () => `▶ ${long}`)

  await typed($, 'anything')
  await settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const row = (await ui.findAll({ type: 'Text' })).find(r => r.text.includes('▶'))

  // Marked, cut, and saying it was cut.
  expect(row?.text).toContain('…')
  expect(row?.text).toContain('▶')

  await ui.unmount()
})

test('does not double the mark when the model writes one', async ($, on) => {
  engine(on, () => '▶ the line')

  await typed($, 'anything')
  await settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const text = await bandText(ui)

  // One mark, not "▶ ▶", and no stray space between it and the line.
  expect(text).toContain('▶ the line')
  expect(text).not.toContain('▶ ▶')
  expect(text).not.toContain('▶  the line')

  await ui.unmount()
})

test('takes the first line when the model answers with several', async ($, on) => {
  engine(on, () => '▶ the line\n\nand a paragraph of explanation')

  await typed($, 'anything')
  await settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const text = await bandText(ui)

  expect(text).toContain('▶ the line')
  expect(text).not.toContain('paragraph of explanation')

  await ui.unmount()
})

test('keeps the earlier prompts instead of dropping them', async ($, on) => {
  engine(on)

  await typed($, 'first thing')
  await typed($, 'second thing')
  await settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const text = await bandText(ui)

  expect(text).toContain('first thing')
  expect(text).toContain('second thing')

  await ui.unmount()
})

test('folds a multi-line prompt onto one row', async ($, on) => {
  engine(on)

  await typed($, 'one\n\n  two   three\n')
  await settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await bandText(ui)).toContain('one two three')

  await ui.unmount()
})

test('numbers the entries so the arc reads in order', async ($, on) => {
  engine(on)

  await typed($, 'alpha')
  await typed($, 'beta')
  await settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const text = await bandText(ui)

  // A refused summary keeps the prompt and marks it `·`, so the row reads as
  // the start of the run rather than as an unmarked leftover.
  expect(text).toMatch(/1 · alpha/)
  expect(text).toMatch(/2 · beta/)

  await ui.unmount()
})

test('fades the older entries so the newest reads first', async ($, on) => {
  engine(on)

  await typed($, 'alpha')
  await typed($, 'beta')
  await settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  const old = await ui.find({ type: 'Text', text: /alpha/ })
  expect(old?.props.dimColor).toBe(true)

  const recent = await ui.find({ type: 'Text', text: /beta/ })
  expect(recent?.props.dimColor).toBeFalsy()

  await ui.unmount()
})

test('the shut band shows only the last few, and the toggle opens the rest', async ($, on) => {
  engine(on)

  for (const text of ['one', 'two', 'three', 'four', 'five']) {
    await typed($, text)
  }
  await settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  const shut = await bandText(ui)
  expect(shut).toContain('five')
  expect(shut).not.toContain('one')

  await ui.press({ key: 'toggle' })
  const open = await bandText(ui)
  expect(open).toContain('one')
  expect(open).toContain('five')

  await ui.press({ key: 'toggle' })
  expect(await bandText(ui)).toBe(shut)

  await ui.unmount()
})

test('the toggle names the rows it will show, not the length of the trail', async ($, on) => {
  engine(on)

  // More prompts than the band has rows for: maxRows 10 leaves room for 9.
  for (let i = 1; i <= 14; i++) {
    await typed($, `prompt ${i}`)
  }
  await settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await ui.press({ key: 'toggle' })

  // The band scrolls the rest into its own window, so promising "All 14"
  // would be a claim the UI cannot keep. The Button's label is the promise, so
  // that is what is asserted.
  expect((await ui.find({ key: 'toggle' }))?.text).toContain('Top 9')

  await ui.unmount()
})

test('no toggle while the whole trail already fits', async ($, on) => {
  engine(on)

  await typed($, 'only one')
  await typed($, 'only two')
  await settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await ui.find({ key: 'toggle' })).toBeUndefined()
  expect(await bandText(ui)).toContain('only one')

  await ui.unmount()
})

test('yields the band to a survey', async ($, on) => {
  engine(on)

  await typed($, 'something typed')
  await settle()

  const ui = await $.ui.mount({
    ...BAND,
    surface: 'terminal',
    props: { ...BAND.props, hasSurvey: true },
  })

  expect(await ui.find({ key: 'header' })).toBeUndefined()

  await ui.unmount()
})

test('a prompt the person did not type leaves the trail alone', async ($, on) => {
  engine(on)

  await typed($, 'what the person typed')

  // A background task's notification and a scheduled trigger both enter as
  // prompts. Neither is something the person needs reminding they typed.
  await $.prompt.submit({
    text: 'a background task finished',
    origin: { kind: 'task-notification' },
  } as never)
  await $.prompt.submit({
    text: 'a routine fired',
    origin: { kind: 'scheduled-trigger' },
  } as never)
  await settle()

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const text = await bandText(ui)

  expect(text).toContain('what the person typed')
  expect(text).not.toContain('background task')
  expect(text).not.toContain('routine fired')

  await ui.unmount()
})

test('draws the chip in theme colors', async ($, on) => {
  engine(on)

  await typed($, 'colour me')
  await settle()

  for (const surface of SURFACES satisfies readonly RenderSurface[]) {
    const ui = await $.ui.mount({ ...BAND, surface })

    // Theme keys, not raw hex, so the band follows the user's light or dark theme.
    const chip = await ui.find({ type: 'Text', text: /Trail/ })
    expect(chip?.props.backgroundColor).toBe('success')
    expect(chip?.props.color).toBe('inverseText')
    expect(chip?.props.bold).toBe(true)

    await ui.unmount()
  }
})

test('the chip says whether the turn is still running', async ($, on) => {
  engine(on)

  await typed($, 'take your time')
  await settle()

  for (const surface of SURFACES satisfies readonly RenderSurface[]) {
    const working = await $.ui.mount({
      ...BAND,
      surface,
      props: { ...BAND.props, isWorking: true },
    })

    const busy = await working.find({ type: 'Text', text: /Trail/ })
    expect(busy?.props.backgroundColor).toBe('claude')

    await working.unmount()

    const done = await $.ui.mount({ ...BAND, surface })

    const idle = await done.find({ type: 'Text', text: /Trail/ })
    expect(idle?.props.backgroundColor).toBe('success')

    await done.unmount()
  }
})
