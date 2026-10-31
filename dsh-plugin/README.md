# @local/dsh-aleph-research

DSH bundle for AlephResearch. The Host entry opens the `aleph_research`
storage domain, registers the `aleph_*` Leader tools and serves read-only state
routes. The `aleph` and `aleph-researcher` presets define the Leader and
single-mission researcher modes; the client entry adds the `Aleph` sidebar
console.

## Install

```bash
npm install --prefix .
dsh plugin --profile web add "$PWD"
```

The package peer-depends on `@deepseek-ai/dsh-storage-domain` and
`@deepseek-ai/dsh-tools`, resolved from the DSH installation. `zod` is a local
dependency and must be installed before adding the bundle when it is loaded
from a source directory.

## Tools

| Tool | Purpose |
| --- | --- |
| `aleph_start_campaign` | Create a campaign in a DSH workspace; accepts evaluator, visible-data, testset and submission-python paths. |
| `aleph_status` | Read campaigns and missions from the storage domain. |
| `aleph_enqueue_mission` | Queue one mission with an L0 to L3 strategy. |
| `aleph_run_next` | Start the next queued researcher subagent. |
| `aleph_compose_batch` | Compose a multi-mission batch with mixed strategies. |
| `aleph_run_available` | Dispatch queued missions up to the concurrency limit. |
| `aleph_infra_status` | Refresh CPU, GPU, memory, disk and concurrency capacity. |
| `aleph_set_exploration` | Change the campaign exploration level. |
| `aleph_set_budget` | Set or clear the campaign mission budget. |

Tools are visible only in the `aleph` preset.

## HTTP routes

- `GET /api/aleph/snapshot`: latest campaign snapshot for the console.
- `GET /api/aleph/campaigns`: all campaigns.
- `GET /api/aleph/health`: Host health and preset roster.
- `POST /api/aleph/start`: create a campaign from a workspace path.
- `POST /api/aleph/enqueue`: enqueue a mission.
- `POST /api/aleph/workspace`: create or bind a DSH workspace.

## Development

```bash
npm install
node --check index.js
node --check client.js
```
