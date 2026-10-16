// Tests for the pure functions behind the custom-endpoint path: URL joining,
// request building and response reading for the three protocols. They need
// no Claude Code running, only node --test.

import test from "node:test"
import assert from "node:assert/strict"

import { endpointFor, requestFor, textFrom, errorFrom, joinPath, authHeaders, buildPrompt, stripContext } from "../hooks/register.js"

const NL = String.fromCharCode(10)

const CONFIG = {
  protocol: "anthropic",
  baseUrl: "https://api.example.com",
  apiKey: "sk-test",
  model: "claude-sonnet-4-5",
}

test("endpointFor appends the protocol path to a bare host", () => {
  assert.equal(endpointFor("anthropic", "https://api.example.com"), "https://api.example.com/v1/messages")
  assert.equal(endpointFor("openai-chat", "https://api.example.com"), "https://api.example.com/v1/chat/completions")
  assert.equal(endpointFor("openai-responses", "https://api.example.com"), "https://api.example.com/v1/responses")
})

test("endpointFor folds trailing slashes and a /v1 base", () => {
  assert.equal(endpointFor("openai-chat", "https://api.example.com/"), "https://api.example.com/v1/chat/completions")
  assert.equal(endpointFor("openai-chat", "https://api.example.com/v1"), "https://api.example.com/v1/chat/completions")
  assert.equal(endpointFor("openai-chat", "https://api.example.com/v1/"), "https://api.example.com/v1/chat/completions")
})

test("endpointFor keeps a base that already names the full path", () => {
  assert.equal(endpointFor("anthropic", "https://api.example.com/v1/messages"), "https://api.example.com/v1/messages")
  assert.equal(endpointFor("openai-responses", "https://api.example.com/v1/responses/"), "https://api.example.com/v1/responses")
})

test("requestFor builds an Anthropic messages request", () => {
  const request = requestFor("anthropic", CONFIG, "the message")
  assert.equal(request.url, "https://api.example.com/v1/messages")
  assert.equal(request.headers["x-api-key"], "sk-test")
  assert.equal(request.headers["anthropic-version"], "2023-06-01")
  const body = JSON.parse(request.body)
  assert.equal(body.model, "claude-sonnet-4-5")
  assert.equal(body.max_tokens, 2048)
  assert.equal(body.system, undefined)
  assert.deepEqual(body.messages, [{ role: "user", content: "the message" }])
})

test("requestFor builds an OpenAI chat request", () => {
  const request = requestFor("openai-chat", CONFIG, "the message")
  assert.equal(request.url, "https://api.example.com/v1/chat/completions")
  assert.equal(request.headers.authorization, "Bearer sk-test")
  const body = JSON.parse(request.body)
  assert.deepEqual(body.messages, [{ role: "user", content: "the message" }])
})

test("requestFor builds an OpenAI responses request", () => {
  const request = requestFor("openai-responses", CONFIG, "the message")
  assert.equal(request.url, "https://api.example.com/v1/responses")
  assert.equal(request.headers.authorization, "Bearer sk-test")
  const body = JSON.parse(request.body)
  assert.equal(body.model, "claude-sonnet-4-5")
  assert.equal(body.input, "the message")
  assert.equal(body.instructions, undefined)
  assert.equal(body.max_output_tokens, 2048)
})

test("textFrom reads an Anthropic content array", () => {
  const json = {
    content: [
      { type: "text", text: "one" },
      { type: "thinking", thinking: "hidden" },
      { type: "text", text: " two" },
    ],
  }
  assert.equal(textFrom("anthropic", json), "one two")
  assert.equal(textFrom("anthropic", { content: [] }), undefined)
  assert.equal(textFrom("anthropic", {}), undefined)
})

test("textFrom reads an OpenAI chat completion", () => {
  assert.equal(textFrom("openai-chat", { choices: [{ message: { content: "hello" } }] }), "hello")
  assert.equal(textFrom("openai-chat", { choices: [] }), undefined)
  assert.equal(textFrom("openai-chat", {}), undefined)
})

test("textFrom reads an OpenAI responses payload", () => {
  assert.equal(textFrom("openai-responses", { output_text: "fast" }), "fast")
  const walked = {
    output: [
      { type: "reasoning" },
      { type: "message", content: [{ type: "output_text", text: "walked" }] },
    ],
  }
  assert.equal(textFrom("openai-responses", walked), "walked")
  assert.equal(textFrom("openai-responses", { output: [] }), undefined)
})

test("errorFrom reads the message out of each shape", () => {
  assert.equal(errorFrom({ error: { message: "bad key" } }), "bad key")
  assert.equal(errorFrom({ error: "plain" }), "plain")
  assert.equal(errorFrom({ message: "top level" }), "top level")
  assert.equal(errorFrom({}), undefined)
  assert.equal(errorFrom(undefined), undefined)
})

test("joinPath keeps the models path right on either base shape", () => {
  assert.equal(joinPath("http://127.0.0.1:8000", "/v1/models"), "http://127.0.0.1:8000/v1/models")
  assert.equal(joinPath("http://127.0.0.1:8000/v1", "/v1/models"), "http://127.0.0.1:8000/v1/models")
  assert.equal(joinPath("http://127.0.0.1:8000/v1/models/", "/v1/models"), "http://127.0.0.1:8000/v1/models")
})

test("authHeaders carries each protocol's credential", () => {
  const anthropic = authHeaders("anthropic", "sk-a")
  assert.equal(anthropic["x-api-key"], "sk-a")
  assert.equal(anthropic["anthropic-version"], "2023-06-01")
  const chat = authHeaders("openai-chat", "sk-b")
  assert.equal(chat.authorization, "Bearer sk-b")
  assert.equal(chat["x-api-key"], undefined)
})

test("buildPrompt orders header, context, template and draft", () => {
  const bare = buildPrompt("the draft", "")
  assert.ok(bare.startsWith("### REWRITE REQUEST ###"))
  assert.ok(bare.includes("### BEGIN RESPONSE ###"))
  assert.ok(bare.endsWith("[Draft]" + NL + "the draft"))
  assert.ok(!bare.includes("[Context]"))

  const withContext = buildPrompt("the draft", "项目目录：D:/x")
  const ctxAt = withContext.indexOf("[Context]" + NL + "项目目录：D:/x")
  const rulesAt = withContext.indexOf("### BEGIN RESPONSE ###")
  const draftAt = withContext.indexOf("[Draft]" + NL + "the draft")
  assert.ok(ctxAt >= 0)
  assert.ok(rulesAt > ctxAt)
  assert.ok(draftAt > rulesAt)
})

test("stripContext drops an echoed context block and nothing else", () => {
  const context = "项目目录：D:/x"
  const echoed = "[Context]" + NL + context + NL + NL + "rewritten"
  assert.equal(stripContext(echoed, context), "rewritten")
  assert.equal(stripContext("rewritten", context), "rewritten")
  assert.equal(stripContext(echoed, ""), echoed)
  assert.equal(stripContext("[Context]", context), "[Context]")
})
