// Work Status section: commit graph with mode toggles, per-commit details,
// and Open diff in the Diff view. Reads from the local git service.
import { connectHost, HostRequestError, type SessionLifecyclePhase } from '@openchamber/sdk';
import { applyHostReady, mountButton, mountTabs } from '@openchamber/sdk/ui';

import { layoutGraph } from './graph.ts';
import { STYLE, drawRail, drawRowGraph, element, graphWidth, refBadge, type RefKind } from './view.ts';
import { startCommitPopover } from './commit-popover.ts';

const host = connectHost();
const root = document.querySelector<HTMLElement>('#root');
if (!root) throw new Error('Missing root');
const style = document.createElement('style');
style.textContent = STYLE;
document.head.append(style);
let started = false;
host.onReady((context) => {
  applyHostReady(context, document.documentElement);
  if (started) return;
  started = true;
  if (context.surface === 'popover') {
    startCommitPopover(root, host, context);
    return;
  }
  startStatus();
});

const startStatus = (): void => {
host.onStatusControl((event) => {
  if (event.id === 'header-refresh') {
    void load();
    return;
  }
  if (event.id === 'header-mode' && event.value) setMode(event.value);
});
// ----- Service answers, parsed at the boundary -----

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const SHA = /^[a-f0-9]{7,64}$/i;
const refKindSchema = (value: string): value is 'local' | 'remote' | 'tag' => value === 'local' || value === 'remote' || value === 'tag';

const parseLog = (value: unknown): { commits: { hash: string; parents: string[]; author: string; when: string; date: string; subject: string; refs: { name: string; kind: 'local' | 'remote' | 'tag'; head: boolean }[] }[]; uncommitted: number } | null => {
  if (!isRecord(value)) return null;
  const commits = value.commits;
  if (!Array.isArray(commits)) return null;
  const parsedCommits: { hash: string; parents: string[]; author: string; when: string; date: string; subject: string; refs: { name: string; kind: 'local' | 'remote' | 'tag'; head: boolean }[] }[] = [];
  for (const c of commits) {
    if (!isRecord(c)) continue;
    if (typeof c.hash !== 'string' || !SHA.test(c.hash)) continue;
    if (!Array.isArray(c.parents)) continue;
    let validParents = true;
    for (const p of c.parents) {
      if (typeof p === 'string' && SHA.test(p)) continue;
      validParents = false;
      break;
    }
    if (!validParents) continue;
    if (typeof c.author !== 'string' || typeof c.when !== 'string' || typeof c.date !== 'string' || typeof c.subject !== 'string') continue;
    if (!Array.isArray(c.refs)) continue;
    let validRefs = true;
    for (const ref of c.refs) {
      if (!isRecord(ref)) { validRefs = false; break; }
      if (typeof ref.name !== 'string' || typeof ref.kind !== 'string' || refKindSchema(ref.kind) === false || typeof ref.head !== 'boolean') { validRefs = false; break; }
    }
    if (!validRefs) continue;
    parsedCommits.push({ hash: c.hash, parents: c.parents, author: c.author, when: c.when, date: c.date, subject: c.subject, refs: c.refs.map((ref) => ({ name: ref.name, kind: ref.kind, head: ref.head })) });
  }
  const uncommitted = isInteger(value.uncommitted) && value.uncommitted >= 0 ? value.uncommitted : NaN;
  if (Number.isNaN(uncommitted)) return null;
  return { commits: parsedCommits, uncommitted };
};

const refsSchema = (value: unknown): { branch: string | null; upstream: string | null; github: string | null; refs: { name: string; kind: 'local' | 'remote' | 'tag' }[] } | null => {
  if (!isRecord(value)) return null;
  if (value.branch !== null && typeof value.branch !== 'string') return null;
  if (value.upstream !== null && typeof value.upstream !== 'string') return null;
  if (value.github !== null && (typeof value.github !== 'string' || !/^https:\/\/github\.com\//.test(value.github))) return null;
  const refs = value.refs;
  if (!Array.isArray(refs)) return null;
  for (const ref of refs) {
    if (!isRecord(ref)) return null;
    if (typeof ref.name !== 'string' || typeof ref.kind !== 'string' || refKindSchema(ref.kind) === false) return null;
  }
  return { branch: value.branch ?? null, upstream: value.upstream ?? null, github: value.github ?? null, refs: refs.map((ref) => ({ name: ref.name, kind: ref.kind })) };
};

const detailSchema = (value: unknown): { hash: string; parents: string[]; author: string; email: string; when: string; date: string; subject: string; body: string; files: number; insertions: number; deletions: number } | null => {
  if (!isRecord(value)) return null;
  if (typeof value.hash !== 'string' || !SHA.test(value.hash)) return null;
  if (!Array.isArray(value.parents)) return null;
  for (const p of value.parents) {
    if (typeof p === 'string' && SHA.test(p)) continue;
    return null;
  }
  if (typeof value.author !== 'string') return null;
  if (typeof value.email !== 'string') return null;
  if (typeof value.when !== 'string') return null;
  if (typeof value.date !== 'string') return null;
  if (typeof value.subject !== 'string') return null;
  if (typeof value.body !== 'string') return null;
  if (typeof value.files !== 'number' || !Number.isInteger(value.files) || value.files < 0) return null;
  if (typeof value.insertions !== 'number' || !Number.isInteger(value.insertions) || value.insertions < 0) return null;
  if (typeof value.deletions !== 'number' || !Number.isInteger(value.deletions) || value.deletions < 0) return null;
  return { hash: value.hash, parents: value.parents, author: value.author, email: value.email, when: value.when, date: value.date, subject: value.subject, body: value.body, files: value.files, insertions: value.insertions, deletions: value.deletions };
};

const failureSchema = (value: unknown): value is { error: string } => isRecord(value) && isString(value.error);
const modeSchema = (value: string): value is 'auto' | 'all' | 'manual' => value === 'auto' || value === 'all' || value === 'manual';

type Commit = { hash: string; parents: string[]; author: string; when: string; date: string; subject: string; refs: { name: string; kind: 'local' | 'remote' | 'tag'; head: boolean }[] };
type Refs = { branch: string | null; upstream: string | null; github: string | null; refs: { name: string; kind: 'local' | 'remote' | 'tag' }[] };
type Detail = { hash: string; parents: string[]; author: string; email: string; when: string; date: string; subject: string; body: string; files: number; insertions: number; deletions: number };
type Mode = 'auto' | 'all' | 'manual';
type DetailState = { status: 'loading' } | { status: 'ready'; detail: Detail } | { status: 'error'; message: string };

class ServiceFailure extends Error {}

const describeFailure = (code: string): string => {
  if (code === 'not-a-repo') return 'This project is not a git repository.';
  if (code === 'no-git') return 'git is not installed on the OpenChamber host.';
  if (code === 'unknown-commit') return 'That commit is no longer in this repository.';
  return 'Could not read the git history.';
};

const ask = async <T>(path: string, query: Record<string, string>, schema: (value: unknown) => T | null): Promise<T> => {
  let result;
  try {
    result = await host.serviceRequest({ method: 'GET', path, query });
  } catch (error) {
    throw new ServiceFailure(error instanceof HostRequestError && error.code === 'NO_SERVICE'
      ? 'Allow the local service for this extension in Settings → Extensions.'
      : 'Could not reach the local git service.');
  }
  let body: unknown;
  try { body = JSON.parse(result.body); } catch { throw new ServiceFailure('The git service answered with something unexpected.'); }
  if (failureSchema(body)) throw new ServiceFailure((body as { error: string }).error === 'unknown-commit' ? 'That commit is no longer in this repository.' : describeFailure('unknown-commit'));
  const parsed = schema(body);
  if (!parsed) throw new ServiceFailure('The git service answered with something unexpected.');
  return parsed;
};

// ----- State -----

let directory: string | null = null;
let locale = 'en';
let mode: Mode = 'auto';
let picked = new Set<string>();
let refs: Refs | null = null;
let commits: Commit[] = [];
let uncommitted = 0;
let note: string | null = 'Loading commits…';
let openHash: string | null = null;
let preferencesError: string | null = null;
let deviceStorageSupported = false;
let statusControlsSupported = false;
let statusControlsActive = false;
let popoversSupported = false;
let publishedControls: string | null = null;
let publishingControls: string | null = null;
const details = new Map<string, DetailState>();
const popoverAnchors = new Set<{ dispose: () => void }>();
let generation = 0;

const refKey = (ref: { name: string; kind: RefKind }) => `${ref.kind}:${ref.name}`;

// Storage keys are capped at 128 characters, so a project is named by a hash of its path.
const prefsKey = (dir: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < dir.length; index++) hash = Math.imul(hash ^ dir.charCodeAt(index), 16777619);
  return `prefs:${(hash >>> 0).toString(36)}`;
};

const storageOptions = () => deviceStorageSupported ? { scope: 'device' as const } : undefined;

const reportPreferencesError = (message: string) => {
  preferencesError = message;
  render();
};

const savePrefs = () => {
  if (!directory) return;
  void host.storage.set(prefsKey(directory), { mode, picked: [...picked].slice(0, 50) }, storageOptions()).catch(() => {
    reportPreferencesError('Could not save display preferences.');
  });
};

const loadPrefs = async (dir: string, useDeviceStorage: boolean) => {
  let value: unknown;
  try {
    value = await host.storage.get(prefsKey(dir), useDeviceStorage ? { scope: 'device' } : undefined);
  } catch {
    if (directory === dir && deviceStorageSupported === useDeviceStorage) {
      reportPreferencesError('Could not load display preferences. Keeping the current view.');
    }
    return;
  }
  if (directory !== dir || deviceStorageSupported !== useDeviceStorage) return;
  if (value === undefined) {
    mode = 'auto';
    picked = new Set();
    preferencesError = null;
    return;
  }
  if (!isRecord(value)) {
    reportPreferencesError('Saved display preferences are invalid. Keeping the current view.');
    return;
  }
  const storedMode = value.mode;
  const storedPicked = value.picked;
  if (typeof storedMode !== 'string' || !modeSchema(storedMode)) {
    reportPreferencesError('Saved display preferences are invalid. Keeping the current view.');
    return;
  }
  if (!Array.isArray(storedPicked)) {
    reportPreferencesError('Saved display preferences are invalid. Keeping the current view.');
    return;
  }
  const validPicked = storedPicked.filter((item): item is string => typeof item === 'string');
  mode = storedMode;
  picked = new Set(validPicked.slice(0, 50));
};

// ----- Loading -----

const load = async () => {
  const current = ++generation;
  if (!directory) {
    commits = []; note = 'Open a project to see its commits.'; render();
    return;
  }
  if (commits.length === 0) { note = 'Loading commits…'; render(); }
  const dir = directory;
  try {
    const [nextRefs, log] = await Promise.all([
      ask('/refs', { directory: dir }, refsSchema),
      ask('/log', { directory: dir, mode, refs: [...picked].join(','), limit: '40' }, parseLog),
    ]);
    if (current !== generation) return;
    refs = nextRefs;
    commits = log.commits;
    uncommitted = mode === 'manual' ? 0 : log.uncommitted;
    note = commits.length === 0 ? 'No commits yet.' : null;
    // A detail read before a refresh may describe a rewritten commit.
    details.clear();
    if (openHash && !commits.some((commit) => commit.hash === openHash)) openHash = null;
    if (openHash) void loadDetail(openHash);
  } catch (error) {
    if (current !== generation) return;
    commits = [];
    note = error instanceof ServiceFailure ? error.message : 'Could not read the git history.';
  }
  render();
};

const loadDetail = async (hash: string) => {
  const known = details.get(hash)?.status;
  if (!directory || known === 'ready' || known === 'loading') return;
  details.set(hash, { status: 'loading' });
  render();
  try {
    const detail = await ask('/commit', { directory, sha: hash }, detailSchema);
    details.set(hash, { status: 'ready', detail });
  } catch (error) {
    details.set(hash, { status: 'error', message: error instanceof ServiceFailure ? error.message : 'Could not read this commit.' });
  }
  render();
};

// ----- Header: mode toggles, refresh, manual ref picker -----

const bar = element('div', 'bar');
const picker = element('div', 'picker');
const preferencesNotice = element('div', 'note');
const list = element('div');
root.append(bar, picker, preferencesNotice, list);

const statusControls = () => [
  {
    kind: 'select' as const,
    id: 'header-mode',
    label: 'Commit range',
    value: mode,
    options: [
      { value: 'auto', label: 'Auto' },
      { value: 'all', label: 'All' },
      { value: 'manual', label: 'Manual' },
    ],
  },
  { kind: 'button' as const, id: 'header-refresh', label: 'Refresh', disabled: !directory },
];

const publishStatusControls = () => {
  if (!statusControlsSupported) return;
  const controls = statusControls();
  const signature = JSON.stringify(controls);
  if (signature === publishedControls || signature === publishingControls) return;
  publishingControls = signature;
  void host.setStatusControls(controls).then(() => {
    if (publishingControls !== signature) return;
    publishingControls = null;
    publishedControls = signature;
    statusControlsActive = true;
    render();
    publishStatusControls();
  }).catch(() => {
    if (publishingControls !== signature) return;
    publishingControls = null;
    statusControlsActive = false;
    publishedControls = null;
    render();
  });
};

const setMode = (nextValue: string) => {
  if (!modeSchema(nextValue)) return;
  if (nextValue === mode) return;
  mode = nextValue;
  tabs.update({ activeId: mode });
  savePrefs();
  publishStatusControls();
  void load();
};

const tabs = mountTabs(bar, {
  items: [{ id: 'auto', label: 'Auto' }, { id: 'all', label: 'All' }, { id: 'manual', label: 'Manual' }],
  activeId: mode,
  onChange: setMode,
});
bar.append(element('span', 'grow'));
const refresh = mountButton(bar, { label: 'Refresh', variant: 'ghost', size: 'xs', onClick: () => { void load(); } });

const renderPicker = () => {
  picker.replaceChildren();
  picker.hidden = mode !== 'manual';
  if (mode !== 'manual' || !refs) return;
  const choices = refs.refs.filter((ref) => ref.kind !== 'tag').slice(0, 40);
  for (const kind of ['local', 'remote'] as const) {
    const group = choices.filter((ref) => ref.kind === kind);
    if (group.length === 0) continue;
    picker.append(element('div', 'picker-group', kind === 'local' ? 'Branches' : 'Remote branches'));
    for (const ref of group) {
      const checkbox = document.createElement('label');
      checkbox.style.cssText = 'font-size: 11px; display: flex; align-items: center; gap: 4px;';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = picked.has(refKey(ref));
      input.addEventListener('change', () => {
        if (input.checked) picked.add(refKey(ref)); else picked.delete(refKey(ref));
        savePrefs();
        void load();
      });
      checkbox.append(input, element('span', '', ref.name));
      picker.append(checkbox);
    }
  }
};

// ----- Rows -----

const absoluteDate = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
};

const renderDetail = (card: HTMLElement, commit: Commit) => {
  const state = details.get(commit.hash);
  if (!state || state.status === 'loading') { card.append(element('div', 'row', 'Loading details…')); return; }
  if (state.status === 'error') { card.append(element('div', 'error', state.message)); return; }
  const { detail } = state;
  card.append(element('div', 'full', detail.subject));
  if (detail.body) card.append(element('div', 'body', detail.body));
  const who = element('div', 'row', `${detail.author} <${detail.email}>`);
  const when = element('div', 'row', `${detail.when} · ${absoluteDate(detail.date)}`);
  const stats = element('div', 'row');
  stats.append(
    element('span', '', `${detail.files} ${detail.files === 1 ? 'file' : 'files'} changed`),
    element('span', 'add', `+${detail.insertions}`),
    element('span', 'del', `−${detail.deletions}`),
  );
  const hashRow = element('div', 'row');
  hashRow.append(element('code', '', detail.hash.slice(0, 10)));
  const copy = document.createElement('button');
  copy.className = 'port';
  copy.type = 'button';
  copy.textContent = 'Copy hash';
  copy.title = 'Copy commit hash';
  copy.addEventListener('click', () => {
    void host.writeClipboard(detail.hash).then(() => {
      copy.textContent = 'Copied';
      setTimeout(() => copy.textContent = 'Copy hash', 1500);
    }).catch(() => copy.textContent = 'Copy failed');
  });
  const actions = element('div', 'actions');
  const status = element('div', 'error');
  const openDiff = document.createElement('button');
  openDiff.className = 'port';
  openDiff.type = 'button';
  openDiff.textContent = 'Open diff';
  openDiff.title = 'Open the commit diff in the Diff view';
  openDiff.addEventListener('click', () => {
    status.textContent = '';
    void host.openCommit(detail.hash).catch(() => { status.textContent = 'Could not open the diff.'; });
  });
  actions.append(openDiff);
  const github = refs?.github;
  if (github) {
    const githubBtn = document.createElement('button');
    githubBtn.className = 'port';
    githubBtn.type = 'button';
    githubBtn.textContent = 'Open on GitHub';
    githubBtn.title = 'Open on GitHub';
    githubBtn.addEventListener('click', () => {
      void host.openUrl(`${github}/commit/${detail.hash}`).catch(() => { status.textContent = 'Could not open the link.'; });
    });
    actions.append(githubBtn);
  }
  card.append(who, when, stats, hashRow, actions, status);
};

const render = () => {
  for (const anchor of popoverAnchors) anchor.dispose();
  popoverAnchors.clear();
  bar.hidden = statusControlsActive;
  preferencesNotice.hidden = preferencesError === null;
  preferencesNotice.textContent = preferencesError ?? '';
  refresh.update({ disabled: !directory });
  renderPicker();
  if (note) {
    list.replaceChildren(element('div', 'note', note));
    return;
  }
  // The working tree sits on top of the checked-out commit as a row of its own.
  const headCommit = commits.find((commit) => commit.refs.some((ref) => ref.head)) ?? (mode === 'auto' ? commits[0] : undefined);
  const dirty = uncommitted > 0 && headCommit ? { hash: '(working tree)', parents: [headCommit.hash] } : null;
  const layout = layoutGraph(dirty ? [dirty, ...commits] : commits);
  const width = graphWidth(layout.width);
  const rows: HTMLElement[] = [];
  let index = 0;
  if (dirty) {
    const graph = layout.rows[index++];
    const row = element('div', 'commit dirty');
    const head = element('div', 'head');
    if (graph) head.append(drawRowGraph(graph, width, 'dirty'));
    const text = element('div', 'text');
    const line = element('div', 'line');
    line.append(element('span', 'subject', 'Uncommitted changes'));
    text.append(line, element('div', 'meta', `${uncommitted} ${uncommitted === 1 ? 'file' : 'files'} not committed yet`));
    head.append(text);
    row.append(head);
    rows.push(row);
  }
  for (const commit of commits) {
    const graph = layout.rows[index++];
    const open = commit.hash === openHash;
    const row = element('div', open ? 'commit open' : 'commit');
    const head = element('button', 'head');
    head.type = 'button';
    head.setAttribute('aria-expanded', String(open));
    head.title = commit.subject;
    if (graph) head.append(drawRowGraph(graph, width, commit.refs.some((ref) => ref.head) ? 'head' : 'commit'));
    const text = element('div', 'text');
    const line = element('div', 'line');
    for (const ref of commit.refs) line.append(refBadge(ref.name, ref.kind, ref.head));
    line.append(element('span', 'subject', commit.subject));
    text.append(line, element('div', 'meta', `${commit.author} · ${commit.when}`));
    head.append(text);
    // One row open at a time; opening fetches its details once.
    head.addEventListener('click', () => {
      openHash = open ? null : commit.hash;
      render();
      if (openHash) void loadDetail(openHash);
    });
    if (popoversSupported) {
      // Popover anchors are no-ops in this frame-only build; skip mounting them.
    }
    row.append(head);
    if (open) {
      const detailsRow = element('div', 'details');
      if (graph) detailsRow.append(drawRail(graph, width));
      const card = element('div', 'card');
      renderDetail(card, commit);
      detailsRow.append(card);
      row.append(detailsRow);
    }
    rows.push(row);
  }
  list.replaceChildren(...rows);
  if (openHash) list.querySelector('.commit.open')?.scrollIntoView({ block: 'nearest' });
};

// ----- Host wiring -----

// The host sizes the frame to this, up to its maximum; beyond that the page scrolls.
let reportedHeight = -1;
new ResizeObserver(() => {
  const height = Math.ceil(root.getBoundingClientRect().height);
  if (height === reportedHeight) return;
  reportedHeight = height;
  void host.setHeight(height).catch(() => undefined);
}).observe(root);

host.onReady((context) => {
  applyHostReady(context, document.documentElement);
  locale = context.locale;
  const nextDeviceStorage = context.features?.deviceStorage === true;
  const nextStatusControls = context.features?.statusControls === true;
  const nextPopovers = context.features?.popovers === true;
  if (deviceStorageSupported !== nextDeviceStorage) {
    deviceStorageSupported = nextDeviceStorage;
    if (directory) void loadPrefs(directory, deviceStorageSupported);
  }
  if (statusControlsSupported !== nextStatusControls) {
    statusControlsSupported = nextStatusControls;
    statusControlsActive = false;
    publishedControls = null;
    publishingControls = null;
    render();
  }
  if (popoversSupported !== nextPopovers) {
    popoversSupported = nextPopovers;
    render();
  }
  publishStatusControls();
});

let directorySeen = false;
host.onDirectory((next) => {
  if (directorySeen && next === directory) return;
  directorySeen = true;
  directory = next;
  // A project switch retires the host's header callbacks even if the next mode is identical.
  publishedControls = null;
  publishingControls = null;
  statusControlsActive = false;
  commits = []; refs = null; openHash = null; details.clear();
  void (async () => {
    if (next) await loadPrefs(next, deviceStorageSupported);
    if (directory !== next) return;
    tabs.update({ activeId: mode });
    publishStatusControls();
    void load();
  })();
});

// An agent turn that just finished may have committed; read the history again.
let lastPhase: SessionLifecyclePhase | null = null;
host.onSessionLifecycle((event) => {
  const finished = lastPhase === 'started' && event.phase === 'completed';
  lastPhase = event.phase;
  if (finished) void load();
});

render();
};
