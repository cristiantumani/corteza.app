/**
 * Help: the sidebar's "Help" opens a chat panel answered by Corteza's support agent
 * (POST /api/support/messages, an event stream; src/core/support/support-agent.js).
 * Loaded by the sidebar partial only when the agent is configured.
 *
 * Everything shown is built with textContent and DOM nodes, never innerHTML: replies come from an AI.
 * The conversation lives for this page only (conversation_id in sessionStorage, so moving between
 * pages keeps it; the text itself isn't kept in the browser).
 */
(function () {
  'use strict';
  const t = window.t || (key => key); // public/scripts/i18n.js
  const STORE = 'corteza.support.conversation';
  let panel = null;
  let log = null;
  let input = null;
  let sendButton = null;
  let busy = false;

  const store = {
    get() { try { return sessionStorage.getItem(STORE); } catch (e) { return null; } },
    set(value) { try { if (value) sessionStorage.setItem(STORE, value); else sessionStorage.removeItem(STORE); } catch (e) { /* private mode */ } }
  };

  function el(tag, style, text) {
    const node = document.createElement(tag);
    if (style) node.style.cssText = style;
    if (text) node.textContent = text;
    return node;
  }

  /** Text with links ([label](https://…) and bare https URLs) as safe anchors */
  function richText(node, text) {
    node.textContent = '';
    const pattern = /\[([^\]]{1,200})\]\((https:\/\/[^\s)]+)\)|(https:\/\/[^\s)<>"]+)/g;
    let last = 0;
    let match;
    while ((match = pattern.exec(text))) {
      if (match.index > last) node.appendChild(document.createTextNode(text.slice(last, match.index)));
      const href = match[2] || match[3];
      const link = el('a', 'color:#C2410C;text-decoration:underline;word-break:break-word;', match[1] || href);
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      node.appendChild(link);
      last = pattern.lastIndex;
    }
    if (last < text.length) node.appendChild(document.createTextNode(text.slice(last)));
  }

  function bubble(who, text) {
    const mine = who === 'me';
    const node = el('div', `max-width:85%;padding:8px 12px;border-radius:12px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word;${mine ? 'align-self:flex-end;background:#171717;color:#fff;' : 'align-self:flex-start;background:#F3F4F6;color:#171717;'}`);
    richText(node, text);
    log.appendChild(node);
    log.scrollTop = log.scrollHeight;
    return node;
  }

  function note(text) {
    const node = el('p', 'align-self:center;margin:4px 0;font-size:12px;color:#6B6B6B;text-align:center;', text);
    log.appendChild(node);
    log.scrollTop = log.scrollHeight;
  }

  function build() {
    panel = el('section', 'position:fixed;right:16px;bottom:16px;z-index:60;width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 32px));display:flex;flex-direction:column;background:#fff;border:1px solid #E5E7EB;border-radius:16px;box-shadow:0 12px 32px rgba(0,0,0,.16);overflow:hidden;');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', t('support.title'));

    const header = el('header', 'display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #E5E7EB;');
    header.appendChild(el('h2', 'flex:1;margin:0;font-size:15px;font-weight:600;color:#171717;', t('support.title')));
    const fresh = el('button', 'background:none;border:0;cursor:pointer;font-size:13px;color:#6B6B6B;padding:4px 6px;', t('support.new'));
    fresh.type = 'button';
    fresh.addEventListener('click', () => { store.set(null); log.textContent = ''; greet(); input.focus(); });
    const close = el('button', 'background:none;border:0;cursor:pointer;color:#6B6B6B;padding:4px;line-height:1;');
    close.type = 'button';
    close.setAttribute('aria-label', t('support.close'));
    close.appendChild(el('span', 'font-size:20px;', 'close')).className = 'material-symbols-outlined';
    close.addEventListener('click', hide);
    header.append(fresh, close);

    log = el('div', 'flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;');
    log.setAttribute('aria-live', 'polite');

    const form = el('form', 'display:flex;gap:8px;padding:12px;border-top:1px solid #E5E7EB;');
    input = el('textarea', 'flex:1;resize:none;height:40px;max-height:120px;padding:9px 12px;border:1px solid #D1D5DB;border-radius:10px;font:inherit;font-size:14px;');
    input.maxLength = 2000;
    input.placeholder = t('support.placeholder');
    input.setAttribute('aria-label', t('support.placeholder'));
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
    });
    sendButton = el('button', 'padding:0 14px;border:0;border-radius:10px;background:#E85D3A;color:#fff;font-weight:600;font-size:14px;cursor:pointer;', t('support.send'));
    sendButton.type = 'submit';
    form.append(input, sendButton);
    form.addEventListener('submit', event => { event.preventDefault(); ask(); });

    const footer = el('p', 'margin:0;padding:0 12px 10px;font-size:12px;color:#6B6B6B;');
    footer.appendChild(document.createTextNode(t('support.footer') + ' '));
    const mail = el('a', 'color:#C2410C;text-decoration:underline;', t('support.emailInstead'));
    mail.href = 'mailto:cristian@corteza.app';
    footer.appendChild(mail);

    panel.append(header, log, form, footer);
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
    document.body.appendChild(panel);
    greet();
  }

  function greet() {
    bubble('agent', t('support.greeting'));
  }

  function open() {
    if (!panel) build();
    panel.style.display = 'flex';
    input.focus();
  }

  function hide() {
    if (panel) panel.style.display = 'none';
    const trigger = document.getElementById('sb-support');
    if (trigger) trigger.focus();
  }

  function setBusy(value) {
    busy = value;
    sendButton.disabled = value;
    sendButton.style.opacity = value ? '0.6' : '1';
  }

  async function ask() {
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    bubble('me', text);
    setBusy(true);
    const reply = bubble('agent', t('support.thinking'));
    reply.style.color = '#6B6B6B';
    let answer = '';
    try {
      const response = await fetch('/api/support/messages', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ text, conversation_id: store.get() || undefined, page: window.location.pathname })
      });
      const type = response.headers.get('Content-Type') || '';
      if (!response.ok || !type.includes('text/event-stream')) {
        if (response.status === 404 && store.get()) store.set(null);
        reply.remove();
        note(response.status === 429 ? t('support.limit') : t('support.error'));
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const event = (chunk.match(/^event: (.*)$/m) || [])[1];
          const raw = (chunk.match(/^data: (.*)$/m) || [])[1];
          let data = {};
          try { data = raw ? JSON.parse(raw) : {}; } catch (e) { continue; }
          if (event === 'text' && typeof data.text === 'string') {
            answer += (answer ? '\n\n' : '') + data.text;
            reply.style.color = '#171717';
            richText(reply, answer);
            log.scrollTop = log.scrollHeight;
          } else if (event === 'done') {
            if (data.conversation_id) store.set(data.conversation_id);
            if (data.escalated) note(t('support.escalated'));
            if (data.limit_reached) { store.set(null); note(t('support.sessionLimit')); }
          } else if (event === 'error') {
            note(t('support.error'));
          }
        }
      }
      if (!answer) reply.remove();
    } catch (error) {
      reply.remove();
      note(t('support.error'));
    } finally {
      setBusy(false);
      input.focus();
    }
  }

  window.CortezaSupport = { open };
})();
