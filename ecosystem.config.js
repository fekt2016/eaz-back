module.exports = {
  apps: [
    {
      name: 'backend',
      script: './src/server.js',
      instances: 'max',
      exec_mode: 'cluster',
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
