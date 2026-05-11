# n8n-nodes-volcengine-next

[![npm version](https://img.shields.io/npm/v/n8n-nodes-volcengine-next)](https://www.npmjs.com/package/n8n-nodes-volcengine-next)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

n8n community node — **Volcengine Ark (火山方舟) Doubao Chat Model**，通过 OpenAI 兼容接口接入豆包系列大模型，支持 Thinking 模式与工具调用。

## 节点说明

| 节点 | 类型 | 说明 |
|------|------|------|
| Volcengine Ark Chat Model (Next) | AI Language Model | 接入 n8n AI Agent / AI Chain 使用 |

## 安装

在 n8n 设置 → Community Nodes 中搜索并安装：

```
n8n-nodes-volcengine-next
```

或通过 npm 手动安装（自托管）：

```bash
npm install n8n-nodes-volcengine-next
```

## 凭据配置

在 n8n 凭据页面新建 **Volcengine Ark API (Next)**，填入：

| 字段 | 说明 |
|------|------|
| API Key | 火山方舟控制台 → API Key 管理 中获取 |
| Base URL | 默认 `https://ark.cn-beijing.volces.com/api/v3`，如使用其他区域可修改 |

> 获取 API Key：[控制台 API Key 管理](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey)

## 支持的模型

节点会自动从 `/models` 端点动态加载可用模型；若接口不可达，以下静态列表作为兜底：

| 模型 ID | 说明 |
|---------|------|
| `doubao-seed-2-0-pro-260215` | Doubao Seed 2.0 Pro（默认） |
| `doubao-seed-2-0-lite-260215` | Doubao Seed 2.0 Lite |
| `doubao-seed-1-6-251015` | Doubao Seed 1.6 标准版 |
| `doubao-seed-1-6-thinking-250715` | Doubao Seed 1.6 Thinking（支持深度推理） |
| `doubao-seed-1-6-flash-250828` | Doubao Seed 1.6 极速版 |
| `doubao-seed-1-6-lite-251015` | Doubao Seed 1.6 轻量版 |
| `doubao-pro-32k` | Doubao Pro 32K |
| `doubao-lite-32k` | Doubao Lite 32K |

## Options 选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| Thinking Mode | Disabled / Enabled | Disabled | 启用后模型输出 `reasoning_content`（推理过程）；需使用 thinking 类模型 |
| Stream | boolean | true | 是否流式输出；AI Agent 场景保持开启 |
| Parallel Tool Calls | boolean | false | 是否允许并行工具调用；关闭可控制 Agent 迭代消耗 |
| Sampling Temperature | number 0–2 | 0.7 | 采样温度 |
| Top P | number 0–1 | 1 | 核采样阈值 |
| Frequency Penalty | number -2~2 | 0 | 频率惩罚（抑制重复） |
| Presence Penalty | number -2~2 | 0 | 存在惩罚（鼓励新话题） |
| Maximum Number of Tokens | number | -1 | 最大输出 token 数；-1 使用模型默认值 |
| Response Format | Text / JSON Object | Text | JSON 格式时请在 Prompt 中包含 "json" 关键词 |
| Timeout (ms) | number | 360000 | 请求超时时间（毫秒） |
| Max Retries | number | 2 | 最大重试次数 |
| Additional Model Arguments | JSON | — | 传递给 Ark API 的额外参数（浅合并到 modelKwargs） |

## 关于 Thinking 模式

Thinking 模式适用于需要复杂推理的任务（数学、代码分析、多步骤规划等）。

- 启用 Thinking 模式时，temperature / top_p 等采样参数对推理阶段无效。
- 推荐使用 `doubao-seed-1-6-thinking` 或 Seed 2.0 系列模型。
- 当 Thinking 模式**禁用**时，节点会自动将 `reasoning_content` 流式增量镜像到普通 assistant text，确保 n8n AI Agent 能正常聚合输出。
- 多轮工具调用场景下，节点会自动将上一轮的 `reasoning_content` 注入到后续请求，符合火山方舟 API 要求。

## 官方文档

- [火山方舟 OpenAI 兼容接口](https://www.volcengine.com/docs/82379/1330626)
- [模型列表](https://www.volcengine.com/docs/82379/1330310)
- [API Key 管理](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey)
