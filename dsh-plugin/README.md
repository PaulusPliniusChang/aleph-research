# @local/dsh-aleph-research

DSH-native AlephResearch bundle.

The Host entry initializes a project with separate research and mission git
repositories, an approved MissionQueue, a machine registry and a batch queue.
MissionComposer and InfraOptimizer run as `aleph-composer` and `aleph-infra`
subagents. The client entry adds the `Aleph` project console.

## Presets

- `aleph`: Leader and approval tools.
- `aleph-researcher`: research work, mission proposal, evaluate and exit.
- `aleph-composer`: batch composition and conflict handling.
- `aleph-infra`: machine-specific batch code optimization.

Researcher activations use DSH's native `parent` delivery so the original Leader
receives a settlement notice with the researcher's closing message, even when
the researcher does not call `send_message`. The prompt asks the researcher to
include the actual final evaluation status, score and commit/report references;
these fields depend on the researcher's output. Aleph separately records the
researcher's status and summary from `activation.result`.

The native notice can arrive before that status write completes. Delivery
requires the original parent Agent to remain available; Aleph does not retry
unavailable or replaced parents, or create an additional completion message.

## Install

```bash
npm install --prefix .
dsh plugin --profile web add "$PWD"
```

## Development

```bash
npm install
npm test
node --check index-v2.js
node --check client.js
```
