'use strict';

function adfDoc(content) {
  return { type: 'doc', version: 1, content: content || [] };
}

function inlineNodes(text) {
  const nodes = [];
  let i = 0;
  let plain = '';

  function pushPlain() {
    if (plain) {
      nodes.push({ type: 'text', text: plain });
      plain = '';
    }
  }

  function pushMarked(t, marks) {
    if (!t) return;
    nodes.push({ type: 'text', text: t, marks });
  }

  while (i < text.length) {
    const ch = text[i];

    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        pushPlain();
        pushMarked(text.slice(i + 1, end), [{ type: 'code' }]);
        i = end + 1;
        continue;
      }
    }

    if (ch === '[') {
      const close = text.indexOf(']', i + 1);
      if (close !== -1 && text[close + 1] === '(') {
        const urlEnd = text.indexOf(')', close + 2);
        if (urlEnd !== -1) {
          pushPlain();
          pushMarked(text.slice(i + 1, close), [{ type: 'link', attrs: { href: text.slice(close + 2, urlEnd) } }]);
          i = urlEnd + 1;
          continue;
        }
      }
    }

    if (ch === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end !== -1) {
        pushPlain();
        pushMarked(text.slice(i + 2, end), [{ type: 'strong' }]);
        i = end + 2;
        continue;
      }
    }

    if (ch === '*' && text[i + 1] !== '*') {
      const end = text.indexOf('*', i + 1);
      if (end !== -1) {
        pushPlain();
        pushMarked(text.slice(i + 1, end), [{ type: 'em' }]);
        i = end + 1;
        continue;
      }
    }

    plain += ch;
    i++;
  }
  pushPlain();
  return nodes;
}

function paragraph(text) {
  return { type: 'paragraph', content: inlineNodes(text) };
}

function listItem(text) {
  return { type: 'listItem', content: [paragraph(text)] };
}

function markdownToAdf(input) {
  const lines = String(input || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let paragraphLines = [];
  let list = null;
  let inCode = false;
  let codeLanguage = '';
  let codeLines = [];

  function flushParagraph() {
    if (!paragraphLines.length) return;
    blocks.push(paragraph(paragraphLines.join(' ')));
    paragraphLines = [];
  }

  function closeList() {
    if (!list) return;
    blocks.push({ type: list.type, content: list.items });
    list = null;
  }

  function flushCode() {
    blocks.push({
      type: 'codeBlock',
      attrs: codeLanguage ? { language: codeLanguage } : {},
      content: codeLines.length ? [{ type: 'text', text: codeLines.join('\n') }] : [],
    });
    codeLines = [];
    codeLanguage = '';
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      if (inCode) { inCode = false; flushCode(); }
      else { flushParagraph(); closeList(); inCode = true; codeLanguage = fence[1] || ''; codeLines = []; }
      continue;
    }
    if (inCode) { codeLines.push(rawLine); continue; }

    if (!line.trim()) { flushParagraph(); closeList(); continue; }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph(); closeList();
      blocks.push({ type: 'heading', attrs: { level: heading[1].length }, content: inlineNodes(heading[2].trim()) });
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (!list || list.type !== 'bulletList') { closeList(); list = { type: 'bulletList', items: [] }; }
      list.items.push(listItem(bullet[1].trim()));
      continue;
    }

    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (!list || list.type !== 'orderedList') { closeList(); list = { type: 'orderedList', items: [] }; }
      list.items.push(listItem(ordered[1].trim()));
      continue;
    }

    closeList();
    paragraphLines.push(line.trim());
  }

  if (inCode) flushCode();
  flushParagraph();
  closeList();
  return adfDoc(blocks);
}

function renderDescription(input, representation) {
  const rep = String(representation || 'markdown').toLowerCase();
  if (rep === 'adf') {
    if (!input || typeof input !== 'object') throw new Error('descriptionRepresentation: adf requires an ADF object');
    return input;
  }
  if (rep === 'markdown' || rep === 'md') return markdownToAdf(String(input ?? ''));
  throw new Error(`Unsupported representation: ${representation}`);
}

function parseAssignee(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return value;
  const s = String(value);
  if (s.startsWith('accountId:')) return { accountId: s.slice('accountId:'.length) };
  return { name: s };
}

function buildCreatePayload(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('create manifest must be an object');
  if (!manifest.project) throw new Error('create manifest requires project (key)');
  if (!manifest.issueType) throw new Error('create manifest requires issueType (name)');
  if (!manifest.summary) throw new Error('create manifest requires summary');

  const fields = {
    project: { key: String(manifest.project) },
    issuetype: { name: String(manifest.issueType) },
    summary: String(manifest.summary),
  };

  if (manifest.description !== undefined && manifest.description !== null) {
    fields.description = renderDescription(manifest.description, manifest.descriptionRepresentation);
  }

  if (Array.isArray(manifest.labels)) fields.labels = manifest.labels.map(String);
  const assignee = parseAssignee(manifest.assignee);
  if (assignee) fields.assignee = assignee;
  if (manifest.priority) fields.priority = typeof manifest.priority === 'string' ? { name: manifest.priority } : manifest.priority;
  if (manifest.parent) fields.parent = typeof manifest.parent === 'string' ? { key: manifest.parent } : manifest.parent;

  if (manifest.fields && typeof manifest.fields === 'object') {
    Object.assign(fields, manifest.fields);
  }

  return { fields };
}

function resolveTransition(transitionsResponse, query) {
  const list = (transitionsResponse && transitionsResponse.transitions) || [];
  if (!list.length) throw new Error('No transitions available');
  if (query.id) {
    const match = list.find(t => String(t.id) === String(query.id));
    if (!match) throw new Error(`Transition not found: id=${query.id}. Available: ${list.map(t => `${t.id}:${t.name}`).join(', ')}`);
    return match;
  }
  if (query.name) {
    const want = String(query.name).toLowerCase();
    const match = list.find(t => String(t.name).toLowerCase() === want);
    if (!match) throw new Error(`Transition not found: "${query.name}". Available: ${list.map(t => t.name).join(', ')}`);
    return match;
  }
  throw new Error('resolveTransition requires {name} or {id}');
}

function fieldValueFromCli(key, value) {
  if (['resolution', 'priority', 'status'].includes(key)) return { name: value };
  if (['labels', 'components', 'fixVersions'].includes(key)) {
    const parts = String(value).split(',').map(s => s.trim()).filter(Boolean);
    if (key === 'labels') return parts;
    return parts.map(name => ({ name }));
  }
  return value;
}

function buildTransitionPayload({ transitionId, commentBody, fields }) {
  if (!transitionId) throw new Error('buildTransitionPayload requires transitionId');
  const payload = { transition: { id: String(transitionId) } };
  if (commentBody) {
    payload.update = { comment: [{ add: { body: commentBody } }] };
  }
  if (fields && Object.keys(fields).length) {
    payload.fields = {};
    for (const [k, v] of Object.entries(fields)) payload.fields[k] = fieldValueFromCli(k, v);
  }
  return payload;
}

function resolveLinkType(typesResponse, query) {
  const list = (typesResponse && typesResponse.issueLinkTypes) || [];
  if (!list.length) throw new Error('No issue link types available');
  const want = String(query || '').toLowerCase();
  const match = list.find(t =>
    String(t.name).toLowerCase() === want
    || String(t.inward).toLowerCase() === want
    || String(t.outward).toLowerCase() === want
  );
  if (!match) throw new Error(`Link type not found: "${query}". Available: ${list.map(t => t.name).join(', ')}`);
  return match;
}

function buildLinkPayload({ from, to, linkType }) {
  if (!from || !to) throw new Error('buildLinkPayload requires from and to');
  if (!linkType || !linkType.name) throw new Error('buildLinkPayload requires linkType.name');
  return {
    type: { name: linkType.name },
    inwardIssue: { key: to },
    outwardIssue: { key: from },
  };
}

module.exports = {
  adfDoc,
  markdownToAdf,
  renderDescription,
  parseAssignee,
  buildCreatePayload,
  resolveTransition,
  fieldValueFromCli,
  buildTransitionPayload,
  resolveLinkType,
  buildLinkPayload,
};
