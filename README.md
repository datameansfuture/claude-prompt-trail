# Prompt Trail

A [Claude Code](https://claude.com/claude-code) mod. It keeps the prompts you
sent this session on a row above the prompt line, each condensed to one line,
and floats the newest one as a toast over the transcript.

把本会话里你发过的每一条 prompt 留在输入框上方,每条压成一行,最新一条还会以
toast 形式浮在 transcript 右上角。

<details>
<summary><b>中文说明 — 点击展开</b></summary>

## 这是什么

一个 [Claude Code](https://claude.com/claude-code) mod。它把本会话你发过的每条
prompt 保持在输入框上方的一行里,每条压缩成一行,最新一条以 toast 形式浮在
transcript 右上角。

长会话会把自己的问题埋掉。你发了个需求,一轮跑了几分钟,等你回来时那件事已经
滚出屏幕了 —— 或者你在另一个终端标签页里,而各种工具输出长得都差不多。这个 mod
让这串痕迹始终在视野里,而不是躺在 scrollback 里。

## 效果

```
  Trail  7  · build the installer      ↩ now write the README
          · add the installer test     ▶ that assertion is wrong
          ▶ fix the failing assertion  ↩ audit the wrapper script
```

- **每一条,不只最后一条。** 带编号,最旧的在顶部,最新的在最靠近输入框的位置。
  默认显示最近三条;点开切换按钮可看全部。
- **每条一行。** 小模型把 prompt 压缩成它「是干什么用的」,而不是复述原文。
  压缩还没回来时,那一行先短暂显示你的原文,回来后再替换。
- **标记它对这一轮做了什么。** `·` 开场,`▶` 承接上一条,`↩` 换了个方向。长会话的
  脉络在话题之间的转折,不在话题本身;平铺的列表表达不出这个。
- **每条一个 toast。** 最新一行浮在 transcript 右上角几秒,然后自己消失。
- **越旧越淡。** 最新一行满亮度,旧的逐级变暗,眼睛自然落在当前的事上。
- **只统计你亲手打的。** 后台任务通知、定时触发、其他 plugin 的提交也会以
  prompt 形式到达,这些按 origin 过滤掉。

芯片的颜色表示会话状态:跑一轮时是 Claude 颜色,跑完后是主题的 success 色,
你还没打字时是灰色。颜色用的是 Claude Code 的主题 key 而非 hex,所以跟随你的
明暗主题,也跟随对色盲友好的主题。

## 成本

每条你亲手打的 prompt 一次小模型调用 —— `haiku`,`effort: low`,上限 200 输出
token、8 秒。它挂在 hook 上异步跑,所以任何一轮都不会等它。超时、API 报错、
空回复、崩溃,任何一种都只是让原文留在原地:band 永远有东西可画。

不想花钱的话,删掉 `hooks/register.tsx` 里的 `condense` 调用和它的 `.then`。
band 会变成显示裁剪后的原始 prompt,标记也就没有了。

## 环境要求

带 mod 支持的 Claude Code(`plugin-authoring` skill 和 `AbovePrompt` 渲染
组件 —— 大约 Claude Code 2.1.294 及以后)。没有别的:不依赖其他 plugin,不依赖
MCP server。

## 安装

**单个会话:**

```
claude --plugin-dir /path/to/prompt-trail
```

**这台机器上每个会话都生效**,在 `~/.claude/settings.json` 的 `env` 里加上:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/prompt-trail"
  }
}
```

多个目录用 `:` 分隔(Windows 用 `;`),之后重启 Claude Code。如果你用某个会重写
`settings.json` 的工具切换订阅(cc-switch 就会),那把 key 也加到那里去,否则下次
切换就没了。

## 开发

`claude plugin validate .` 和 `claude plugin test .` 都离线跑,对着引擎本地执行
—— 不发 API 请求,不走网络。mod 目录被监听时,存文件会在本轮结束时重载 mod,
所以你改着代码就能看到 band 冒出来。

### 测试覆盖不到的部分

写在这里而不是留着让人默认以为覆盖了 —— 全绿的测试套件很容易被读成比实际更多的
保证:

- **`session.end` 与 `/clear` 时的状态重置。** 测试工具没有暴露
  `$.session.end` 这个 noun,它的 `$.classic` 只到 settings-hook 链,到不了 hooks
  模块。得在真会话里跑一次 `/clear` 才能验。
- **热重载。** 重载会重置模块作用域变量,而 `$.state` 会保留 —— 这正是行号从
  trail 推导、而不是用模块变量计的原因。没有任何测试能在被测模块运行时重载它。
- **`seq` 与索引匹配的差异。** 测试工具搭得出的场景(乱序落地的回复、滚动出
  视野之后才落地的回复),在索引匹配下结果也对。真正需要 `seq` 的场景 —— 重载、
  或 `/clear` 发生在提交与回复之间 —— 就是上面那两条。乱序和滚动出视野那两个
  测试是回归覆盖,不是证明。
- **toast。** 工具里没有 `$.ui.toast`,它只会报告这个调用被丢掉,没法断言。
- **输入截断与码点切片。** 两者作用在模型收到的请求上,以及 band 随后裁剪的字
  符上,都无法通过 band 观测到。

## 致谢

基于 Gurpreet S Luthra 的
[`claude-mod-last-prompt`](https://github.com/gsluthra/claude-mod-last-prompt)
(MIT),它在提示符上方只保留最近一条 prompt。这个 fork 保留整串、逐条压缩,并
标记其中的转折。上游版权保留在 `LICENSE` 里。

## 许可

MIT,见 `LICENSE`。

</details>

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
- **Fades with age.** The newest row is at full strength, older ones dim, so
  the eye lands on what is current.
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
`settings.json` (cc-switch does), add the key there too or it will be lost on
the next switch.

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
