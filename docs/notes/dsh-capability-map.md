# DSH 能力地图（AlephResearch 需求讨论版）

本文梳理 DeepSeek Harness（下称 DSH）为 AlephResearch 提供的模式、界面与运行时扩展点，并给出这些扩展点的硬性约束。所有结论标注证据来源，供后续架构决策使用。

## 0. 证据范围与环境事实

- 运行时根目录记为 `$DSH_ROOT`，取值 `/opt/dsh-desktop-linux-bin/resources/app/dsh`；包目录记为 `$PKG`，取值 `$DSH_ROOT/node_modules/@deepseek-ai/<包名>`。下文引用 `@deepseek-ai/<包名>/README.md` 即指 `$PKG` 下的同名文件。
- 安装包实际版本为 `0.2.2-alpha.2`（`@deepseek-ai/dsh/package.json`）。全树未附带 `.d.ts` 文件（`find` 计数为零），类型证据改由 README 的 `Use this package` 段、已构建 `lib/*.js` 的 JSDoc，以及 `cordis_inspect_query` 的 host 查询结果承担。
- host 侧 Inspect 的 Service 目录查询可用，Event、Config、Tool 提供者同时出现在注册表中，本次以 Service 目录为主要运行时证据；client 侧 Inspect（Service、Slots、Theme）在本次会话内连续超时，界面证据改为读取安装包内 client bundle 的注册调用与各包 README。
- 用户 profile 位于 `~/.dsh/profiles/desktop/`，其 `package.json` 的 `dsh.profile.bundles` 与 `cordis.patch.yml` 决定当前进程的实际组合；`~/.dsh/sessions` 存会话日志，`~/.dsh/storages` 目录用于 storage 后端数据（均为本机目录观测结果）。

### 0.1 组合层级与 profile

- DSH 的组合是分层叠加的 Loader 条目树：先按 `dsh.profile.bundles` 顺序应用每个 bundle 的 patch，再应用 profile 的 `cordis.patch.yml`、`$DSH_HOME/cordis.patch.yml`，最后应用 `--patch` 覆盖层（`@deepseek-ai/dsh/README.md` 的 Profiles 段）。
- bundle 名称先解析到 DSH 安装内的包，再解析到 profile 目录的 `node_modules`；后者承载外部插件（同前 README）。Desktop profile 的 bundle 列表包含官方 web 面、`dsh-experimental-agent-team-profile`、`dsh-experimental-auto-review`、语音输入 bundle 与用户安装的第三方 bundle（`~/.dsh/profiles/desktop/package.json`）。
- 该分层决定扩展放置：官方能力用 profile patch 做行级覆盖与插入，外部插件用独立 bundle patch 装入，二者都不改动安装目录。

## 1. 模式机制：Agent preset

### 1.1 声明与装载

- 一个 preset 即一行普通的 Loader 条目，插件名为 `@deepseek-ai/dsh-agent-preset`，`config` 字段为 `id`（必填，会话记录的身份）、`plugins`（必填，子插件条目列表）、`name`、`description`、`order`；声明行的 `id` 供 Loader 编辑定位，`config.id` 才是会话保存的 preset 身份（`@deepseek-ai/dsh-agent-preset/README.md`）。
- 选择注册表为 `@deepseek-ai/dsh-agent-preset-registry`，只有一个部署级字段 `default`；用户默认值存于该条目的易失字段 `selectedDefault`，新建会话优先取用户默认，其次取部署默认（`@deepseek-ai/dsh-agent-preset-registry/README.md`）。
- 注册表不写任何声明，也不扫描目录。新增 preset 或覆盖内置 preset，唯一受支持的路径是 bundle patch：`insert` 一行 `dsh-agent-preset`，或按既有 row id 覆盖其完整 `config.plugins`（`@deepseek-ai/dsh-agent-preset-registry/README.md`）。
- 内置 preset 由 `@deepseek-ai/dsh-web-app` 以独立补丁文件分发：`presets/standard.patch.yml`（`id: standard`，`order: 1`）、`presets/ptc.patch.yml`（`order: 2`）、`presets/minimal.patch.yml`（`order: 3`）、`presets/cordis.patch.yml`（`order: 4`）；装载顺序见 `@deepseek-ai/dsh-web-app/package.json` 的 `dsh.bundle.patch`。
- preset 可以挂任意 Cordis 插件行，包括提供 Service 的插件，但服务提供者与消费者必须处于同一个 `cordis:group` 隔离域。`standard` 的 `planning`、`compaction`、`delegation` 分组即例证，其中 `workflow-ptc` 在 `isolate: { workflowEngine: true }` 内提供引擎服务（`@deepseek-ai/dsh-web-app/presets/standard.patch.yml`）。
- 跨会话单例服务被明确留在 Host 平面，不进入 preset：jobs 注册表、subagents 注册表、skills 注册表、goals 服务、tokenMeter，以及 Session 相关服务均保持 Host 行，preset 只挂其模型面向工具（`@deepseek-ai/dsh-web-app/cordis.patch.yml` 第 463 至 587 行注释逐条说明判据）。

### 1.2 会话选择与继承

- 新建 Agent 时，`ctx.agentPresets.mount(ctx, id)` 挂载对应修订；`select` 会为空白 Session 记录所选 preset 并立即按当前修订运行，不追加选择记录与 `tools/change`（`@deepseek-ai/dsh-agent-preset-registry/README.md`）。
- 会话日志记录 preset id；重启恢复使用该 id 的当前定义，定义缺失即拒绝恢复。已经运行的 Agent 保留挂载时的组合，编辑只影响之后创建的 Agent（`@deepseek-ai/dsh-agent-preset/README.md`、`@deepseek-ai/dsh-client-ui-agent-preset/README.md`）。
- 子代理可指定独立 preset：`dsh-tool-subagent` 的 `agentPreset` 给出默认值，`allowedAgentPresets` 开放模型可选的 `agent_preset` 枚举；该能力仅 in-process spawn 支持，fork 与外部后端在装载时拒绝上述字段。未配置选择时，子代理加入父 Agent 当前的 preset 修订（`@deepseek-ai/dsh-tool-subagent/README.md`）。
- 子代理会话持久化后，冷恢复按日志中 `agent-preset/selected` 记录重建独立 preset，缺失或损坏时拒绝恢复，不回退父级或部署默认（`@deepseek-ai/dsh-subagent/README.md`）。

### 1.3 界面呈现

- General 设置内有 preset 默认值一行；新建任务面板提供 preset 卡片。页面只读，不做编辑：查看配置以 Loader 方言的 YAML 呈现，创作引导到 `cordis` preset 的 Creator 模式（`@deepseek-ai/dsh-client-ui-agent-preset/README.md`）。
- 界面读取 `agentPresets/list` 与 `agentPresets/read`；默认值写入 `agent-preset-registry` 的 settings 命名空间（同前 README）。

### 1.4 模式需求的结论

- 自动研究模式的对应实现是新增一个 preset（例如 `aleph-research`），在其中挂研究工具、persona 与 skill，并把会话级默认值通过 General 设置或新建任务选择器交付。
- 最关键的约束是安全边界：preset 不是安全沙箱，YAML 与插件可以执行 Host 代码；用户覆盖会整体替换子列表，后续内置变更不会自动合并（`@deepseek-ai/dsh-agent-preset-registry/README.md` 的 Known Limitations）。研究模式的权限隔离必须依赖 sandbox 与 approval，不能依赖 preset。
- 另一项关键约束是生命周期：运行中的 Agent 组合保持稳定，修改 preset 只对后续新建 Agent 生效；据此设计模式升级与实验批次边界。

## 2. 界面机制：Slot 与全页面板

### 2.1 根布局与主面板

- 根 Slot 组合左侧栏、主内容与右栏；全局面板占用根作用域的 `main` 键控 Slot，`conversation` 是该 Slot 的保留键。`ctx.layout.selectPanel(id)` 选择已注册面板，传 `null` 回到 Conversation 且不改变当前 Session；选择未注册 id 会抛错并保持原面板（`@deepseek-ai/dsh-client-ui-layout/README.md`）。
- `ctx.layout.panelInfo` 与 `usePanelInfo` 共享同一选择源；`layoutInfo` 负责几何测量。布局状态在刷新后重置，右栏宽度是窗口级偏好而非会话级事实（同前 README）。

### 2.2 注册 API

- 业务插件通过 `ctx.slots.inject(slotKey, () => ctx.slots.register({ name, id 或 key, order, locale, inject }, Component))` 注册条目；`inject` 返回传给组件的标准 prop 扩展，`locale` 指向字典命名空间。证据：`@deepseek-ai/dsh-client-ui-jobs/lib/client.js` 第 891 行起。
- 键控 Slot 用 `key`（如 `tool.call.toolview` 按 wire 工具名分派，`@deepseek-ai/dsh-client-ui-tool/README.md`）；链式 Slot 用 `select` 选择器（如 `conversation.composer` 的临时占用，`@deepseek-ai/dsh-client-ui-conversation/README.md`）；可复用定义用 `ctx.slots.registerFactory`。
- 业务组件保持普通 React 组件，会话与工作区数据由 renderer 注入的类型化 hooks 提供；client 插件不得自行建立 transport 订阅（`@deepseek-ai/dsh-client-ui-renderer/README.md`）。

### 2.3 新增全页仪表盘的最小注册集

1. `main` Slot：`name: 'main'`、`key: <panel-id>`、`locale`、`inject: () => ({ t })`，渲染整页组件。
2. `sidebar.panellist` 条目：`{ name: 'sidebar.panellist', id: <panel-id>, order, label: () => t('nav'), locale }`，组件接收 `size` 并渲染图标。
3. 导航：入口按钮调用 `ctx.layout.selectPanel(<panel-id>)`；面板注销或退出时调用 `ctx.layout.selectPanel(null)` 复位。
4. 文案：每个 `locale` 命名空间需以 `ctx.locale.register` 注册字典（`@deepseek-ai/dsh-client-ui-jobs/lib/client.js` 同段示例）；图标也可用包元数据 `icon` 或导出的 `./icon`（`@deepseek-ai/dsh-client-ui-plugin-manager/README.md` 的插件展示元数据说明）。

完整实证样例为 `dshmarket`：`~/.dsh/profiles/desktop/node_modules/dshmarket/client/client.js` 第 18296 至 18318 行同时注册 `main`（键为 `dsh-market`）与 `sidebar.panellist`，第 18310 行在面板离开时调用 `selectPanel(null)`。官方等价样例是 Plugins 页，其侧栏入口与主面板均经 `ctx.slots.inject()` 注册（`@deepseek-ai/dsh-client-ui-plugin-manager/README.md`）。

### 2.4 可用的 Slot 面

安装包内 client bundle 的注册调用统计给出以下稳定 Slot 面：`main`、`sidebar`、`sidebar.panellist`、`sidebar.right.pane.tab`、`conversation.view`、`conversation.chat.node`、`conversation.chat.turnTail`、`conversation.input.dock`、`conversation.composer`、`conversation.session.header.actions`、`conversation.session.header.utilities`、`tool.call.toolview`、`tool.call.images`、`settings.section`、`settings.general.item`、`shell.overlay`、`shell.leading`、`shell.bottom`、`plugins.*` 与 `sidebar.workspaces.*` 系列。证据来源为 `$PKG/*/lib/client.js` 中 `slots.inject("<key>"` 字面量；代表性 README 为 `@deepseek-ai/dsh-client-ui-tool/README.md`（工具视图）、`@deepseek-ai/dsh-experimental-client-ui-stats/README.md`（`conversation.view`）、`@deepseek-ai/dsh-client-ui-workflow-run/README.md`（`conversation.chat.node`）、`@deepseek-ai/dsh-client-ui-layout/README.md`（`main`、`shell.*`）。

### 2.5 补充样例与最关键的界面约束

- 完整页面样例另有 `@deepseek-ai/dsh-client-ui-jobs`（会话头部动作与弹出面板）与 `@deepseek-ai/dsh-experimental-client-ui-agent-team`（头部动作、名册与任务面板），两者均以 Slot 注册实现，可作为轻量入口的参照。
- 全页仪表盘没有独立路由机制，只能注册 `main` 键控 Slot，由 `layout.selectPanel` 切换；SPA 入口与兜底路由属于 Host 的静态前端服务（`@deepseek-ai/dsh-host-webserver/README.md` 的 fallback seat 段）。
- 首个应用帧等待全部 client 条目激活后才挂载，Slot 渲染没有 Suspense 与逐条懒加载（`@deepseek-ai/dsh-client-ui-renderer/README.md` 的 Known Limitations）。页面体积与启动成本必须控制。

### 2.6 主题、图标与 locale 的最小要求

- 主题样式由 `@deepseek-ai/dsh-client-ui-theme` 提供：`--dsw-*` token 样式表、`ThemeRuntime` 状态与 General 设置行；自绘面板应消费 token 而不是硬编码颜色（包描述）。
- 图标可由组件渲染，也可使用包元数据 `icon` 或导出的 `./icon`，供插件列表与启动器展示（`@deepseek-ai/dsh-client-ui-plugin-manager/README.md` 的插件展示元数据段）。
- 侧栏启动器支持用户固定与取消固定，注册进 `sidebar.panellist` 的条目会被入口定制机制接管（`@deepseek-ai/dsh-client-ui-entry-customization` 包描述）。
- 主面板内容若触及窗口左上角，应按 `--dsh-frame-top-clearance` 与 `--dsh-frame-leading-clearance` 预留边距，避免与窗口控件重叠（`@deepseek-ai/dsh-client-ui-layout/README.md` 的 Window-chrome seat 段）。

## 3. 数据到界面的通路

### 3.1 Session projection

- 领域插件向 `ctx.sessionProjections` 注册投影单元，定义包含 `key`、`stateSchema`、`stateVersion`、`init`、同步 `apply(state, event)`，以及可选 `wire` 块（`viewSchema`、`view`、`summary`）。没有 `wire` 的单元只存于 Host（`@deepseek-ai/dsh-session-projection/README.md`）。
- 注册返回句柄，提供 `stateOf(session)` 读值；载波侧使用 `snapshot(session)` 取一致切面、`onChanged` 订阅变化，`checkpoint(session)` 输出持久检查点。`apply` 必须同步，且对无关事件返回同一状态引用以抑制下游工作（同前 README）。
- 客户端可见键合入 `SessionProjectionMap` 类型表；会话打开后的尾页与 `session/projection` 推送帧携带完整值（`@deepseek-ai/dsh-goal/README.md` 的 Session projection 段可作实例）。
- 检查点由 `@deepseek-ai/dsh-session-projection-cache` 持久化，冷读可跳过整日志重放（`@deepseek-ai/dsh-session-projection/README.md` 的 Persisted checkpoints 段）。

### 3.2 客户端读取

- `useSessions` 来自 `@deepseek-ai/dsh-client-ui-session`，它把 Session Controller 列表、状态与按会话投影值适配成标准 Slot hooks；`projectionsBySession[<sessionId>].values.<key>` 是读取入口。实证来源为以下 README：`@deepseek-ai/dsh-client-ui-subagent/README.md` 写明头部血统渲染器经 `useSessions` 读取 `projectionsBySession`；`@deepseek-ai/dsh-experimental-client-ui-agent-team/README.md` 写明 `projectionsBySession[lead].values.agentTeam`。
- 客户端侧不区分来源，只要 Host 注册了带 `wire` 的单元，页面即可读值；键表是进程级，某键在任何 preset 注册后都会出现在所有会话的快照中，客户端必须读值而不能把键缺失当作能力缺失（`@deepseek-ai/dsh-session-projection/README.md` 的 Known Limitations）。

### 3.3 第三方插件发布自定义 projection

- 第三方 Host 插件可调用 `ctx.sessionProjections.register(...)` 发布带 `wire` 的单元。实证为 `dsh-context`：`~/.dsh/profiles/desktop/node_modules/dsh-context/lib/index.js` 注册 `contextTimeline`、`contextHeaders`、`contextActivity` 单元，单元形态为 `{ key, stateSchema, wire: { viewSchema, view }, init, apply, stateVersion }`。
- 关键限制：投影是会话日志的派生状态，没有全局或工作区级 projection API。全局仪表盘数据必须来自 Host 服务本身，通过自定义 API 路由或复用既有 Remote 命名空间传给页面；工作区级变更另有 `workspaceController.follow` 流（`@deepseek-ai/dsh-api-workspace-controller` 的 host 服务签名，经 `cordis_inspect_query` 的 Service 目录取得）。
- 若战役状态需要随会话日志持久化与推送，可让每个战役绑定一个 Session，并把状态作为该 Session 的 projection 发布；该做法牺牲全局性，换来重启恢复与页面推送能力。

## 4. 界面动作：从 Client 调用 Host 自定义服务

- 官方通路是 Typert Remote。Host 业务 Service 继承 Typert 远程基类并用 `@Remote` 标记方法；Client 经 `ctx.remote.$mount()` 挂载生成产物，命名空间方法由 `ctx.remote.<namespace>` 暴露；传输为 `/api` 一元调用与 `/api/remote.mux` WebSocket 流，含取消、重连、上行与访问决策（`@deepseek-ai/dsh-api-gateway/README.md`）。
- 命名空间的装配点固定在 `@deepseek-ai/dsh-api-remotes`：该包在构建期以显式 import 选择要暴露的 Host 能力，Client 不在运行时发现 Host 的活跃 Service；新增能力需要显式 `/remote` import 与装配改动（`@deepseek-ai/dsh-api-remotes/README.md` 的 Known Limitations）。这意味着外部第三方插件无法仅靠装包向 `ctx.remote` 增加命名空间。
- 第三方可行的动作通路是自定义 HTTP 路由：Host 插件注入 `connection`，经共享 `/api` FetchHandler 注册命名空间路由，路由由 connection 的浏览器信任栅栏与访问策略保护（`@deepseek-ai/dsh-api-gateway/README.md` 第 31 段描述共享 FetchHandler；host Service 目录给出 `connection.createSharedFetchHandler('/api')`）。实证为 `dsh-context/lib/index.js`，其注册 `/api/dsh-context/commands`、`/detail`、`/fleet`、`/skills`、`/backfill`、`/recom` 等自定义路由，客户端直接 `fetch`。
- `@deepseek-ai/dsh-client-connection` 承担浏览器与 Host 的线上层：Remote RPC、事件流重连、精确 Fetch 路由、`/api` HTTP 桥与浏览器信任栅栏（包描述与 `@deepseek-ai/dsh-api-gateway/README.md` 的 Client 段）。
- 对 `pause campaign`、`kill mission` 这类动作的结论：采用 Host 服务状态 + `/api/aleph/*` 自定义路由即可，动作结果以 JSON 返回，页面按钮立即调用并在失败时展示错误；不依赖 Typert 代码生成。若需要实时状态，页面用短轮询或让该状态进入战役 Session 的 projection，由推送帧更新。

## 5. 代理运行时与子代理

### 5.1 Agent 与 Agent loop

- `ctx.agents` 管理活跃 Agent 与会话注册表，提供 `list()`、`roots()`、`get(id)`、`create()`、`resume()`、发起者作用域与 `announce()`（`cordis_inspect_query` host Service 目录，`agents` 条目）。`ctx.agentLoop` 提供 `create(id, options, meta)`、`createAgent(ownerCtx, options)`、`resume(ownerCtx, options)`（同目录，`agentLoop` 条目）。
- `dsh-agent` 提供 Agent 句柄、活跃注册表、进程内发起者作用域与 `agent/*` 事件词汇；`dsh-agent-loop` 是默认驱动，决定 Agent 的创建方式以及 turn、step 的运行方式（两包 README 描述字段）。

### 5.2 子代理能力

- 委派由 `ctx.subagents` 的命名 provider 注册表实现，内置 provider 名称包括 `spawn`、`fork`，对应包为 `@deepseek-ai/dsh-subagent-spawn-in-process` 与 `@deepseek-ai/dsh-subagent-fork-in-process`；外部后端包括 ACP、DSH SDK、Codex、Claude Code。每次委派启动一个受管 activation 并立即返回 child id，完成通知与清理由运行时负责（`@deepseek-ai/dsh-subagent/README.md`）。
- 工具配置项：`provider`、`toolName`、`modelSelection`、`modelDiscovery`、`agentOptions`（provider、model、reasoningEffort、maxTokens）、`agentPreset`、`allowedAgentPresets`、`maxDepth`；每个委派目标挂一个实例，`toolName` 必须唯一（`@deepseek-ai/dsh-tool-subagent/README.md`）。续聊、打断与子代理列举由 `@deepseek-ai/dsh-tool-subagent-control` 提供。
- 并发与深度：`maxActiveSubagents` 默认 8，按激活树共享，顶层父 Agent 不占槽；达到上限时创建或冷恢复以 `ACTIVATION_LIMIT_REACHED` 拒绝且不排队。`maxDepth` 默认 1，数值深度要求 provider 具备 `depthLimit`，`'provider-managed'` 由外部 provider 自管（`@deepseek-ai/dsh-subagent/README.md`、`@deepseek-ai/dsh-tool-subagent/README.md`）。
- fork 语义：fork 子代理继承父代理已完成 turn 的前缀，不继承当前进行中的 turn；spawn 子代理不携带父对话。工具描述会根据 provider 的继承属性改写措辞（`@deepseek-ai/dsh-tool-subagent/README.md` 的 Context-sensitive wording 段）。team 的 fork 成员同样只捕获 Lead 已完成 turn 前缀（`@deepseek-ai/dsh-experimental-agent-team/README.md`）。
- 生命周期与开销：本地子代理有持久 Session，可继续消息、可冷恢复；外部子代理只执行一次、不接受后续消息。启动即返回，完成经通知送达父级，空闲父级收到通知会开启一次独立模型请求；本地子代理结算等待其清理完成后才投递通知（`@deepseek-ai/dsh-subagent/README.md`）。
- 持久化与恢复：本地子代理的会话持久化后可冷恢复；恢复要求持久化与 Session 查询服务，且 descriptor 记录 provider、model、reasoningEffort 与 preset，跨重启使用当前注册的 preset 定义（同前 README）。
- 跨进程限制：activation 收件箱与所有权图不协调多个 Host 进程；进程崩溃可能丢失已接受但未落日志的消息（`@deepseek-ai/dsh-subagent/README.md` 的 Known Limitations）。

## 6. 无界面常驻与进程生命周期

### 6.1 可用的非 Desktop 形态

| 形态 | 入口 | 能力边界 | 进程生命周期 |
|---|---|---|---|
| headless | `dsh --profile headless "<任务>"` | 一个任务、打印最终答案或 NDJSON 事件流，不开端口 | 任务结束即退出（`@deepseek-ai/dsh-headless/README.md`） |
| SDK | `dsh --profile sdk` | stdio JSON-RPC，按 `sessionId` 打开/恢复会话，适合进程外客户端 | 客户端连接期间存活，`shutdown` 或 EOF 结束（`@deepseek-ai/dsh-sdk-jsonrpc-server/README.md`） |
| SDK minimal | `dsh --profile sdk-minimal` | 复用 SDK 启动器，独立的最小 agent 树 | 同上（`@deepseek-ai/dsh-sdk-app/README.md`） |
| ACP | `dsh --profile acp` | 标准 ACP v1 stdio，多个独立会话，可列举、恢复、关闭持久会话 | 连接期间存活（`@deepseek-ai/dsh-acp/README.md`） |

- SDK 与 ACP 都是 CLI 的 profile，不是独立公开二进制；profile 在首次使用时从随包模板初始化（`@deepseek-ai/dsh/README.md`）。SDK 的协议类型在 `@deepseek-ai/dsh-sdk-protocol`，应用 bundle 在 `@deepseek-ai/dsh-sdk-app`，ACP 应用 bundle 在 `@deepseek-ai/dsh-acp-app`。
- 这些 profile 不组合 `dsh-web-app`，因此没有 preset 注册表、没有 Web UI，只继承 `dsh-base` 的能力与各自的应用行。会话是否有 preset 记录取决于创建它的 surface。
- 本安装的包清单中没有 `@deepseek-ai/dsh-subagent-acp`，当前无法把 ACP 作为子代理后端使用；如需 ACP 委派，需要另行安装该包。

### 6.2 Desktop 的进程模型

- Desktop 由 Electron 主进程派生子进程运行 Host：`resources/app/lib/main.js` 第 8094 行以 `@deepseek-ai/dsh-desktop-host/lib/index.js` 为入口 spawn 一个 Node 模式 Host，通过 IPC 通信；`@deepseek-ai/dsh-desktop-host` 的包描述为 `Private Node-mode host process for the Electron desktop application`。
- 关闭主窗口不会结束进程：`main.js` 第 20852 行的 `window.on("close")` 调用 `preventDefault()` 并隐藏窗口；Linux 与 Windows 另有托盘（第 20764 行 `new DesktopTray`）与后台关闭确认提示。窗口隐藏后 Host 继续运行，网页仍可通过原地址访问。
- 退出应用会结束 Host：`before-quit` 触发 `finishQuit()`，其中 `backend.close()` 关闭 Host；Host 侧 `process.once("disconnect")` 收到 IPC 断开即执行停止流程（`@deepseek-ai/dsh-desktop-host/lib/index.js` 的 `stop()` 与 disconnect 监听）。
- `desktop` 是 Electron 独占的 profile 名称，CLI 拒绝启动或配置导出该 profile（`@deepseek-ai/dsh/README.md`）。`~/.dsh/profiles/web/` 是已初始化的独立 web profile，其 bundle 列表与 Desktop 不同，但共享同一 `$DSH_HOME` 与同一会话根目录（`@deepseek-ai/dsh-base/cordis.patch.yml` 第 141 行 `root: !!js dshHomePath('sessions')`）。

### 6.3 研究集群持续运行能力的结论

- 关闭窗口不等于关闭 DSH：窗口隐藏后 Host 与 Agent 循环继续，未完成的 turn 与后台 job 继续运行。只有退出应用（托盘退出、系统会话结束、显式 quit）才终止 Host。
- 退出应用后，Host 内的 job、终端、待处理审批与进行中的 Agent turn 全部终止；已提交的事件保留在会话日志，恢复会话时由持久化层补齐中断的 turn。
- 若研究集群需要脱离 DSH 生命周期长期运行，执行面必须放在外部 daemon。仅依赖 DSH 进程内设施的方案在应用退出、OOM、强制杀进程时不具备生存能力。

### 6.4 现有 profile 清单与可复用性

- `~/.dsh/profiles/web/` 已初始化：bundle 列表包含官方 base、web-app、agent-team profile、auto-review、语音输入与第三方 bundle，`patchReload` 为 `live`（该目录 `package.json`）。启动命令为 `dsh web`（`@deepseek-ai/dsh/README.md`）。
- `~/.dsh/profiles/acp/` 已初始化：bundle 列表为 `dsh-base` 与 `dsh-acp-app`，`patchReload` 为 `startup`（该目录 `package.json`）。启动命令为 `dsh --profile acp`。
- `headless`、`sdk`、`sdk-minimal` 首次使用时自动初始化，用户 profile 目录内出现同名目录（`@deepseek-ai/dsh/README.md`）。
- 共享性结论：多个 profile 共享 `$DSH_HOME` 的会话根、settings、credentials 与 storages，但各自拥有 bundle 组合与 patch 层；跨 profile 复用会话需要接受组合差异。常驻研究 Host 建议使用专用 profile 名称与专用会话根，避免与 Desktop 争用同一日志目录。
- 对同一 profile 启动常驻 Host 这一问题的直接回答：Desktop profile 无法由 CLI 启动，因此不存在完全相同的 profile 常驻进程；web profile 可以复用同一会话根与同一批内置 preset id，条件是 bundle 组合与 patch 层与目标一致，且同一会话根不由多个 Host 同时写入。

## 7. 执行与调度基础设施

### 7.1 后台 job

- `ctx.jobs` 是抽象注册表，提供 `start`、`list`、`get`、`read`、`kill` 与事件流；`dsh-jobs-local` 是进程内实现，记录存内存，随 Host 退出消失；`maxConcurrentJobsPerOwner` 默认 10，输出环默认 256 KiB，结算后保留 16 KiB（`@deepseek-ai/dsh-jobs-local/README.md`）。
- 模型面向控制为 `job_output`、`job_list`、`job_kill`（`@deepseek-ai/dsh-tool-jobs`），Web 顶部 job 面板经 `job.list` 与 `job.follow` 流观察（`@deepseek-ai/dsh-client-ui-jobs/README.md`）。
- 使用边界：job 适合工具调用期间的后台命令与分钟级观察；跨重启执行需要另行实现 `ctx.jobs` 契约的后端（`@deepseek-ai/dsh-jobs-local/README.md` 的 Known Limitations）。

### 7.2 终端与 shell

- `ctx.terminals` 管理替换式 PTY 后端与按 Agent 归属的持久终端会话；`@deepseek-ai/dsh-tool-terminal` 提供 open、send、read、signal、close、list 模型工具，`run_in_background` 的 send 复用 jobs 设施（两包 README）。
- shell 执行是 `ctx.shell` 抽象：`dsh-bash-local` 为不受限 POSIX 执行器，`dsh-bash-sandbox` 为受沙箱约束的执行器，`run_in_background` 由 `dsh-tool-bash` 交给 jobs（包描述与 `@deepseek-ai/dsh-sandbox-local/README.md` 的引用关系）。
- 终端会话与 shell 进程都归 Host 管理，Host 退出时被清理；长时间实验不能只靠终端会话承载。

### 7.3 沙箱

- `ctx.sandbox.confine(argv, policy, signal)` 把命令包装成受约束的 argv；`ctx.sandboxPolicy.resolve()` 给出执行策略，模式为 `read-only`、`workspace-write`、`danger-full-access`，`additionalWritableRoots` 在 `workspace-write` 下追加可写根（`cordis_inspect_query` host Service 目录的 `sandbox`、`sandboxPolicy` 条目）。
- Linux 后端选择链为 `bwrap` 后 Landlock；`bwrap` 提供只读 Host 根、新的 `/dev` 与私有 PID 命名空间，`workspace-write` 下追加临时 `/tmp` 与工作区可写绑定；Landlock 由 `@deepseek-ai/node-addon-system/landlock-run` 提供启动器与探测。执行结果报告 `full` 或 `partial` 强制程度；不可用时以 `SANDBOX_UNAVAILABLE` 失败关闭（`@deepseek-ai/dsh-sandbox-local/README.md`）。
- `@deepseek-ai/dsh-fs-sandbox` 的包描述为 confining model file mutations，其约束对象是模型的文件变更而非文件读取。
- 关键结论：进程沙箱约束写效果与可见挂载，不约束读取工作区之外的文件。子代理无法被限制为不可读取工作区之外的文件，除非把执行整体替换为容器或远程执行器（`@deepseek-ai/dsh-sandbox-local/README.md` 的 When to choose it 段明确给出该替代路径）。

### 7.4 子进程

- `ctx.subprocess` 提供 `resolveExecutable`、`spawn`、`spawnTerminal`；`dsh-subprocess-local` 在 Linux 上以 transient user-systemd scope 管理普通命令与终端，Windows 使用 kill-on-close Job，平台不支持时退回进程组或会话观察并给出警告（`@deepseek-ai/dsh-subprocess-local/README.md`）。
- 该 provider 随 Host 处置终止所有受管范围并等待退出；SIGKILL、OOM、原生崩溃与断电需要外部 supervisor（同前 README 的 Known Limitations）。没有脱离 Host 生命周期的启动选项。
- 据此得出的结论是，常驻实验进程应由外部 daemon 承担，DSH 侧只负责发起、观测与控制。

### 7.5 Host HTTP 服务

- `dsh-host-webserver` 使用 `node:http`（配置 TLS 后为 `node:https`），路由匹配顺序为精确、最长前缀、兜底；兜底位置由 SPA 静态服务占用；`/api` 桥、插件 bundle、HMR 流分别由对应插件注册（`@deepseek-ai/dsh-host-webserver/README.md`）。
- 监听地址必须是本地具体字面量，回环地址保持本机可达，非回环字面量把路由暴露到该网络；服务本身没有全局认证与来源策略，策略由路由所有者（如 `dsh-client-connection`）承担。Desktop Host 以 `127.0.0.1` 与 OS 分配端口提供网页（`lib/main.js` 的 `authenticatedUrl` 组装方式）。
- 由此得出的结论是，自定义服务端点的暴露范围由 `host` 配置与路由所有者共同决定；研究控制面（control plane）默认保持回环绑定与浏览器信任栅栏，不新增公网入口。

### 7.6 默认上限与资源参数

| 设施 | 参数 | 默认值 | 证据 |
|---|---|---|---|
| background job | `maxConcurrentJobsPerOwner` | `10` | `@deepseek-ai/dsh-jobs-local/README.md` |
| background job | `retainBytes` / `settledRetainBytes` | `262144` / `16384` | 同上 |
| 子代理 | `maxActiveSubagents` | `8` | `@deepseek-ai/dsh-subagent/README.md` |
| 子代理 | `maxDepth` | `1` | `@deepseek-ai/dsh-tool-subagent/README.md` |
| Agent Teams | `maxMembers` / `maxTasks` | `16` / `256`（Desktop bundle 覆盖成员上限为 8） | `@deepseek-ai/dsh-experimental-agent-team/README.md`、`dsh-experimental-agent-team-profile/cordis.patch.yml` |
| Goal | `defaultMaxGoalRounds` | `256` | `@deepseek-ai/dsh-goal/README.md` |
| Ralph | `maxRounds` | `256` | `@deepseek-ai/dsh-tool-ralph/README.md` |
| 终端工具 | `maxResultBytes` | `262144` | `@deepseek-ai/dsh-tool-terminal/README.md` |
| workflow | 单次运行子代理总量 | 由 engine 上限约束 | `@deepseek-ai/dsh-tool-ralph/README.md` 的 Fixed script and routing 段 |

- 这些值决定单机并发规模：子代理与 Team 的并发上限在单个 Host 进程内生效，跨进程并发不受约束，但同一会话根的多进程写入没有官方协调契约。

## 8. 权限、审批与子代理限制

- 审批是 `ctx.approval` 的一次性决策通道：`ask` 交给已组合的 answerer，`never` 在派发前直接拒绝；answerer 缺失或异常返回 `unavailable` 并失败关闭；每次请求与结果写入会话审计日志（`@deepseek-ai/dsh-user-approval/README.md`）。
- 权限预设把 sandbox 模式与 approval 策略打包成命名档位，由 `/permission` 切换，默认值写入 `permission` settings 命名空间并固化到新会话；用户在 Desktop profile 中配置的默认档位是 `danger-full-access` 加 `never`（`~/.dsh/profiles/desktop/cordis.patch.yml`）。
- 子代理权限在创建时由父 Agent 捕获并固定：运行时上下文会声明权限范围在启动时确定且无法从会话内部扩大，审批类操作自动拒绝（`@deepseek-ai/dsh-subagent/README.md` 的 Child delegation-scope statement 段）。工具配置中没有按子代理单独设置 sandbox 的字段，限制手段是会话级 permission preset、工具可见性与外部执行器。
- 工具面收窄是另一条限制手段：`ctx.tools.restrict(filter)` 与 `ctx.tools.guard(guard)` 按注册作用域限制可见与可执行的工具，preset 可以决定所挂的工具行组合，从而让不同研究者 Agent 看到不同工具集（`cordis_inspect_query` 的 `tools` 服务签名；`@deepseek-ai/dsh-web-app/presets/standard.patch.yml` 的工具行组合）。
- 禁止子代理读取测试集的可行手段：把测试集放在执行面之外的容器或远程环境中，使子代理进程不可见；或在文件工具层做路径策略（当前 `dsh-fs-sandbox` 只约束写，读路径过滤需要自研工具替换）。现有内置能力无法只靠沙箱达成该目标。

## 9. git 分支与隔离

- `ctx.worktrees` 创建保留的 Git worktree：`create(agent, { name?, from? }, signal?, onPhase?)` 解析本地提交、创建新分支与检出目录，并经 `ctx.workingDirectory.set` 把当前 Session 切到新目录；默认目录为 `<当前检出根>/.agents/worktrees/<name>`，返回 `path`、`branch`、`baseCommit`、`repositoryRoot`（`@deepseek-ai/dsh-experimental-worktree/README.md`）。
- 新 worktree 只从本地提交创建，不复制暂存、未提交、未跟踪与忽略文件，不拉取缺失对象、不初始化子模块、不安装依赖；Git 过滤器被禁用；写操作沿用调用 Session 的文件策略，不扩大目标与共享 Git 管理目录的写权限（同前 README）。
- `ctx.worktrees.restore()` 在记录目录重新检出，并报告 `branchRecreated`；调用 Session 的工作目录不随之改变，未提交改动不会恢复。
- 并发：服务可被多次调用创建不同 worktree，但每个 Session 只有一个有效工作目录；多 Agent 并行实验需要各自 Session 各自 worktree，或由外部执行器按任务分配 worktree。没有内置的合并、清理与分支回收，保留产物由使用者处置。
- 模型面向工具为 `@deepseek-ai/dsh-experimental-tool-worktree`，创建后改变当前 Session 目录（包描述）。

## 10. 协调原语

### 10.1 Agent Teams

- `ctx.agentTeams` 以 Lead Session 日志为唯一持久权威，维护成员名册与共享任务板：成员上限默认 16，任务上限 256，消息上限 64 KiB；成员状态为 `running`、`inactive`、`provisioning`、`failed`（`@deepseek-ai/dsh-experimental-agent-team/README.md`）。
- 任务板支持依赖、声明持有、完成、释放、重开与 Lead 指派，所有变更以 `expectedRevision` 比较并置；`writeScopes` 只生成重叠警告，不阻塞也不授权写入（同前 README）。
- `agentTeam` projection 向 Web 发布名册、任务与最近失败；Web 面板只读，任务变更由模型工具完成（同前 README 与 `@deepseek-ai/dsh-experimental-client-ui-agent-team/README.md`）。
- 模型工具由 `@deepseek-ai/dsh-experimental-tool-agent-team` 提供，`freshProvider` 与 `forkProvider` 分别指定新建与 fork 后端（`dsh-experimental-agent-team-profile/cordis.patch.yml`）。
- 该包的限制为单进程、单共享检出目录，不支持 worktree 隔离、远程成员、自动任务所有权释放与发送重试，且实验包没有稳定性承诺（同前 README 的 Known Limitations）。
- Desktop profile 的 `dsh-experimental-agent-team-profile` 会禁用直接子代理工具（`tool-subagent`、`tool-subagent-control`、`tool-subagent-fork`），把委派统一到 Team 工具；`agent-team-profile/cordis.patch.yml` 可查。

### 10.2 Workflow

- `ctx.workflowEngine.start({ script, meta, args?, parent, signal? })` 运行模型编写的 JavaScript 编排脚本，脚本可用 `agent()`、`parallel()`、`pipeline()`、`phase()`、`log()` 并行分派子代理并返回 JSON；每次运行归属调用者，结果永不 reject，错误以 `stopReason` 表达（`@deepseek-ai/dsh-workflow/README.md`）。
- 模型入口为 `dsh-tool-workflow`，调用阻塞到整个运行结束，只返回一个最终结果。运行没有日志与恢复点，不支持后台启动与轮询，运行句柄由持有者负责释放（同前 README 的 Known Limitations）。
- Host 事件广播走 `@deepseek-ai/dsh-api-remotes` 的转发白名单，Client 用 `ctx.remote.$on` 订阅；普通单向通知在重连后不重放，需要可靠恢复的状态必须由所有者提供服务查询或游标（`@deepseek-ai/dsh-api-remotes/README.md` 的 Forwarded Host events 段）。

### 10.3 Goal 与 Round driver

- `ctx.goals` 为每个 Session 持久化一个完成目标，阶段为 `active`、`paused`、`blocked`、`complete`，全部变更写入会话日志并带修订号；自动继续的 `armed` 标志是进程内状态，每次会话启动边沿都会解除，需要显式恢复（`@deepseek-ai/dsh-goal/README.md`）。
- 自动续跑由 `dsh-goal-round-driver` 承担，轮次上限默认 256；目标状态只做状态存储，不负责调度（同前 README 与包描述）。

### 10.4 Ralph

- `dsh-tool-ralph` 提供固定前台循环：每轮一个全新子代理由不可变目标与上一轮有界报告驱动，完成或阻塞由 worker 自报，没有独立评估器；轮次上限默认 256（`@deepseek-ai/dsh-tool-ralph/README.md`）。
- 该工具的适用性在于以门禁反复修复为形态的迭代任务，而不适合需要独立评估器的研究结论评价。

### 10.5 作为 Mission Queue 与研究者协调基础的评估

- Team 任务板是最接近的现成基础：具备持久日志、比较并置、依赖就绪、write scopes、projection 与 Web 面板。其边界是绑定单个 Lead Session、单进程、单检出、实验状态，且没有自动所有权回收。
- Workflow 只适合 turn 内的并行分派，没有持久队列与恢复；Goal 适合单会话长目标；Ralph 适合固定循环而非队列。
- 建议：Mission Queue 以自研 Host 服务实现，采用 Team 任务板的语义（依赖、CAS、write scopes、就绪计算）与 projection 推送模式；执行记录落在外部 daemon 的持久存储，DSH 侧只保留控制元数据。研究者协调可复用 Team 原语，但需接受单进程与单检出限制。

### 10.6 preset 与服务型插件的放置

- preset 可以挂载提供 Service 的插件，但该服务只在其 `cordis:group` 隔离域内可见；Host 平面上的其他条目行无法通过普通 Context 查找看到该实例（`@deepseek-ai/dsh-agent-preset-registry/README.md` 的 Implementation internals 段）。
- 推荐放置：跨会话共享的业务服务（mission 队列、campaign 状态、执行器代理）放 Host 平面；preset 内只挂带工具与 persona 的行，用 `ctx.get` 读取 Host 服务。同一 npm 包可用多个入口同时提供两侧能力，官方先例是 `@deepseek-ai/dsh-plugin-manager` 与其 `/tools` 子入口（`@deepseek-ai/dsh-web-app/presets/standard.patch.yml` 的 `tool-plugin-manager` 行）。

## 11. 持久化与恢复

- 会话日志是事件溯源存储：`@deepseek-ai/dsh-session-persistence-jsonl` 按 `<root>/--<规范化 cwd>--/<编码会话 id>/session.vN.jsonl[.zstd]` 写入磁盘，默认 Zstandard 压缩，逐批 fsync，崩溃后保留已提交前缀并补齐中断的 turn；`root` 必填，Desktop 使用 `dshHomePath('sessions')`（`@deepseek-ai/dsh-session-persistence-jsonl/README.md`、`@deepseek-ai/dsh-base/cordis.patch.yml` 第 141 行）。
- 投影缓存把 `checkpoint()` 结果持久化，冷读先取检查点再折叠尾部（`@deepseek-ai/dsh-session-projection-cache` 包描述；`@deepseek-ai/dsh-session-projection/README.md` 的 Persisted checkpoints 段）。
- `ctx.storage` 是命名存储后端与数据形态的枢纽：`mount(form, facility)` 与 `form(form)`；`ctx.storageDomain.open(spec)` 打开域级设施；`dsh-storage-json` 是默认 JSON 后端，Desktop 基础层已挂载 `dsh-storage`、`dsh-storage-json`、`dsh-storage-domain`（`cordis_inspect_query` 的 `storage`、`storageDomain` 签名；`@deepseek-ai/dsh-base/cordis.patch.yml` 第 180 至 188 行）。
- 第三方 Host 插件持久化自有队列、分支与结果时，优先使用 `storageDomain` 的命名域，或经 `dsh-home-paths` 解析 `$DSH_HOME` 下的自有目录并用 `dsh-atomic-write` 的原子替换与跨进程写锁持久化（两包 README）。把全局状态写进某个会话日志需要事件生产者与 replay 纪律，适合战役级状态而不适合跨战役队列。
- 重启恢复边界：会话与 projection 可恢复；job、终端、待处理审批与 Agent turn 不恢复；preset 按记录的 id 使用当前定义。

## 12. 会话可见性与外部子代理观察

- 普通侧边栏不显示子代理会话。子代理对话经父会话头部的血统目录浏览，按精确地址 `{ parentSessionId, childSessionId, mode }` 打开，可在右栏独立标签中查看；`@` 引用只插入运行时子代理的标签文本，不授予继续权限（`@deepseek-ai/dsh-client-ui-subagent/README.md`）。
- 外部子代理（ACP、SDK、Codex、Claude Code）在目录中作为不可导航叶子出现，没有执行状态；其成功结果只通过父级完成通知承载保存，不产生本地子会话（`@deepseek-ai/dsh-subagent/README.md` 的 Local and external children 段与 `@deepseek-ai/dsh-client-ui-subagent/README.md`）。
- 普通侧边栏的会话列表来自 Workspace 控制器的 `follow` 流与持久注册表，按工作区分组（`@deepseek-ai/dsh-api-workspace-controller` 的 host 签名、`@deepseek-ai/dsh-client-ui-workspace` 包描述）；子代理会话由 `parentSession` 血统标记，不进入普通列表（`@deepseek-ai/dsh-client-ui-subagent/README.md` 明确写明普通侧边栏省略子代理会话；`@deepseek-ai/dsh-subagent/README.md` 的 Ownership and invariants 段描述 `parentSession` 与 `origin: subagent`）。
- 自定义仪表盘若需要展示研究者与战役关系，应读取 Host 会话注册表与子代理目录服务，自行渲染；DSH 没有提供侧边栏会话过滤或分组配置项。

## 13. 用户侧第三方插件样例

以下包位于 `~/.dsh/profiles/desktop/node_modules/`，是当前环境可读的完整外部插件，可作为主面板、侧栏图标、自定义页面与 Host 服务的实证模板。

- `dshmarket`（插件市场）：`cordis.patch.yml` 插入 Host 行；`package.json` 的 `dsh.client.inject` 声明 client 依赖；`client/client.js` 第 18296 至 18318 行注册 `main` 面板与 `sidebar.panellist` 图标，是全页仪表盘与侧栏入口最完整的样例。
- `dsh-context`：`cordis.patch.yml` 插入 Host 行；`lib/index.js` 注册 `sessionProjections` 单元并注册 `/api/dsh-context/*` 自定义路由；`lib/client.js` 注册 `sidebar.panellist` 与 `sidebar.right.pane.tab`。该包同时演示 Host 服务、projection 与自定义 HTTP 动作通路。
- `dsh-cost-meter`：`package.json` 导出 `./client`、`./typert`，`lib/typert.host.js` 提供 Typert 产物，`lib/client.js` 为浏览器半；适合作为 Typert Remote 与多文件业务包的参考，源码规模远大于其他样例。
- `dsh-lets-draw-canvas`：本地链接到 `/home/hapenia/Projects/dsh-lets-draw`；`package.json` 的 `dsh.client.inject` 列出 `dsh-api-gateway`、`dsh-api-remotes`、`dsh-client-ui-renderer`、`dsh-client-ui-sidebar-right` 等依赖；`lib/client.js` 注册 `sidebar.right.pane.tab`、`conversation.session.header.actions`、`conversation.input.right`；同时导出 `./typert`。
- 由此得出的结论是，主面板与侧栏入口照 `dshmarket` 实现，Host 服务加自定义 API 与 projection 照 `dsh-context` 实现，需要类型化 Remote 时照 `dsh-cost-meter` 或 `dsh-lets-draw-canvas` 打包 typert 产物。

## 14. 候选实现形态与推荐

### 形态 A：DSH 控制面插件 + 独立 Python 数据面（推荐）

- DSH 侧：一个 Host 插件提供 mission 与 campaign 控制服务、模型工具与 `/api/aleph/*` 路由；一个 Client 插件注册全页仪表盘与侧栏入口；一个 `aleph-research` preset 组合研究工具、persona 与 skill。
- Python 侧：常驻 daemon 承担实验调度、GPU 执行、日志采集与结果存储，以 systemd user unit 或独立进程运行，通过 HTTP 或 Unix socket 与 Host 插件通信。
- 形态 A 的优势在于实验生命周期与 DSH 解耦：应用退出、OOM 与重启不影响执行，同一台 4070 机器可以稳定运行长任务，DSH 升级只影响控制面（control plane）。
- 形态 A 的代价在于控制面与数据面（data plane）需要约定协议与鉴权方式，且 DSH 侧需要自行持久化控制元数据。

### 形态 B：纯 DSH 插件

- 全部能力放在 Host 与 Client 插件内，使用 jobs、终端、subprocess 与 worktree 执行实验。
- 形态 B 的优势在于实现路径最短，工具、审批、沙箱、projection 与界面都复用现成能力，不需要额外进程。
- 形态 B 的代价在于执行随 Host 退出终止，jobs 不跨重启，subprocess 没有脱离选项，并发与资源隔离受单进程与默认上限约束（jobs 每 owner 10、子代理每树 8、深度 1）。该形态适合单机短周期 MVP，不适合长期无人值守研究。

### 形态 C：DSH UI 壳 + 外部 daemon

- DSH 只保留界面与 Agent 对话，实验与研究编排完全在外部系统；DSH 侧仅一个 Client 面板与若干只读 API。
- 形态 C 的优势在于边界最清晰，DSH 可按需替换，外部系统独立演进。
- 形态 C 的代价在于放弃 preset、模型工具、审批、沙箱与流式 Agent 能力的复用，且页面动作仍需自定义 `/api` 路由，集成成本不会因为外部化而降低。

### 推荐结论

采用形态 A，并以形态 B 的能力作为控制面实现手段。模式用 preset 承载，界面用 Client 插件承载，研究执行与状态持久化由外部 Python daemon 承载；DSH Host 插件只做控制面与观察面。该组合同时满足模式可安装、界面可扩展与执行生命周期独立的要求。

## 15. 待验证事项

- Desktop profile 与 web profile 共享会话根目录时，多个 Host 进程并发读写的实际行为；当前代码只有进程内单写者声明与原子写锁，跨进程协调没有官方契约（`@deepseek-ai/dsh-subagent/README.md`、`@deepseek-ai/dsh-session-persistence-jsonl/README.md`）。
- web profile 恢复 Desktop 会话时对 preset 记录与 Host 平面差异的校验行为；headless 的恢复校验可作为对照（`@deepseek-ai/dsh-headless/README.md` 的 Adoption 段）。
- 非回环绑定下 `/api` 路由的信任与访问决策细节；`connection` 的浏览器信任栅栏只在回环场景有实证。
- 客户端 Inspect 在本次会话内超时的原因；该通道恢复后可把 Slot 目录与 Theme token 作为运行时证据补齐。
- 外部 ACP 子代理后端在本安装中的缺失是否影响后续形态选择；如需 ACP 委派，需要额外安装 `@deepseek-ai/dsh-subagent-acp`。

## 16. 关键证据索引

| 议题 | 主要证据 |
|---|---|
| preset 声明与选择 | `@deepseek-ai/dsh-agent-preset/README.md`、`@deepseek-ai/dsh-agent-preset-registry/README.md`、`dsh-web-app/presets/*.patch.yml` |
| preset 的 Host 平面边界 | `dsh-web-app/cordis.patch.yml` 第 463 至 587 行 |
| 全页面板注册 | `dshmarket/client/client.js` 第 18296 至 18318 行、`@deepseek-ai/dsh-client-ui-layout/README.md` |
| Slot 注册形态 | `@deepseek-ai/dsh-client-ui-jobs/lib/client.js`、`@deepseek-ai/dsh-client-ui-tool/README.md` |
| projection 定义与读取 | `@deepseek-ai/dsh-session-projection/README.md`、`@deepseek-ai/dsh-client-ui-subagent/README.md` |
| 自定义 /api 动作 | `dsh-context/lib/index.js`、`@deepseek-ai/dsh-api-gateway/README.md` |
| 子代理运行时 | `@deepseek-ai/dsh-subagent/README.md`、`@deepseek-ai/dsh-tool-subagent/README.md` |
| Desktop Host 生命周期 | `resources/app/lib/main.js` 第 20764 行、第 20852 行、第 21058 行；`@deepseek-ai/dsh-desktop-host/lib/index.js` |
| 沙箱机制 | `@deepseek-ai/dsh-sandbox-local/README.md` |
| worktree 隔离 | `@deepseek-ai/dsh-experimental-worktree/README.md` |
| 持久化 | `@deepseek-ai/dsh-session-persistence-jsonl/README.md`、`@deepseek-ai/dsh-base/cordis.patch.yml` |
