// qi-pm — rewrite the draft in the prompt box with a side-channel model call,
// then put the result back for the person to edit or send.
//
// Three API calls carry the whole interaction:
//   $.prompt.read()       read the draft
//   $.model.complete()    a model call outside the main conversation
//   $.prompt.fill()       write back into the box, without sending
//
// The main conversation never sees the rewrite unless the person presses
// Enter on it. Two ways in: the /qi-pm command, and a Button on the band
// above the prompt.

const NL = String.fromCharCode(10)

const BEGIN = "<enhanced-prompt>"
const END = "</enhanced-prompt>"

const SYSTEM = `You rewrite a rough draft into a precise prompt for a coding agent.

Rules:
- Reply with the rewritten prompt only, wrapped in ${BEGIN} and ${END}.
- Do not use any tools. Do not ask questions.
- Keep the original language of the draft.
- Preserve every file path, symbol, command, flag and error string exactly as written.
- Keep code blocks and inline code unchanged.
- Do not invent requirements the draft does not imply.`

function buildPrompt(draft, context) {
  if (!context) return draft
  return "[Context]" + NL + context + NL + NL + draft
}

// Collapse runs of whitespace without a regex literal, so this file stays
// free of backslash escapes.
function squash(value) {
  const out = []
  let pendingSpace = false
  for (const ch of value) {
    const code = ch.charCodeAt(0)
    const isSpace = code === 32 || code === 9 || code === 10 || code === 13
    if (isSpace) {
      if (!pendingSpace) out.push(" ")
      pendingSpace = true
    } else {
      out.push(ch)
      pendingSpace = false
    }
  }
  return out.join("").trim()
}

const HISTORY_COUNT = 10
const HISTORY_TEXT_LEN = 1500

function buildContext(cwd, messages) {
  const parts = []
  if (cwd) parts.push("项目目录：" + cwd)

  const lines = []
  const list = Array.isArray(messages) ? messages.slice(-HISTORY_COUNT) : []
  for (const message of list) {
    if (!message || typeof message.text !== "string") continue
    const text = squash(message.text)
    if (!text) continue
    const who = message.role === "user" ? "User" : "Assistant"
    const shown = text.length > HISTORY_TEXT_LEN
      ? text.slice(0, HISTORY_TEXT_LEN) + "..."
      : text
    lines.push("- " + who + ": " + shown)
  }
  if (lines.length > 0) {
    parts.push("最近对话：")
    for (const line of lines) parts.push(line)
  }
  return parts.join(NL)
}

function extract(text) {
  const start = text.indexOf(BEGIN)
  if (start < 0) return undefined
  const from = start + BEGIN.length
  const end = text.indexOf(END, from)
  const body = end > start ? text.slice(from, end) : text.slice(from)
  const out = body.trim()
  return out === "" ? undefined : out
}

function status($, text) {
  try {
    $.ui.status(text)
  } catch (err) {
    // A surface that cannot draw a status line is not an error.
  }
}

async function readContext($) {
  try {
    const cwd = await $.session.cwd()
    const messages = await $.session.messages()
    return buildContext(cwd, messages)
  } catch (err) {
    // No transcript, no context. Rewrite without it rather than fail.
    return ""
  }
}

async function resolveModel($) {
  try {
    const model = await $.session.model()
    if (typeof model === "string" && model !== "") return model
  } catch (err) {
    // fall through
  }
  return undefined
}

// `explicitDraft` comes from /qi-pm <text>; without it the box is the source.
async function rewrite($, explicitDraft) {
  let draft = typeof explicitDraft === "string" ? explicitDraft.trim() : ""

  if (!draft) {
    const box = await $.prompt.read()
    draft = box && typeof box.text === "string" ? box.text.trim() : ""
  }
  if (!draft) {
    status($, "qi-pm: 输入框是空的，也没有给参数")
    return
  }

  const model = await resolveModel($)
  if (!model) {
    status($, "qi-pm: 拿不到当前模型，无法改写")
    return
  }

  const context = await readContext($)
  status($, "qi-pm: 改写中…")

  let raw
  try {
    raw = await $.model.complete({
      model,
      system: SYSTEM,
      prompt: buildPrompt(draft, context),
      maxTokens: 2048,
    })
  } catch (err) {
    const why = err && err.message ? err.message : String(err)
    status($, "qi-pm: 模型调用失败 — " + why)
    return
  }

  const out = extract(raw)
  if (!out) {
    status($, "qi-pm: 输出里没有 " + BEGIN + " 标记")
    return
  }

  let filled
  try {
    filled = await $.prompt.fill({ text: out, mode: "replace" })
  } catch (err) {
    const why = err && err.message ? err.message : String(err)
    status($, "qi-pm: 写回输入框失败 — " + why)
    return
  }

  if (filled && filled.isFilled === false) {
    status($, "qi-pm: 输入框没有接受这次写入")
    return
  }

  const how = context ? "（已带上会话上下文）" : "（没有读到会话上下文）"
  status($, "qi-pm: 改写完成" + how + "，改完按 Enter 发送")
}

const COMMAND_NAME = "qi-pm"

export function register(on, options) {
  // Registering in session.start makes the command available from the first
  // turn. A taken name throws, and a throw here would skip the rest of this
  // hook, so it is wrapped.
  on("session.start", async ($, e, next) => {
    try {
      await $.command.register({
        name: COMMAND_NAME,
        description: "改写输入框里的草稿，结果回填等你确认",
        argumentHint: "[草稿]",
      })
    } catch (err) {
      const why = err && err.message ? err.message : String(err)
      status($, "qi-pm: 注册命令失败 — " + why)
    }
    return next(e)
  })

  // /qi-pm [草稿] — with no argument it rewrites what is in the box.
  on("command.run", { command: COMMAND_NAME }, async ($, e) => {
    await rewrite($, e.args)
    return {}
  }).catch(async ($, e, next) => {
    // command.run gates the command, so it carries a catch handler:
    // a throw here would otherwise leave the command without an answer.
    const failure = next.error
    const why = failure && failure.message
      ? failure.message
      : (failure ? failure.kind : "unknown")
    status($, "qi-pm: 命令失败 — " + why)
    return {}
  })

  // The band above the prompt. hotkey "p" works while the box is empty, so a
  // bare p then Enter is the fastest path.
  on("ui.render", { component: "AbovePrompt" }, async ($, e) => {
    const { Button } = $.ui.resolve(e)
    return Button({
      key: COMMAND_NAME,
      label: "改写",
      hotkey: "p",
      plain: true,
      onPress: () => rewrite($),
    })
  })
}
