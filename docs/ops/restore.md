# Backups: set up and restore

Every night `.github/workflows/backup.yml` dumps the production database, encrypts it with
[age](https://age-encryption.org) and keeps it 30 days as a workflow artifact
(spec `docs/specs/2026-10-ops-monitoring.md`). Meeting content inside is also encrypted per workspace
(`src/core/crypto`), so a restore needs the same `DATA_KEK` the app uses.

## Set up (once)

1. **Key pair.** On your own computer: `age-keygen -o corteza-backup-key.txt`. It prints the public
   key (`age1…`). Keep the file **offline** (password manager); without it no backup can be read, and
   anyone with it and an artifact can.
2. **Read-only database user.** Atlas → Database Access → Add user, role *Read any database*
   (or `read` on the Corteza database). Copy its connection string.
3. **GitHub secrets** (repo → Settings → Secrets and variables → Actions):
   - `BACKUP_MONGODB_URI`: that connection string, with the database name (`…mongodb.net/<db>`);
   - `BACKUP_AGE_RECIPIENT`: the public key `age1…`.
4. **Atlas network access** must let GitHub's runners in (Atlas → Network Access). On the free tier
   that means `0.0.0.0/0`, protected by the user's password; the user is read-only.
5. Run it once: repo → Actions → Backup → Run workflow. Then do the restore test below.

## Restore

Needs `mongorestore` ([MongoDB Database Tools](https://www.mongodb.com/try/download/database-tools))
and `age`.

1. Repo → Actions → Backup → the night you want → Artifacts → download, unzip:
   `corteza-YYYY-MM-DD.archive.gz.age`.
2. Restore into a **new** database first, never over production:

   ```bash
   scripts/ops/restore.sh corteza-2026-10-13.archive.gz.age corteza-backup-key.txt \
     'mongodb+srv://<admin user>@<cluster>/' --nsFrom='<db>.*' --nsTo='<db>_restore.*'
   ```

3. Check it: point a local app at `<db>_restore` with production's `DATA_KEK`, sign in, and open a few
   outcomes (they decrypt only with the right key). The documents per collection should match
   production's (`scripts/db-size.js` lists them).
4. Only then, if production is really lost or broken, restore into it (or switch `MONGODB_URI` to the
   restored database).

## When to retire this

When Corteza moves to a paid Atlas cluster (M10 or more), turn on Atlas' own continuous backups and
delete the workflow and its secrets.
