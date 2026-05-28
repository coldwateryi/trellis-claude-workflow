# Trellis Workflow 模板

可复用的 Claude Code Workflow 脚本，与 Trellis 任务管理系统深度集成。

## 可用模板

### trellis-parallel-implement

从 Trellis 任务的 `implement.md` 中提取独立模块，并行实现。

**适用场景：** Phase 2（Execute）有 2+ 个互不依赖的实现步骤。

**调用方式：**

```javascript
Workflow({
  name: 'trellis-parallel-implement',
  args: {
    taskPath: '.trellis/tasks/05-28-api-i18n',
    modules: [
      { key: 'middleware', desc: '请求语言检测中间件' },
      { key: 'response', desc: '响应包装层 i18n key 替换' },
      { key: 'errors', desc: '错误消息国际化' },
    ],
    worktree: true,       // 可选，默认 3+ 模块时启用
    verifyCmd: 'npm test' // 可选，自定义验证命令
  }
})
```

**行为：**
- 使用 `pipeline()` — 每个模块实现完立即验证，不等其他模块
- `isolation: 'worktree'` 防止并行 agent 之间的文件冲突
- 每个 agent 通过 `implement.jsonl` 获取 Trellis 上下文
- 返回 `{total, passed, failed, modules}` 供主循环决策

---

### trellis-parallel-research

多方向研究扇出，合成为决策报告。

**适用场景：** Phase 1.2（Research）探索多个技术方向。

**调用方式：**

```javascript
Workflow({
  name: 'trellis-parallel-research',
  args: {
    taskPath: '.trellis/tasks/05-28-api-i18n',
    questions: [
      { key: 'lib', question: '2026 年 Node.js 最佳 i18n 库？' },
      { key: 'format', question: 'ICU vs gettext vs 自定义格式？' },
      { key: 'perf', question: '运行时翻译查找的性能影响？' },
    ],
    outputFile: 'research/i18n-decisions.md' // 可选
  }
})
```

**行为：**
- 使用 `parallel()` + barrier — 合成需要所有研究结果
- 每个研究 agent 使用 `trellis-research` agentType
- 最终合成 agent 写出决策报告
- 返回 `{findings, synthesis, outputFile}`

---

### trellis-dag-implement

按拓扑排序的波次顺序执行有依赖关系的子任务。

**适用场景：** `/trellis-zero-to-mvp-zh` 创建的父子任务树，子任务之间存在依赖。

**调用方式：**

```javascript
Workflow({
  name: 'trellis-dag-implement',
  args: {
    parentPath: '.trellis/tasks/05-28-hub-user-system',
    tasks: [
      { key: '01-user-model',      path: '...children/01-user-model',      deps: [] },
      { key: '02-auth-service',    path: '...children/02-auth-service',    deps: ['01-user-model'] },
      { key: '03-session-mw',     path: '...children/03-session-middleware', deps: ['02-auth-service'] },
      { key: '04-user-api',       path: '...children/04-user-api',        deps: ['01-user-model', '02-auth-service'] },
      { key: '05-user-ui',        path: '...children/05-user-ui',         deps: ['04-user-api', '03-session-mw'] },
    ],
    stopOnFail: true,
    worktree: true
  }
})
```

**行为：**
- 运行时自动拓扑排序，检测循环依赖
- 同波次内 `parallel()` + worktree 隔离
- 波次间顺序执行（天然 barrier）
- 失败时中断下游波次
- 全部通过后跨模块集成检查
- 返回 `{waves, completed, total, halted, allPassed, results}`

---

## 模板选型指南

| 场景 | 模板 | 原因 |
|------|------|------|
| 独立模块，无依赖 | `trellis-parallel-implement` | pipeline 最快 |
| 有 DAG 依赖的任务树 | `trellis-dag-implement` | 拓扑分波 + 波内并行 |
| 多方向技术调研 | `trellis-parallel-research` | barrier + 合成 |
| 单个复杂任务 | 直接用 `trellis-implement` | 不需要 workflow |

---

## 端到端场景：从 `/trellis-zero-to-mvp-zh` 到 Workflow 执行

### 场景：团队 Hub 用户系统 MVP

#### Step 1: 用 skill 拆分任务

```
用户: [粘贴 PRD]
      /trellis-zero-to-mvp-zh
```

Skill 产出任务树：

```
.trellis/tasks/05-28-hub-user-system/
├── prd.md                              (总 PRD + 需求追踪矩阵)
├── children/
│   ├── 01-user-model/          deps: []
│   ├── 02-auth-service/        deps: [01-user-model]
│   ├── 03-session-middleware/  deps: [02-auth-service]
│   ├── 04-user-api/            deps: [01-user-model, 02-auth-service]
│   └── 05-user-ui/             deps: [04-user-api, 03-session-middleware]
```

#### Step 2: 用户确认后，触发 workflow

```
用户: 任务树确认没问题，用 workflow 按依赖顺序实现所有子任务
```

#### Step 3: 主循环构建 args 并调用

主循环读取任务树的依赖关系，构建调用参数：

```javascript
Workflow({
  name: 'trellis-dag-implement',
  args: {
    parentPath: '.trellis/tasks/05-28-hub-user-system',
    tasks: [
      { key: '01-user-model',
        path: '.trellis/tasks/05-28-hub-user-system/children/01-user-model',
        deps: [] },
      { key: '02-auth-service',
        path: '.trellis/tasks/05-28-hub-user-system/children/02-auth-service',
        deps: ['01-user-model'] },
      { key: '03-session-middleware',
        path: '.trellis/tasks/05-28-hub-user-system/children/03-session-middleware',
        deps: ['02-auth-service'] },
      { key: '04-user-api',
        path: '.trellis/tasks/05-28-hub-user-system/children/04-user-api',
        deps: ['01-user-model', '02-auth-service'] },
      { key: '05-user-ui',
        path: '.trellis/tasks/05-28-hub-user-system/children/05-user-ui',
        deps: ['04-user-api', '03-session-middleware'] },
    ],
    stopOnFail: true,
    worktree: true
  }
})
```

#### Step 4: Workflow 内部自动计算波次

```
拓扑排序结果：
  Wave 1: [01-user-model]                                ← 无依赖
  Wave 2: [02-auth-service]                              ← 依赖 01 ✓
  Wave 3: [03-session-middleware, 04-user-api]           ← 并行
  Wave 4: [05-user-ui]                                   ← 依赖 03+04
```

执行时序：

```
时间 →
Wave 1: [===01-user-model===] ✓
Wave 2: [====02-auth-service====] ✓
Wave 3: [==03-session-mw==] ✓  [===04-user-api===] ✓    ← 并行
Wave 4: [=====05-user-ui=====] ✓
```

#### Step 5: 每个 subagent 收到的 prompt

以 Wave 3 中的 `04-user-api` 为例：

```
Active task: .trellis/tasks/05-28-hub-user-system/children/04-user-api
Read the task's implement.jsonl and prd.md for full context.
This task depends on: 01-user-model, 02-auth-service.
Those dependencies are already implemented and verified.

Implement this task fully. Follow existing code patterns. Write unit tests.
After implementation, run type-check and tests to verify correctness.
Return the files changed, test results, and a summary.
```

Agent 类型 `trellis-implement` 会自动：
1. 读取 `implement.jsonl` → 文件列表和角色上下文
2. 读取 `prd.md` → 验收标准
3. 读取 `design.md`（如有）→ 技术设计约束
4. 读取 `implement.md` → 具体实现步骤
5. 实现代码 + 写测试 + 跑验证
6. 返回结构化结果

#### Step 6: 失败处理

假设 Wave 3 中 `04-user-api` 测试失败：

```javascript
// Workflow 返回:
{
  waves: 4,
  completed: 4,
  total: 5,
  halted: true,       // stopOnFail 生效，Wave 4 未执行
  allPassed: false,
  results: {
    "01-user-model": { passed: true, summary: "..." },
    "02-auth-service": { passed: true, summary: "..." },
    "03-session-middleware": { passed: true, summary: "..." },
    "04-user-api": { passed: false, issues: ["TypeError: AuthService.verify is not a function"] },
  }
}
```

用户此时可以说：

```
用户: 修复 04-user-api 的问题然后继续 workflow 执行剩余任务
```

主循环修复后，只需执行剩余部分（deps 清空，因为依赖已完成）：

```javascript
Workflow({
  name: 'trellis-dag-implement',
  args: {
    parentPath: '.trellis/tasks/05-28-hub-user-system',
    tasks: [
      { key: '05-user-ui',
        path: '.trellis/tasks/.../children/05-user-ui',
        deps: [] }
    ],
    stopOnFail: true
  }
})
```

---

### 完整用户交互摘要

```
用户: [粘贴 PRD]  /trellis-zero-to-mvp-zh    → 拆分任务树
用户: 确认，用 workflow 实现                    → 调用 trellis-dag-implement
用户: (如有失败) 修复后继续 workflow            → 剩余波次继续
用户: 全部通过，提交                            → commit + 更新状态
```

---

## 设计原则

### 为什么 pipeline() 是默认选择

```
pipeline: 完成即进入下一阶段         parallel+barrier: 等所有完成才继续
┌─────────────────────────────┐   ┌─────────────────────────────┐
│ A: [impl][verify] ✓         │   │ A: [impl]---wait---[verify] │
│ B: [==impl==][verify] ✓     │   │ B: [==impl==]wait--[verify] │
│ C: [impl][verify] ✓         │   │ C: [impl]---wait---[verify] │
└─────────────────────────────┘   └─────────────────────────────┘
 wall-clock = max(单条链)           wall-clock = sum(各阶段最慢)
```

仅在以下情况使用 `parallel()` barrier：
- 合成需要所有结果的交叉上下文（研究 → 合并）
- 需要跨结果去重后再进入昂贵的下游阶段
- 总数为 0 时提前退出

### Trellis 上下文注入

每个 subagent prompt 以 `Active task: ${taskPath}` 开头。
`trellis-implement` / `trellis-check` 据此找到：
- `implement.jsonl` — 文件列表和角色上下文
- `prd.md` — 验收标准
- `design.md` — 架构约束

### Worktree 隔离

使用 `isolation: 'worktree'` 当：
- 3+ 个 agent 同时写文件
- Agent 修改重叠目录
- 需要按模块原子回滚

不需要 worktree 当：
- Agent 只读（研究、审查）
- 单 agent 顺序执行
- 变更文件互不重叠

### 职责分工

| 环节 | 负责方 | 原因 |
|------|--------|------|
| 依赖图定义 | `/trellis-zero-to-mvp-zh` | 规划时确定 |
| 依赖图 → args | 主循环 | 读取 task 元数据提取 |
| 拓扑排序 | `trellis-dag-implement` | 运行时自动计算 |
| 单任务实现 | `trellis-implement` agent | 每个 agent 只管自己 |
| 失败决策 | 主循环 + 用户 | workflow 报告，人决策 |
| 状态持久化 | Trellis `task.py` | workflow 后更新状态 |

---

## 自定义 Workflow

复制模板后修改。核心规则：

1. `meta` 必须是纯字面量（无变量、无插值）
2. 所有运行时参数通过 `args` 传入
3. 每个 `agent()` prompt 以 `Active task: ${taskPath}` 开头
4. 使用 `schema` 获取结构化输出，不要解析字符串
5. 使用 `log()` 提供进度可见性
6. 返回摘要对象供主循环决策

---

## 实战样例：RuoYi-Vue + AI 大模型聊天功能

### 项目背景

基于 RuoYi-Vue 前后端分离框架，开发 AI 大模型聊天功能，包含：
1. 模型 API 密钥维护（CRUD + 密钥脱敏展示）
2. API 连通性测试（支持 OpenAI/Claude/本地模型）
3. 创建新对话 + 多轮对话 + 流式输出
4. 对话历史管理（列表、删除、收藏）

### 前提：项目 Spec 结构

通过 `trellis init` 生成的 spec 目录：

```
.trellis/spec/
├── guides/
│   └── index.md                    ← 通用编码规范
├── backend/
│   ├── index.md                    ← 后端 spec 入口
│   ├── ruoyi-conventions.md        ← RuoYi 后端约定
│   ├── api-design.md               ← RESTful API 设计规范
│   └── mybatis-patterns.md         ← MyBatis-Plus 使用模式
├── frontend/
│   ├── index.md                    ← 前端 spec 入口
│   ├── vue-conventions.md          ← Vue3 + Element Plus 组件规范
│   ├── api-layer.md                ← 前端 API 调用层约定
│   └── store-patterns.md           ← Pinia/Vuex 状态管理模式
└── unit-test/
    └── index.md                    ← 测试规范
```

### 用户交互流程

#### Step 1: 提供需求，触发任务拆分

```
用户: 我需要基于 RuoYi-Vue 框架开发一个 AI 大模型聊天功能，包含：
      1. 模型 API 密钥维护（CRUD + 密钥脱敏展示）
      2. API 连通性测试（支持 OpenAI/Claude/本地模型）
      3. 创建新对话 + 多轮对话 + 流式输出
      4. 对话历史管理（列表、删除、收藏）
      
      /trellis-zero-to-mvp-zh
```

Skill 产出任务树：

```
.trellis/tasks/05-28-ai-chat-mvp/
├── prd.md
├── children/
│   ├── 01-model-api-backend/       deps: []
│   ├── 02-model-api-frontend/      deps: [01-model-api-backend]
│   ├── 03-chat-engine-backend/     deps: [01-model-api-backend]
│   ├── 04-chat-ui-frontend/        deps: [03-chat-engine-backend]
│   └── 05-history-fullstack/       deps: [03-chat-engine-backend, 04-chat-ui-frontend]
```

#### Step 2: 用户确认并指定 spec 注入策略

```
用户: 任务树确认。用 workflow 实现，注意：
      - 后端任务必须遵循 .trellis/spec/backend/ 下的所有规范
      - 前端任务必须遵循 .trellis/spec/frontend/ 下的所有规范
      - 所有任务都要遵循 .trellis/spec/guides/index.md 通用规范
```

#### Step 3: 主循环构建 workflow 调用

```javascript
Workflow({
  name: 'trellis-dag-implement',
  args: {
    parentPath: '.trellis/tasks/05-28-ai-chat-mvp',
    globalSpecs: ['.trellis/spec/guides/index.md'],
    tasks: [
      {
        key: '01-model-api-backend',
        path: '.trellis/tasks/05-28-ai-chat-mvp/children/01-model-api-backend',
        deps: [],
        specs: [
          '.trellis/spec/backend/index.md',
          '.trellis/spec/backend/ruoyi-conventions.md',
          '.trellis/spec/backend/api-design.md',
          '.trellis/spec/backend/mybatis-patterns.md',
        ]
      },
      {
        key: '02-model-api-frontend',
        path: '.trellis/tasks/05-28-ai-chat-mvp/children/02-model-api-frontend',
        deps: ['01-model-api-backend'],
        specs: [
          '.trellis/spec/frontend/index.md',
          '.trellis/spec/frontend/vue-conventions.md',
          '.trellis/spec/frontend/api-layer.md',
        ]
      },
      {
        key: '03-chat-engine-backend',
        path: '.trellis/tasks/05-28-ai-chat-mvp/children/03-chat-engine-backend',
        deps: ['01-model-api-backend'],
        specs: [
          '.trellis/spec/backend/index.md',
          '.trellis/spec/backend/ruoyi-conventions.md',
          '.trellis/spec/backend/api-design.md',
        ]
      },
      {
        key: '04-chat-ui-frontend',
        path: '.trellis/tasks/05-28-ai-chat-mvp/children/04-chat-ui-frontend',
        deps: ['03-chat-engine-backend'],
        specs: [
          '.trellis/spec/frontend/index.md',
          '.trellis/spec/frontend/vue-conventions.md',
          '.trellis/spec/frontend/store-patterns.md',
        ]
      },
      {
        key: '05-history-fullstack',
        path: '.trellis/tasks/05-28-ai-chat-mvp/children/05-history-fullstack',
        deps: ['03-chat-engine-backend', '04-chat-ui-frontend'],
        specs: [
          '.trellis/spec/backend/index.md',
          '.trellis/spec/backend/ruoyi-conventions.md',
          '.trellis/spec/frontend/index.md',
          '.trellis/spec/frontend/vue-conventions.md',
        ]
      },
    ],
    stopOnFail: true,
    worktree: true
  }
})
```

#### Step 4: Workflow 自动计算波次并执行

```
拓扑排序结果：
  Wave 1: [01-model-api-backend]                              ← 无依赖
  Wave 2: [02-model-api-frontend, 03-chat-engine-backend]     ← 并行
  Wave 3: [04-chat-ui-frontend]                               ← 依赖 03
  Wave 4: [05-history-fullstack]                              ← 依赖 03+04
```

执行时序：

```
时间 →
Wave 1: [===01-model-api-backend===] ✓
Wave 2: [==02-model-api-frontend==] ✓  [===03-chat-engine-backend===] ✓  ← 并行
Wave 3: [====04-chat-ui-frontend====] ✓
Wave 4: [===05-history-fullstack===] ✓
```

#### Step 5: Subagent 收到的 prompt（以后端任务为例）

`01-model-api-backend` 收到：

```
Active task: .trellis/tasks/05-28-ai-chat-mvp/children/01-model-api-backend

Read these spec files FIRST for coding guidelines:
- .trellis/spec/guides/index.md
- .trellis/spec/backend/index.md
- .trellis/spec/backend/ruoyi-conventions.md
- .trellis/spec/backend/api-design.md
- .trellis/spec/backend/mybatis-patterns.md

Read the task's implement.jsonl and prd.md for full context.
This task depends on: nothing (no dependencies).

Implement this task fully. Follow existing code patterns. Write unit tests.
After implementation, run type-check and tests to verify correctness.
Return the files changed, test results, and a summary.
```

Agent 读取 spec 后了解 RuoYi 约定（`AjaxResult` 返回格式、`@RequiresPermissions`
注解、`BaseEntity` 继承、MyBatis-Plus 分页模式），按规范实现。

`04-chat-ui-frontend` 收到：

```
Active task: .trellis/tasks/05-28-ai-chat-mvp/children/04-chat-ui-frontend

Read these spec files FIRST for coding guidelines:
- .trellis/spec/guides/index.md
- .trellis/spec/frontend/index.md
- .trellis/spec/frontend/vue-conventions.md
- .trellis/spec/frontend/store-patterns.md

Read the task's implement.jsonl and prd.md for full context.
This task depends on: 03-chat-engine-backend.
Those dependencies are already implemented and verified.

Implement this task fully. Follow existing code patterns. Write unit tests.
...
```

Agent 读取前端 spec 后了解 Vue3 组件规范、Element Plus 使用约定、
`request.js` API 封装模式，按规范实现。

---

### Spec 注入策略：三种交互方式

#### 方式一：触发 workflow 时明确指定（推荐）

用户在确认任务树时一句话说明规则：

```
用户: 确认任务树，用 workflow 实现。
      所有后端任务读取 .trellis/spec/backend/ 下的 spec，
      所有前端任务读取 .trellis/spec/frontend/ 下的 spec，
      通用规范 .trellis/spec/guides/index.md 全部任务都要遵循。
```

主循环据此构建 `globalSpecs` + 每个 task 的 `specs` 字段。

#### 方式二：在 implement.jsonl 中预埋 spec（规划阶段完成）

在 Phase 1（Plan）阶段直接写入 `implement.jsonl`：

```jsonl
{"role":"context","content":"Active task: ...01-model-api-backend\nFollow all specs below."}
{"role":"file","path":".trellis/spec/backend/index.md"}
{"role":"file","path":".trellis/spec/backend/ruoyi-conventions.md"}
{"role":"file","path":".trellis/spec/backend/api-design.md"}
{"role":"file","path":".trellis/spec/backend/mybatis-patterns.md"}
{"role":"file","path":".trellis/tasks/.../01-model-api-backend/prd.md"}
{"role":"file","path":".trellis/tasks/.../01-model-api-backend/implement.md"}
```

这样即使不传 `specs` 参数，`trellis-implement` 读取 jsonl 时也会获得 spec。

#### 方式三：按任务 key 自动匹配（自定义模板）

在自定义 workflow 模板中按命名约定自动注入：

```javascript
const BACKEND_SPECS = [
  '.trellis/spec/backend/index.md',
  '.trellis/spec/backend/ruoyi-conventions.md',
  '.trellis/spec/backend/api-design.md',
  '.trellis/spec/backend/mybatis-patterns.md',
]
const FRONTEND_SPECS = [
  '.trellis/spec/frontend/index.md',
  '.trellis/spec/frontend/vue-conventions.md',
  '.trellis/spec/frontend/api-layer.md',
  '.trellis/spec/frontend/store-patterns.md',
]

function autoSpecs(taskKey) {
  if (taskKey.includes('backend')) return BACKEND_SPECS
  if (taskKey.includes('frontend')) return FRONTEND_SPECS
  if (taskKey.includes('fullstack')) return [...BACKEND_SPECS, ...FRONTEND_SPECS]
  return []
}
```

用户只需说：

```
用户: 确认任务树，用 workflow 实现，按任务名称自动匹配前后端 spec
```

#### 三种方式对比

| 方式 | 用户操作 | 适合场景 |
|------|----------|----------|
| 方式一：触发时指定 | 一句话说明规则 | 首次使用、灵活调整 |
| 方式二：jsonl 预埋 | 规划阶段一次性完成 | spec 稳定、重复执行 |
| 方式三：按 key 自动匹配 | 自定义模板后免配置 | 长期项目、团队规范 |

核心原则：**spec 注入在 prompt 层面实现，不依赖 hook 机制**。
效果比 hook 更好——显式、可追溯、可差异化（前端拿前端 spec，后端拿后端 spec）。
