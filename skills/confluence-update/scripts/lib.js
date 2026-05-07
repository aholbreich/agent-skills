'use strict';

const { randomUUID } = require('crypto');

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeName(name) {
  return String(name || 'untitled').replace(/[\\/\0]/g, '_').replace(/^\.+$/, '_').slice(0, 120) || 'untitled';
}

function extractPageId(input) {
  const s = String(input || '').trim();
  if (/^\d+$/.test(s)) return s;
  try {
    const u = new URL(s);
    const qp = u.searchParams.get('pageId') || u.searchParams.get('pageid') || u.searchParams.get('contentId') || u.searchParams.get('contentid');
    if (qp && /^\d+$/.test(qp)) return qp;
    const patterns = [
      /\/pages\/(\d+)(?:\/|$)/,
      /[?&]pageId=(\d+)/,
      /[?&]contentId=(\d+)/,
    ];
    for (const re of patterns) {
      const m = u.href.match(re);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

function inlineMarkdown(s) {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return out;
}

function markdownToStorage(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let paragraph = [];
  let list = null;
  let inCode = false;
  let code = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    out.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  }

  function closeList() {
    if (!list) return;
    out.push(`<${list.type}>${list.items.map(item => `<li>${inlineMarkdown(item)}</li>`).join('')}</${list.type}>`);
    list = null;
  }

  function flushCode() {
    out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
    code = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    if (/^```/.test(line)) {
      if (inCode) {
        inCode = false;
        flushCode();
      } else {
        flushParagraph();
        closeList();
        inCode = true;
        code = [];
      }
      continue;
    }
    if (inCode) {
      code.push(rawLine);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMarkdown(heading[2].trim())}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (!list || list.type !== 'ul') { closeList(); list = { type: 'ul', items: [] }; }
      list.items.push(bullet[1].trim());
      continue;
    }
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (!list || list.type !== 'ol') { closeList(); list = { type: 'ol', items: [] }; }
      list.items.push(ordered[1].trim());
      continue;
    }
    closeList();
    paragraph.push(line.trim());
  }

  if (inCode) flushCode();
  flushParagraph();
  closeList();
  return out.join('\n');
}

function renderContent(content, representation) {
  const rep = String(representation || 'storage').toLowerCase();
  if (rep === 'storage') return String(content ?? '');
  if (rep === 'markdown' || rep === 'md') return markdownToStorage(content);
  throw new Error(`Unsupported representation: ${representation}`);
}

function blockMarkers(marker) {
  const name = String(marker || '').trim();
  if (!/^[A-Za-z0-9._:-]+$/.test(name)) throw new Error('Marker must contain only letters, digits, dot, underscore, colon, or hyphen');
  return {
    start: `<!-- agent-block:${name}:start -->`,
    end: `<!-- agent-block:${name}:end -->`,
  };
}

function replaceMarkedBlock(storage, marker, replacementStorage) {
  const { start, end } = blockMarkers(marker);
  const re = new RegExp(`(${escapeRegExp(start)})([\\s\\S]*?)(${escapeRegExp(end)})`);
  if (!re.test(String(storage || ''))) throw new Error(`Marker block not found: ${marker}`);
  return String(storage).replace(re, `$1\n${String(replacementStorage || '')}\n$3`);
}

function replaceTextMatch(storage, matchText, replacementStorage) {
  if (!matchText) throw new Error('Match text cannot be empty');
  const index = storage.indexOf(matchText);
  if (index === -1) throw new Error(`Match text not found: ${matchText.slice(0, 50)}...`);
  if (storage.indexOf(matchText, index + 1) !== -1) throw new Error('Match text is not unique in the page. Please provide a more specific match string.');
  return storage.replace(matchText, replacementStorage);
}

function replaceLocalId(storage, localId, replacementStorage) {
  if (!localId) throw new Error('local-id cannot be empty');
  const re = new RegExp(`(<[^>]+local-id="${escapeRegExp(localId)}"[^>]*>)([\\s\\S]*?)(</[a-zA-Z0-9]+>)`);
  const match = storage.match(re);
  if (!match) throw new Error(`local-id not found: ${localId}`);
  
  // This is a naive replacement that assumes the tag closes cleanly. It works for simple blocks (p, h1, etc.)
  // but might be dangerous for deep nesting unless the user provides the whole replacement tag.
  // Actually, replacing the *entire* matched block is safer and clearer for the user.
  return storage.replace(match[0], replacementStorage);
}

function generateSimpleDiff(oldText, newText) {
  const oldLines = String(oldText || '').split('\n');
  const newLines = String(newText || '').split('\n');
  const diff = [];
  
  // Extremely naive diff just for dry-run summaries without dependencies
  if (oldText === newText) return '  (No changes)';
  
  const added = newLines.length - oldLines.length;
  diff.push(`  Size changed: ${oldText.length} bytes -> ${newText.length} bytes`);
  diff.push(`  Lines changed: ${oldLines.length} -> ${newLines.length} (${added > 0 ? '+' : ''}${added})`);
  
  return diff.join('\n');
}

function wrapMacro(storage, macroType) {
  if (!macroType) return storage;
  const name = String(macroType).toLowerCase();
  
  // Page Properties macro is internally called "details"
  if (name === 'page-properties' || name === 'details') {
    return `<ac:structured-macro ac:name="details" ac:schema-version="1" ac:macro-id="${randomUUID()}"><ac:rich-text-body>${storage}</ac:rich-text-body></ac:structured-macro>`;
  }
  
  // Generic wrapper for other rich-text body macros
  return `<ac:structured-macro ac:name="${escapeHtml(name)}" ac:schema-version="1" ac:macro-id="${randomUUID()}"><ac:rich-text-body>${storage}</ac:rich-text-body></ac:structured-macro>`;
}

module.exports = {
  escapeHtml,
  safeName,
  extractPageId,
  markdownToStorage,
  renderContent,
  wrapMacro,
  blockMarkers,
  replaceMarkedBlock,
  replaceTextMatch,
  replaceLocalId,
  generateSimpleDiff,
};
