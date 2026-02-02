require('dotenv').config();
const { Telegraf } = require('telegraf');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const ALLOWED_USERS = process.env.TELEGRAM_ALLOWED_USERS.split(',').map(id => parseInt(id));
const API_BASE = process.env.API_BASE || 'http://localhost:5000';
const API_KEY = process.env.CLAWDBOT_API_KEY;

const conversations = new Map();

const SYSTEM_PROMPT = `You are a sales and marketing co-pilot for Hungry Times restaurant in Kolkata, India.

CRITICAL: When user asks about "my website" or "hungrytimes.in", you MUST:
1. Use web_search tool to visit hungrytimes.in
2. Browse the actual website and see what's there
3. Provide SPECIFIC analysis based on what you see
4. DO NOT give generic restaurant advice

Your mission: Increase sales, improve website conversion, grow customer base.

Website to analyze: https://hungrytimes.in

Capabilities:
- Browse and analyze hungrytimes.in (ALWAYS do this before giving advice)
- Create marketing campaigns based on actual menu/offerings
- Generate marketing copy
- Provide data-driven insights

Be proactive, specific, and action-oriented. Always base advice on the ACTUAL website.`;

// Security middleware
bot.use((ctx, next) => {
  if (!ALLOWED_USERS.includes(ctx.from?.id)) {
    ctx.reply('⛔ Unauthorized');
    return;
  }
  return next();
});

// Helper: Call backend API
async function callAPI(endpoint, method = 'GET', data = null) {
  try {
    console.log(`[API-CALL] ${method} ${API_BASE}${endpoint}`);
    console.log(`[API-CALL] Headers:`, { 'X-Clawdbot-Key': API_KEY });
    
    const config = {
      method,
      url: `${API_BASE}${endpoint}`,
      headers: { 
        'X-Clawdbot-Key': API_KEY,
        'Content-Type': 'application/json'
      }
    };
    
    // Only add data for non-GET requests
    if (data && method !== 'GET') {
      config.data = data;
    }
    
    const response = await axios(config);
    console.log(`[API-CALL] Success: ${response.status}`);
    return response.data;
  } catch (error) {
    console.error(`[API-CALL] Error calling ${endpoint}:`, {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message
    });
    return { error: error.message };
  }
}

// Helper: Call Claude API
async function callClaude(userId, message) {
  if (!conversations.has(userId)) conversations.set(userId, []);
  
  const history = conversations.get(userId);
  history.push({ role: 'user', content: message });
  if (history.length > 10) history.splice(0, history.length - 10);
  
  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: history
    });
    
    const reply = response.content[0].text;
    history.push({ role: 'assistant', content: reply });
    return reply;
  } catch (error) {
    console.error('Claude API Error:', error);
    return `⚠️ AI temporarily unavailable. Error: ${error.message}`;
  }
}

// Commands
bot.start((ctx) => {
  ctx.reply(
    `🚀 *Hungry Times Sales Co-Pilot*\n\n` +
    `I help you grow sales!\n\n` +
    `Commands:\n` +
    `/test - System check\n` +
    `/analytics - Last 7 days data\n` +
    `/reset - Clear chat\n\n` +
    `Try: "Analyze my website" or "Create weekend promo"`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('test', async (ctx) => {
  try {
    const health = await callAPI('/api/marketing/website-health');
    if (health.error) {
      ctx.reply(`⚠️ API Error: ${health.error}`);
    } else {
      ctx.reply(
        `✅ *All Systems Online!*\n\n` +
        `Website: ${health.website_url}\n` +
        `Status: ${health.status}\n` +
        `Orders Today: ${health.checks.traffic?.orders_today || 0}`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    ctx.reply(`⚠️ ${error.message}`);
  }
});

bot.command('analytics', async (ctx) => {
  try {
    const data = await callAPI('/api/marketing/analytics?days=7');
    if (data.error) {
      ctx.reply(`⚠️ ${data.error}`);
      return;
    }
    
    const s = data.summary;
    ctx.reply(
      `📈 *Last 7 Days*\n\n` +
      `Orders: ${s.total_orders}\n` +
      `Revenue: ₹${s.total_revenue.toLocaleString('en-IN')}\n` +
      `Conversion: ${s.conversion_rate}`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    ctx.reply(`⚠️ ${error.message}`);
  }
});

bot.command('reset', (ctx) => {
  conversations.delete(ctx.from.id);
  ctx.reply('🔄 Conversation reset!');
});

// Handle text messages
bot.on('text', async (ctx) => {
  ctx.sendChatAction('typing');
  
  try {
    let msg = ctx.message.text;
    
    // Enhance with API data if needed
    if (/(analytics|sales|revenue)/i.test(msg)) {
      const data = await callAPI('/api/marketing/analytics?days=7');
      msg += `\n\nCurrent data: ${JSON.stringify(data)}`;
    }
    
    const response = await callClaude(ctx.from.id, msg);
    ctx.reply(response);
  } catch (error) {
    ctx.reply(`⚠️ ${error.message}`);
  }
});

bot.catch((err) => console.error('Bot error:', err));

console.log('🤖 Starting Hungry Times Sales Bot...');
bot.launch();
console.log('✅ Bot is running!');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));