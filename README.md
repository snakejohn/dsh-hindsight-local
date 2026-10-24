# dsh-hindsight-memory

把本地 [Hindsight](https://github.com/vectorize-io/hindsight) 记忆服务接进 DeepSeek Harness (dsh)，让 AI **记住你们聊过的事**：对话自动归档，需要时按需召回，旧历史会被折叠，用长期记忆换上下文 Token。

📖 [小白使用文档（带截图）](docs/使用文档.md) · 🛠 [技术说明](docs/技术说明.md) · ⬇️ [下载最新版](https://github.com/snakejohn/dsh-hindsight-local/releases)

## 核心功能

- **三步设置、一键部署**：粘贴一个硅基流动密钥即可。插件会自动准备 Python 和 Hindsight，不用打开命令行。
- **自动记忆 + 按需召回**：每轮对话都会写进记忆库；提问时会召回相关记忆并注入上下文，支持「今天早上 7 点」这类时间问题。
- **跟随 dsh 的模型**：整理记忆的 LLM 默认和 dsh 用同一个模型。
- **绝不阻塞对话**：服务异常、超时、限流时会降级为「无记忆」，对话照常进行。
- **控制面板**：可以查看服务状态、各记忆库数量、记住进度，还能浏览和搜索记忆，查看最近写入和失败写入。

## 安装

在 dsh 左侧点「Plugins」→「+ Add plugin」，然后任选一种方式：

- **A. 从 GitHub 安装（推荐）**：粘贴 `https://github.com/snakejohn/dsh-hindsight-local`，点「Install」。
- **B. 从本地文件夹安装**：在 [Releases](https://github.com/snakejohn/dsh-hindsight-local/releases) 下载 zip 并解压，把文件夹的完整路径填进去，点「Install」。

装好后按 [使用文档](docs/使用文档.md) 完成首次设置。

> ⚠️ 目前只在 Linux 上完整测试过，Windows / macOS 还没有真机验证。

## 许可证

[MIT](LICENSE)
