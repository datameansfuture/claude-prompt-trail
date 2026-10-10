# Prompt Trail

A [Claude Code](https://claude.com/claude-code) mod. It keeps the prompts you
sent this session on a row above the prompt line, each condensed to one line,
and floats the newest one as a toast over the transcript.

A long session buries its own questions. You send something, a turn runs for a
few minutes, and by the time you come back the thing you asked for has scrolled
off the screen — or you are in a different terminal tab and the scrolling tool
output looks the same in all of them. This keeps the trail in view instead of
in scrollback.

## What it does

```
  Trail  7  · build the installer      ↩ now write the README
          · add the installer test     ▶ that assertion is wrong
          ▶ fix the failing assertion  ↩ audit the wrapper script
```

- **Every prompt, not just the last.** Numbered, oldest at the top, newest at
  the bottom nearest the input. The three most recent show by default; the
  toggle opens the rest.
- **One line each.** A small model condenses the prompt into what it was *for*,
  not a restatement of it. The row shows your raw text for a second while that
  is in flight, then swaps to the line.
- **Marked for what it did to the run.** `·` starts the log, `▶` carries on the
  line above, `↩` changes what you are trying to do. The arc of a long session
  is the turns between topics, not the topics; a flat list cannot show that.
- **A toast per prompt.** The newest line floats over the transcript's top-right
  corner for a few seconds, then leaves on its own.
- **Fades with age.** The newest row is at full strength, older ones dim, so the
  eye lands on what is current.
- **Only what you typed.** Background task notifications, scheduled triggers and
  other plugins' submissions all arrive as prompts; they are filtered out by
  origin.

The chip colours say what the session is doing: the Claude colour while a turn
is running, the theme's success colour once it has finished, grey before you
have typed anything. Colours are Claude Code theme keys, not hex, so the band
follows your light or dark theme and the colourblind-friendly themes.

## Cost

One small-model call per prompt you type — `haiku` at `effort: low`, capped at
200 output tokens and 8 seconds. It runs off the hook, so a turn never waits for
it. A timeout, an API error, an empty reply or a crash all leave the raw prompt
in place: the band always has something to draw.

If you would rather pay nothing, delete the `condense` call and its `.then` in
`hooks/register.tsx`; the band then shows your prompts clipped rather than
condensed, and loses the marks.

## Requirements

Claude Code with mod support (the `plugin-authoring` skill and the
`AbovePrompt` render component — Claude Code 2.1.294 or so). Nothing else: no
other plugin, no MCP server.

## Install

**One session:**

```
claude --plugin-dir /path/to/prompt-trail
```

**Every session on the machine**, add the folder to `env` in
`~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/prompt-trail"
  }
}
```

Separate several folders with `:` (`;` on Windows), and restart Claude Code
afterwards. If you switch subscriptions through a tool that rewrites
`settings.json` (cc-switch does), add the key there too or it will be lost on the
next switch.

## Develop

`claude plugin validate .` and `claude plugin test .` both run offline against
the engine — no API call, no network. While a mods folder is watched, saving a
file reloads the mod at the end of the turn, so the band appears while you work.

### What the tests do not cover

Stated here rather than left to be assumed, because the passing suite is easy to
read as more assurance than it is:

- **`session.end` and the clear-on-`/clear` reset.** The test kit exposes no
  `$.session.end` noun, and its `$.classic` reaches only the settings-hook
  chain, not a hooks module. Verify by running a `/clear` in a live session.
- **Hot reload.** A reload resets module-scope variables while `$.state`
  survives — which is why the row number is derived from the trail rather than
  counted in a module variable. No test can reload the module under test.
- **`seq` versus index matching.** The scenarios the kit can stage (a reply
  landing out of order, a reply landing after its row scrolled off) come out
  right under index matching too. The cases that need `seq` — a reload or a
  `/clear` between submit and reply — are the two above. The out-of-order and
  scrolled-off tests are regression cover, not proof.
- **The toast.** The kit has no `$.ui.toast`, so it reports the call dropped and
  nothing can assert on it.
- **Input truncation and code-point slicing.** Both act on the request the model
  receives and on characters the band then clips; neither is observable through
  the band.

## Credits

Built on [`claude-mod-last-prompt`](https://github.com/gsluthra/claude-mod-last-prompt)
by Gurpreet S Luthra, MIT licensed — which keeps the most recent prompt on one
row. This fork keeps the whole run, condenses each entry, and marks the turns
between them. The upstream copyright is retained in `LICENSE`.

## License

MIT. See `LICENSE`.
