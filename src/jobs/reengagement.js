const { getExtensionInstallsCollection } = require('../config/database');
const { sendReengagementEmail } = require('../utils/n8n-client');

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // Once per day

async function checkAndSendReengagementEmails() {
  try {
    const extensionInstalls = getExtensionInstallsCollection();
    const cutoff = new Date(Date.now() - THREE_DAYS_MS);

    const installs = await extensionInstalls.find({
      status: 'installed',
      email: { $ne: null },
      installed_at: { $lt: cutoff },
      reminder_sent_at: null
    }).toArray();

    if (installs.length === 0) {
      return;
    }

    console.log(`📧 Re-engagement job: found ${installs.length} inactive install(s) to follow up`);

    for (const install of installs) {
      try {
        await sendReengagementEmail({
          email: install.email,
          workspace_name: install.workspace_name,
          install_date: install.installed_at
        });

        await extensionInstalls.updateOne(
          { install_id: install.install_id },
          {
            $set: { reminder_sent_at: new Date() },
            $inc: { reminder_count: 1 }
          }
        );
      } catch (emailError) {
        console.error(`❌ Re-engagement email failed for ${install.email}:`, emailError.message);
        // Continue to next — don't let one failure stop the batch
      }
    }
  } catch (error) {
    console.error('❌ Re-engagement job failed:', error.message);
  }
}

function startReengagementJob() {
  // Wait 5 minutes after server start before first check (let DB stabilize)
  setTimeout(() => {
    checkAndSendReengagementEmails();
    setInterval(checkAndSendReengagementEmails, CHECK_INTERVAL_MS);
  }, 5 * 60 * 1000);

  console.log('⏰ Re-engagement job scheduled (runs daily, first check in 5 minutes)');
}

module.exports = { startReengagementJob, checkAndSendReengagementEmails };
