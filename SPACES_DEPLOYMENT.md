# Spaces Feature - Production Deployment Guide

## Pre-Deployment Checklist

- [x] Code committed to main branch
- [ ] Production database backup completed
- [ ] Migration script tested on staging/test database
- [ ] All team members notified of deployment

## Deployment Steps

### 1. Backup Production Database

```bash
# Create a backup of your production MongoDB database
# Use MongoDB Atlas UI or mongodump command
mongodump --uri="<PRODUCTION_MONGODB_URI>" --out=backup-$(date +%Y%m%d-%H%M%S)
```

### 2. Run Migration Script

**IMPORTANT:** Run this BEFORE deploying the new code to ensure zero downtime.

```bash
# Connect to your production environment
# Set your production MONGODB_URI in .env or environment

# Run the migration script
node scripts/migrate-spaces.js

# Expected output:
# ✅ Connected to MongoDB
# 📦 Processing workspace: <workspace_id>
# ✅ Created default "General" space
# ✅ Assigned X decisions to default space
# 🎉 Migration completed successfully
```

**Verify Migration:**
```bash
# Check that all decisions have a space_id
mongo <PRODUCTION_MONGODB_URI>
> use corteza
> db.decisions.countDocuments({ space_id: null })
# Should return 0

> db.workspace_spaces.countDocuments({})
# Should return at least 1 per workspace

> db.workspace_spaces.find({ is_default: true }).pretty()
# Should show one default space per workspace
```

### 3. Deploy Code

```bash
# Push to main branch (triggers automatic deployment on Railway)
git push origin main

# Or manually deploy via Railway CLI
railway up
```

### 4. Verify Deployment

1. Check application logs for startup errors
2. Visit dashboard and verify spaces feature is visible
3. Test creating a new space
4. Test filtering decisions by space
5. Test space permissions (private/shared/public)

### 5. Monitor

- Watch for any errors in production logs
- Monitor database query performance
- Check that existing users can still access their decisions
- Verify new spaces can be created without issues

## Rollback Plan

If critical issues occur:

```bash
# 1. Revert code deployment
git revert HEAD
git push origin main

# 2. Restore database from backup (if needed)
mongorestore --uri="<PRODUCTION_MONGODB_URI>" --drop backup-<timestamp>/corteza

# 3. Remove space-related collections (alternative to full restore)
mongo <PRODUCTION_MONGODB_URI>
> use corteza
> db.decisions.updateMany({}, { $unset: { space_id: "", space_name: "" }})
> db.workspace_spaces.drop()
> db.space_members.drop()
```

## Known Considerations

### Backward Compatibility
- All existing decisions are assigned to default "General" space
- API handles both `space_id` present and null gracefully
- Search works across all accessible spaces by default

### Performance
- New indexes ensure space filtering doesn't slow down queries
- Compound indexes on `workspace_id + space_id + timestamp`
- Permission checks optimized with proper database queries

### Test Workspaces
- Test authentication (src/routes/test-auth.js) is NOT deployed
- Non-Slack workspaces gracefully fallback to database-only permission checks
- All Slack-dependent features continue to work normally

## Post-Deployment Tasks

### Phase 3-6 (Future Releases)
- [ ] Add Spaces to Slack integration (/decision command)
- [ ] Add Spaces to browser extension
- [ ] Add Spaces to Obsidian plugin
- [ ] Make semantic search space-aware

### Documentation
- [ ] Update user documentation with Spaces feature
- [ ] Create video tutorial for space management
- [ ] Update API documentation with new endpoints

## Support

If issues arise:
1. Check production logs first
2. Verify migration completed successfully
3. Test with a single user before rolling back
4. Contact dev team if permission issues occur

---

**Migration Script Location:** `scripts/migrate-spaces.js`
**Commit Hash:** b0304c2
**Date:** 2026-05-20
