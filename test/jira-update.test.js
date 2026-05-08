'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const lib = require('../skills/jira-update/scripts/lib');

function adfDoc(...content) {
  return { type: 'doc', version: 1, content };
}

test('markdownToAdf converts a single paragraph', () => {
  assert.deepEqual(
    lib.markdownToAdf('Hello world.'),
    adfDoc({ type: 'paragraph', content: [{ type: 'text', text: 'Hello world.' }] })
  );
});

test('markdownToAdf converts headings 1-6', () => {
  for (let level = 1; level <= 6; level++) {
    const md = `${'#'.repeat(level)} Title`;
    assert.deepEqual(
      lib.markdownToAdf(md),
      adfDoc({ type: 'heading', attrs: { level }, content: [{ type: 'text', text: 'Title' }] })
    );
  }
});

test('markdownToAdf converts unordered lists', () => {
  assert.deepEqual(
    lib.markdownToAdf('- one\n- two'),
    adfDoc({
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] },
      ],
    })
  );
});

test('markdownToAdf converts ordered lists', () => {
  assert.deepEqual(
    lib.markdownToAdf('1. first\n2. second'),
    adfDoc({
      type: 'orderedList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }] },
      ],
    })
  );
});

test('markdownToAdf converts fenced code blocks with language', () => {
  assert.deepEqual(
    lib.markdownToAdf('```js\nconst x = 1;\n```'),
    adfDoc({
      type: 'codeBlock',
      attrs: { language: 'js' },
      content: [{ type: 'text', text: 'const x = 1;' }],
    })
  );
});

test('markdownToAdf converts inline code, bold, italic, and links', () => {
  const result = lib.markdownToAdf('See `foo` and **bold** and *italic* and [link](https://example.com).');
  assert.deepEqual(result, adfDoc({
    type: 'paragraph',
    content: [
      { type: 'text', text: 'See ' },
      { type: 'text', text: 'foo', marks: [{ type: 'code' }] },
      { type: 'text', text: ' and ' },
      { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
      { type: 'text', text: ' and ' },
      { type: 'text', text: 'italic', marks: [{ type: 'em' }] },
      { type: 'text', text: ' and ' },
      { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
      { type: 'text', text: '.' },
    ],
  }));
});

test('markdownToAdf returns an empty doc for empty input', () => {
  assert.deepEqual(lib.markdownToAdf(''), adfDoc());
  assert.deepEqual(lib.markdownToAdf('   \n\n  '), adfDoc());
});

test('renderDescription returns ADF object directly when representation is adf', () => {
  const adf = adfDoc({ type: 'paragraph', content: [{ type: 'text', text: 'preformed' }] });
  assert.deepEqual(lib.renderDescription(adf, 'adf'), adf);
});

test('renderDescription converts string when representation is markdown', () => {
  assert.deepEqual(
    lib.renderDescription('Hello.', 'markdown'),
    adfDoc({ type: 'paragraph', content: [{ type: 'text', text: 'Hello.' }] })
  );
});

test('renderDescription throws on unsupported representation', () => {
  assert.throws(() => lib.renderDescription('x', 'wiki'), /Unsupported representation/);
});

test('buildCreatePayload assembles standard fields with markdown description', () => {
  const manifest = {
    project: 'PROJ',
    issueType: 'Bug',
    summary: 'Login fails',
    description: 'Step 1\n\nStep 2',
    descriptionRepresentation: 'markdown',
    labels: ['bug', 'browser'],
    assignee: 'accountId:abc',
    priority: 'High',
    parent: 'PROJ-100',
  };
  const payload = lib.buildCreatePayload(manifest);
  assert.equal(payload.fields.project.key, 'PROJ');
  assert.equal(payload.fields.issuetype.name, 'Bug');
  assert.equal(payload.fields.summary, 'Login fails');
  assert.equal(payload.fields.description.type, 'doc');
  assert.deepEqual(payload.fields.labels, ['bug', 'browser']);
  assert.deepEqual(payload.fields.assignee, { accountId: 'abc' });
  assert.deepEqual(payload.fields.priority, { name: 'High' });
  assert.deepEqual(payload.fields.parent, { key: 'PROJ-100' });
});

test('buildCreatePayload accepts adf description directly', () => {
  const adf = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'pre' }] }] };
  const payload = lib.buildCreatePayload({
    project: 'PROJ',
    issueType: 'Bug',
    summary: 'x',
    description: adf,
    descriptionRepresentation: 'adf',
  });
  assert.deepEqual(payload.fields.description, adf);
});

test('buildCreatePayload merges raw fields last (escape hatch wins)', () => {
  const payload = lib.buildCreatePayload({
    project: 'PROJ',
    issueType: 'Bug',
    summary: 'x',
    labels: ['a'],
    fields: { labels: ['override'], customfield_10010: 'Q3' },
  });
  assert.deepEqual(payload.fields.labels, ['override']);
  assert.equal(payload.fields.customfield_10010, 'Q3');
});

test('buildCreatePayload throws when required fields are missing', () => {
  assert.throws(() => lib.buildCreatePayload({}), /project/);
  assert.throws(() => lib.buildCreatePayload({ project: 'PROJ' }), /issueType/);
  assert.throws(() => lib.buildCreatePayload({ project: 'PROJ', issueType: 'Bug' }), /summary/);
});

test('resolveTransition matches by name (case-insensitive)', () => {
  const transitions = { transitions: [
    { id: '11', name: 'To Do' },
    { id: '21', name: 'In Progress' },
    { id: '31', name: 'Done' },
  ]};
  assert.deepEqual(lib.resolveTransition(transitions, { name: 'In Progress' }), { id: '21', name: 'In Progress' });
  assert.deepEqual(lib.resolveTransition(transitions, { name: 'in progress' }), { id: '21', name: 'In Progress' });
  assert.deepEqual(lib.resolveTransition(transitions, { id: '31' }), { id: '31', name: 'Done' });
});

test('resolveTransition throws when not found and lists candidates', () => {
  const transitions = { transitions: [{ id: '11', name: 'To Do' }] };
  assert.throws(
    () => lib.resolveTransition(transitions, { name: 'Done' }),
    /Transition not found.*To Do/
  );
});

test('buildTransitionPayload includes id, optional comment, and field overrides', () => {
  const adf = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] };
  const payload = lib.buildTransitionPayload({
    transitionId: '21',
    commentBody: adf,
    fields: { resolution: 'Fixed' },
  });
  assert.equal(payload.transition.id, '21');
  assert.deepEqual(payload.update.comment, [{ add: { body: adf } }]);
  assert.deepEqual(payload.fields.resolution, { name: 'Fixed' });
});

test('buildTransitionPayload omits update/fields when not provided', () => {
  const payload = lib.buildTransitionPayload({ transitionId: '21' });
  assert.deepEqual(payload, { transition: { id: '21' } });
});

test('parseAssignee accepts accountId: prefix and bare strings', () => {
  assert.deepEqual(lib.parseAssignee('accountId:abc'), { accountId: 'abc' });
  assert.deepEqual(lib.parseAssignee('jane.doe'), { name: 'jane.doe' });
  assert.equal(lib.parseAssignee(null), null);
});

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const repoRoot = path.resolve(__dirname, '..');
const script = path.join(repoRoot, 'skills/jira-update/scripts/jira-update.js');

test('jira-update CLI --help exits 0 and prints usage', () => {
  const result = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: jira-update/);
  assert.match(result.stdout, /create\s+/);
});

test('jira-update CLI rejects unknown command', () => {
  const result = spawnSync(process.execPath, [script, 'frobnicate'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown command: frobnicate/);
});

test('jira-update CLI fails fast when --server is missing for create', () => {
  const result = spawnSync(process.execPath, [script, 'create', '--file', 'nope.json'], {
    encoding: 'utf8',
    env: { ...process.env, JIRA_SERVER: '' },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Missing Jira server/);
});

test('jira-update CLI dry-run comment writes audit files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-update-'));
  const commentPath = path.join(tmp, 'reply.md');
  fs.writeFileSync(commentPath, '## Summary\n\nLooks good.');
  const result = spawnSync(process.execPath, [
    script, 'comment', 'PROJ-123',
    '--server', 'https://example.atlassian.net',
    '--file', commentPath,
    '--raw-dir', tmp,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stdout, /Dry-run comment on PROJ-123/);
  const dirs = fs.readdirSync(path.join(tmp, 'jira-updates'));
  const audit = path.join(tmp, 'jira-updates', dirs[0]);
  const payload = JSON.parse(fs.readFileSync(path.join(audit, 'proposed.payload.json'), 'utf8'));
  assert.equal(payload.body.type, 'doc');
  assert.equal(payload.body.content[0].type, 'heading');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('jira-update CLI dry-run create writes audit files without contacting Jira', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-update-'));
  const manifestPath = path.join(tmp, 'issue.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    project: 'PROJ',
    issueType: 'Bug',
    summary: 'test summary',
    description: 'one\n\ntwo',
  }));
  const result = spawnSync(process.execPath, [
    script, 'create', '--server', 'https://example.atlassian.net', '--file', manifestPath, '--raw-dir', tmp,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stdout, /Dry-run create: PROJ \/ Bug/);
  const dirs = fs.readdirSync(path.join(tmp, 'jira-updates'));
  assert.equal(dirs.length, 1);
  const audit = path.join(tmp, 'jira-updates', dirs[0]);
  assert.equal(fs.existsSync(path.join(audit, 'proposed.payload.json')), true);
  assert.equal(fs.existsSync(path.join(audit, 'proposed.adf.json')), true);
  assert.equal(fs.existsSync(path.join(audit, 'update-run.json')), true);
  fs.rmSync(tmp, { recursive: true, force: true });
});
