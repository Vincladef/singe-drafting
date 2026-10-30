import {defineConfig,devices} from '@playwright/test';
export default defineConfig({testDir:'tests/production',retries:1,use:{baseURL:'https://singe-drafting.netlify.app',trace:'retain-on-failure',screenshot:'only-on-failure'},projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}}]});
