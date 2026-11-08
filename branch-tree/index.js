/**
 * Host half of the Git graph watermark bundle.
 *
 * Reduces a workspace repository to the small tree the browser draws: the
 * current branch's HEAD, plus each nearby branch's fork point and newest
 * commit, skipping everything in between. Every git call is read-only and
 * bounded; nothing here writes to the repository.
 */
import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Authenticated route below `/api`; only owner Peers of this Host reach it. */
const ROUTE = '/api/plugin/git-graph-watermark';
/** How long one repository snapshot is reused before git is queried again. */
const CACHE_MS = 15_000;
/** Branches drawn beside the current one. */
const MAX_BRANCHES = 7;
/** Commit subjects kept long enough for the hover card. */
const SUBJECT_LIMIT = 160;
/** Repository snapshots kept for reuse. */
const MAX_CACHE_ENTRIES = 64;

/** Snapshot cache keyed by repository directory. */
const cache = new Map();

export const inject = ['connection'];

/**
 * Register the snapshot route for this plugin's lifetime.
 * @param ctx - Host context carrying the Connection service.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: handleRequest,
  }), 'git-graph-watermark: snapshot route');
}

/**
 * Answer one snapshot request.
 * @param request - admitted same-origin request carrying the workspace path.
 * @returns the snapshot, or an `available: false` envelope.
 */
async function handleRequest(request) {
  const url = new URL(request.url);
  const dir = url.searchParams.get('path');
  if (typeof dir !== 'string' || !dir.startsWith('/')) return reply({ available: false, reason: 'path' }, 400);
  try {
    return reply(await snapshot(dir, url.searchParams.get('fresh') === '1'), 200);
  } catch {
    return reply({ available: false, reason: 'git' }, 200);
  }
}

/**
 * Build a JSON response.
 * @param value - JSON-serializable body.
 * @param status - HTTP status.
 * @returns the response.
 */
function reply(value, status) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/**
 * Reuse a recent snapshot unless a fresh read was requested.
 * @param dir - repository directory.
 * @param fresh - whether the caller wants a live read.
 * @returns the snapshot.
 */
async function snapshot(dir, fresh) {
  const now = Date.now();
  const cached = cache.get(dir);
  if (!fresh && cached !== undefined && now - cached.at < CACHE_MS) return cached.value;
  const value = await readGraph(dir);
  cache.set(dir, { at: now, value });
  if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  return value;
}

/**
 * Read the repository and reduce it to a forked tree.
 * @param dir - workspace directory; any non-repository path yields `available: false`.
 * @returns the snapshot envelope.
 */
async function readGraph(dir) {
  const headRef = ((await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])) ?? '').trim();
  const head = await commitInfo(dir, 'HEAD');
  if (head === undefined) return { available: false };
  const current = headRef === 'HEAD' ? undefined : headRef;

  const refsText = (await git(dir, [
    'for-each-ref',
    '--format=%(refname)%09%(objectname)%09%(authorname)%09%(committerdate:unix)%09%(subject)',
    'refs/heads',
    'refs/remotes',
  ])) ?? '';
  const statusText = (await git(dir, ['status', '--porcelain', '--untracked-files=no'])) ?? '';

  const refs = [];
  let branchCount = 0;
  for (const line of refsText.split('\n')) {
    if (line === '') continue;
    const [refname, objectName = '', author = '', timeText = '0', subject = ''] = line.split('\t');
    if (refname === undefined || refname.endsWith('/HEAD')) continue;
    const local = refname.startsWith('refs/heads/');
    const name = local
      ? refname.slice('refs/heads/'.length)
      : refname.slice('refs/remotes/'.length).split('/').slice(1).join('/');
    if (name === '') continue;
    branchCount += 1;
    refs.push({ name, local, tip: objectName, author, t: Number(timeText) || 0, subject: clip(subject) });
  }

  const ranked = refs
    .filter((ref) => !(current !== undefined && ref.local && ref.name === current))
    .sort((left, right) => (right.t - left.t) || (left.local === right.local ? 0 : left.local ? -1 : 1));

  const branches = [];
  const seenTips = new Set();
  for (const ref of ranked) {
    if (branches.length >= MAX_BRANCHES) break;
    if (seenTips.has(ref.tip)) continue;
    const forkHash = ((await git(dir, ['merge-base', 'HEAD', ref.tip])) ?? '').trim();
    if (forkHash === '') continue;
    const aheadText = ((await git(dir, ['rev-list', '--count', `${forkHash}..${ref.tip}`])) ?? '').trim();
    const ahead = Number(aheadText) || 0;
    if (ahead === 0) continue;
    const fork = await commitInfo(dir, forkHash);
    if (fork === undefined) continue;
    seenTips.add(ref.tip);
    branches.push({
      name: ref.name,
      remote: !ref.local,
      tip: { h: ref.tip.slice(0, 7), subject: ref.subject, author: ref.author, t: ref.t },
      fork: { h: fork.h, t: fork.t },
      ahead,
    });
  }

  return {
    available: true,
    repo: basename(dir),
    branch: current ?? head.h,
    hash: head.h,
    detached: current === undefined,
    dirty: Math.min(statusText.split('\n').filter((line) => line !== '').length, 99),
    branchCount,
    head,
    branches,
  };
}

/**
 * Read one commit's display fields.
 * @param dir - repository directory.
 * @param rev - any commit-ish.
 * @returns the fields, or undefined when the revision is unknown.
 */
async function commitInfo(dir, rev) {
  const text = await git(dir, ['log', '-1', '--format=%h%x1f%an%x1f%ct%x1f%s', rev]);
  if (text === undefined) return undefined;
  const line = text.trim();
  if (line === '') return undefined;
  const [h = '', author = '', timeText = '0', subject = ''] = line.split('\x1f');
  if (h === '') return undefined;
  return { h, subject: clip(subject), author, t: Number(timeText) || 0 };
}

/**
 * Bound one display string.
 * @param text - raw git text.
 * @returns at most {@link SUBJECT_LIMIT} characters.
 */
function clip(text) {
  const value = String(text);
  return value.length <= SUBJECT_LIMIT ? value : `${value.slice(0, SUBJECT_LIMIT - 1)}…`;
}

/**
 * Run one bounded, read-only git command.
 * @param dir - repository directory.
 * @param args - git arguments after `-C <dir>`.
 * @returns stdout, or undefined when git failed.
 */
async function git(dir, args) {
  try {
    const { stdout } = await run('git', ['-C', dir, ...args], {
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout;
  } catch {
    return undefined;
  }
}
