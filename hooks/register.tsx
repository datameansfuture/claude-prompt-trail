import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TrailItem } from '../types'

// The whole run of prompts this session, oldest first. Capped at CAP: an
// unbounded array in host-held state is a slow leak in a long-lived session,
// and the oldest two hundred prompts are the ones nobody is scrolling back to.
const trail = atom(
  { plugin: 'prompt-trail', key: 'trail' } as const,
  [] as TrailItem[],
)

// Expanded: every entry the band has room for. Shut: only the last few, so
// the band stays out of the way between turns.
const isOpen = atom({ plugin: 'prompt-trail', key: 'isOpen' } as const, false)

// The line the previous prompt was condensed into. Held in state, not in a
// module variable, because the model judges each prompt against the row above
// it in the band — and the band is the thing that survives a hot reload. A
// module variable resets on reload and would leave the model judging against
// a line that is no longer on screen. It is derived from the trail whenever
// the trail changes, so it cannot drift out of step with what is drawn.
const previousLine = atom(
  { plugin: 'prompt-trail', key: 'previousLine' } as const,
  '',
)

const CAP = 200

// How many rows the shut band spends on the trail itself, under its header.
const SHUT_ROWS = 3

// Only what the person typed themselves. A task notification, a scheduled
// prompt or another plugin's submission is not something they need reminding of.
const TYPED = ['composer', 'bridge']

const LABEL = ' Trail '
const ELLIPSIS = '…'

// How long the toast floats. Long enough to read a clipped prompt, short
// enough that a burst of prompts does not paper over the transcript.
const TOAST_MS = 5200

// The chip says whether the turn is still running: the Claude colour while it
// is, the theme's success colour once it is done. Grey before the first prompt,
// because there is nothing finished to report yet. Theme keys, so the
// daltonized themes get their own pair rather than a red/green one.
const WORKING_BG = 'claude'
const DONE_BG = 'success'
const IDLE_BG = 'inactive'

// Past entries fade with age rather than all reading equal: the eye lands on
// the bottom row first, which is the newest and the one being worked on.
const RECENT = 'suggestion'
const OLDER = 'inactive'

// ---------------------------------------------------------------- summary

// The model that condenses a prompt into a line. Haiku because this is a
// cheap classification, not reasoning: the work is reading one paragraph and
// naming it. Effort low for the same reason.
const MODEL = 'haiku'

// The line the model is asked for. 60 characters is roughly 40 tokens of
// English and 60-120 of CJK, so the cap is set well above that: a reply cut
// short by max_tokens still reads as answered, and would otherwise arrive
// chopped mid-word with no ellipsis to say so.
const MAX_TOKENS = 200

// How long the condensing may take before it resolves aborted and the entry
// keeps its raw text. A summary is a nicety; a hung request must never hold a
// prompt hostage.
const SUMMARY_MS = 8000

// Ceiling on what is sent to the model. A pasted log runs to hundreds of
// kilobytes and costs a round trip to throw away; the first stretch of a
// prompt carries the intent, and the band's row clips for display anyway.
const MAX_INPUT = 600

// The line the model is asked to produce, in characters. Enforced on the way
// out as well as asked for on the way in, because a model asked for "at most
// 60 characters" returns 70 often enough to matter.
const LINE_CHARS = 60

// Marks how a prompt sits against the one before it. This is the part a flat
// list cannot show: the arc is not the topics, it is the turns between them.
const CONTINUES = '▶'
const PIVOTS = '↩'
const FIRST = '·'

const SYSTEM = [
  'You compress a developer\'s prompt into one line for a running log they read at a glance.',
  'Answer with the line only: no quotes, no preamble, no trailing period.',
  `Begin it with ${CONTINUES} if it carries on the previous line's work,`,
  `${PIVOTS} if it changes what they are trying to do, or ${FIRST} if there is no previous line.`,
  `Then the line itself: at most ${LINE_CHARS} characters, in the language they wrote in,`,
  'naming the goal rather than restating the words. No quotes, no file lists, no code.',
].join(' ')

// Cuts on a code point, not a UTF-16 unit: slicing an astral character in half
// leaves a lone surrogate that renders as a replacement character.
const shorten = (text: string, max: number) => {
  const chars = Array.from(text)

  return chars.length > max ? chars.slice(0, max).join('') : text
}

// One line, cleaned. The model is told the shape but not trusted with it:
// quotes and a stray newline both come back often enough to matter.
const tidy = (raw: string, fallback: string) => {
  const first = raw
    .split('\n')
    .map(line => line.trim())
    .find(line => line !== '')
  if (!first) return fallback

  // A leading mark is kept only once, and all three are recognised: the model
  // is told to write one, and a reply that opens "▶ ▶ …" or "· · …" would
  // render the row two marks wide.
  let mark = FIRST
  let body = first
  if (
    body.startsWith(CONTINUES) ||
    body.startsWith(PIVOTS) ||
    body.startsWith(FIRST)
  ) {
    mark = body.slice(0, 1)
    body = body.slice(1)
  }

  body = body
    .replace(/^[\s:：>—–-]+/, '')
    .replace(/^["'`「『]|["'`」』]$/g, '')
    .trim()

  if (body === '') return fallback

  const short = shorten(body, LINE_CHARS)

  return `${mark} ${short.length < body.length ? short + ELLIPSIS : short}`
}

// Condense one prompt into `▶ line` / `↩ line`. Never rejects: a failure
// leaves the caller its fallback, so the band always has something to draw.
//
// `before` is passed in rather than read from a module variable: two prompts
// can be in flight at once, and each must be judged against the line that was
// on screen when it was typed, not against whatever landed in the meantime.
const condense = async (
  $: EngineInterface,
  text: string,
  before: string,
): Promise<string> => {
  const given = shorten(text, MAX_INPUT)
  const clipped = given.length < text.length ? given + ELLIPSIS : given
  const fallback = `${FIRST} ${shorten(clipped, LINE_CHARS - 2)}`

  try {
    const r = await $.model.complete({
      model: MODEL,
      system: SYSTEM,
      prompt: [
        `Previous line in the log:\n${before || `${FIRST} (no previous line)`}`,
        ``,
        `Their next prompt:\n${given}`,
        ``,
        'The line:',
      ].join('\n'),
      maxTokens: MAX_TOKENS,
      effort: 'low',
      timeoutMs: SUMMARY_MS,
    })

    // A refusal still yields the raw prompt, and it is marked `·` because
    // nothing established it as a continuation of anything.
    return r.isAnswered ? tidy(r.text, fallback) : fallback
  } catch {
    return fallback
  }
}

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

// Clips to `room` cells, and never eats the leading mark: a row that lost its
// ▶ or ↩ reads as "no idea what this was", which is the one thing the mark is
// there to say. All three marks count, so the width is the same either way.
const isMark = (ch: string) => ch === CONTINUES || ch === PIVOTS || ch === FIRST

const clip = (text: string, room: number) => {
  if (text.length <= room) return text

  const mark = isMark(text[0]) ? 1 : 0
  const body = text.slice(mark)
  const keep = Math.max(1, room - mark - 1)

  return body.length > keep ? shorten(body, keep) + ELLIPSIS : body
}

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    // A hook that throws is skipped whole, so read the origin defensively:
    // an unstamped submission is treated as not the person's own.
    if (TYPED.includes(e.origin?.kind)) {
      const text = flatten(e.text)

      if (text !== '') {
        // The raw text goes in first and the band shows it at once, so the row
        // is never blank while the model is asked for the line that replaces it.
        // The turn does not wait on that call either.
        //
        // The seq is derived from the trail inside the update, never from a
        // module counter: a counter resets on hot reload while the trail does
        // not, and two rows sharing a seq would let one summary overwrite the
        // other and render as duplicate keys. Reading the previous row here also
        // settles what "previous line" means at the moment of typing, before
        // any summary has landed.
        const before = await read($, previousLine)
        const stamped = await update($, trail, list => {
          const seq = (list.length === 0 ? 0 : list[list.length - 1].seq) + 1

          return [...list, { seq, text, line: null }].slice(-CAP)
        })
        const seq = stamped[stamped.length - 1].seq

        // Not awaited: the prompt enters the session now and the summary lands
        // a second or two later, rewriting the row in place. Awaiting it here
        // would hold the turn for a log line.
        void condense($, text, before)
          .then(line => {
            void update($, trail, list =>
              list.map(item => (item.seq === seq ? { ...item, line } : item)),
            )
            void update($, previousLine, () => line)
            // The float carries the line rather than the paste: a clipped prompt
            // is the one thing the person already has a copy of.
            $.ui.toast(line, { timeoutMs: TOAST_MS })
          })
          // The session can end inside the summary window — an exit, a /clear,
          // or a reload that swapped the environment out from under this
          // continuation. `condense` itself never rejects, but the writes after
          // it do, and an unhandled rejection here would surface in the debug
          // log with nobody to read it. A summary is optional; never worth a
          // stray error.
          .catch(() => {})
      }
    }

    return next(e)
  })
    // This hook only observes, so a throw must never cost the person their
    // prompt. The handler answers in the hook's place: `next(e)` runs what is
    // beneath on the event as it was raised, so the prompt enters exactly once
    // whether the hook threw before its own call or after it.
    .catch(($, e, next) => next(e))

  // A /clear ends the conversation and starts a new session id without
  // reloading the module, so nothing else would reset these. The trail is the
  // new session's log: carrying the old one across the boundary would show
  // prompts from a conversation that no longer exists, and would leave the
  // first prompt of the new session judged against a line the model can no
  // longer see.
  //
  // Only `clear` restarts the conversation. `prompt_input_exit` is the person
  // leaving, `resume` is another session taking this one's place, and the
  // process is going down in either case — clearing then would throw away a
  // trail the next session under the same id could still show.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, trail, () => [])
      await update($, previousLine, () => '')
      await update($, isOpen, () => false)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, trail)

    // A survey needs the band more than the trail does.
    if (e.props.hasSurvey) {
      return next(e)
    }

    const open = await read($, isOpen)
    const { Box, Button, Text } = $.ui.resolve(e)

    const chipBackground = e.props.isWorking
      ? WORKING_BG
      : list.length === 0
        ? IDLE_BG
        : DONE_BG

    // The band's own slot is capped at half the terminal, prompt included, so
    // read the room off the props rather than assuming a window size. The
    // header takes one row, and a slot that cannot spare one shows the trail
    // alone.
    const room = Math.max(0, e.props.maxRows - 1)
    const shut = Math.min(list.length, SHUT_ROWS)
    const openRows = Math.min(list.length, room)
    const rows = open ? openRows : shut

    // The button promises what opening will actually show. Past the cap the
    // band scrolls the rest into its own window, so the label names the rows
    // on screen rather than the length of the trail.
    const capped = open && openRows < list.length
    const toggleLabel = open
      ? capped
        ? ` Top ${openRows}`
        : ' Less'
      : list.length > shut
        ? ` ${list.length - shut} more`
        : ''

    const header = (
      <Box key="header">
        <Text backgroundColor={chipBackground} color="inverseText" bold>
          {LABEL}
        </Text>
        <Text dimColor> {list.length} </Text>
        {toggleLabel ? (
          <Button
            key="toggle"
            label={toggleLabel}
            dimColor
            plain
            onPress={() => update($, isOpen, was => !was)}
          />
        ) : null}
      </Box>
    )

    if (list.length === 0) {
      // An empty band reads as the mod missing, so it says it is waiting.
      return (
        <Box flexDirection="column">
          {header}
          <Text dimColor wrap="truncate-end">
            {' '}
            waiting for your first prompt{ELLIPSIS}
          </Text>
        </Box>
      )
    }

    const shown = list.slice(-Math.max(1, rows))

    // Room for the widest ordinal, so the rows line up whether the trail runs
    // to nine or to nine hundred.
    const digits = String(shown[shown.length - 1].seq).length
    const width = Math.max(8, e.props.bodyColumns - digits - 4)

    return (
      <Box flexDirection="column">
        {header}
        {shown.map((item, i) => {
          // Age within the shown window: the last row is the newest, and the
          // one the turn is running against.
          const isNewest = i === shown.length - 1
          // The line once the model has written it, the raw prompt until then.
          // It is always there: `condense` answers the raw text on any failure,
          // so a row never sits empty.
          const body = item.line ?? item.text

          return (
            <Text
              key={item.seq}
              wrap="truncate-end"
              color={isNewest ? RECENT : OLDER}
              dimColor={!isNewest}
            >
              {' '}
              {String(item.seq).padStart(digits)} {clip(body, width)}
            </Text>
          )
        })}
      </Box>
    )
  })
}
