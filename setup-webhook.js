// setup-webhook.js
import 'dotenv/config'; // Load .env file
import { TelegramBot } from 'node-telegram-bot-api';

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

// The URL for your webhook. Vercel will handle this automatically.
const webhookUrl = `https://mytelbot.vercel.app/api/bot`;

bot.setWebHook(webhookUrl, {
  secret_token: process.env.TELEGRAM_WEBHOOK_SECRET
})
.then(() => {
  console.log(`✅ Webhook set successfully to ${webhookUrl}`);
})
.catch((error) => {
  console.error('❌ Failed to set webhook:', error.response.body);
});