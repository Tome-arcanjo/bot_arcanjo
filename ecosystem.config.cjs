// ecosystem.config.cjs — PM2 configuration for VPS/Hostinger
// Usage: pm2 start ecosystem.config.cjs --env production
module.exports = {
  apps: [
    {
      name: "bot-arcanjo",
      script: "src/server.js",
      interpreter: "node",
      interpreter_args: "--experimental-vm-modules",
      instances: 1,          // aumentar para "max" se quiser cluster mode
      exec_mode: "fork",     // trocar para "cluster" para múltiplas instâncias
      watch: false,          // NUNCA true em produção
      max_memory_restart: "512M",

      // Variáveis de ambiente — PRODUÇÃO
      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
      },

      // Variáveis de ambiente — DESENVOLVIMENTO
      env_development: {
        NODE_ENV: "development",
        PORT: 3000,
      },

      // Logs
      out_file: "./logs/out.log",
      error_file: "./logs/error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,

      // Reinício automático em crashes
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,

      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 10000,
    },
  ],
};
