const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scriptJson } = require('../../src/routes/dashboard');

test('preloaded data cannot break out of its <script> tag', () => {
  const json = scriptJson({ name: '</script><script>alert(1)</script>', note: 'line break' });
  assert.ok(!json.includes('</script>'));
  assert.ok(!json.includes(' '));
  assert.deepEqual(JSON.parse(json), { name: '</script><script>alert(1)</script>', note: 'line break' }, 'still valid JSON with the same data');
});
