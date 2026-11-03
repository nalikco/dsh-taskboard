window.__ModuleLoader__.load({
  id: 'dsh-taskboard',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'dshTaskboard';
    const PANEL_ID = 'dsh-taskboard';
    const STORE = 'dsh-taskboard:v1';
    const COLS = ['todo', 'doing', 'done'];

    const en = { panel: 'TaskBoard', todo: 'To Do', doing: 'In Progress', done: 'Done', add: 'Add task', edit: 'Edit task', save: 'Save', session: 'Session', noSession: 'Not linked', untitledSession: 'Untitled session', openSession: 'Open session', workspace: 'Workspace', noWorkspace: 'No workspace', improve: 'Improve with AI', improving: 'Improving…', improveFailed: 'Could not improve the task', syncFailed: 'Could not reach TaskBoard', cancel: 'Cancel', create: 'Create', close: 'Close', placeholder: 'Task title', remove: 'Delete', empty: 'No tasks', back: 'Move back', next: 'Move forward' };
    const ru = { panel: 'TaskBoard', todo: 'К выполнению', doing: 'В работе', done: 'Готово', add: 'Добавить задачу', edit: 'Редактировать задачу', save: 'Сохранить', session: 'Сессия', noSession: 'Не привязана', untitledSession: 'Сессия без названия', openSession: 'Открыть сессию', workspace: 'Рабочее пространство', noWorkspace: 'Без рабочего пространства', improve: 'Улучшить с ИИ', improving: 'Улучшаю…', improveFailed: 'Не удалось улучшить задачу', syncFailed: 'Нет связи с TaskBoard', cancel: 'Отмена', create: 'Создать', close: 'Закрыть', placeholder: 'Название задачи', remove: 'Удалить', empty: 'Нет задач', back: 'Назад', next: 'Вперёд' };

    // Tasks live on the Host so the agent tool and the board share one store. localStorage is only the one-time import source and is never cleared.
    function legacyTasks() { try { const v = JSON.parse(localStorage.getItem(STORE) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
    async function api(op, args) {
      const r = await fetch('/taskboard/api/op', { method: 'POST', headers: { 'content-type': 'application/json', 'x-taskboard-request': '1' }, body: JSON.stringify({ op, ...args }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || 'request failed');
      return body;
    }
    const POLL_MS = 3000;

    // Markup and tokens mirror the host Button, Input, Modal and Task Manager page.
    const css = `
.tb-page{width:100%;height:100%;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:14px;line-height:1.6}
.tb-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;flex:none;padding:28px clamp(24px,4vw,48px) 0;margin-bottom:24px}
[data-platform=darwin] .tb-heading{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.tb-heading h1{margin:0;font-size:20px;font-weight:500;line-height:28px}
.tb-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;padding:0 14px;border:none;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer;white-space:nowrap}
.tb-button:disabled{cursor:not-allowed;opacity:.4}
.tb-button.primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.tb-button.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.tb-button.outline{border:.5px solid var(--dsw-alias-border-l3)}
.tb-button.outline:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.tb-button.new{height:32px;padding:0 12px;border-radius:16px;font-size:13px;line-height:20px}
.tb-iconbtn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.tb-iconbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.tb-iconbtn:disabled{opacity:.3;cursor:default}
.tb-iconbtn svg{width:14px;height:14px}
.tb-field{display:flex;align-items:center;gap:6px;height:36px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);box-sizing:border-box}
.tb-field:focus-within{border-color:var(--dsw-alias-state-business-primary)}
.tb-field input{flex:1;min-width:0;border:none;outline:none;background:transparent;font:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}
.tb-field input::placeholder{color:var(--dsw-alias-label-dimmed)}
.tb-board{flex:1;min-height:0;display:grid;grid-template-columns:repeat(3,minmax(240px,1fr));gap:16px;padding:0 clamp(24px,4vw,48px) 32px;overflow:auto;align-items:stretch}
.tb-col{display:flex;flex-direction:column;min-height:0;border-radius:var(--dsw-radius-panel);background:color-mix(in srgb,var(--dsw-alias-label-primary) 2.5%,var(--dsw-alias-bg-base));border:.5px solid var(--dsw-alias-border-l3);transition:border-color .15s}
.tb-col.over{border-color:var(--dsw-alias-state-business-primary)}
.tb-col-head{display:flex;align-items:center;gap:8px;padding:14px 16px 10px;font-weight:500}
.tb-count{margin-left:auto;font-weight:400;font-size:13px;color:var(--dsw-alias-label-tertiary)}
.tb-list{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable both-edges;display:flex;flex-direction:column;gap:8px;padding:0 4px 12px}
.tb-card{position:relative;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:12px;background:var(--dsw-alias-bg-base);cursor:pointer;flex:none}
.tb-card:hover{background:var(--dsw-alias-interactive-bg-hover)}
.tb-card-text{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;overflow-wrap:anywhere;line-height:22px}
.tb-card.done .tb-card-text{color:var(--dsw-alias-label-tertiary)}
.tb-actions{position:absolute;top:6px;right:6px;display:none;align-items:center;gap:2px;padding:2px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l3)}
.tb-card:hover .tb-actions,.tb-card:focus-within .tb-actions{display:flex}
.tb-empty{padding:12px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary)}
.tb-modal-root{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px}
.tb-modal-mask{position:absolute;inset:0;backdrop-filter:var(--dsw-mask-blur)}
.tb-modal-mask:after{content:"";position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1)}
.tb-modal{box-sizing:border-box;position:relative;z-index:1;display:flex;flex-direction:column;gap:20px;width:min(380px,100%);padding:0 0 24px;overflow:hidden;border-radius:var(--dsw-radius-panel);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary)}
.tb-modal:focus{outline:none}
.tb-modal-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:22px 14px 0 24px}
.tb-modal-title{margin:0;font-size:16px;line-height:24px;font-weight:500}
.tb-modal-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary)}
.tb-modal-close:hover{background:var(--dsw-alias-interactive-bg-hover)}
.tb-modal-body{display:flex;flex-direction:column;padding:0 24px}
.tb-button.sm{height:28px;padding:0 10px;border-radius:var(--dsw-radius-sm);font-size:12px;line-height:18px}
.tb-select-row{display:flex;flex-direction:column;gap:6px;margin-top:14px}
.tb-label{font-size:13px;color:var(--dsw-alias-label-tertiary)}
.tb-select select{flex:1;min-width:0;border:none;outline:none;background:transparent;font:inherit;font-size:14px;color:var(--dsw-alias-label-primary);cursor:pointer}
.tb-card-ws{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tb-session{display:flex;align-items:center;gap:6px;max-width:100%;margin-top:6px;padding:2px 8px 2px 6px;border:.5px solid var(--dsw-alias-border-l3);border-radius:12px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.tb-session:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.tb-session-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.tb-session-dot.running{background:var(--dsw-alias-state-success-primary)}
.tb-session-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb-sync-error{margin:-12px clamp(24px,4vw,48px) 12px;font-size:12px;color:var(--dsw-alias-state-error-primary)}
.tb-ai{display:flex;align-items:center;gap:10px;margin-top:10px}
.tb-error{font-size:12px;color:var(--dsw-alias-state-error-primary)}
.tb-modal-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 24px}
.tb-modal-footer .tb-button{min-width:72px}
`;

    const svg = (children, size) => h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, children);
    const XIcon = () => svg([h('path', { key: 1, d: 'M6 6l12 12' }), h('path', { key: 2, d: 'M18 6L6 18' })], 16);
    const LeftIcon = () => svg(h('path', { d: 'M14.5 6l-6 6 6 6' }), 14);
    const RightIcon = () => svg(h('path', { d: 'M9.5 6l6 6-6 6' }), 14);
    const PlusIcon = () => svg([h('path', { key: 1, d: 'M12 5v14' }), h('path', { key: 2, d: 'M5 12h14' })], 14);

    const SparkIcon = () => svg(h('path', { d: 'M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z' }), 14);
    function PanelIcon({ size }) {
      return svg([
        h('rect', { key: 1, x: 3.5, y: 4, width: 5, height: 16, rx: 1.5 }),
        h('rect', { key: 2, x: 10, y: 4, width: 5, height: 10, rx: 1.5 }),
        h('rect', { key: 3, x: 16.5, y: 4, width: 4, height: 6, rx: 1.5 })], size);
    }

    function Modal({ t, initial, initialWorkspace, initialSession, workspaces, sessions, onClose, onSubmit }) {
      const editing = initial != null;
      const [title, setTitle] = React.useState(initial || '');
      const [workspaceId, setWorkspaceId] = React.useState(initialWorkspace || '');
      const [sessionId, setSessionId] = React.useState(initialSession || '');
      const path = (workspaces.find((w) => w.workspaceId === workspaceId) || {}).path;
      const options = sessions.filter((x) => (!path || x.cwd === path) || x.id === sessionId);
      const [busy, setBusy] = React.useState(false);
      const [failed, setFailed] = React.useState(false);
      const ref = React.useRef(null);
      const improve = async () => {
        setBusy(true); setFailed(false);
        try {
          const r = await fetch('/taskboard/api/regenerate', { method: 'POST', headers: { 'content-type': 'application/json', 'x-taskboard-request': '1' }, body: JSON.stringify({ text: title, workspaceId: workspaceId || null, sessionId: sessionId || null }) });
          const body = await r.json();
          if (!r.ok || !body.title) throw new Error(body.error || 'failed');
          setTitle(body.title);
        } catch { setFailed(true); } finally { setBusy(false); }
      };
      React.useEffect(() => { ref.current && ref.current.focus(); }, []);
      const submit = () => { const v = title.trim(); if (v) onSubmit(v, workspaceId || null, sessionId || null); };
      return h('div', { className: 'tb-modal-root', onKeyDown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } } },
        h('div', { className: 'tb-modal-mask', onMouseDown: onClose }),
        h('div', { className: 'tb-modal', role: 'dialog', 'aria-modal': true, 'aria-label': t(editing ? 'edit' : 'add'), tabIndex: -1 },
          h('div', { className: 'tb-modal-header' },
            h('h2', { className: 'tb-modal-title' }, t(editing ? 'edit' : 'add')),
            h('button', { className: 'tb-modal-close', type: 'button', title: t('close'), 'aria-label': t('close'), onClick: onClose }, h(XIcon))),
          h('div', { className: 'tb-modal-body' },
            h('label', { className: 'tb-field' },
              h('input', { ref, value: title, placeholder: t('placeholder'), onChange: (e) => setTitle(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') submit(); } })),
            workspaces.length > 0 && h('label', { className: 'tb-select-row' },
              h('span', { className: 'tb-label' }, t('workspace')),
              h('span', { className: 'tb-field tb-select' },
                h('select', { value: workspaceId, onChange: (e) => setWorkspaceId(e.target.value) },
                  h('option', { value: '' }, t('noWorkspace')),
                  workspaces.map((w) => h('option', { key: w.workspaceId, value: w.workspaceId }, w.title))))),
            h('label', { className: 'tb-select-row' },
              h('span', { className: 'tb-label' }, t('session')),
              h('span', { className: 'tb-field tb-select' },
                h('select', { value: sessionId, onChange: (e) => setSessionId(e.target.value) },
                  h('option', { value: '' }, t('noSession')),
                  options.map((x) => h('option', { key: x.id, value: x.id }, x.title || t('untitledSession')))))),
            h('div', { className: 'tb-ai' },
              h('button', { className: 'tb-button outline sm', type: 'button', disabled: busy || !title.trim(), onClick: improve }, h(SparkIcon), t(busy ? 'improving' : 'improve')),
              failed && h('span', { className: 'tb-error' }, t('improveFailed')))),
          h('div', { className: 'tb-modal-footer' },
            h('button', { className: 'tb-button outline', type: 'button', onClick: onClose }, t('cancel')),
            h('button', { className: 'tb-button primary', type: 'button', disabled: !title.trim(), onClick: submit }, t(editing ? 'save' : 'create')))));
    }

    function Board({ t, ctx, useWorkspaces, useSessions }) {
      const list = useSessions ? useSessions((state) => state) : null;
      const archived = useWorkspaces ? useWorkspaces((state) => state.archivedSessionIds) : null;
      const archivedSet = React.useMemo(() => new Set(archived || []), [archived]);
      const sessions = React.useMemo(() => {
        if (!list) return [];
        return (list.ids || []).map((id) => list.byId[id]).filter((x) => x && !x.blank && x.origin !== 'subagent' && !archivedSet.has(x.id))
          .map((x) => ({ id: x.id, title: (x.title || '').trim(), cwd: x.cwd, running: !!x.running, updatedAt: x.updatedAt || 0 }))
          .sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt)).slice(0, 200);
      }, [list, archivedSet]);
      const sessionOf = (id) => (list && list.byId[id]) ? sessions.find((x) => x.id === id) || { id, title: ((list.byId[id].title) || '').trim(), running: false } : null;
      const stored = useWorkspaces ? useWorkspaces((state) => state.items) : [];
      const workspaces = React.useMemo(() => (stored || []).map((w) => ({ workspaceId: w.workspaceId, path: w.path, title: (w.title && w.title.trim()) || (w.path || '').split('/').filter(Boolean).pop() || w.workspaceId })), [stored]);
      const wsName = (id) => (workspaces.find((w) => w.workspaceId === id) || {}).title;
      const [tasks, setTasks] = React.useState([]);
      const [loaded, setLoaded] = React.useState(false);
      const [syncError, setSyncError] = React.useState(false);
      const revision = React.useRef(-1);
      const apply = React.useCallback((board) => {
        if (!board || board.unchanged) return;
        revision.current = board.revision;
        setTasks(board.tasks);
      }, []);
      React.useEffect(() => {
        let alive = true;
        const tick = async () => {
          try {
            const board = await api('list', { since: revision.current });
            if (!alive) return;
            apply(board); setSyncError(false);
            if (!loaded) {
              const old = legacyTasks();
              if (old.length && board.migrated === false) apply(await api('import', { tasks: old }));
              if (alive) setLoaded(true);
            }
          } catch { if (alive) setSyncError(true); }
        };
        tick();
        const timer = setInterval(() => { if (!document.hidden) tick(); }, POLL_MS);
        return () => { alive = false; clearInterval(timer); };
      }, [apply, loaded]);
      const run = async (op, args, optimistic) => {
        if (optimistic) setTasks(optimistic);
        try { apply(await api(op, args)); setSyncError(false); }
        catch { setSyncError(true); revision.current = -1; }
      };
      const [open, setOpen] = React.useState(false);
      const [editId, setEditId] = React.useState(null);
      const [over, setOver] = React.useState(null);
      const move = (id, col) => run('move', { id, col }, (p) => p.map((x) => (x.id === id ? { ...x, col } : x)));
      const add = (text, workspaceId, sessionId) => {
        run('add', { title: text, workspaceId, sessionId });
        setOpen(false);
      };
      const edit = tasks.find((x) => x.id === editId);
      const rename = (text, workspaceId, sessionId) => { run('update', { id: editId, title: text, workspaceId: workspaceId || '', sessionId: sessionId || '' }); setEditId(null); };
      return h('div', { className: 'tb-page' },
        h('style', null, css),
        h('div', { className: 'tb-heading' },
          h('h1', null, t('panel')),
          h('button', { className: 'tb-button primary new', type: 'button', onClick: () => setOpen(true) }, h(PlusIcon), t('add'))),
        syncError && h('div', { className: 'tb-sync-error', role: 'status' }, t('syncFailed')),
        open && h(Modal, { t, workspaces, sessions, onClose: () => setOpen(false), onSubmit: add }),
        edit && h(Modal, { key: edit.id, t, initial: edit.title, initialWorkspace: edit.workspaceId, initialSession: edit.sessionId, workspaces, sessions, onClose: () => setEditId(null), onSubmit: rename }),
        h('div', { className: 'tb-board' }, COLS.map((col, ci) => {
          const items = tasks.filter((x) => x.col === col);
          return h('div', {
            key: col, className: 'tb-col' + (over === col ? ' over' : ''),
            onDragOver: (e) => { e.preventDefault(); setOver(col); },
            onDragLeave: () => setOver((c) => (c === col ? null : c)),
            onDrop: (e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/plain'); if (id) move(id, col); },
          },
            h('div', { className: 'tb-col-head' }, t(col), h('span', { className: 'tb-count' }, items.length)),
            h('div', { className: 'tb-list' }, items.length === 0 ? h('div', { className: 'tb-empty' }, t('empty')) : items.map((x) =>
              h('div', { key: x.id, className: 'tb-card' + (col === 'done' ? ' done' : ''), draggable: true, onClick: (e) => { if (!e.target.closest('button')) setEditId(x.id); }, onDragStart: (e) => e.dataTransfer.setData('text/plain', x.id) },
                h('div', { className: 'tb-card-text', title: x.title }, x.title),
                wsName(x.workspaceId) && h('div', { className: 'tb-card-ws' }, wsName(x.workspaceId)),
                x.sessionId && sessionOf(x.sessionId) && h('button', { className: 'tb-session', type: 'button', title: t('openSession'), onClick: (e) => { e.stopPropagation(); ctx.uiWorkspace.openSession(x.sessionId); } },
                  h('span', { className: 'tb-session-dot' + (sessionOf(x.sessionId).running ? ' running' : '') }),
                  h('span', { className: 'tb-session-title' }, sessionOf(x.sessionId).title || t('untitledSession'))),
                h('div', { className: 'tb-actions' },
                h('button', { className: 'tb-iconbtn', type: 'button', title: t('back'), 'aria-label': t('back'), disabled: ci === 0, onClick: () => move(x.id, COLS[ci - 1]) }, h(LeftIcon)),
                h('button', { className: 'tb-iconbtn', type: 'button', title: t('next'), 'aria-label': t('next'), disabled: ci === COLS.length - 1, onClick: () => move(x.id, COLS[ci + 1]) }, h(RightIcon)),
                h('button', { className: 'tb-iconbtn', type: 'button', title: t('remove'), 'aria-label': t('remove'), onClick: () => run('remove', { id: x.id }, (p) => p.filter((y) => y.id !== x.id)) }, h(XIcon)))))));
        })));
    }

    return {
      inject: ['slots', 'locale', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, ru }), 'dsh-taskboard: dictionaries');
        const t = ctx.locale.bind(NS);
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({}) }, (props) => h(Board, { t: props.t || t, ctx, useWorkspaces: props.useWorkspaces, useSessions: props.useSessions })));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => t('panel'), locale: NS }, PanelIcon));
      },
    };
  },
});
