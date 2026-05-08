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
