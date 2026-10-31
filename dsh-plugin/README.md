# @local/dsh-aleph-research

DSH-native AlephResearch bundle.

The Host entry initializes a project with separate research and mission git
repositories, an approved MissionQueue, a machine registry and a batch queue.
MissionComposer and InfraOptimizer run as `aleph-composer` and `aleph-infra`
subagents. The client entry adds the `Aleph` project console.

## Selecting the recorded best result

`POST /api/aleph/select-best` accepts `project_id` (or `projectId`) and a local
research `branch`, defaulting to `main`. It selects the recorded `best.commit`,
not an arbitrary historical evaluation. If the branch already points to that
commit, selection succeeds without changing files, the index or references,
including when the worktree has pending changes.

If selection would move a branch checked out in the main repository or any
linked worktree, the operation refuses before updating the reference. Its error
lists the exact worktree paths. Save or commit pending changes and switch each
listed worktree to another branch or detached HEAD, then retry. The Host does
not reset, stash, stage, commit or clean research files. Unoccupied local branches
are updated only if their tip still matches the tip read at request time; a
concurrent change causes selection to fail. Failure to enumerate worktrees also
fails the operation. These checks assume one Host and do not lock out an
independent Git process checking out the branch after occupancy is inspected.

## Presets

- `aleph`: Leader and approval tools.
- `aleph-researcher`: research work, mission proposal, evaluate and exit.
- `aleph-composer`: batch composition and conflict handling.
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
