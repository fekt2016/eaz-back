module.exports = {
  apps: [
    {
      name: 'backend',
      script: './src/server.js',
      instances: 'max',
      exec_mode: 'cluster',

      // Restart the app if it uses more than 1GB of memory
      max_memory_restart: '1G',

      // PM2 log files (these are separate from Winston logs)
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Auto‑restart behaviour
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',

      env: {
        NODE_ENV: 'production',
        PORT: 4000, // Aligned with config.env default
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000, // Aligned with config.env default
      },
    },
  ],
};
