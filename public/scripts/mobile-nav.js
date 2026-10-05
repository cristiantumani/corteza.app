/**
 * Phone layout for the shared sidebar (src/views/partials/sidebar.html).
 *
 * Below 768px the sidebar becomes a drawer: a menu button at the start of the page's top bar
 * opens it over the page, and a link, the backdrop or Esc closes it. Pages without a top bar
 * (Search) get a small one with the menu button and "Corteza". The CSS lives in the partial.
 */
(function() {
  'use strict';
  const t = window.t || (key => key); // public/scripts/i18n.js

  const aside = document.querySelector('.corteza-sidebar');
  if (!aside) return;
  aside.id = aside.id || 'corteza-sidebar';

  // The page's own fixed top bar, or a minimal one for pages that have none
  let bar = Array.from(document.body.children).find(el => el.tagName === 'HEADER' && el.classList.contains('fixed'));
  if (!bar) {
    bar = document.createElement('header');
    bar.className = 'cz-mobile-header fixed'; // "fixed": dashboard-new.css hides headers without it
    const brand = document.createElement('a');
    brand.href = '/dashboard';
    brand.className = 'cz-mobile-brand';
    brand.textContent = 'Corteza';
    bar.appendChild(brand);
    document.body.prepend(bar);
    document.body.classList.add('cz-own-header');
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cz-menu-btn';
  button.setAttribute('aria-controls', aside.id);
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', t('nav.open'));
  button.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">menu</span>';
  bar.prepend(button);

  const backdrop = document.createElement('div');
  backdrop.className = 'cz-nav-backdrop';
  backdrop.hidden = true;
  document.body.appendChild(backdrop);

  const isOpen = () => document.body.classList.contains('cz-nav-open');

  function setOpen(open) {
    document.body.classList.toggle('cz-nav-open', open);
    backdrop.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? t('nav.close') : t('nav.open'));
    if (open) {
      // After the drawer becomes visible: a hidden element can't take focus
      const first = aside.querySelector('a, button');
      if (first) requestAnimationFrame(() => requestAnimationFrame(() => first.focus()));
    }
  }

  button.addEventListener('click', () => setOpen(!isOpen()));
  backdrop.addEventListener('click', () => setOpen(false));
  aside.addEventListener('click', event => {
    if (event.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isOpen()) {
      setOpen(false);
      button.focus();
    }
  });
  // Back to desktop width: the sidebar is always visible there
  const desktop = window.matchMedia('(min-width: 768px)');
  desktop.addEventListener('change', event => {
    if (event.matches && isOpen()) setOpen(false);
  });
})();
