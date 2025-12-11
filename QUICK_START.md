# Quick Start Guide

## ✅ Refactoring Complete!

Your Decision Logger Bot has been completely refactored with professional code quality.

## 🚀 How to Start the Bot

```bash
cd /Users/cristian.tumani/Documents/decision-logger-bot
npm start
```

That's it! The bot will:
1. Validate your environment variables
2. Connect to MongoDB
3. Start the Slack bot
4. Show you the URLs for dashboard and health check

## 📊 View the Dashboard

Once running, open your browser to:
```
http://localhost:3000/dashboard
```

## 🔍 Check Health

```
http://localhost:3000/health
```

## 🧪 Test Before Starting

Want to verify everything is OK without starting the bot?

```bash
node test-modules.js
```

This checks all modules load correctly.

## 📁 Where Is Everything?

| What you need | Where to find it |
|---------------|------------------|
| Main entry point | `src/index.js` |
| Environment config | `src/config/environment.js` |
| Database setup | `src/config/database.js` |
| Jira integration | `src/services/jira.js` |
| Input validation | `src/middleware/validation.js` |
| API routes | `src/routes/api.js` |
| Slack commands | `src/routes/slack.js` |
| Dashboard HTML | `src/views/dashboard.html` |

## 🔧 Common Tasks

### Add a new Slack command
Edit: `src/routes/slack.js`

### Add a new API endpoint
Edit: `src/routes/api.js` and `src/index.js`

### Modify Jira integration
Edit: `src/services/jira.js`

### Update dashboard design
Edit: `src/views/dashboard.html`

### Add validation rules
Edit: `src/middleware/validation.js`

### Change environment settings
Edit: `src/config/environment.js`

## 🆘 Something Wrong?

### Revert to old version
```bash
mv index.js.old index.js
npm start
```

### Check the logs
The refactored code has better error messages. Read what it says!

### Module won't load?
```bash
node test-modules.js
```

## 📚 Read More

- `REFACTORING_SUMMARY.md` - Full details of what was changed
- `BEFORE_AND_AFTER.md` - Side-by-side comparisons
- Your old code is in `index.js.old` (backed up safely)

## 💡 Tips

1. **Each module is independent** - You can modify one without breaking others
2. **Read the JSDoc comments** - They explain what each function does
3. **Validation is automatic** - All inputs are validated before use
4. **Errors are clear** - Messages tell you exactly what went wrong

## ✨ What's Better?

- ✅ Input validation (prevents attacks)
- ✅ Environment validation (catches config errors early)
- ✅ Clean code organization (easy to find things)
- ✅ Proper error handling (better error messages)
- ✅ Code comments (explains what things do)
- ✅ Separated concerns (HTML not in JavaScript)
- ✅ No code duplication (DRY principle)
- ✅ Professional structure (industry standard)

## 🎯 Everything Still Works!

All features work exactly as before:
- ✅ `/decision` command
- ✅ `/decisions search/recent/epic`
- ✅ Dashboard with filters and export
- ✅ Jira integration
- ✅ Delete functionality

**The difference?** Now the code is maintainable, secure, and professional!

---

**Ready?** → `npm start` 🚀
