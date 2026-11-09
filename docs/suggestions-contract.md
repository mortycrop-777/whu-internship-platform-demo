# 实习助手空态推荐 · 接口与交互约定

状态：草案（v1）。当前原型使用前端静态目录 `prototype-v2/chat-suggestions.js` 的 `defaultCatalog`；接入服务端时按本文档实现即可，前端已预留兼容字段与降级路径。

## 1. 推荐项 schema

```json
{
  "version": 1,
  "scene": "student_home",
  "id": "prepare-internship",
  "kind": "prompt",
  "title": "准备实习",
  "subtitle": "了解实习前需要准备的材料与心态",
  "prompt": "实习前我需要准备什么？",
  "icon": "briefcase",
  "accent": "blue",
  "weight": 1,
  "badge": ""
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `version` | int | schema 版本，当前 1；未知值由前端回落为 1 |
| `scene` | string | 场景标识，学生首页为 `student_home` |
| `id` | string | 场景内唯一，用于埋点与「换一批」去重；缺省时前端按标题+prompt 生成稳定 id |
| `kind` | `prompt` \| `action` \| `link` | 点击行为类型；缺失时按 `prompt`/`action`/`url` 推断 |
| `title` | string（必填） | 卡片标题，≤60 字 |
| `subtitle` | string | 卡片副标题，≤120 字，前端两行截断 |
| `prompt` | string | `kind=prompt` 必填，点击后填入输入框（不自动发送） |
| `action` | object | `kind=action` 必填，见下节 |
| `url` | string | `kind=link` 必填，仅允许 `http(s)://` |
| `icon` | string | 图标枚举：`briefcase`/`doc`/`search`/`clock`/`flag`/`star`/`grid`/`users`/`spark`/`history`/`compass`/`pen`/`list`；未知值回退 `spark` |
| `accent` | string | 主题色枚举：`blue`/`teal`/`amber`/`violet`/`sky`/`green`；未知值回退 `blue` |
| `weight` | number | 服务端排序权重，前端当前不依赖 |
| `badge` | string | 可选角标文字，≤16 字 |

前端 `normalizeSuggestion(raw)` 会丢弃不安全/不完整的项（无标题、prompt/action/url 与 kind 不匹配等），任何字段渲染前都经过 `safeText`/`esc` 转义。

## 2. 接口草案

```
GET /api/suggestions?scene=student_home&limit=3&seed=0
```

响应：

```json
{
  "version": 1,
  "scene": "student_home",
  "seed": 0,
  "nextSeed": 1,
  "items": [ { "id": "...", "kind": "prompt", "title": "...", "subtitle": "...", "prompt": "...", "icon": "briefcase", "accent": "blue" } ]
}
```

- `limit`：期望条数，默认 3，上限建议 6。
- `seed`：批次种子；同一个 seed 应返回同一批（可复现），客户端「换一批」递增 seed 并携带上一批 id（客户端内部用于去重，服务端可接受可选 `exclude` 参数，未定稿）。
- 响应中 `version`/`scene` 与请求不一致时，前端以请求值兜底。
- 允许返回少于 `limit` 条；前端回退到静态目录补足。

## 3. 动作类型

| kind / action.type | 结构 | 前端行为 |
| --- | --- | --- |
| `prompt` | `prompt` 文本 | 填入输入框并聚焦，**不发送**；输入框边框闪一次主题色 |
| `action.type = "navigate"` | `{ "type": "navigate", "path": "/student/volunteer" }` | `location.hash = '#' + path`，走现有 hash 路由（`/student/volunteer`、`/student/internship` 等，见 README 页面路由） |
| `action.type = "toast"` | `{ "type": "toast", "message": "暂未开放" }` | `toast(message)` |
| 其他 action.type | `{ "type": "future_action", ... }` | 暂统一 `toast('该入口暂未开放')`，后续在 `activateSuggestion` 中注册处理逻辑 |
| `link` | `url` | `window.open(url, '_blank', 'noopener')`，仅 http(s) |

跨板块动作的注册方式：服务端只下发 `action.type/path`，前端 `activateSuggestion(resolved)` 负责分发；新增跳转目标只需保证 `path` 是 README 中已存在的路由（`#/student/volunteer` 等），新增动作类型时在前端补充对应分支并保留未知类型 toast 兜底。

## 4. 前端降级与批次策略

- 当前原型：首屏固定展示 `defaultCatalog` 的前 3 个 prompt 卡（准备实习 / 整理经历 / 探索方向），不混入 action 卡；点击「换一批」后改用 `pickBatch(catalog, {size:3, seed})` 种子洗牌，并通过 `excludeIds` 尽量避免与上一批重复（6 条中取 3 条），从第二批起才可能出现 action 卡。
- 接入服务端后的降级：`fetch('/api/suggestions?...', {signal: AbortSignal.timeout(800)})`；超时、非 2xx、JSON 不合法或返回 0 条时回退静态 `defaultCatalog`，不阻塞首页渲染。
- 缓存：同一 `scene` 的最近一批可短期缓存（session 级），跨页面返回首页不重复播放入场动画（`suggestionsEntrancePlayed` 模块级标记）；「换一批」独立使用淡出/进入动画。

## 5. 埋点

点击任何卡片时，前端在 `window` 上派发：

```js
window.dispatchEvent(new CustomEvent('assistant-suggestion', {
  detail: { id, kind, position, scene: 'student_home' }
}));
```

- `kind` 为 `prompt` / `action` / `link`（即 `resolveSuggestion` 的 `type`）。
- `position` 为卡片在当批中的序号（0 起）。
- 默认无监听即静默；接入统计时监听该事件即可，无需改动卡片实现。

## 6. 安全与兼容

- 所有标题/副标题/提示文本经 `safeText` 转义；`data-suggestion-id` 等属性经 `esc`。
- `link` 仅允许 `http(s)`；`action.path` 必须以 `/` 开头，防止 `javascript:` 等伪协议。
- schema 新增字段为向后兼容的可选项；未知 `icon`/`accent` 回退默认值，未知 `action.type` 回退 toast 提示。
- 不改变输入框、附件上传、历史抽屉等既有交互。
