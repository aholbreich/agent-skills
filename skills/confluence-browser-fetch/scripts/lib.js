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

function slugify(s) {
  return String(s || 'untitled')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'untitled';
}

function safeName(name) {
  return String(name || 'attachment').replace(/[\\/\0]/g, '_').replace(/^\.+$/, '_');
}

function extractPageId(input) {
  const s = String(input).trim();
  if (/^\d+$/.test(s)) return s;
  try {
    const u = new URL(s);
    const qp = u.searchParams.get('pageId') || u.searchParams.get('pageid') || u.searchParams.get('homepageId') || u.searchParams.get('homepageid');
    if (qp && /^\d+$/.test(qp)) return qp;
    const patterns = [
      /\/pages\/(\d+)(?:\/|$)/,
      /\/display\/[^/]+\/.*?[?&]pageId=(\d+)/,
      /contentId=(\d+)/,
    ];
    for (const re of patterns) {
      const m = u.href.match(re);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

function sameVersion(existing, page) {
  if (!existing || !page) return false;
  const oldVersion = existing.version || {};
  const newVersion = page.version || {};
  return String(existing.id) === String(page.id)
    && oldVersion.number === newVersion.number
    && oldVersion.when === newVersion.when
    && existing.status === page.status;
}

function shouldSkipAttachment(size, maxAttachmentBytes) {
  const n = typeof size === 'number' ? size : Number(size);
  return Number.isFinite(n) && n > maxAttachmentBytes;
}

module.exports = {
  DEFAULT_MAX_ATTACHMENT_BYTES,
  parseSize,
  formatBytes,
  slugify,
  safeName,
  extractPageId,
  sameVersion,
  shouldSkipAttachment,
};
