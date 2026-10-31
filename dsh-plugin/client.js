/**
 * Client half of the AlephResearch plugin bundle.
 *
 * Registers:
 *   - main slot key `aleph`: the full-page read-only Research console
 *   - sidebar.panellist id `aleph`: the sidebar entry that opens it
 *
 * The console polls the Host route /api/aleph/snapshot every two seconds and
 * never writes anything back. All visible text goes through the Client locale
 * service; all colors and surfaces go through the host theme tokens with a
 * light-mode fallback.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-aleph-research',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'alephResearch';
    const PANEL_ID = 'aleph';
    const POLL_MS = 2000;

    const MISSION_COLUMNS = '96px minmax(84px, 120px) 76px minmax(120px, 1.4fr) 72px minmax(160px, 2fr)';
    const BRANCH_COLUMNS = 'minmax(150px, 1.6fr) 72px minmax(100px, 1fr) minmax(100px, 1fr) 64px';
    const BATCH_COLUMNS = 'minmax(90px, 0.8fr) minmax(220px, 2.4fr) 80px minmax(150px, 1fr)';

    const dict = {
      en: {
        nav: 'Aleph',
        'page.title': 'Aleph Research console',
        'page.subtitle': 'Read-only view of campaign state stored by the DSH Aleph Host service.',
        'action.back': 'Back to conversation',
        'state.loading': 'Loading campaign snapshot…',
        'state.empty.title': 'No campaign snapshot yet',
        'state.empty.detail': 'The Host service has no campaign yet. Start one from Leader mode with aleph_start_campaign.',
        'state.error.title': 'Cannot read the campaign snapshot',
        'state.error.detail': 'The console keeps retrying every 2 seconds.',
        'state.stale': 'Showing the last snapshot; the latest poll failed.',
        'section.campaign': 'Campaign',
        'section.sota': 'State of the art',
        'section.counts': 'Mission counts',
        'section.missions': 'Missions',
        'section.branches': 'Branches',
        'section.infra': 'InfraOptimizer',
        'section.batches': 'Composer batches',
        'section.agents': 'Orchestration agents',
        'field.role': 'Role',
        'field.agentStatus': 'Agent status',
        'field.child': 'Child session',
        'field.summary': 'Summary',
        'field.updated': 'Updated',
        'role.composer': 'Composer',
        'role.infra': 'InfraOptimizer',
        'empty.agents': 'No Composer or InfraOptimizer run yet.',
        'field.parallel': 'Parallel limit',
        'field.activeAgents': 'Active agents',
        'field.cpu': 'CPU cores',
        'field.gpu': 'GPUs',
        'field.disk': 'Disk free',
        'field.memory': 'Memory',
        'field.limit': 'Concurrency',
        'field.vramTotal': 'GPU VRAM',
        'field.cache': 'Eval cache',
        'field.gpuSeconds': 'GPU seconds',
        'field.evalSeconds': 'Eval seconds',
        'field.runtime': 'Eval runtime',
        'field.priority': 'Priority',
        'field.vram': 'VRAM MB',
        'table.batch': 'Batch',
        'field.brief': 'Brief',
        'field.count': 'Missions',
        'field.id': 'Campaign',
        'field.status': 'Status',
        'field.exploration': 'Exploration',
        'field.budget': 'Budget',
        'field.spent': 'Spent',
        'field.workspace': 'Workspace',
        'field.generated': 'Generated at',
        'field.sotaBranch': 'SOTA branch',
        'field.sotaScore': 'SOTA score',
        'field.score': 'Score',
        'field.strategy': 'Strategy',
        'field.branch': 'Branch',
        'field.parent': 'Parent',
        'field.mission': 'Mission',
        'field.description': 'Description',
        'field.created': 'Created',
        'field.finished': 'Finished',
        'table.mission': 'Mission',
        'table.branch': 'Branch',
        'table.status': 'Status',
        'table.strategy': 'Strategy',
        'table.score': 'Score',
        'table.description': 'Description',
        'status.queued': 'Queued',
        'status.running': 'Running',
        'status.done': 'Done',
        'status.failed': 'Failed',
        'status.unknown': 'Unknown',
        'count.queued': 'Queued',
        'count.running': 'Running',
        'count.done': 'Done',
        'count.failed': 'Failed',
        'branch.sota': 'SOTA',
        'empty.missions': 'No missions recorded yet.',
        'empty.branches': 'No branches recorded yet.',
        'empty.batches': 'No composed batches yet.',
        'value.none': '—',
        'updated.at': 'Last updated',
      },
      zh: {
        nav: 'Aleph',
        'page.title': 'Aleph Research 控制台',
        'page.subtitle': '只读展示 DSH Aleph Host 服务保存的战役状态。',
        'action.back': '返回对话',
        'state.loading': '正在加载战役快照…',
        'state.empty.title': '暂无战役快照',
        'state.empty.detail': 'Host 服务尚无战役；在 Leader 模式使用 aleph_start_campaign 创建。',
        'state.error.title': '无法读取战役快照',
        'state.error.detail': '控制台每 2 秒自动重试。',
        'state.stale': '正在显示最后一次快照；最近一次轮询失败。',
        'section.campaign': '战役',
        'section.sota': '当前最优',
        'section.counts': '任务计数',
        'section.missions': '任务',
        'section.branches': '分支',
        'section.infra': 'InfraOptimizer',
        'section.batches': 'Composer 批次',
        'section.agents': '编排 agent',
        'field.role': '角色',
        'field.agentStatus': 'Agent 状态',
        'field.child': '子会话',
        'field.summary': '摘要',
        'field.updated': '更新时间',
        'role.composer': 'Composer',
        'role.infra': 'InfraOptimizer',
        'empty.agents': '尚未运行 Composer 或 InfraOptimizer。',
        'field.parallel': '并发上限',
        'field.activeAgents': '活动 agent',
        'field.cpu': 'CPU 核数',
        'field.gpu': 'GPU',
        'field.disk': '磁盘可用',
        'field.memory': '内存',
        'field.limit': '并发限制',
        'field.vramTotal': 'GPU 显存',
        'field.cache': '评测缓存',
        'field.gpuSeconds': 'GPU 秒',
        'field.evalSeconds': '评测秒',
        'field.runtime': '评测运行时',
        'field.priority': '优先级',
        'field.vram': '显存 MB',
        'table.batch': '批次',
        'field.brief': '研究简述',
        'field.count': '任务数',
        'field.id': '战役',
        'field.status': '状态',
        'field.exploration': '探索度',
        'field.budget': '预算',
        'field.spent': '已花费',
        'field.workspace': '工作区',
        'field.generated': '生成时间',
        'field.sotaBranch': 'SOTA 分支',
        'field.sotaScore': 'SOTA 分数',
        'field.score': '分数',
        'field.strategy': '策略',
        'field.branch': '分支',
        'field.parent': '父分支',
        'field.mission': '任务',
        'field.description': '描述',
        'field.created': '创建时间',
        'field.finished': '完成时间',
        'table.mission': '任务',
        'table.branch': '分支',
        'table.status': '状态',
        'table.strategy': '策略',
        'table.score': '分数',
        'table.description': '描述',
        'status.queued': '排队中',
        'status.running': '运行中',
        'status.done': '已完成',
        'status.failed': '失败',
        'status.unknown': '未知',
        'count.queued': '排队',
        'count.running': '运行',
        'count.done': '完成',
        'count.failed': '失败',
        'branch.sota': 'SOTA',
        'empty.missions': '暂无任务记录。',
        'empty.branches': '暂无分支记录。',
        'empty.batches': '暂无 Composer 批次。',
        'value.none': '—',
        'updated.at': '最后更新',
      },
    };

    // Every color below is a host theme token with a light-mode fallback, so a
    // renamed or absent token only changes appearance and never breaks render.
    const TOKENS = {
      labelPrimary: 'var(--dsw-alias-label-primary, #1f2329)',
      labelSecondary: 'var(--dsw-alias-label-secondary, #4e5969)',
      labelTertiary: 'var(--dsw-alias-label-tertiary, #6b7280)',
      bgBase: 'var(--dsw-alias-bg-base, transparent)',
      bgLayer1: 'var(--dsw-alias-bg-layer-1, #ffffff)',
      bgLayer2: 'var(--dsw-alias-bg-layer-2, #f7f8fa)',
      borderL1: 'var(--dsw-alias-border-l1, #eef0f2)',
      borderL2: 'var(--dsw-alias-border-l2, #e5e6eb)',
      business: 'var(--dsw-alias-state-business-primary, #247bbf)',
      success: 'var(--dsw-alias-state-success-primary, #2ea121)',
      warn: 'var(--dsw-alias-state-warn-primary, #d97706)',
      error: 'var(--dsw-alias-state-error-primary, #d92d20)',
      brand: 'var(--dsw-alias-brand-primary, #247bbf)',
      hover: 'var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.04))',
    };

    const STATUS_COLORS = {
      queued: TOKENS.labelTertiary,
      running: TOKENS.business,
      done: TOKENS.success,
      failed: TOKENS.error,
    };
    const STATUS_KEYS = ['queued', 'running', 'done', 'failed'];
    const MISSING = 'value.none';

    const styles = {
      root: {
        boxSizing: 'border-box',
        height: '100%',
        width: '100%',
        overflow: 'auto',
        padding: 'calc(var(--dsh-frame-top-clearance, 0px) + 20px) 24px 32px',
        color: TOKENS.labelPrimary,
        background: TOKENS.bgBase,
        fontFamily: 'inherit',
        fontSize: 13,
        lineHeight: 1.5,
      },
      frame: { maxWidth: 1120, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 },
      header: {
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
      },
      title: { margin: 0, fontSize: 20, fontWeight: 600, lineHeight: 1.3, color: TOKENS.labelPrimary },
      subtitle: { margin: '4px 0 0', fontSize: 12.5, color: TOKENS.labelTertiary },
      headerActions: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
      button: {
        appearance: 'none',
        border: `1px solid ${TOKENS.borderL2}`,
        borderRadius: 8,
        background: TOKENS.bgLayer1,
        color: TOKENS.labelPrimary,
        fontFamily: 'inherit',
        fontSize: 13,
        lineHeight: '20px',
        padding: '5px 12px',
        cursor: 'pointer',
      },
      card: {
        boxSizing: 'border-box',
        border: `1px solid ${TOKENS.borderL2}`,
        borderRadius: 12,
        background: TOKENS.bgLayer1,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      },
      sectionTitle: {
        margin: 0,
        fontSize: 13,
        fontWeight: 600,
        color: TOKENS.labelSecondary,
        letterSpacing: '0.02em',
      },
      metricGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 12,
      },
      metric: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 },
      metricLabel: { fontSize: 11.5, color: TOKENS.labelTertiary },
      metricValue: {
        fontSize: 13.5,
        fontWeight: 500,
        color: TOKENS.labelPrimary,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12.5 },
      badge: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '1px 8px',
        borderRadius: 999,
        border: `1px solid ${TOKENS.borderL2}`,
        background: TOKENS.bgLayer2,
        fontSize: 12,
        lineHeight: '18px',
        whiteSpace: 'nowrap',
      },
      dot: { width: 7, height: 7, borderRadius: '50%', flex: '0 0 auto' },
      barTrack: {
        position: 'relative',
        height: 6,
        borderRadius: 999,
        background: TOKENS.bgLayer2,
        border: `1px solid ${TOKENS.borderL1}`,
        overflow: 'hidden',
        minWidth: 90,
        marginTop: 3,
      },
      barFill: { position: 'absolute', inset: 0, width: '0%', background: TOKENS.brand, borderRadius: 999 },
      tableWrap: { overflowX: 'auto', border: `1px solid ${TOKENS.borderL2}`, borderRadius: 10 },
      tableHeadRow: {
        display: 'grid',
        gap: 0,
        background: TOKENS.bgLayer2,
        borderBottom: `1px solid ${TOKENS.borderL2}`,
      },
      tableRow: { display: 'grid', gap: 0, borderTop: `1px solid ${TOKENS.borderL1}` },
      headCell: {
        padding: '7px 12px',
        fontSize: 11.5,
        fontWeight: 600,
        color: TOKENS.labelTertiary,
        whiteSpace: 'nowrap',
      },
      cell: {
        padding: '8px 12px',
        fontSize: 12.5,
        color: TOKENS.labelSecondary,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        minWidth: 0,
      },
      cellPrimary: { color: TOKENS.labelPrimary, fontWeight: 500 },
      empty: {
        padding: '28px 16px',
        textAlign: 'center',
        color: TOKENS.labelTertiary,
        fontSize: 12.5,
      },
      stateCard: {
        border: `1px solid ${TOKENS.borderL2}`,
        borderRadius: 12,
        background: TOKENS.bgLayer1,
        padding: '40px 24px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
      },
      stateTitle: { margin: 0, fontSize: 15, fontWeight: 600, color: TOKENS.labelPrimary },
      stateDetail: { margin: 0, fontSize: 12.5, color: TOKENS.labelTertiary, maxWidth: 560 },
      stateCode: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 11.5, color: TOKENS.labelTertiary },
      stale: {
        border: `1px solid ${TOKENS.warn}`,
        borderRadius: 8,
        padding: '6px 10px',
        fontSize: 12,
        color: TOKENS.labelSecondary,
        background: TOKENS.bgLayer2,
      },
      footer: {
        display: 'flex',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
        color: TOKENS.labelTertiary,
        fontSize: 11.5,
        paddingTop: 4,
      },
      counts: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 },
      countTile: {
        border: `1px solid ${TOKENS.borderL1}`,
        borderRadius: 10,
        background: TOKENS.bgLayer2,
        padding: '8px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      },
      countValue: { fontSize: 17, fontWeight: 600, color: TOKENS.labelPrimary },
      countLabel: { fontSize: 11.5, color: TOKENS.labelTertiary },
      sotaRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 },
      sotaValue: {
        fontSize: 18,
        fontWeight: 600,
        color: TOKENS.labelPrimary,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      twoCards: { display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(220px, 1fr)', gap: 16 },
    };

    /** Trim a numeric value to a compact, fixed-precision string. */
    function formatNumber(value, digits) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      return value.toFixed(digits);
    }

    /** Format a byte count compactly. */
    function formatBytes(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
      let amount = Math.max(0, value);
      let index = 0;
      while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
      return amount.toFixed(index === 0 ? 0 : 1) + ' ' + units[index];
    }

    /** Format an ISO timestamp in the browser locale, or return the raw string. */
    function formatDate(value) {
      if (typeof value !== 'string' || value === '') return null;
      const time = Date.parse(value);
      if (!Number.isFinite(time)) return value;
      try {
        return new Date(time).toLocaleString();
      } catch {
        return value;
      }
    }

    /** Format a poll timestamp as a wall-clock time. */
    function formatClock(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      try {
        return new Date(value).toLocaleTimeString();
      } catch {
        return null;
      }
    }

    /** Normalize a mission status to one of the four known states. */
    function normalizeStatus(value) {
      return typeof value === 'string' && STATUS_KEYS.indexOf(value) !== -1 ? value : 'unknown';
    }

    /** Read-only snapshot polling. Keeps the last good snapshot on failure. */
    function useSnapshot() {
      const [state, setState] = React.useState({ phase: 'loading', snapshot: null, error: null, fetchedAt: null });

      React.useEffect(() => {
        let stopped = false;
        let timer = null;

        async function poll() {
          try {
            const response = await fetch('/api/aleph/snapshot', {
              cache: 'no-store',
              headers: { accept: 'application/json' },
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const body = await response.json();
            if (stopped) return;
            if (body && typeof body === 'object' && body.ok === false) {
              const error = body.error && typeof body.error === 'object' ? body.error : {};
              setState({
                phase: 'empty',
                snapshot: null,
                error: {
                  code: typeof error.code === 'string' ? error.code : 'aleph/no-snapshot',
                  message: typeof error.message === 'string' ? error.message : '',
                },
                fetchedAt: Date.now(),
              });
              return;
            }
            setState({
              phase: 'ready',
              snapshot: body && typeof body === 'object' ? body : {},
              error: null,
              fetchedAt: Date.now(),
            });
          } catch (error) {
            if (stopped) return;
            const message = error instanceof Error ? error.message : String(error);
            setState((previous) => {
              const failure = { code: 'aleph/unreachable', message };
              if (previous.phase === 'ready') {
                return { ...previous, error: failure, fetchedAt: previous.fetchedAt };
              }
              return { phase: 'error', snapshot: null, error: failure, fetchedAt: null };
            });
          }
        }

        poll();
        timer = setInterval(poll, POLL_MS);
        return () => {
          stopped = true;
          if (timer !== null) clearInterval(timer);
        };
      }, []);

      return state;
    }

    /** A status pill with a colored dot; tolerates unknown statuses. */
    function statusPill(t, status) {
      const key = normalizeStatus(status);
      return h(
        'span',
        { style: styles.badge },
        h('span', { style: { ...styles.dot, background: STATUS_COLORS[key] } }),
        t('status.' + key),
      );
    }

    /** One label/value pair inside a metric grid. */
    function metric(label, value) {
      return h(
        'div',
        { style: styles.metric },
        h('span', { style: styles.metricLabel }, label),
        h('span', { style: styles.metricValue }, value === null || value === undefined || value === '' ? '—' : value),
      );
    }

    /** A metric whose value can be a rendered node. */
    function metricNode(label, node) {
      return h('div', { style: styles.metric }, h('span', { style: styles.metricLabel }, label), node);
    }

    /** Exploration bar plus percentage; clamps out-of-range and non-numeric values. */
    function explorationBlock(t, value) {
      const ratio = typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
      const percent = ratio === null ? null : Math.round(ratio * 100) + '%';
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 1 } },
        h('span', { style: styles.metricValue }, percent === null ? t(MISSING) : percent),
        h(
          'div',
          { style: styles.barTrack, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': ratio === null ? 0 : Math.round(ratio * 100) },
          h('div', { style: { ...styles.barFill, width: ratio === null ? '0%' : percent } }),
        ),
      );
    }

    /** Build one grid row of table cells from a column list. */
    function tableRow(columns, row, key, rowStyle) {
      return h(
        'div',
        { style: { ...styles.tableRow, ...(rowStyle || {}) }, key },
        columns.map((column, index) =>
          h(
            'div',
            {
              key: String(index),
              style: { ...styles.cell, ...(column.primary ? styles.cellPrimary : null), ...(column.mono ? styles.mono : null) },
              title: typeof column.title === 'function' ? column.title(row) : undefined,
            },
            column.render(row),
          ),
        ),
      );
    }

    /** A stacked-head table that tolerates missing fields and empty lists. */
    function table(t, columns, rows, emptyText) {
      const grid = { gridTemplateColumns: columns.map((column) => column.width).join(' ') };
      return h(
        'div',
        { style: styles.tableWrap },
        h(
          'div',
          { style: { ...styles.tableHeadRow, ...grid } },
          columns.map((column, index) => h('div', { key: String(index), style: styles.headCell }, column.label)),
        ),
        rows.length === 0
          ? h('div', { style: styles.empty }, emptyText)
          : rows.map((row, index) => tableRow(columns, row, String(index), grid)),
      );
    }

    /** The mission rows, filtered to plain objects and capped for the page. */
    function missionList(snapshot) {
      const list = Array.isArray(snapshot?.missions) ? snapshot.missions : [];
      return list.filter((mission) => mission && typeof mission === 'object').slice(0, 500);
    }

    /** Count missions by status, falling back to a local count if `counts` is absent. */
    function missionCounts(snapshot) {
      const counts = snapshot && typeof snapshot.counts === 'object' && snapshot.counts !== null ? snapshot.counts : {};
      const list = Array.isArray(snapshot?.missions) ? snapshot.missions : [];
      const result = {};
      for (const key of STATUS_KEYS) {
        const value = counts[key];
        result[key] = typeof value === 'number' && Number.isFinite(value)
          ? value
          : list.filter((mission) => mission && mission.status === key).length;
      }
      return result;
    }

    /** InfraOptimizer capacity card. */
    function infraSection(t, campaign) {
      const infra = campaign && typeof campaign.infra === 'object' && campaign.infra !== null ? campaign.infra : {};
      const gpu = Array.isArray(infra.gpuNames) && infra.gpuNames.length > 0 ? infra.gpuNames.join(', ') : '0';
      return h(
        'section',
        { style: styles.card },
        h('h2', { style: styles.sectionTitle }, t('section.infra')),
        h(
          'div',
          { style: styles.metricGrid },
          metric(t('field.cpu'), formatNumber(infra.cpuCount, 0) ?? '—'),
          metric(t('field.gpu'), gpu),
          metric(t('field.disk'), formatBytes(infra.diskFreeBytes) ?? '—'),
          metric(t('field.memory'), formatBytes(infra.memoryTotalBytes) ?? '—'),
          metric(t('field.limit'), formatNumber(campaign.max_parallel, 0) ?? '—'),
          metric(t('field.vramTotal'), infra.gpuMemoryTotalMb != null ? formatNumber(infra.gpuMemoryTotalMb, 0) + ' MB' : '—'),
          metric(t('field.cache'), campaign.cache ? `${campaign.cache.hits}/${campaign.cache.hits + campaign.cache.misses}` : '—'),
          metric(t('field.gpuSeconds'), campaign.cost_profile ? formatNumber(campaign.cost_profile.gpuSeconds, 1) : '—'),
          metric(t('field.evalSeconds'), campaign.cost_profile ? formatNumber(campaign.cost_profile.evalSeconds, 1) : '—'),
          metric(t('field.runtime'), campaign.runtime ? `${campaign.runtime.ompThreads || 'auto'} / ${Math.round(campaign.runtime.evalTimeoutMs / 1000)}s` : '—'),
        ),
      );
    }

    /** Composer and InfraOptimizer agent runs. */
    function agentSection(t, campaign) {
      const agents = Array.isArray(campaign?.agents) ? campaign.agents : [];
      const roleName = (role) => t('role.' + role);
      const columns = [
        { label: t('field.role'), width: 'minmax(110px, 0.9fr)', primary: true, render: (agent) => roleName(agent.role) ?? agent.role ?? '—' },
        { label: t('field.agentStatus'), width: '96px', render: (agent) => statusPill(t, agent.status) },
        { label: t('field.child'), width: 'minmax(150px, 1.4fr)', mono: true, render: (agent) => agent.childId ?? '—' },
        { label: t('field.updated'), width: 'minmax(140px, 1fr)', render: (agent) => formatDate(agent.updatedAt) ?? '—' },
        { label: t('field.summary'), width: 'minmax(220px, 2.6fr)', render: (agent) => { const text = typeof agent.summary === 'string' ? agent.summary : ''; return h('span', { title: text || undefined }, text.length > 240 ? text.slice(0, 240) + '…' : text || '—'); } },
      ];
      return h(
        'section',
        { style: styles.card },
        h('h2', { style: styles.sectionTitle }, t('section.agents')),
        table(t, columns, agents.slice(-8), t('empty.agents')),
      );
    }

    /** Composer batch card. */
    function batchSection(t, snapshot, batches) {
      const columns = [
        { label: t('table.batch'), width: 'minmax(90px, 0.8fr)', mono: true, primary: true, render: (batch) => batch.id ?? '—' },
        { label: t('field.brief'), width: 'minmax(220px, 2.4fr)', render: (batch) => batch.brief ?? '—' },
        { label: t('field.count'), width: '80px', render: (batch) => formatNumber(batch.count, 0) ?? '—' },
        { label: t('field.created'), width: 'minmax(150px, 1fr)', render: (batch) => formatDate(batch.createdAt) ?? '—' },
      ];
      return h(
        'section',
        { style: styles.card },
        h('h2', { style: styles.sectionTitle }, t('section.batches')),
        table(t, columns, batches, t('empty.batches')),
      );
    }

    /** The campaign console page body; `snapshot` is untrusted JSON. */
    function consoleBody(t, snapshot) {
      const campaign = snapshot && typeof snapshot.campaign === 'object' && snapshot.campaign !== null ? snapshot.campaign : {};
      const counts = missionCounts(snapshot);
      const generated = formatDate(snapshot?.generated_at);
      const missions = Array.isArray(snapshot?.missions) ? snapshot.missions : [];
      const branches = Array.isArray(snapshot?.branches) ? snapshot.branches : [];
      const batches = Array.isArray(campaign?.batches) ? campaign.batches : [];

      const campaignCard = h(
        'div',
        { style: styles.card },
        h('h2', { style: styles.sectionTitle }, t('section.campaign')),
        h(
          'div',
          { style: styles.metricGrid },
          metric(t('field.id'), campaign.id ?? t(MISSING)),
          metricNode(t('field.status'), statusPill(t, campaign.status)),
          metricNode(t('field.exploration'), explorationBlock(t, campaign.exploration)),
          metric(t('field.budget'), formatNumber(campaign.budget, 2) ?? t(MISSING)),
          metric(t('field.spent'), formatNumber(campaign.spent, 2)),
          metric(t('field.parallel'), formatNumber(campaign.max_parallel, 0) ?? '1'),
          metric(t('field.activeAgents'), formatNumber(campaign.active_agents, 0) ?? '0'),
          metric(t('field.generated'), generated),
        ),
        h(
          'div',
          { style: { ...styles.metricGrid, gridColumn: '1 / -1' } },
          metricNode(t('field.workspace'), h('span', { style: { ...styles.metricValue, ...styles.mono, whiteSpace: 'normal', wordBreak: 'break-all' } }, snapshot?.workspace ?? t(MISSING))),
        ),
      );

      const sotaCard = h(
        'div',
        { style: styles.card },
        h('h2', { style: styles.sectionTitle }, t('section.sota')),
        h(
          'div',
          { style: styles.sotaRow },
          metricNode(
            t('field.sotaBranch'),
            h('span', { style: { ...styles.sotaValue, ...styles.mono } }, campaign.sota_branch ?? t(MISSING)),
          ),
          metricNode(t('field.sotaScore'), h('span', { style: styles.sotaValue }, formatNumber(campaign.sota_score, 3) ?? t(MISSING))),
        ),
      );

      const countsCard = h(
        'div',
        { style: styles.card },
        h('h2', { style: styles.sectionTitle }, t('section.counts')),
        h(
          'div',
          { style: styles.counts },
          STATUS_KEYS.map((key) =>
            h(
              'div',
              { key },
              h(
                'div',
                { style: styles.countTile },
                h('span', { style: styles.countValue }, String(counts[key])),
                h('span', { style: styles.countLabel }, t('count.' + key)),
              ),
            ),
          ),
        ),
      );

      const missionColumns = [
        { label: t('table.status'), width: '96px', render: (mission) => statusPill(t, mission.status) },
        { label: t('table.mission'), width: 'minmax(84px, 120px)', mono: true, primary: true, render: (mission) => String(mission.id ?? '—') },
        { label: t('table.strategy'), width: '76px', render: (mission) => mission.strategy ?? '—' },
        { label: t('field.priority'), width: '64px', render: (mission) => formatNumber(mission.priority, 0) ?? '—' },
        { label: t('field.vram'), width: '76px', render: (mission) => formatNumber(mission.vram_mb, 0) ?? '—' },
        { label: t('table.branch'), width: 'minmax(120px, 1.4fr)', mono: true, render: (mission) => mission.branch ?? '—' },
        { label: t('table.score'), width: '72px', render: (mission) => formatNumber(mission.score, 3) ?? '—' },
        {
          label: t('table.description'),
          width: 'minmax(160px, 2fr)',
          render: (mission) =>
            h('span', { title: typeof mission.description === 'string' ? mission.description : undefined }, mission.description ?? '—'),
        },
      ];

      const branchColumns = [
        { label: t('table.branch'), width: 'minmax(150px, 1.6fr)', mono: true, primary: true, render: (branch) => branch.name ?? '—' },
        { label: t('table.score'), width: '72px', render: (branch) => formatNumber(branch.score, 3) ?? '—' },
        { label: t('field.parent'), width: 'minmax(100px, 1fr)', mono: true, render: (branch) => branch.parent ?? '—' },
        { label: t('field.mission'), width: 'minmax(100px, 1fr)', mono: true, render: (branch) => branch.mission ?? '—' },
        {
          label: '',
          width: '64px',
          render: (branch) => (branch.is_sota === true ? h('span', { style: { ...styles.badge, color: TOKENS.success } }, t('branch.sota')) : null),
        },
      ];

      return h(
        'div',
        { style: styles.frame },
        h('div', { style: styles.twoCards }, campaignCard, sotaCard),
        countsCard,
        infraSection(t, campaign),
        agentSection(t, campaign),
        batchSection(t, snapshot, batches),
        h(
          'section',
          { style: styles.card },
          h('h2', { style: styles.sectionTitle }, t('section.missions')),
          table(t, missionColumns, missionList(snapshot), t('empty.missions')),
        ),
        h(
          'section',
          { style: styles.card },
          h('h2', { style: styles.sectionTitle }, t('section.branches')),
          table(t, branchColumns, branches.filter((branch) => branch && typeof branch === 'object').slice(0, 500), t('empty.branches')),
        ),
        h(
          'div',
          { style: styles.footer },
          h('span', null, generated ? t('field.generated') + ': ' + generated : ''),
          h('span', null, snapshot?.schema !== undefined ? 'schema ' + String(snapshot.schema) : ''),
          h('span', null, 'missions: ' + String(missions.length) + ' · branches: ' + String(branches.length)),
        ),
      );
    }

    /** Centered state card for loading, empty, and error phases. */
    function stateCard(title, detail, code) {
      return h(
        'div',
        { style: styles.stateCard, role: 'status' },
        h('h2', { style: styles.stateTitle }, title),
        h('p', { style: styles.stateDetail }, detail),
        code ? h('p', { style: styles.stateCode }, code) : null,
      );
    }

    /** Root page: polling state machine around the console body. */
    function ConsoleView(props) {
      const t = props.t;
      const state = useSnapshot();
      const snapshot = state.snapshot;
      const campaign = snapshot && typeof snapshot.campaign === 'object' && snapshot.campaign !== null ? snapshot.campaign : null;
      const campaignName = campaign ? campaign.title ?? campaign.id : null;

      let content;
      if (state.phase === 'loading') content = stateCard(t('state.loading'), '');
      else if (state.phase === 'empty') {
        const code = state.error?.code ?? '';
        const detail = state.error?.message ? t('state.empty.detail') + ' ' + state.error.message : t('state.empty.detail');
        content = stateCard(t('state.empty.title'), detail, code);
      } else if (state.phase === 'error') {
        content = stateCard(t('state.error.title'), t('state.error.detail') + ' ' + (state.error?.message ?? ''), state.error?.code);
      } else content = consoleBody(t, snapshot);

      return h(
        'div',
        { style: styles.root },
        h(
          'div',
          { style: styles.frame },
          h(
            'header',
            { style: styles.header },
            h(
              'div',
              { style: { minWidth: 0 } },
              h('h1', { style: styles.title }, campaignName ? t('page.title') + ' · ' + campaignName : t('page.title')),
              h('p', { style: styles.subtitle }, t('page.subtitle')),
            ),
            h(
              'div',
              { style: styles.headerActions },
              state.phase === 'ready' ? statusPill(t, campaign?.status) : null,
              h('span', { style: { fontSize: 11.5, color: TOKENS.labelTertiary } }, formatClock(state.fetchedAt) ? t('updated.at') + ': ' + formatClock(state.fetchedAt) : ''),
              h('button', { type: 'button', style: styles.button, onClick: props.onClose }, t('action.back')),
            ),
          ),
          state.phase === 'ready' && state.error ? h('div', { style: styles.stale }, t('state.stale') + ' ' + (state.error.message ?? '')) : null,
          content,
        ),
      );
    }

    /** Sidebar glyph. The shell owns the row; this also selects the panel on click. */
    function makePanelIcon(select) {
      return function PanelIcon(props) {
        const size = typeof props?.size === 'number' ? props.size : 16;
        return h(
          'svg',
          {
            viewBox: '0 0 16 16',
            width: size,
            height: size,
            fill: 'none',
            xmlns: 'http://www.w3.org/2000/svg',
            'aria-hidden': 'true',
            'data-dsh-panel-entry': PANEL_ID,
            onClick: select,
            style: { display: 'block', cursor: 'pointer' },
          },
          h('path', {
            d: 'M3 13.2 8 2.8l5 10.4',
            stroke: 'currentColor',
            strokeWidth: 1.6,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
          h('circle', { cx: 8, cy: 10.4, r: 1.1, fill: 'currentColor' }),
        );
      };
    }

    return {
      name: '@local/dsh-aleph-research',
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dict), 'aleph-research: locale dictionaries');

        const t = ctx.locale.bind(NS);
        const openPanel = () => ctx.layout?.selectPanel?.(PANEL_ID);
        const closePanel = () => ctx.layout?.selectPanel?.(null);
        const PanelIcon = makePanelIcon(openPanel);

        function PanelPage() {
          return h(ConsoleView, { t, onClose: closePanel });
        }

        return ctx.effect(() => {
          const disposeMain = ctx.slots.inject('main', () =>
            ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, PanelPage),
          );
          const disposeRow = ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              { name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => t('nav'), locale: NS },
              PanelIcon,
            ),
          );
          return () => {
            disposeRow();
            disposeMain();
          };
        }, 'aleph-research: console panel and sidebar row');
      },
    };
  },
});
