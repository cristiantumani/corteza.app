require('dotenv').config();
const { App } = require('@slack/bolt');
const { MongoClient } = require('mongodb');

let db, decisionsCollection;

async function connectToMongoDB() {
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    console.log('✅ Connected to MongoDB!');
    db = client.db('decision-logger');
    decisionsCollection = db.collection('decisions');
    await decisionsCollection.createIndex({ text: 'text', tags: 'text' });
    await decisionsCollection.createIndex({ timestamp: -1 });
    console.log('✅ Database ready!');
  } catch (error) {
    console.error('❌ MongoDB error:', error);
    process.exit(1);
  }
}

async function fetchJiraIssue(issueKey) {
  if (!process.env.JIRA_URL || !process.env.JIRA_EMAIL || !process.env.JIRA_API_TOKEN) {
    console.log('⚠️ Jira not configured');
    return null;
  }
  try {
    const auth = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
    const url = `${process.env.JIRA_URL}/rest/api/3/issue/${issueKey}`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
    });
    if (!response.ok) {
      console.log(`❌ Jira fetch failed: ${response.status}`);
      return null;
    }
    const data = await response.json();
    return {
      key: data.key,
      summary: data.fields.summary,
      type: data.fields.issuetype.name,
      status: data.fields.status.name,
      url: `${process.env.JIRA_URL}/browse/${data.key}`
    };
  } catch (error) {
    console.error(`❌ Jira error:`, error.message);
    return null;
  }
}

async function addJiraComment(issueKey, comment) {
  if (!process.env.JIRA_URL || !process.env.JIRA_EMAIL || !process.env.JIRA_API_TOKEN) return false;
  try {
    const auth = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
    const url = `${process.env.JIRA_URL}/rest/api/3/issue/${issueKey}/comment`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: comment }] }] }
      })
    });
    if (response.ok) {
      console.log(`✅ Jira comment added to ${issueKey}`);
      return true;
    }
    console.log(`❌ Jira comment failed: ${response.status}`);
    return false;
  } catch (error) {
    console.error(`❌ Jira comment error:`, error.message);
    return false;
  }
}

function parseQueryParams(url) {
  const params = {};
  const urlParts = url.split('?');
  if (urlParts.length > 1) {
    urlParts[1].split('&').forEach(pair => {
      const [key, value] = pair.split('=');
      params[decodeURIComponent(key)] = decodeURIComponent(value || '');
    });
  }
  return params;
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false,
  customRoutes: [
    { path: '/', method: ['GET'], handler: (req, res) => { res.writeHead(302, { Location: '/dashboard' }); res.end(); } },
    { path: '/health', method: ['GET'], handler: (req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: 'ok', mongodb: db ? 'connected' : 'disconnected', jira: process.env.JIRA_URL ? 'configured' : 'not configured' })); } },
    { path: '/api/decisions', method: ['GET'], handler: async (req, res) => { try { const query = parseQueryParams(req.url); const page = parseInt(query.page || '1'); const limit = parseInt(query.limit || '50'); const skip = (page - 1) * limit; const filter = {}; if (query.type) filter.type = query.type; if (query.epic) filter.epic_key = { $regex: query.epic, $options: 'i' }; if (query.search) filter.$or = [{ text: { $regex: query.search, $options: 'i' } }, { tags: { $regex: query.search, $options: 'i' } }]; const [decisions, total] = await Promise.all([decisionsCollection.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit).toArray(), decisionsCollection.countDocuments(filter)]); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ decisions, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })); } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: 'Error' })); } } },
    { path: '/api/stats', method: ['GET'], handler: async (req, res) => { try { const [total, byType, recentCount] = await Promise.all([decisionsCollection.countDocuments(), decisionsCollection.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }]).toArray(), decisionsCollection.countDocuments({ timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() } })]); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ total, byType: byType.reduce((acc, item) => { acc[item._id] = item.count; return acc; }, {}), lastWeek: recentCount })); } catch (error) { res.writeHead(500); res.end('{}'); } } },
    { path: '/dashboard', method: ['GET'], handler: (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Decision Logger</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#f5f5f5;color:#1d1c1d}header{background:#fff;border-bottom:1px solid #e0e0e0;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.container{max-width:1400px;margin:0 auto;padding:20px}h1{font-size:28px;font-weight:700}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;margin:20px 0}.stat-card{background:#fff;padding:20px;border-radius:8px}.stat-card h3{font-size:14px;color:#616061;margin-bottom:8px;text-transform:uppercase}.stat-card .number{font-size:32px;font-weight:700}.filters{background:#fff;padding:20px;border-radius:8px;margin-bottom:20px;display:flex;gap:15px;flex-wrap:wrap}.filter-group{flex:1;min-width:200px}.filter-group label{display:block;font-size:14px;font-weight:600;margin-bottom:5px}.filter-group input,.filter-group select{width:100%;padding:10px;border:1px solid #e0e0e0;border-radius:4px;font-size:14px}.decisions-table{background:#fff;border-radius:8px;overflow:hidden}table{width:100%;border-collapse:collapse}thead{background:#f8f8f8}th{text-align:left;padding:15px;font-weight:600;font-size:14px;border-bottom:2px solid #e0e0e0}td{padding:15px;border-bottom:1px solid #f0f0f0;font-size:14px}tbody tr:hover{background:#f8f8f8}.badge{display:inline-block;padding:4px 8px;border-radius:4px;font-size:12px;font-weight:600}.badge-product{background:#e8f5e9;color:#2e7d32}.badge-ux{background:#e3f2fd;color:#1565c0}.badge-technical{background:#fff3e0;color:#e65100}.tag{background:#f0f0f0;padding:2px 8px;border-radius:3px;font-size:12px;margin:2px}.jira-link{color:#0052cc;text-decoration:none;font-weight:500}.jira-link:hover{text-decoration:underline}.jira-title{color:#616061;font-size:12px}.loading{text-align:center;padding:40px}.export-btn{background:#611f69;color:#fff;border:none;padding:10px 20px;border-radius:4px;font-size:14px;cursor:pointer;margin-top:10px}.export-btn:hover{background:#4a154b}</style></head><body><header><div class="container"><h1>📝 Decision Logger</h1></div></header><div class="container"><div class="stats"><div class="stat-card"><h3>Total</h3><div class="number" id="total-count">-</div></div><div class="stat-card"><h3>Product</h3><div class="number" id="product-count">-</div></div><div class="stat-card"><h3>UX</h3><div class="number" id="ux-count">-</div></div><div class="stat-card"><h3>Technical</h3><div class="number" id="technical-count">-</div></div><div class="stat-card"><h3>This Week</h3><div class="number" id="week-count">-</div></div></div><div class="filters"><div class="filter-group"><label>Search</label><input type="text" id="search" placeholder="Search..."></div><div class="filter-group"><label>Type</label><select id="type-filter"><option value="">All</option><option value="product">Product</option><option value="ux">UX</option><option value="technical">Technical</option></select></div><div class="filter-group"><label>Epic</label><input type="text" id="epic-filter" placeholder="LOK-123"></div></div><button class="export-btn" onclick="exportToCSV()">📥 Export CSV</button><div class="decisions-table"><table><thead><tr><th>#</th><th>Decision</th><th>Type</th><th>Epic</th><th>Tags</th><th>Creator</th><th>Date</th></tr></thead><tbody id="decisions-body"><tr><td colspan="7" class="loading">Loading...</td></tr></tbody></table></div></div><script>let allDecisions=[];async function fetchStats(){try{const r=await fetch('/api/stats');const d=await r.json();document.getElementById('total-count').textContent=d.total;document.getElementById('product-count').textContent=d.byType.product||0;document.getElementById('ux-count').textContent=d.byType.ux||0;document.getElementById('technical-count').textContent=d.byType.technical||0;document.getElementById('week-count').textContent=d.lastWeek}catch(e){}}async function fetchDecisions(){try{const s=document.getElementById('search').value;const t=document.getElementById('type-filter').value;const e=document.getElementById('epic-filter').value;const p=new URLSearchParams();if(s)p.append('search',s);if(t)p.append('type',t);if(e)p.append('epic',e);p.append('limit','100');const r=await fetch(\`/api/decisions?\${p}\`);const d=await r.json();allDecisions=d.decisions;renderDecisions(d.decisions)}catch(err){document.getElementById('decisions-body').innerHTML='<tr><td colspan="7">Error</td></tr>'}}function renderDecisions(decisions){const tbody=document.getElementById('decisions-body');if(decisions.length===0){tbody.innerHTML='<tr><td colspan="7">No decisions</td></tr>';return}tbody.innerHTML=decisions.map(d=>{let epicCell='-';if(d.epic_key){if(d.jira_data&&d.jira_data.url){epicCell=\`<a href="\${d.jira_data.url}" target="_blank" class="jira-link">\${d.epic_key}</a><div class="jira-title">\${d.jira_data.summary||''}</div>\`}else{epicCell=d.epic_key}}return\`<tr><td><strong>#\${d.id}</strong></td><td>\${d.text}</td><td><span class="badge badge-\${d.type}">\${d.type}</span></td><td>\${epicCell}</td><td>\${d.tags.map(t=>\`<span class="tag">\${t}</span>\`).join('')}</td><td>\${d.creator}</td><td>\${new Date(d.timestamp).toLocaleDateString()}</td></tr>\`}).join('')}function exportToCSV(){const csv=[['ID','Decision','Type','Epic','Summary','Tags','Creator','Date'],...allDecisions.map(d=>[d.id,d.text,d.type,d.epic_key||'',(d.jira_data&&d.jira_data.summary)||'',d.tags.join(','),d.creator,new Date(d.timestamp).toLocaleDateString()])].map(row=>row.map(cell=>\`"\${cell}"\`).join(',')).join('\\n');const blob=new Blob([csv],{type:'text/csv'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=\`decisions.csv\`;a.click()}document.getElementById('search').addEventListener('input',debounce(fetchDecisions,500));document.getElementById('type-filter').addEventListener('change',fetchDecisions);document.getElementById('epic-filter').addEventListener('input',debounce(fetchDecisions,500));function debounce(func,wait){let timeout;return function(...args){clearTimeout(timeout);timeout=setTimeout(()=>func.apply(this,args),wait)}}fetchStats();fetchDecisions();setInterval(()=>{fetchStats();fetchDecisions()},30000)</script></body></html>`); } },
  ],
});

app.command('/decision', async ({ command, ack, client, say }) => {
  await ack();
  const decisionText = command.text.trim();
  if (!decisionText) { await say('❌ Provide text'); return; }
  try {
    await client.views.open({
      trigger_id: command.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'decision_modal',
        private_metadata: JSON.stringify({ channel_id: command.channel_id, user_id: command.user_id, decision_text: decisionText }),
        title: { type: 'plain_text', text: '📝 Log Decision' },
        submit: { type: 'plain_text', text: 'Save' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: `*Decision:*\n${decisionText}` } },
          { type: 'divider' },
          { type: 'input', block_id: 'type_block', element: { type: 'static_select', action_id: 'type_select', options: [{ text: { type: 'plain_text', text: '📦 Product' }, value: 'product' }, { text: { type: 'plain_text', text: '🎨 UX' }, value: 'ux' }, { text: { type: 'plain_text', text: '⚙️ Technical' }, value: 'technical' }] }, label: { type: 'plain_text', text: 'Decision Type' } },
          { type: 'input', block_id: 'epic_block', optional: true, element: { type: 'plain_text_input', action_id: 'epic_input', placeholder: { type: 'plain_text', text: 'LOK-123' } }, label: { type: 'plain_text', text: 'Epic/Story Key (optional)' }, hint: { type: 'plain_text', text: 'Auto-fetches from Jira' } },
          { type: 'input', block_id: 'tags_block', optional: true, element: { type: 'plain_text_input', action_id: 'tags_input', placeholder: { type: 'plain_text', text: 'aem, integration' } }, label: { type: 'plain_text', text: 'Tags (comma-separated, optional)' } },
          { type: 'input', block_id: 'alternatives_block', optional: true, element: { type: 'plain_text_input', action_id: 'alternatives_input', multiline: true }, label: { type: 'plain_text', text: 'Alternatives Considered (optional)' } },
          { type: 'input', block_id: 'jira_comment_block', optional: true, element: { type: 'checkboxes', action_id: 'jira_comment_checkbox', options: [{ text: { type: 'plain_text', text: 'Add this decision as a comment in Jira' }, value: 'yes' }] }, label: { type: 'plain_text', text: 'Jira Integration' } }
        ]
      }
    });
  } catch (error) { console.error('Modal error:', error); }
});

app.view('decision_modal', async ({ ack, view, client }) => {
  try {
    await ack();
    const metadata = JSON.parse(view.private_metadata);
    const values = view.state.values;
    const decisionType = values.type_block.type_select.selected_option.value;
    const epicKey = values.epic_block.epic_input.value || null;
    const tags = (values.tags_block.tags_input.value || '').split(',').map(t => t.trim()).filter(t => t);
    const alternatives = values.alternatives_block.alternatives_input.value || null;
    const addComment = (values.jira_comment_block.jira_comment_checkbox.selected_options || []).length > 0;
    
    console.log('=== Decision Modal ===');
    console.log('Epic:', epicKey);
    console.log('Add Jira Comment:', addComment);
    
    const userInfo = await client.users.info({ user: metadata.user_id });
    const userName = userInfo.user.real_name || userInfo.user.name;
    const lastDecision = await decisionsCollection.findOne({}, { sort: { id: -1 } });
    const nextId = lastDecision ? lastDecision.id + 1 : 1;
    
    let jiraData = null;
    if (epicKey) {
      console.log(`Fetching Jira: ${epicKey}`);
      jiraData = await fetchJiraIssue(epicKey);
      if (jiraData) console.log(`✅ Jira: ${jiraData.summary}`);
    }
    
    const decision = { id: nextId, text: metadata.decision_text, type: decisionType, epic_key: epicKey, jira_data: jiraData, tags, alternatives, creator: userName, user_id: metadata.user_id, channel_id: metadata.channel_id, timestamp: new Date().toISOString() };
    await decisionsCollection.insertOne(decision);
    console.log(`✅ Saved decision #${decision.id}`);
    
    if (addComment && epicKey && jiraData) {
      console.log('>>> Adding Jira comment...');
      const comment = `📝 Decision #${decision.id} logged by ${userName}\n\nType: ${decisionType}\nDecision: ${decision.text}\n\n${alternatives ? `Alternatives: ${alternatives}\n\n` : ''}Logged via Decision Logger`;
      if (await addJiraComment(epicKey, comment)) {
        console.log(`✅ Jira comment added to ${epicKey}`);
      }
    }
    
    const typeEmoji = { product: '📦', ux: '🎨', technical: '⚙️' };
    const blocks = [
      { type: 'section', text: { type: 'mrkdwn', text: `✅ *Decision #${decision.id}* logged by ${userName}` } },
      { type: 'section', fields: [{ type: 'mrkdwn', text: `*Type:*\n${typeEmoji[decisionType]} ${decisionType}` }, { type: 'mrkdwn', text: `*Date:*\n${new Date().toLocaleDateString()}` }] },
      { type: 'section', text: { type: 'mrkdwn', text: `*Decision:*\n${decision.text}` } }
    ];
    if (epicKey && jiraData) {
      blocks.push({ type: 'section', fields: [{ type: 'mrkdwn', text: `*Epic:*\n<${jiraData.url}|${jiraData.key}: ${jiraData.summary}>\n_${jiraData.type} • ${jiraData.status}_` }] });
    } else if (epicKey) {
      blocks.push({ type: 'section', fields: [{ type: 'mrkdwn', text: `*Epic:*\n${epicKey}` }] });
    }
    if (tags.length > 0) blocks.push({ type: 'section', fields: [{ type: 'mrkdwn', text: `*Tags:*\n${tags.map(t => `\`${t}\``).join(', ')}` }] });
    if (alternatives) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Additional Comments:*\n${alternatives}` } });
    await client.chat.postMessage({ channel: metadata.channel_id, blocks, text: `Decision #${decision.id} logged` });
  } catch (error) { console.error('❌ Error:', error); }
});

app.command('/decisions', async ({ command, ack, say }) => {
  await ack();
  const args = command.text.trim().split(' ');
  const cmd = args[0];
  if (cmd === 'search') {
    const keyword = args.slice(1).join(' ');
    if (!keyword) { await say('❌ Provide keyword'); return; }
    const results = await decisionsCollection.find({ $or: [{ text: { $regex: keyword, $options: 'i' } }, { tags: { $regex: keyword, $options: 'i' } }] }).sort({ timestamp: -1 }).limit(10).toArray();
    if (results.length === 0) { await say(`🔍 No results`); return; }
    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: `🔍 *Found ${results.length}*` } }, { type: 'divider' }];
    results.forEach(d => blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*#${d.id}* ${d.text}\n_${d.type} • ${d.creator}_` } }));
    await say({ blocks });
  } else if (cmd === 'recent') {
    const recent = await decisionsCollection.find({}).sort({ timestamp: -1 }).limit(10).toArray();
    if (recent.length === 0) { await say('📭 No decisions'); return; }
    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: `📋 *Recent*` } }, { type: 'divider' }];
    recent.forEach(d => blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*#${d.id}* ${d.text}\n_${d.type} • ${d.creator}_` } }));
    await say({ blocks });
  } else if (cmd === 'epic' && args[1]) {
    const epic = args[1];
    const results = await decisionsCollection.find({ epic_key: { $regex: epic, $options: 'i' } }).sort({ timestamp: -1 }).toArray();
    if (results.length === 0) { await say(`🔍 No decisions for ${epic}`); return; }
    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: `🎯 *${results.length} for ${epic}*` } }, { type: 'divider' }];
    results.forEach(d => blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*#${d.id}* ${d.text}\n_${d.type} • ${d.creator}_` } }));
    await say({ blocks });
  } else {
    await say('Try: `/decisions search [keyword]` | `/decisions recent` | `/decisions epic [KEY]`');
  }
});

(async () => {
  await connectToMongoDB();
  await app.start(process.env.PORT || 3000);
  console.log(`⚡️ Bot running on port ${process.env.PORT || 3000}!`);
})();