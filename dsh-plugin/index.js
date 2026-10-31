/**
 * Host half of the AlephResearch plugin bundle.
 *
 * Exposes two read-only GET routes over the Web host server:
 *   - /api/aleph/health   liveness probe for the console
 *   - /api/aleph/snapshot the campaign snapshot written by the `aleph` runtime
 *
 * The snapshot route reads the workspace pointer at ~/.aleph/current_workspace
 * and then returns <workspace>/.aleph/dashboard.json verbatim. No database is
 * opened, no Remote method is registered, and nothing is written to disk.
 *
 * The routes use the web server's node-style `handler` form. The Fetch
 * `resource` form is advertised by the server package, but in this runtime it
 * returns 400 before the handler runs; the node form is stable here.
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PLUGIN_VERSION = '0.1.0';
const NO_STORE = { 'cache-control': 'no-store' };

/** Send a JSON response through the node HTTP response. */
function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    ...NO_STORE,
  });
  res.end(text);
}

/** A JSON response carrying a stable machine-readable error code. */
function failure(res, code, message, status = 200) {
  const error = { code };
  if (typeof message === 'string' && message !== '') error.message = message;
  sendJson(res, status, { ok: false, error });
}

/** Describe an unknown thrown value without leaking a stack trace. */
function describe(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Read the campaign snapshot:
 *   ~/.aleph/current_workspace -> <workspace>/.aleph/dashboard.json
 */
async function readSnapshot() {
  const pointerPath = join(homedir(), '.aleph', 'current_workspace');

  let workspace;
  try {
    workspace = (await readFile(pointerPath, 'utf8')).trim();
  } catch (error) {
    return { code: 'aleph/no-workspace', message: `cannot read ${pointerPath}: ${describe(error)}` };
  }
  if (workspace === '') {
    return { code: 'aleph/no-workspace', message: `${pointerPath} is empty` };
  }

  const dashboardPath = join(workspace, '.aleph', 'dashboard.json');
  let text;
  try {
    text = await readFile(dashboardPath, 'utf8');
  } catch (error) {
    return { code: 'aleph/read-failed', message: `cannot read ${dashboardPath}: ${describe(error)}` };
  }
  try {
    JSON.parse(text);
  } catch (error) {
    return { code: 'aleph/read-failed', message: `invalid JSON in ${dashboardPath}: ${describe(error)}` };
  }
  return { text };
}

/** Host plugin export: registers both routes and releases them on dispose. */
export function apply(ctx) {
  ctx.effect(() => {
    const disposeHealth = ctx.webServer.register({
      kind: 'exact',
      path: '/api/aleph/health',
      handler(req, res) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { allow: 'GET, HEAD' });
          res.end();
          return;
        }
        sendJson(res, 200, { ok: true, version: PLUGIN_VERSION });
      },
    });

    const disposeSnapshot = ctx.webServer.register({
      kind: 'exact',
      path: '/api/aleph/snapshot',
      async handler(req, res) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { allow: 'GET, HEAD' });
          res.end();
          return;
        }
        try {
          const result = await readSnapshot();
          if ('text' in result) {
            res.writeHead(200, {
              'content-type': 'application/json; charset=utf-8',
              'content-length': Buffer.byteLength(result.text),
              ...NO_STORE,
            });
            res.end(req.method === 'HEAD' ? undefined : result.text);
            return;
          }
          failure(res, result.code, result.message);
        } catch (error) {
          failure(res, 'aleph/read-failed', describe(error), 500);
        }
      },
    });

    return () => {
      disposeSnapshot();
      disposeHealth();
    };
  }, 'aleph-research: read-only snapshot routes');
}

export const inject = ['webServer'];
