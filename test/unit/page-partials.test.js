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

describe('first-run onboarding', () => {
  test('Home gets the onboarding steps and its script; the sidebar can reopen them from any page', () => {
    const home = renderView('dashboard-new.html', { active: 'home' });
    assert.ok(!home.includes('<!-- ONBOARDING -->'));
    assert.equal((home.match(/id="cz-onboarding"/g) || []).length, 1);
    assert.ok(home.includes('/scripts/onboarding.js'));
    for (const step of ['capture', 'search', 'actions', 'context']) assert.ok(home.includes(`data-step="${step}"`), step);
    assert.ok(home.includes('href="/integrations/google/connect"'), 'the first step connects Google Meet');

    const settings = renderView('settings-new.html', { active: 'settings' });
    assert.ok(!settings.includes('id="cz-onboarding"'), 'only Home shows it');
    assert.ok(settings.includes('href="/dashboard?tour=1"'), '"How it works" goes to Home and opens it');
  });
});
