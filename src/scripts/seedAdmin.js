const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const Admin = require('../models/user/adminModel');

const loadEnv = () => {
  const envPath = path.join(__dirname, '../../.env');
  const configEnvPath = path.join(__dirname, '../../config.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    return;
  }
  if (fs.existsSync(configEnvPath)) {
    dotenv.config({ path: configEnvPath });
    return;
  }
  dotenv.config({ path: envPath });
};

const requireEnv = (key) => {
  const v = process.env[key];
  if (!v) {
    throw new Error(`Missing required env: ${key}`);
  }
  return v;
};

const resolveMongoUri = () => {
  const raw = requireEnv('MONGO_URL');
  const password = requireEnv('DATABASE_PASSWORD');
  return raw.replace('<PASSWORD>', password);
};

async function main() {
  loadEnv();

  const email = String(process.env.ADMIN_SEED_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_SEED_PASSWORD || '').trim();
  const name = String(process.env.ADMIN_SEED_NAME || 'Admin').trim().slice(0, 80);
  const roleRaw = String(process.env.ADMIN_SEED_ROLE || 'superadmin').trim().toLowerCase();
  const role = ['admin', 'superadmin', 'support_agent'].includes(roleRaw)
    ? roleRaw
    : 'superadmin';

  if (!email || !password) {
    throw new Error(
      'Set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD environment variables'
    );
  }
  if (password.length < 8) {
    throw new Error('ADMIN_SEED_PASSWORD must be at least 8 characters');
  }

  const mongoUri = resolveMongoUri();
  await mongoose.connect(mongoUri, { family: 4 });

  const existing = await Admin.findOne({ email }).select('_id email role');
  if (existing) {
    // Do not overwrite passwords/roles automatically.
    // This script is only for creating a missing admin safely.
    // eslint-disable-next-line no-console
    console.log(
      `[seedAdmin] Admin already exists: ${existing.email} (${existing.role})`
    );
    await mongoose.disconnect();
    return;
  }

  await Admin.create({
    name,
    email,
    role,
    password,
    passwordConfirm: password,
    status: 'active',
  });

  // eslint-disable-next-line no-console
  console.log(`[seedAdmin] Created admin: ${email} (${role})`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error('[seedAdmin] Failed:', err.message);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});

