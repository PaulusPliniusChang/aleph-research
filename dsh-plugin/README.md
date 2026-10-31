# @local/dsh-aleph-research

AlephResearch 的 DSH 插件包（第一版）：两个 agent preset、一个只读研究控制台主面板、一条只读状态接口与侧栏入口。

## 内容

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 插件：注册两条只读 GET 路由 |
| `client.js` | Client 插件：`main` 面板、`sidebar.panellist` 入口、zh/en 字典、2 秒轮询 |
| `cordis.patch.yml` | 插入 Host 行与 `aleph`、`aleph-researcher` 两个 preset |
| `locale/en.json`、`locale/zh.json` | 插件清单显示的 `meta.title` / `meta.description` 与界面文案 |
| `icon.svg` | 原创几何图标 |
| `package.json` | bundle 清单：`dsh.bundle.patch` 与 `dsh.client` |

## 安装

在 DSH 会话中调用 `plugin_manager`，`action: install_bundle`，`target` 指向本目录的绝对路径：

```text
/home/hapenia/Projects/aleph-research/dsh-plugin
```

隔离实验使用独立 `DSH_HOME` 与独立 web profile，安装后启动新的 Web Host 加载 bundle；替换已安装包需要重启才能加载新的 JavaScript 模块代。

本机隔离实验步骤见仓库根目录 `scripts/dsh-lab.sh`。

## 隔离验证

隔离环境使用 `/tmp/aleph-dsh-lab` 作为 `DSH_HOME`，从 web 模板创建 `aleph-lab` profile，并在其中安装本 bundle。启动 Web Host 后：

- 页面侧栏出现 `Aleph` 入口，点击打开整页控制台；
- 控制台显示战役、SOTA、探索度、任务与分支；
- `/api/aleph/health` 与 `/api/aleph/snapshot` 返回 200；
- `dsh --profile aleph-lab --dump-config` 显示 `preset-aleph` 与 `preset-aleph-researcher`。

当前 DSH 未安装该插件，隔离环境没有账号与工作区会话，因此模式选择器未展开验证。

## 状态接口

Host 只使用 `node:fs/promises`、`node:os`、`node:path` 与全局 `Response`，不注册 Remote 方法，不打开 SQLite。

| 方法 | 路径 | 响应 |
| --- | --- | --- |
| GET/HEAD | `/api/aleph/health` | `{"ok":true,"version":"0.1.0"}` |
| GET/HEAD | `/api/aleph/snapshot` | `<workspace>/.aleph/dashboard.json` 的原始 JSON |

`snapshot` 读取顺序：

1. 读 `~/.aleph/current_workspace`，取首尾空白后的内容作为工作区绝对路径。
2. 读 `<workspace>/.aleph/dashboard.json`，校验 JSON 后原样返回。

错误响应统一为 `{"ok":false,"error":{"code":"...","message":"..."}}`：

| code | 触发条件 |
| --- | --- |
| `aleph/no-workspace` | `~/.aleph/current_workspace` 不存在、不可读或内容为空 |
| `aleph/read-failed` | `dashboard.json` 不存在、不可读或不是合法 JSON |

所有响应带 `cache-control: no-store`。

## 面板与槽位

- `main` 槽，key `aleph`：整页控制台。展示战役标题/状态/探索度/预算，SOTA 分支与分数，任务计数，任务表（状态、ID、策略、分支、分数、描述），分支表（名称、分数、父分支、任务、SOTA 标记），生成时间与工作区路径。
- `sidebar.panellist`，id `aleph`，order 20：侧栏图标行，标签取 `nav`；点击图标调用 `ctx.layout.selectPanel('aleph')`，行本身由 shell 负责选中。
- 控制台右上角"返回对话"按钮调用 `ctx.layout.selectPanel(null)`。
- 数据来自 `/api/aleph/snapshot`，首次立即请求，之后每 2 秒轮询；组件仅在面板被选中时挂载。字段缺失、类型不符、任务或分支为空都会降级显示，不会抛错。
- 颜色全部取自 `--dsw-alias-*` 主题 token，并带浅色 fallback；未硬编码深色主题。

## Preset

- `aleph`（order 20）：AlephResearch 研究总指挥。persona 要求通过 bash 调用 `aleph` CLI 管理战役、任务、运行与状态，明确禁止直接修改 `.aleph/state.sqlite`。工具：`tool-bash`、`tool-fs`、`tool-fs-search`、`tool-todo`、`skill-filesystem`、`tool-skill`。
- `aleph-researcher`（order 21）：研究员。persona 要求只在 worktree 中改代码，不运行 git，通过工具提交，不打开状态数据库。工具：`tool-bash`、`tool-fs`、`tool-fs-search`、`tool-todo`。

两个 preset 只引用 shipped 包名，不新增依赖。

## 已知限制

- 只读：控制台不回写任何状态，暂停、终止、回退 SOTA、调整探索度等操作留给后续版本。
- 依赖运行时：必须先由 `aleph` CLI 或运行时写入 `~/.aleph/current_workspace` 与 `.aleph/dashboard.json`，否则控制台显示空状态。
- 轮询固定 2 秒，没有 WebSocket/SSE 推送，也没有手动刷新按钮。
- `/api/aleph/snapshot` 与其它 Host 路由一样受 loopback 绑定保护，但本身不额外校验 cookie 或来源；本版定位为本机单用户使用。
- 会话头入口（`conversation.session.header.actions`）本版未实现，入口只有侧栏与服务模式选择。

## 设计取舍

实现以安装包内 `@deepseek-ai/dsh-host-webserver`、`@deepseek-ai/dsh-client-ui-layout`、`@deepseek-ai/dsh-client-ui-sidebar` 的 README 为准。Host 路由使用 node `handler` 形式：Fetch `resource` 形式在隔离运行时会返回 400，`handler` 形式稳定。skill 模板的 `decoration` 示例只注册 `conversation.composer.dock`，与本插件的整页面板目标不同，因此槽位与注册选项按上述 README 的 `main` keyed slot 与 `sidebar.panellist` 列表语义实现；`package.json` 的 `dsh.client` 结构与 `client.js` 的 `window.__ModuleLoader__.load` 工厂格式沿用模板。
