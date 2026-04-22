/**
 * One-time migration: Admin.role `moderator` → `support_agent`.
 *
 * Run from repo root:
 *   node backend/src/scripts/renameModeratorsToSupportAgent.js
 */

require('dotenv').config({
  path: require('path').join(__dirname, '../../.env'),
});
const mongoose = require('mongoose');

const run = async () => {
  const DB = (process.env.MONGO_URL || process.env.DATABASE).replace(
    '<PASSWORD>',
    process.env.DATABASE_PASSWORD,
  );
  await mongoose.connect(DB);
  console.log('Connected to MongoDB');

  const collection = mongoose.connection.collection('admins');
  const result = await collection.updateMany(
    { role: 'moderator' },
    { $set: { role: 'support_agent' } },
  );

  console.log(
    `Updated ${result.modifiedCount} admin(s) (matched ${result.matchedCount}).`,
  );

  const AdminActionLog = require('../models/admin/adminActionLogModel');
  const actionLogs = mongoose.connection.collection(AdminActionLog.collection.name);
  const logResult = await actionLogs.updateMany(
    { role: 'moderator' },
    { $set: { role: 'support_agent' } },
  );
  console.log(
    `AdminActionLog role updates: modified ${logResult.modifiedCount} (matched ${logResult.matchedCount}).`,
  );

  await mongoose.disconnect();
  console.log('Disconnected.');
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
