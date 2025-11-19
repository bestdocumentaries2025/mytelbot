// setup-webhook.js

// THIS IS THE ONLY CHANGE NEEDED
// This line loads your .env file into process.env
import 'dotenv/config'; 

import { TelegramBot } from 'node-telegram-bot-api';

// You need to pass your Vercel deployment URL as an argument
const vercelUrl = process.argv[2];
if (!vercelUrl) {
  console.error('Please provide the Vercel deployment URL as an argument.');
  console.error('Example: node setup-webhook.js https://your-project.vercel.app');
  process.exit(1);
}

// These variables are now loaded from your .env file
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET) {
    console.error('TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must be set in your .env file.');
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

const webhookUrl = `${vercelUrl}/api/bot`;

bot.setWebHook(webhookUrl, {
  secret_token: TELEGRAM_WEBHOOK_SECRET
})
.then(() => {
  console.log(`✅ Webhook set successfully to ${webhookUrl}`);
})
.catch((error) => {
  console.error('❌ Failed to set webhook:', error.response.body);
});