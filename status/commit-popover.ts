import { HostRequestError, type HostClient, type HostReadyContext } from '@openchamber/sdk';

import { element, refBadge } from './view.ts';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const refKindSchema = (value: string): value is 'local' | 'remote' | 'tag' => value === 'local' || value === 'remote' || value === 'tag';

const commitPopoverDataSchema = (value: unknown): value is {
  sha: string;
  refs: { name: string; kind: 'local' | 'remote' | 'tag'; head: boolean }[];
  github: string | null;
} => {
  if (!isRecord(value)) return false;
  if (typeof value.sha !== 'string' || !/^[a-f0-9]{7,64}$/i.test(value.sha)) return false;
  if (!Array.isArray(value.refs) || value.refs.length > 20) return false;
  for (const ref of value.refs) {
    if (!isRecord(ref)) return false;
    if (typeof ref.name !== 'string' || ref.name.length < 1 || ref.name.length > 200) return false;
    if (ref.kind !== 'local' && ref.kind !== 'remote' && ref.kind !== 'tag') return false;
    if (typeof ref.head !== 'boolean') return false;
  }
  if (value.github !== null && (typeof value.github !== 'string' || !value.github.startsWith('https://github.com/') || value.github.length > 2000)) return false;
  return true;
};

const detailSchema = (value: unknown): value is {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  when: string;
  date: string;
  subject: string;
  body: string;
  files: number;
  insertions: number;
  deletions: number;
} => {
  if (!isRecord(value)) return false;
  if (typeof value.hash !== 'string' || !/^[a-f0-9]{7,64}$/i.test(value.hash)) return false;
  if (!Array.isArray(value.parents)) return false;
  for (const p of value.parents) if (typeof p !== 'string' || !/^[a-f0-9]{7,64}$/i.test(p)) return false;
  if (typeof value.author !== 'string') return false;
  if (typeof value.email !== 'string') return false;
  if (typeof value.when !== 'string') return false;
  if (typeof value.date !== 'string') return false;
  if (typeof value.subject !== 'string') return false;
  if (typeof value.body !== 'string') return false;
  if (typeof value.files !== 'number' || !Number.isInteger(value.files) || value.files < 0) return false;
  if (typeof value.insertions !== 'number' || !Number.isInteger(value.insertions) || value.insertions < 0) return false;
  if (typeof value.deletions !== 'number' || !Number.isInteger(value.deletions) || value.deletions < 0) return false;
  return true;
};

const failureSchema = (value: unknown): value is { error: string } => isRecord(value) && typeof value.error === 'string';

type CommitPopoverData = { sha: string; refs: { name: string; kind: 'local' | 'remote' | 'tag'; head: boolean }[]; github: string | null };
type Detail = { hash: string; parents: string[]; author: string; email: string; when: string; date: string; subject: string; body: string; files: number; insertions: number; deletions: number };

const absoluteDate = (iso: string, locale: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
};

const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.length === 0 ? '?' : parts.map((part) => part[0]?.toUpperCase() ?? '').join('');
};

const askDetail = async (host: HostClient, directory: string, sha: string): Promise<Detail> => {
  let result;
  try {
    result = await host.serviceRequest({ method: 'GET', path: '/commit', query: { directory, sha } });
  } catch (error) {
    throw new Error(error instanceof HostRequestError && error.code === 'NO_SERVICE'
      ? 'Allow the local service for this extension in Settings → Extensions.'
      : 'Could not reach the local git service.');
  }
  if (result.status < 200 || result.status >= 300) throw new Error('Could not read this commit.');
  let body: unknown;
  try { body = JSON.parse(result.body); } catch { throw new Error('The git service answered with something unexpected.'); }
  if (failureSchema(body)) throw new Error((body as { error: string }).error === 'unknown-commit' ? 'That commit is no longer in this repository.' : 'Could not read this commit.');
  if (!detailSchema(body)) throw new Error('The git service answered with something unexpected.');
  const detail = body as Detail;
  if (!detail.hash.toLowerCase().startsWith(sha.toLowerCase())) {
    throw new Error('The git service answered with something unexpected.');
  }
  return detail;
};

const renderDetail = (root: HTMLElement, host: HostClient, data: CommitPopoverData, detail: Detail, locale: string): void => {
  const card = element('article', 'popover-card');
  card.dataset.commitPopover = detail.hash;
  const author = element('div', 'popover-author');
  author.append(element('span', 'popover-initials', initials(detail.author)), element('span', 'popover-author-name', detail.author));
  const metadata = element('span', 'popover-meta', `${detail.when} · ${absoluteDate(detail.date, locale)}`);
  author.append(metadata);
  card.append(author, element('div', 'popover-subject', detail.subject));
  if (detail.body) card.append(element('div', 'popover-body', detail.body));
  const stats = element('div', 'popover-stats');
  stats.append(element('span', '', `${detail.files} ${detail.files === 1 ? 'file' : 'files'} changed`));
  if (detail.insertions > 0) stats.append(element('span', 'add', `+${detail.insertions}`));
  if (detail.deletions > 0) stats.append(element('span', 'del', `−${detail.deletions}`));
  card.append(stats);
  if (data.refs.length) {
    const refs = element('div', 'popover-refs');
    refs.dataset.commitPopoverRefs = detail.hash;
    for (const ref of data.refs) refs.append(refBadge(ref.name, ref.kind, ref.head));
    card.append(refs);
  }
  const actions = element('div', 'popover-actions');
  actions.append(element('code', '', detail.hash.slice(0, 10)));
  const feedback = element('span', 'popover-feedback');
  const copy = document.createElement('button');
  copy.className = 'port';
  copy.type = 'button';
  copy.textContent = 'Copy hash';
  copy.title = 'Copy commit hash';
  copy.addEventListener('click', () => {
    feedback.textContent = '';
    void host.writeClipboard(detail.hash).then(() => {
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy hash'; }, 1_500);
    }).catch(() => { feedback.textContent = 'Copy failed.'; });
  });
  const openDiff = document.createElement('button');
  openDiff.className = 'port';
  openDiff.type = 'button';
  openDiff.textContent = 'Open diff';
  openDiff.title = 'Open the commit diff in the Diff view';
  openDiff.addEventListener('click', () => {
    feedback.textContent = '';
    void host.openCommit(detail.hash).catch(() => { feedback.textContent = 'Could not open the diff.'; });
  });
  const github = data.github;
  if (github) {
    const githubBtn = document.createElement('button');
    githubBtn.className = 'port';
    githubBtn.type = 'button';
    githubBtn.textContent = 'Open on GitHub';
    githubBtn.title = `Open on GitHub`;
    githubBtn.addEventListener('click', () => {
      feedback.textContent = '';
      void host.openUrl(`${github.replace(/\/$/, '')}/commit/${detail.hash}`).catch(() => { feedback.textContent = 'Could not open the link.'; });
    });
    actions.append(githubBtn);
  }
  actions.append(copy, openDiff);
  card.append(actions, feedback);
  root.replaceChildren(card);
};

/** Renders the popover child without mounting the status graph or its preferences. */
export const startCommitPopover = (root: HTMLElement, host: HostClient, context: HostReadyContext): void => {
  let reportedHeight = -1;
  const observer = new ResizeObserver(() => {
    const height = Math.ceil(root.getBoundingClientRect().height);
    if (height === reportedHeight) return;
    reportedHeight = height;
    void host.setHeight(height).catch(() => undefined);
  });
  observer.observe(root);
  root.ownerDocument.defaultView?.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  const popoverData = context.popover?.data;
  if (context.surface !== 'popover' || !context.popover || !popoverData || !context.directory) {
    root.replaceChildren(element('div', 'error', 'This commit preview is unavailable.'));
    return;
  }
  if (!commitPopoverDataSchema(popoverData)) {
    root.replaceChildren(element('div', 'error', 'This commit preview is unavailable.'));
    return;
  }
  root.replaceChildren(element('div', 'note', 'Loading commit…'));
  const directory = context.directory;
  let active = true;
  let stopDirectory = (): void => undefined;
  const window = root.ownerDocument.defaultView;
  const retire = (): void => {
    active = false;
    observer.disconnect();
    stopDirectory();
    window?.removeEventListener('pagehide', retire);
  };
  stopDirectory = host.onDirectory((next) => { if (next !== directory) retire(); });
  window?.addEventListener('pagehide', retire, { once: true });
  const finish = (): void => {
    stopDirectory();
    window?.removeEventListener('pagehide', retire);
  };
  void askDetail(host, directory, popoverData.sha).then((detail) => {
    if (!active) return;
    finish();
    renderDetail(root, host, popoverData, detail, context.locale);
  }).catch((error) => {
    if (!active) return;
    finish();
    root.replaceChildren(element('div', 'error', error instanceof Error ? error.message : 'Could not read this commit.'));
  });
};
