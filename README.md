# qi-pm

一个 Claude Code mod：用旁路模型改写输入框里的草稿，结果回填到输入框，由你决定改不改、发不发。

## 它做什么

1. 你在输入框里敲一个草稿
2. 按提示词上方 band 里的「改写」按钮（空输入框里也可以直接按 `p`）
3. 它读草稿，带上最近的会话上下文，调一次旁路模型改写
4. 改写结果**写回输入框**，不发送
5. 你改完按 Enter 才发出去

主对话看不到这次改写，除非你按了 Enter。

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
| `$.prompt.read()` | 读输入框草稿，返回 `{text, cursor}` |
| `$.session.model()` | 当前主模型，用作改写模型 |
| `$.session.messages()` | 会话转录，取最近 10 条做上下文 |
| `$.session.cwd()` | 当前工作目录 |
| `$.model.complete()` | 旁路模型调用，不碰主对话 |
| `$.prompt.fill()` | 写回输入框，不发送 |
| `$.ui.status()` | 提示词下方的状态行 |

## 提示词模板的硬约束

system prompt 里有几条：

- 只输出 `<enhanced-prompt>` 和 `</enhanced-prompt>` 之间的内容
- 不用工具、不提问
- 保持原语言
- **原样保留文件路径、符号、命令、参数、报错文本**
- 代码块和行内代码不动
- 不添加草稿里没有的要求

中间两条是为 Claude Code 场景专门加的：这里的提示词经常带路径和命令，而且往往不带反引号，改错了很麻烦。

## 上下文怎么取

参考了 dsh 的 wukong 插件，但比它省事：wukong 要自己实现读会话，这个 mod 直接调 `$.session.messages()`。

- 取最近 10 条消息，每条压成一行、截断 1500 字符
- 加上当前工作目录
- **读不到就降级**，不带上下文改写，而不是失败

## 已知边界

- 改写模型固定用当前主模型，还不能配自定义端点
- 没有 key 配置，因为只用主模型
- 只在能绘制的界面里工作（终端、桌面端、VS Code 扩展）
- `$.model.complete` 的返回值签名以本机生成的类型为准：官方文档说返回对象，GitHub 上的 d.ts 说返回 `Promise<string>`，本文件按后者写

## 许可

MIT
