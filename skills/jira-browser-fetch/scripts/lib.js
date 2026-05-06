'use strict';

const DEFAULT_MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

function parseSize(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_MAX_ATTACHMENT_BYTES;
  const s = String(value).trim().toLowerCase();
  if (['unlimited', 'infinite', 'inf', 'none', 'no-limit'].includes(s)) return Infinity;
  const m = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*(b|bytes?|k|kb|kib|m|mb|mib|g|gb|gib)?$/);
  if (!m) throw new Error(`Invalid size: ${value}`);
  const n = Number(m[1]);
  const unit = m[2] || 'b';
  const factor = unit.startsWith('g') ? 1024 ** 3 : unit.startsWith('m') ? 1024 ** 2 : unit.startsWith('k') ? 1024 : 1;
  return Math.floor(n * factor);
}

function formatBytes(n) {
  if (n === Infinity) return 'unlimited';
  if (!Number.isFinite(n)) return String(n);
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GiB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${n} B`;
}

function safeName(name) {
  return String(name || 'attachment').replace(/[\\/\0]/g, '_').replace(/^\.+$/, '_');
}

function issueKeysFromText(text) {
  if (!text) return [];
  const found = [];
  const re = /\b([A-Z][A-Z0-9]+)-(\d+)\b/g;
  for (const m of String(text).matchAll(re)) found.push(`${m[1]}-${m[2]}`);
  return [...new Set(found)];
}

function shouldSkipAttachment(size, maxAttachmentBytes) {
  const n = typeof size === 'number' ? size : Number(size);
  return Number.isFinite(n) && n > maxAttachmentBytes;
}

function parseBacklogInput(input, server = '') {
  if (!input) throw new Error('Missing Jira backlog URL or board id');
  const value = String(input).trim();
  const numeric = value.match(/^\d+$/);
  if (numeric) {
    return {
      boardId: Number(value),
      source: value,
      browseUrl: server ? `${String(server).replace(/\/$/, '')}/jira/software/c/boards/${value}/backlog` : value,
    };
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid Jira backlog URL or board id: ${input}`);
  }

  const m = url.pathname.match(/\/boards\/(\d+)(?:\/backlog)?\b/);
  if (!m) throw new Error(`Could not parse Jira board id from backlog URL: ${input}`);

  return {
    boardId: Number(m[1]),
    source: value,
    browseUrl: value,
  };
}

function backlogApiUrl(server, boardId, startAt, maxResults) {
  const base = String(server || '').replace(/\/$/, '');
  const params = new URLSearchParams({ startAt: String(startAt), maxResults: String(maxResults) });
  return `${base}/rest/agile/1.0/board/${boardId}/backlog?${params}`;
}

function issueKeysFromAgilePage(page) {
  const issues = page && Array.isArray(page.issues) ? page.issues : [];
  return issues.map(issue => issue && issue.key).filter(Boolean);
}

module.exports = {
  DEFAULT_MAX_ATTACHMENT_BYTES,
  parseSize,
  formatBytes,
  safeName,
  issueKeysFromText,
  shouldSkipAttachment,
  parseBacklogInput,
  backlogApiUrl,
  issueKeysFromAgilePage,
};
