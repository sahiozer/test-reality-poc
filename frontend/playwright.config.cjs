const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({testDir:'./tests',testMatch:'**/*.spec.cjs',use:{baseURL:process.env.DASHBOARD_URL||'http://127.0.0.1:18080',headless:true,channel:process.env.PW_CHANNEL||'chrome'},workers:1,reporter:'list'});
