// One prompt as the trail keeps it.
//
// `seq` is derived from the previous entry inside the update that appends it,
// never from a module counter: a hot reload resets module state while the
// trail itself is host-held and survives, and two rows sharing a seq would let
// one summary overwrite the other and render as duplicate keys.
//
// `text` is what was typed. `line` is the model's one-line reading of it, null
// only between the append and the reply landing — `condense` answers the raw
// prompt on any failure, so a row is never left empty and never falls back to
// showing the paste twice.
export type TrailItem = { seq: number; text: string; line: string | null }

declare module 'claude-code' {
  interface PluginState {
    'prompt-trail': {
      trail: TrailItem[]
      isOpen: boolean
      // The line the row above the newest was condensed into, which is what
      // the model judges the next prompt against. Held beside the trail so the
      // two cannot drift: it is written from the same reply that fills a row.
      previousLine: string
    }
  }
}
