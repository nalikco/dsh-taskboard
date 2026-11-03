/**
 * Host half of TaskBoard.
 *
 * - One JSON store owns every task. The board UI (same-origin `/taskboard/api/op`) and the agent tool (`taskboard`)
 *   call the same operations, so both see the same data.
 * - `/taskboard/api/regenerate` rewrites a rough task note into a clear title with the default model.
 */
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const inject = ['webServer', 'llm', 'agentDefaultModel', 'workspaceRegistry', 'sessionQuery', 'tools', 'agents'];

const COLUMNS = ['todo', 'doing', 'done'];
const TITLE_MAX = 500;

const SYSTEM = [
  'You rewrite rough task notes into one clear task title for an agile board.',
  'Keep the language of the input. Keep every concrete fact, name and number; add nothing new.',
  'Use an imperative or noun phrase, at most 90 characters, no trailing period, no quotes, no markdown.',
  'When session context is given, it shows what the user is already working on for this task; use it to align terms and scope.',
  'When project context is given, use it only to resolve ambiguous terms and to pick precise wording; never copy it into the title.',
  'Reply with the title only.',
].join(' ');

const DOCS = ['AGENTS.md', 'CLAUDE.md', 'README.md'];
const HIDDEN_OK = new Set(['.github']);

/** Read-only, size-capped project summary: name, top-level entries, package description, head of one guidance doc. */
async function projectContext(workspace) {
  const parts = [`Project: ${workspace.title}`];
  try {
    const names = (await readdir(workspace.path, { withFileTypes: true }))
      .filter((e) => !e.name.startsWith('.') || HIDDEN_OK.has(e.name))
      .filter((e) => e.name !== 'node_modules')
      .slice(0, 40).map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    if (names.length) parts.push(`Top-level entries: ${names.join(', ')}`);
  } catch {}
  try {
    const pkg = JSON.parse(await readFile(join(workspace.path, 'package.json'), 'utf8'));
    if (typeof pkg.description === 'string' && pkg.description) parts.push(`package.json description: ${pkg.description.slice(0, 300)}`);
  } catch {}
  for (const name of DOCS) {
    try {
      const text = await readFile(join(workspace.path, name), 'utf8');
      parts.push(`${name} (start):\n${text.slice(0, 2000)}`);
      break;
    } catch {}
  }
  return parts.join('\n');
}

/** Read-only session summary: title plus the first and the last few user messages, each capped. Replies and tool output stay out. */
async function sessionContext(ctx, sessionId) {
  const parts = [];
  try {
    const title = await ctx.sessionQuery.readTitle(sessionId);
    if (title && title.title) parts.push(`Session title: ${title.title.slice(0, 200)}`);
  } catch {}
  try {
    const docs = await ctx.sessionQuery.filterEvents(sessionId, [{ kind: 'type', values: ['user/message'] }, { kind: 'surface', values: ['current'] }]);
    const texts = docs.map((d) => (d.text || '').trim()).filter(Boolean);
    const picked = texts.length <= 4 ? texts : [texts[0], ...texts.slice(-3)];
    picked.forEach((text, i) => parts.push(`${i === 0 ? 'First' : 'Recent'} user message:\n${text.slice(0, 700)}`));
  } catch {}
  return parts.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------
// Store

/** Validated copy of one task; unknown fields are dropped so a hand-edited or imported file cannot smuggle data in. */
function cleanTask(raw, now) {
  if (!raw || typeof raw !== 'object') return undefined;
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, TITLE_MAX) : '';
  if (!title) return undefined;
  const task = {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : randomUUID(),
    title,
    col: COLUMNS.includes(raw.col) ? raw.col : 'todo',
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
  };
  if (typeof raw.workspaceId === 'string' && raw.workspaceId) task.workspaceId = raw.workspaceId;
  if (typeof raw.sessionId === 'string' && raw.sessionId) task.sessionId = raw.sessionId;
  return task;
}

class Store {
  constructor(file) {
    this.file = file;
    this.data = undefined;
    this.queue = Promise.resolve();
  }

  async load() {
    if (this.data) return this.data;
    let text;
    try { text = await readFile(this.file, 'utf8'); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    // A file that exists but does not parse stays untouched: the error surfaces instead of silently starting empty.
    const parsed = text === undefined ? { revision: 0, migrated: false, tasks: [] } : JSON.parse(text);
    const now = Date.now();
    this.data = {
      revision: Number.isFinite(parsed.revision) ? parsed.revision : 0,
      migrated: parsed.migrated === true,
      tasks: (Array.isArray(parsed.tasks) ? parsed.tasks : []).map((t) => cleanTask(t, now)).filter(Boolean),
    };
    return this.data;
  }

  async read() {
    const data = await (this.queue = this.queue.then(() => this.load()));
    return data;
  }

  /** Apply `change` to a draft, persist it atomically, then publish it; a throwing change leaves everything as it was. */
  mutate(change) {
    const run = this.queue.then(async () => {
      const current = await this.load();
      const draft = structuredClone(current);
      const result = change(draft);
      draft.revision = current.revision + 1;
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify({ version: 1, ...draft }, null, 2), 'utf8');
      await rename(tmp, this.file);
      this.data = draft;
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

const view = (data) => ({ revision: data.revision, migrated: data.migrated, tasks: data.tasks });
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/** The operations both callers share. Each returns the whole board so the UI can replace its state in one step. */
function operations(store) {
  const find = (draft, id) => {
    const task = draft.tasks.find((t) => t.id === id);
    if (!task) throw fail(`Task "${id}" not found`, 404);
    return task;
  };
  const text = (value) => {
    if (typeof value !== 'string' || !value.trim()) throw fail('Title must be a non-empty string');
    return value.trim().slice(0, TITLE_MAX);
  };
  const column = (value) => {
    if (!COLUMNS.includes(value)) throw fail(`Column must be one of: ${COLUMNS.join(', ')}`);
    return value;
  };
  const link = (task, key, value) => {
    if (value === undefined) return;
    if (value === null || value === '') delete task[key];
    else if (typeof value === 'string') task[key] = value;
    else throw fail(`${key} must be a string or null`);
  };
  return {
    list: async ({ since }) => {
      const data = await store.read();
      return since === data.revision ? { unchanged: true, revision: data.revision } : view(data);
    },
    import: ({ tasks }) => store.mutate((draft) => {
      if (draft.migrated) return view(draft);
      const now = Date.now();
      const seen = new Set(draft.tasks.map((t) => t.id));
      for (const raw of Array.isArray(tasks) ? tasks.slice(0, 2000) : []) {
        const task = cleanTask(raw, now);
        if (task && !seen.has(task.id)) { seen.add(task.id); draft.tasks.push(task); }
      }
      draft.migrated = true;
      return view(draft);
    }),
    add: (args) => store.mutate((draft) => {
      const now = Date.now();
      const task = { id: randomUUID(), title: text(args.title), col: args.col === undefined ? 'todo' : column(args.col), createdAt: now, updatedAt: now };
      link(task, 'workspaceId', args.workspaceId);
      link(task, 'sessionId', args.sessionId);
      draft.tasks.push(task);
      return { ...view(draft), task };
    }),
    update: (args) => store.mutate((draft) => {
      const task = find(draft, args.id);
      if (args.title !== undefined) task.title = text(args.title);
      if (args.col !== undefined) task.col = column(args.col);
      link(task, 'workspaceId', args.workspaceId);
      link(task, 'sessionId', args.sessionId);
      task.updatedAt = Date.now();
      return { ...view(draft), task };
    }),
    move: (args) => store.mutate((draft) => {
      const task = find(draft, args.id);
      task.col = column(args.col);
      task.updatedAt = Date.now();
      return { ...view(draft), task };
    }),
    remove: (args) => store.mutate((draft) => {
      const task = find(draft, args.id);
      draft.tasks = draft.tasks.filter((t) => t !== task);
      return { ...view(draft), removed: task };
    }),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// HTTP

function send(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(fail('Request too large', 413)); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Agent tool

const string = (description) => ({ type: 'string', description });
const output = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
};

export function apply(ctx) {
  const origin = new URL(ctx.webServer.getOrigin());
  const allowed = new Set([origin.host, `localhost:${origin.port}`, `127.0.0.1:${origin.port}`]);
  const file = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'state', 'taskboard', 'tasks.json');
  const store = new Store(file);
  const ops = operations(store);

  const sameOrigin = (req) => allowed.has(req.headers.host ?? '') && req.headers['x-taskboard-request'] === '1'
    && (req.headers.origin === undefined || req.headers.origin === `http://${req.headers.host}`);

  const guarded = (handler) => async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    if (!sameOrigin(req)) return send(res, 403, { error: 'Same-origin request required' });
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    try {
      const body = JSON.parse(await readBody(req, 256_000) || '{}');
      await handler(body, res, abort.signal);
    } catch (error) {
      if (!res.writableEnded) send(res, error?.status ?? 500, { error: error instanceof Error ? error.message : String(error) });
    }
  };

  // --- board operations for the UI
  const disposeOp = ctx.webServer.register({
    kind: 'exact',
    path: '/taskboard/api/op',
    handler: guarded(async (body, res) => {
      const run = ops[body.op];
      if (typeof run !== 'function' || !Object.hasOwn(ops, body.op)) throw fail('Unknown operation');
      send(res, 200, await run(body));
    }),
  });

  // --- title regeneration
  const disposeRegenerate = ctx.webServer.register({
    kind: 'exact',
    path: '/taskboard/api/regenerate',
    handler: guarded(async ({ text, workspaceId, sessionId }, res, signal) => {
      if (typeof text !== 'string' || !text.trim()) throw fail('Empty text');
      const workspace = typeof workspaceId === 'string' && workspaceId ? ctx.workspaceRegistry.get(workspaceId) : undefined;
      const context = workspace ? await projectContext(workspace) : '';
      const sessionNote = typeof sessionId === 'string' && sessionId ? await sessionContext(ctx, sessionId) : '';
      const selection = ctx.agentDefaultModel.currentSelection();
      const config = await ctx.llm.resolveCallConfig({ provider: selection.provider, model: selection.model, maxTokens: 4000 }, signal);
      let out = ''; let reason = 'unknown';
      for await (const chunk of ctx.llm.stream({
        ...config, system: SYSTEM, signal,
        messages: [{ role: 'user', content: [{ type: 'text', text: (context ? `<project_context>\n${context}\n</project_context>\n\n` : '') + (sessionNote ? `<session_context>\n${sessionNote}\n</session_context>\n\n` : '') + `Task note:\n${text.trim().slice(0, 4000)}` }] }],
      })) {
        if (chunk.type === 'text-delta') out += chunk.text;
        else if (chunk.type === 'finish') { reason = chunk.reason.kind; if (reason === 'error' || reason === 'aborted') throw new Error(chunk.reason.failure.message); }
      }
      const title = out.trim().replace(/^["«“]+|["»”]+$/g, '').replace(/\s+/g, ' ');
      if (!title) throw fail(`Empty answer (${reason})`, 502);
      send(res, 200, { title });
    }),
  });

  // --- agent tool
  const agentOf = (exec) => {
    const agent = exec.agent && ctx.agents.get(exec.agent.id);
    if (!agent?.session) throw new Error('TaskBoard requires a live agent');
    return agent;
  };
  const assertWritable = (exec) => {
    const agent = agentOf(exec);
    const policy = ctx.get('sandboxPolicy')?.resolve({ session: agent.session });
    if (policy?.mode === 'read-only') throw new Error('TaskBoard changes are disabled by read-only policy');
    const plan = agent.ctx.get('planMode')?.get(agent);
    if (plan && (plan.active || plan.pending === true)) throw new Error('TaskBoard changes are disabled in plan mode');
    return agent;
  };
  const workspaceOf = (reference) => {
    const all = ctx.workspaceRegistry.list();
    const key = String(reference).trim().toLowerCase();
    const found = all.find((w) => w.id === reference) ?? all.find((w) => w.path === reference)
      ?? all.find((w) => w.title.trim().toLowerCase() === key);
    if (!found) throw fail(`Unknown workspace "${reference}". Known workspaces: ${all.map((w) => w.title).join(', ') || 'none'}`);
    return found;
  };
  const describe = (task) => {
    const workspace = task.workspaceId ? ctx.workspaceRegistry.get(task.workspaceId) : undefined;
    return { id: task.id, title: task.title, column: task.col, workspace: workspace?.title ?? null, workspaceId: task.workspaceId ?? null, sessionId: task.sessionId ?? null };
  };

  const tool = {
    name: 'taskboard',
    description: [
      'Manage the user\'s TaskBoard, the agile board (columns todo / doing / done) shown in the sidebar. Changes appear on the board within seconds.',
      'Actions: "list" (optional column and workspace filters), "add" (title; optional column, workspace, link_current_session), "update" (id; optional title, column, workspace, session_id),',
      '"move" (id and column), "remove" (id; deletes the task for good, so use it only when the user asked).',
      'Always "list" first to get task ids; never invent an id. A workspace is its title, path or id; when "add" names none, the workspace of the current session is used.',
      'To clear a link on "update", pass an empty string for workspace or session_id.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'add', 'update', 'move', 'remove'], description: 'Operation to run.' },
        id: string('Task id from "list". Required for update, move and remove.'),
        title: string('Task title, one clear line. Required for add.'),
        column: { type: 'string', enum: COLUMNS, description: 'Target column for add, move and update; also the filter for list.' },
        workspace: string('Workspace title, absolute path or id. For list it filters; for add and update it assigns; an empty string on update clears it.'),
        session_id: string('Session id to link on update; an empty string clears the link.'),
        link_current_session: { type: 'boolean', description: 'On add, link the task to the session that is calling this tool.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output,
    isConcurrencySafe: (args) => args?.action === 'list',
    execute: async (args, exec) => {
      exec.signal.throwIfAborted();
      const resolveWorkspace = (value) => (value === '' ? null : workspaceOf(value).id);
      switch (args.action) {
        case 'list': {
          const wanted = args.workspace ? workspaceOf(args.workspace).id : undefined;
          const { revision, tasks } = await ops.list({});
          const rows = tasks.filter((t) => (!args.column || t.col === args.column) && (!wanted || t.workspaceId === wanted));
          return { revision, count: rows.length, tasks: rows.map(describe) };
        }
        case 'add': {
          const agent = assertWritable(exec);
          let workspaceId = args.workspace === undefined ? undefined : resolveWorkspace(args.workspace);
          if (workspaceId === undefined && agent.session.header?.cwd) {
            workspaceId = (await ctx.workspaceRegistry.resolveByPath(agent.session.header.cwd).catch(() => undefined))?.id;
          }
          const result = await ops.add({ title: args.title, col: args.column, workspaceId, sessionId: args.link_current_session ? agent.id ?? exec.agent.id : undefined });
          return { added: describe(result.task) };
        }
        case 'update': {
          assertWritable(exec);
          if (!args.id) throw fail('"id" is required');
          const result = await ops.update({
            id: args.id, title: args.title, col: args.column,
            workspaceId: args.workspace === undefined ? undefined : resolveWorkspace(args.workspace),
            sessionId: args.session_id,
          });
          return { updated: describe(result.task) };
        }
        case 'move': {
          assertWritable(exec);
          if (!args.id || !args.column) throw fail('"id" and "column" are required');
          return { moved: describe((await ops.move({ id: args.id, col: args.column })).task) };
        }
        case 'remove': {
          assertWritable(exec);
          if (!args.id) throw fail('"id" is required');
          return { removed: describe((await ops.remove({ id: args.id })).removed) };
        }
        default: throw fail(`Unknown action "${args.action}"`);
      }
    },
  };
  const disposeTool = ctx.tools.register(tool);

  ctx.effect(() => () => { disposeOp(); disposeRegenerate(); disposeTool(); }, 'dsh-taskboard: routes and tool');
}
