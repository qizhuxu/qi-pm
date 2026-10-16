# qi-pm

一个 Claude Code mod：用旁路模型改写输入框里的草稿，结果回填到输入框，由你决定改不改、发不发。

## 它做什么

1. 你在输入框里敲一个草稿
2. 按提示词上方 band 里的「改写」按钮（空输入框里也可以直接按 `p`）
3. 它读草稿，调一次旁路模型改写
4. 改写结果**写回输入框**，不发送
5. 你改完按 Enter 才发出去

主对话看不到这次改写，除非你按了 Enter。

默认走 Claude Code 自己的主模型，也可以指向你自己的端点，见下面「配置」。

## 配置

`/qi-pm-config`，或 band 里的「设置」按钮（空输入框里按 `s`），打开设置面板：

| 项 | 说明 |
|---|---|
| 协议 | 主模型（默认）/ Anthropic `/v1/messages` / OpenAI `/v1/chat/completions` / OpenAI `/v1/responses` |
| 端点 | base URL。可带 `/v1`，也可直接贴完整路径，两种都能拼对 |
| 密钥 | 只在面板里写入，从不回显；提交空值不会覆盖已存的密钥 |
| 模型 | 发给端点的模型名。点「拉取模型」会从端点的 `/v1/models` 拉一份列表，直接选 |

四项齐全才走自定义端点；缺任何一项都回退主模型，不会失败。模型 id 区分大小写，拿不准就点「拉取模型」从列表里选。

关于密钥：存在 Claude Code 给本插件的本地存储里（`$.store`），只在调用时发给你配置的那个端点。状态行、toast、日志里都不会出现它。

## 和 settings hook 的区别

settings hook 只能往上下文里注入旁白，用户看不见，也改不了输入框。这个 mod 跑在 Claude Code 进程内，能读输入框、能写回、能画界面。

## 安装

从 marketplace：

```
/plugin install qi-pm --marketplace <owner>/<repo>
```

开发时加载本地目录（支持热重载）：

```bash
claude --plugin-dir D:/AI/BeAnything/cc-mod-qiqm
```

装好后 `/plugin` 的 Installed 页会显示 mod 计数。

## 用到的 API

| 调用 | 作用 |
|---|---|
| `$.prompt.read()` | 读输入框草稿 |
| `$.prompt.fill()` | 写回输入框，不发送 |
| `$.model.fork()` | 主模型路径：重放主线程最后一次请求 |
| `$.model.complete()` | 主模型的兜底：会话还没有历史时用 |
| `$.http.fetch()` | 自定义端点路径：发 HTTP 请求 |
| `$.session.messages()` / `$.session.cwd()` | 会话上下文（自定义端点路径用） |
| `$.store` | 设置的持久化 |
| `$.ui.open()` / `$.ui.close()` / `$.ui.panes()` | 设置面板 |
| `$.ui.status()` / `$.ui.toast()` / `$.ui.invalidate()` | 状态行、提示、面板重绘 |
| `$.command.register()` | 注册 `/qi-pm` 和 `/qi-pm-config` |

## 主模型路径为什么先走 fork

`$.model.complete()` 按设计发的是轻量请求：没有工具定义、没有历史。**只放行 Claude Code 请求的中转站会拒绝它**（实测 HTTP 503）。

`$.model.fork()` 把主线程最后一次请求原样重放：同一个模型、同一份 system prompt、同一套工具定义、同一段消息历史，只在末尾追加一条用户消息（改写指令 + 草稿）。请求特征和主对话一致，而且能命中提示词缓存。

只有一个情况退回 complete：`nothing-to-fork`，即主线程还没产生过回复（全新会话或刚 `/clear`），没有前缀可重放。

如果中转站连 fork 也拒绝，就用自定义端点绕开它。

## 提示词模板的硬约束

system prompt（fork 路径下是那条用户消息的开头）里有几条：

- 草稿在 `[Draft]` 行之后，之前的都是上下文，只给模型看
- 只输出 `<enhanced-prompt>` 和 `</enhanced-prompt>` 之间的内容，不带上文块和标记本身
- 不用工具、不提问、不解释
- 保持原语言
- **原样保留文件路径、符号、命令、参数、报错文本**
- 代码块和行内代码不动
- 不添加草稿里没有的要求

中间两条是为 Claude Code 场景专门加的：这里的提示词经常带路径和命令，而且往往不带反引号，改错了很麻烦。

## 上下文怎么取

- 主模型路径：fork 自带完整会话历史，不需要另取
- 自定义端点路径：参考 dsh 的 wukong 插件，取最近 10 条消息，每条压成一行、截断 1500 字符，加上当前工作目录；读不到就降级为不带上下文，而不是失败
- 改写模型偶尔会把上下文块照抄进答案里，代码在回填前会把它剥掉（`stripContext`）

## 测试

```bash
npm test
```

`node --test`，覆盖三个协议的请求构造、端点拼接与响应解析。都是纯函数，不需要 Claude Code 运行。

## 已知边界

- 只在能绘制的界面里工作（终端、桌面端、VS Code 扩展）；手机端面板只显示摘要，不能编辑
- 自定义端点直连，能不能用取决于服务商对三种协议的兼容程度
- `$.model.complete` 的返回值在不同版本里形状不同（对象或字符串），代码两种都接受
- 自定义端点的请求没有超时控制，服务端不响应时状态行会停在「改写中…」

## 类型从哪来

首次用 `--plugin-dir` 加载时，Claude Code 会把权威类型写到 `.claude-plugin/types/claude-code/index.d.ts`。

这是**你这台机器的版本**的真实签名。官方明说 GitHub 上那份可能更旧，两者冲突时以本机生成的为准。

它已经解决了本项目的几个不确定点：

- `$.model.complete` 返回 `ModelCompleteResult`，一个联合类型：成功分支带 `isAnswered: true` 和 `text`，拒绝分支带 `isAnswered: false` 和 `reason`。GitHub 上的 d.ts 说 `Promise<string>`，那是旧版。
- `$.session.model()` 返回主循环的模型，`/model` 显示的那个。
- `$.model.fork` 的请求体是「主线程最后一次请求 + 一条用户消息」，工具全部 deny。
- `$.http.fetch` 走宿主网络，返回 `{status, ok, headers, text}`，插件自己不碰网络。
- `$.ui.open` 开面板，`ui.render` 用 `{component: "Pane", requestId: <id>}` 匹配到它。

这些生成文件不进 git：`types/` 目录自带一个内容为 `*` 的 `.gitignore`，根 `tsconfig.json` 也已加入忽略。

## 许可

MIT
