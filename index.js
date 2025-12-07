require('dotenv').config();
const { App } = require('@slack/bolt');
const { MongoClient } = require('mongodb');

// MongoDB setup
let db;
let decisionsCollection;

async function connectToMongoDB() {
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    console.log('✅ Connected to MongoDB!');
    
    db = client.db('decision-logger');
    decisionsCollection = db.collection('decisions');
    
    await decisionsCollection.createIndex({ text: 'text', tags: 'text' });
    await decisionsCollection.createIndex({ timestamp: -1 });
    
    console.log('✅ Database and collections ready!');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

function parseQueryParams(url) {
  const params = {};
  const urlParts = url.split('?');
  if (urlParts.length > 1) {
    const queryString = urlParts[1];
    queryString.split('&').forEach(pair => {
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
    {
      path: '/',
      method: ['GET'],
      handler: (req, res) => {
        res.writeHead(302, { Location: '/dashboard' });
        res.end();
      },
    },
    {
      path: '/health',
      method: ['GET'],
      handler: (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', mongodb: db ? 'connected' : 'disconnected' }));
      },
    },
    {
      path: '/api/decisions',
      method: ['GET'],
      handler: async (req, res) => {
        try {
          const query = parseQueryParams(req.url);
          const page = parseInt(query.page || '1');
          const limit = parseInt(query.limit || '50');
          const skip = (page - 1) * limit;

          const filter = {};
          if (query.type) filter.type = query.type;
          if (query.epic) filter.epic_key = { $regex: query.epic, $options: 'i' };
          if (query.search) {
            filter.$or = [
              { text: { $regex: query.search, $options: 'i' } },
              { tags: { $regex: query.search, $options: 'i' } }
            ];
          }

          const [decisions, total] = await Promise.all([
            decisionsCollection.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit).toArray(),
            decisionsCollection.countDocuments(filter)
          ]);

          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ decisions, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }));
        } catch (error) {
          console.error('Error fetching decisions:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      },
    },
    {
      path: '/api/stats',
      method: ['GET'],
      handler: async (req, res) => {
        try {
          const [total, byType, recentCount] = await Promise.all([
            decisionsCollection.countDocuments(),
            decisionsCollection.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }]).toArray(),
            decisionsCollection.countDocuments({ timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() } })
          ]);

          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({
            total,
            byType: byType.reduce((acc, item) => { acc[item._id] = item.count; return acc; }, {}),
            lastWeek: recentCount
          }));
        } catch (error) {
          console.error('Error fetching stats:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      },
    },
    {
      path: '/dashboard',
      method: ['GET'],
      handler: (req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Decision Logger Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif; background: #f5f5f5; color: #1d1c1d; }
        header { background: white; border-bottom: 1px solid #e0e0e0; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
        h1 { font-size: 28px; font-weight: 700; color: #1d1c1d; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
        .stat-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .stat-card h3 { font-size: 14px; color: #616061; margin-bottom: 8px; text-transform: uppercase; font-weight: 600; }
        .stat-card .number { font-size: 32px; font-weight: 700; color: #1d1c1d; }
        .filters { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 20px; display: flex; gap: 15px; flex-wrap: wrap; }
        .filter-group { flex: 1; min-width: 200px; }
        .filter-group label { display: block; font-size: 14px; font-weight: 600; margin-bottom: 5px; color: #1d1c1d; }
        .filter-group input, .filter-group select { width: 100%; padding: 10px; border: 1px solid #e0e0e0; border-radius: 4px; font-size: 14px; }
        .decisions-table { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden; }
        table { width: 100%; border-collapse: collapse; }
        thead { background: #f8f8f8; }
        th { text-align: left; padding: 15px; font-weight: 600; font-size: 14px; color: #1d1c1d; border-bottom: 2px solid #e0e0e0; }
        td { padding: 15px; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
        tbody tr:hover { background: #f8f8f8; }
        .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
        .badge-product { background: #e8f5e9; color: #2e7d32; }
        .badge-ux { background: #e3f2fd; color: #1565c0; }
        .badge-technical { background: #fff3e0; color: #e65100; }
        .tag { display: inline-block; background: #f0f0f0; padding: 2px 8px; border-radius: 3px; font-size: 12px; margin: 2px; }
        .loading { text-align: center; padding: 40px; font-size: 16px; color: #616061; }
        .export-btn { background: #611f69; color: white; border: none; padding: 10px 20px; border-radius: 4px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 10px; }
        .export-btn:hover { background: #4a154b; }
    </style>
</head>
<body>
    <header>
        <div class="container"><h1>📝 Decision Logger Dashboard</h1></div>
    </header>
    <div class="container">
        <div class="stats">
            <div class="stat-card"><h3>Total Decisions</h3><div class="number" id="total-count">-</div></div>
            <div class="stat-card"><h3>Product Decisions</h3><div class="number" id="product-count">-</div></div>
            <div class="stat-card"><h3>UX Decisions</h3><div class="number" id="ux-count">-</div></div>
            <div class="stat-card"><h3>Technical Decisions</h3><div class="number" id="technical-count">-</div></div>
            <div class="stat-card"><h3>This Week</h3><div class="number" id="week-count">-</div></div>
        </div>
        <div class="filters">
            <div class="filter-group"><label for="search">Search</label><input type="text" id="search" placeholder="Search decisions..."></div>
            <div class="filter-group"><label for="type-filter">Type</label><select id="type-filter"><option value="">All Types</option><option value="product">Product</option><option value="ux">UX</option><option value="technical">Technical</option></select></div>
            <div class="filter-group"><label for="epic-filter">Epic</label><input type="text" id="epic-filter" placeholder="e.g., LOK-123"></div>
        </div>
        <button class="export-btn" onclick="exportToCSV()">📥 Export to CSV</button>
        <div class="decisions-table">
            <table>
                <thead><tr><th>#</th><th>Decision</th><th>Type</th><th>Epic</th><th>Tags</th><th>Creator</th><th>Date</th></tr></thead>
                <tbody id="decisions-body"><tr><td colspan="7" class="loading">Loading decisions...</td></tr></tbody>
            </table>
        </div>
    </div>
    <script>
        let allDecisions = [];
        async function fetchStats() {
            try {
                const response = await fetch('/api/stats');
                const data = await response.json();
                document.getElementById('total-count').textContent = data.total;
                document.getElementById('product-count').textContent = data.byType.product || 0;
                document.getElementById('ux-count').textContent = data.byType.ux || 0;
                document.getElementById('technical-count').textContent = data.byType.technical || 0;
                document.getElementById('week-count').textContent = data.lastWeek;
            } catch (error) { console.error('Error fetching stats:', error); }
        }
        async function fetchDecisions() {
            try {
                const search = document.getElementById('search').value;
                const type = document.getElementById('type-filter').value;
                const epic = document.getElementById('epic-filter').value;
                const params = new URLSearchParams();
                if (search) params.append('search', search);
                if (type) params.append('type', type);
                if (epic) params.append('epic', epic);
                params.append('limit', '100');
                const response = await fetch(\`/api/decisions?\${params}\`);
                const data = await response.json();
                allDecisions = data.decisions;
                renderDecisions(data.decisions);
            } catch (error) {
                console.error('Error fetching decisions:', error);
                document.getElementById('decisions-body').innerHTML = '<tr><td colspan="7" class="loading">Error loading decisions</td></tr>';
            }
        }
        function renderDecisions(decisions) {
            const tbody = document.getElementById('decisions-body');
            if (decisions.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="loading">No decisions found</td></tr>';
                return;
            }
            tbody.innerHTML = decisions.map(d => \`<tr><td><strong>#\${d.id}</strong></td><td>\${d.text}</td><td><span class="badge badge-\${d.type}">\${d.type}</span></td><td>\${d.epic_key || '-'}</td><td>\${d.tags.map(t => \`<span class="tag">\${t}</span>\`).join('')}</td><td>\${d.creator}</td><td>\${new Date(d.timestamp).toLocaleDateString()}</td></tr>\`).join('');
        }
        function exportToCSV() {
            const csv = [['ID', 'Decision', 'Type', 'Epic', 'Tags', 'Creator', 'Date', 'Alternatives'], ...allDecisions.map(d => [d.id, d.text.replace(/"/g, '""'), d.type, d.epic_key || '', d.tags.join(', '), d.creator, new Date(d.timestamp).toLocaleDateString(), (d.alternatives || '').replace(/"/g, '""')])].map(row => row.map(cell => \`"\${cell}"\`).join(',')).join('\\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = \`decisions-\${new Date().toISOString().split('T')[0]}.csv\`;
            a.click();
        }
        document.getElementById('search').addEventListener('input', debounce(fetchDecisions, 500));
        document.getElementById('type-filter').addEventListener('change', fetchDecisions);
        document.getElementById('epic-filter').addEventListener('input', debounce(fetchDecisions, 500));
        function debounce(func, wait) { let timeout; return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), wait); }; }
        fetchStats();
        fetchDecisions();
        setInterval(() => { fetchStats(); fetchDecisions(); }, 30000);
    </script>
</body>
</html>`);
      },
    },
  ],
});

app.command('/decision', async ({ command, ack, client, say }) => {
  await ack();
  const decisionText = command.text.trim();
  if (!decisionText) {
    await say({ text: '❌ Please provide a decision text.', thread_ts: command.thread_ts });
    return;
  }
  try {
    await client.views.open({
      trigger_id: command.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'decision_modal',
        private_metadata: JSON.stringify({ channel_id: command.channel_id, user_id: command.user_id, decision_text: decisionText }),
        title: { type: 'plain_text', text: '📝 Log Decision' },
        submit: { type: 'plain_text', text: 'Save Decision' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: `*Decision:*\n${decisionText}` } },
          { type: 'divider' },
          { type: 'input', block_id: 'type_block', element: { type: 'static_select', action_id: 'type_select', placeholder: { type: 'plain_text', text: 'Select decision type' }, options: [{ text: { type: 'plain_text', text: '📦 Product' }, value: 'product' }, { text: { type: 'plain_text', text: '🎨 UX' }, value: 'ux' }, { text: { type: 'plain_text', text: '⚙️ Technical' }, value: 'technical' }] }, label: { type: 'plain_text', text: 'Decision Type' } },
          { type: 'input', block_id: 'epic_block', optional: true, element: { type: 'plain_text_input', action_id: 'epic_input', placeholder: { type: 'plain_text', text: 'e.g., JIRA-123, LOK-456' } }, label: { type: 'plain_text', text: 'Epic/Story Key (optional)' } },
          { type: 'input', block_id: 'tags_block', optional: true, element: { type: 'plain_text_input', action_id: 'tags_input', placeholder: { type: 'plain_text', text: 'e.g., aem, integration, scope' } }, label: { type: 'plain_text', text: 'Tags (comma-separated, optional)' } },
          { type: 'input', block_id: 'alternatives_block', optional: true, element: { type: 'plain_text_input', action_id: 'alternatives_input', multiline: true, placeholder: { type: 'plain_text', text: 'What alternatives were considered?' } }, label: { type: 'plain_text', text: 'Alternatives Considered (optional)' } }
        ]
      }
    });
  } catch (error) {
    console.error('Error opening modal:', error);
    await say({ text: '❌ Error opening decision form.', thread_ts: command.thread_ts });
  }
});

app.view('decision_modal', async ({ ack, view, client }) => {
  try {
    await ack();
    const metadata = JSON.parse(view.private_metadata);
    const values = view.state.values;
    const decisionType = values.type_block.type_select.selected_option.value;
    const epicKey = values.epic_block.epic_input.value || null;
    const tagsInput = values.tags_block.tags_input.value || '';
    const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t);
    const alternatives = values.alternatives_block.alternatives_input.value || null;
    const userInfo = await client.users.info({ user: metadata.user_id });
    const userName = userInfo.user.real_name || userInfo.user.name;
    const lastDecision = await decisionsCollection.findOne({}, { sort: { id: -1 } });
    const nextId = lastDecision ? lastDecision.id + 1 : 1;
    const decision = { id: nextId, text: metadata.decision_text, type: decisionType, epic_key: epicKey, tags: tags, alternatives: alternatives, creator: userName, user_id: metadata.user_id, channel_id: metadata.channel_id, timestamp: new Date().toISOString() };
    await decisionsCollection.insertOne(decision);
    console.log('✅ Decision saved:', decision);
    const typeEmoji = { product: '📦', ux: '🎨', technical: '⚙️' };
    const blocks = [
      { type: 'section', text: { type: 'mrkdwn', text: `✅ *Decision #${decision.id} logged by ${userName}*` } },
      { type: 'section', fields: [{ type: 'mrkdwn', text: `*Type:*\n${typeEmoji[decisionType]} ${decisionType}` }, { type: 'mrkdwn', text: `*Date:*\n${new Date().toLocaleDateString()}` }] },
      { type: 'section', text: { type: 'mrkdwn', text: `*Decision:*\n${decision.text}` } }
    ];
    if (epicKey) blocks.push({ type: 'section', fields: [{ type: 'mrkdwn', text: `*Epic:*\n${epicKey}` }] });
    if (tags.length > 0) blocks.push({ type: 'section', fields: [{ type: 'mrkdwn', text: `*Tags:*\n${tags.map(t => `\`${t}\``).join(', ')}` }] });
    if (alternatives) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Alternatives:*\n${alternatives}` } });
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `View dashboard: <https://${process.env.RAILWAY_STATIC_URL || 'decision-logger-bot-production.up.railway.app'}/dashboard|Open>` }] });
    await client.chat.postMessage({ channel: metadata.channel_id, blocks: blocks, text: `Decision #${decision.id} logged` });
  } catch (error) {
    console.error('❌ ERROR:', error);
  }
});

app.command('/decisions', async ({ command, ack, say }) => {
  await ack();
  const args = command.text.trim().split(' ');
  const subcommand = args[0];
  if (subcommand === 'search') {
    const keyword = args.slice(1).join(' ').toLowerCase();
    if (!keyword) { await say('❌ Provide a keyword. Example: `/decisions search AEM`'); return; }
    const results = await decisionsCollection.find({ $or: [{ text: { $regex: keyword, $options: 'i' } }, { tags: { $regex: keyword, $options: 'i' } }, { epic_key: { $regex: keyword, $options: 'i' } }] }).sort({ timestamp: -1 }).limit(10).toArray();
    if (results.length === 0) { await say(`🔍 No decisions found matching "${keyword}"`); return; }
    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: `🔍 *Found ${results.length} decision(s)*` } }, { type: 'divider' }];
    results.slice(0, 5).forEach(d => blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*#${d.id}* (${d.type})\n${d.text}\n_by ${d.creator} on ${new Date(d.timestamp).toLocaleDateString()}_` } }));
    if (results.length > 5) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `_Showing 5 of ${results.length} results._` }] });
    await say({ blocks });
  } else if (subcommand === 'recent') {
    const recentDecisions = await decisionsCollection.find({}).sort({ timestamp: -1 }).limit(10).toArray();
    if (recentDecisions.length === 0) { await say('📭 No decisions yet.'); return; }
    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: `📋 *Recent Decisions*` } }, { type: 'divider' }];
    recentDecisions.forEach(d => blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*#${d.id}* ${d.text}\n_${d.type} • ${d.creator} • ${new Date(d.timestamp).toLocaleDateString()}_` } }));
    await say({ blocks });
  } else if (subcommand === 'epic' && args[1]) {
    const epicKey = args[1].toUpperCase();
    const results = await decisionsCollection.find({ epic_key: { $regex: epicKey, $options: 'i' } }).sort({ timestamp: -1 }).toArray();
    if (results.length === 0) { await say(`🔍 No decisions for epic "${epicKey}"`); return; }
    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: `🎯 *${results.length} decision(s) for ${epicKey}*` } }, { type: 'divider' }];
    results.forEach(d => blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*#${d.id}* ${d.text}\n_${d.type} • ${d.creator} • ${new Date(d.timestamp).toLocaleDateString()}_` } }));
    await say({ blocks });
  } else {
    await say('❌ Try: `/decisions search [keyword]` | `/decisions recent` | `/decisions epic [KEY]`');
  }
});

(async () => {
  await connectToMongoDB();
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log(`⚡️ Decision Logger bot running on port ${port}!`);
})();