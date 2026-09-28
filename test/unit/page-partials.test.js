const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { renderView } = require('../../src/http/page-partials');

describe('shared sidebar', () => {
  const pages = [
    ['dashboard-new.html', 'home'],
    ['actions.html', 'actions'],
    ['ai-search.html', 'search'],
    ['settings-new.html', 'settings']
  ];

  test('every app page gets the same sidebar, with only its own link marked as current', () => {
    const sidebars = pages.map(([file, active]) => {
      const html = renderView(file, { active });
      assert.ok(!html.includes('<!-- SIDEBAR -->'), `${file} still has the placeholder`);
      assert.equal((html.match(/<aside/g) || []).length, 1, `${file} has one sidebar`);
      const aside = html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));
      assert.equal((aside.match(/aria-current="page"/g) || []).length, 1);
      assert.ok(aside.includes(`data-nav="${active}" aria-current="page"`));
      return aside.replace(' aria-current="page"', '');
    });
    sidebars.forEach(sidebar => assert.equal(sidebar, sidebars[0]));
  });
});
