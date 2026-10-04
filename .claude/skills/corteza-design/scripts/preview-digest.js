#!/usr/bin/env node
/**
 * Morning summary preview: renders the daily summary email for every morning partner ×
 * situation × language with fake data (no database, no email sent), plus Classic.
 *
 *   node .claude/skills/corteza-design/scripts/preview-digest.js                 # writes ./ui-preview/digest (gitignored)
 *   node .claude/skills/corteza-design/scripts/preview-digest.js --out /tmp/x
 *
 * Writes one HTML file per email and index.html with every subject and opening line, to
 * review the voice before people see it (docs/specs/2026-10-morning-partner.md).
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../../..');
const voice = require(path.join(root, 'src/core/digest/voice'));
const { dailyDigestHtml, dailyDigestSubject, escapeHtml } = require(path.join(root, 'src/utils/n8n-client'));

const i = process.argv.indexOf('--out');
const out = path.resolve(i === -1 ? path.join(root, 'ui-preview/digest') : process.argv[i + 1]);
fs.mkdirSync(out, { recursive: true });

const today = '2026-10-05';
const item = (id, text, due) => ({ item_id: id, text, due_date: due, meeting: 'Planificación comercial Q4', next_step_on: null });
const SUMMARIES = {
  all_clear: { overdue: 0, dueToday: 0, planItems: [] },
  due_today: { overdue: 0, dueToday: 1, planItems: [item('a1', 'Preparar la página de precios con el plan anual', today)] },
  overdue_few: { overdue: 2, dueToday: 0, planItems: [item('a2', 'Confirmar con el proveedor de pagos el cobro anual', '2026-10-01'), item('a3', 'Enviar el resumen de la revisión técnica', '2026-09-29')] },
  overdue_pile: { overdue: 4, dueToday: 0, planItems: [1, 2, 3, 4].map(n => item(`p${n}`, `Pendiente atrasado número ${n}`, '2026-09-28')) },
  overloaded: { overdue: 9, dueToday: 0, planItems: [1, 2, 3, 4, 5].map(n => item(`o${n}`, `Pendiente atrasado número ${n}`, '2026-09-20')) },
  prep_only: {
    overdue: 0, dueToday: 0, planItems: [], meetings: 0, newActionItems: 0,
    meetingPrep: [{ time: '9:30 AM', title: 'Weekly Ops', people: ['Bruno Díaz'], items: [{ item_id: 'm1', text: 'Actualizar el calendario', due_date: null, owner: 'Bruno Díaz' }], more: 0 }]
  }
};

function summaryFor(situation) {
  return {
    dayLabel: 'Monday, October 5', today, since: 'Friday', meetings: 2, outcomes: { decision: 2, open_question: 1 },
    newActionItems: 1, toReview: 1, noDueDate: 0, assignedBy: [], meetingPrep: [], ...SUMMARIES[situation]
  };
}

const rows = [];
const write = (name, html) => fs.writeFileSync(path.join(out, name), html);
for (const situation of voice.SITUATIONS) {
  const summary = summaryFor(situation);
  const file = `classic-${situation}.html`;
  write(file, dailyDigestHtml({ workspace_name: 'Acme', summary, unsubscribe_url: '#' }));
  rows.push({ voice: 'classic', language: 'en', situation, file, subject: dailyDigestSubject(summary), followUp: '' });
  for (const name of voice.PARTNER_VOICES) {
    for (const language of voice.LANGUAGES) {
      const lines = voice.LIBRARY[name][language][situation];
      lines.forEach((unused, index) => {
        const partner = {
          voice: name,
          ...voice.pickLine({
            voice: name, situation, language, random: () => index / lines.length,
            vars: { count: situation === 'due_today' ? summary.dueToday : summary.overdue, weekday: language === 'es' ? 'lunes' : 'Monday', item: (summary.planItems[0] || {}).text || null }
          })
        };
        const fileName = `${name}-${language}-${situation}-${index}.html`;
        if (index === 0) write(fileName, dailyDigestHtml({ workspace_name: 'Acme', summary, unsubscribe_url: '#', partner }));
        rows.push({ voice: name, language, situation, file: index === 0 ? fileName : null, subject: partner.subject, followUp: partner.followUp });
      });
    }
  }
}

write('index.html', `<!doctype html><meta charset="utf-8"><title>Morning partner lines</title>
<style>body{font:14px/1.4 -apple-system,sans-serif;margin:24px}td,th{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f4f4f6}</style>
<h1>Morning partner: ${rows.length} lines</h1>
<table><tr><th>Voice</th><th>Lang</th><th>Situation</th><th>Subject / opener</th><th>Follow-up</th><th>Email</th></tr>
${rows.map(row => `<tr><td>${row.voice}</td><td>${row.language}</td><td>${row.situation}</td><td>${escapeHtml(row.subject)}</td><td>${escapeHtml(row.followUp)}</td><td>${row.file ? `<a href="${row.file}">open</a>` : ''}</td></tr>`).join('')}
</table>`);
console.log(`${rows.length} lines; emails and index.html in ${out}`);
