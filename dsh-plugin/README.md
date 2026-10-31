# @local/dsh-aleph-research

DSH-native AlephResearch bundle.

The Host entry initializes a project with separate research and mission git
repositories, an approved MissionQueue, a machine registry and a batch queue.
MissionComposer and InfraOptimizer run as `aleph-composer` and `aleph-infra`
subagents. The client entry adds the `Aleph` project console.

## Presets

- `aleph`: Leader and approval tools.
- `aleph-researcher`: research work, mission proposal, evaluate and exit.
- `aleph-composer`: batch composition, conflict handling, direct batch execution
  and InfraOptimizer dispatch. The Infra dispatch tool is available to the
  Leader and Composer; researchers and InfraOptimizer do not receive it.
- `aleph-infra`: machine-specific batch code optimization.

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
