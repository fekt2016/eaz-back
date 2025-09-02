module.exports = {
  apps: [
    {
      name: 'backend',
      script: './server.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 6000,
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
