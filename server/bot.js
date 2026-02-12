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
    `*General:*\n` +
    `/test - System check\n` +
    `/analytics - Last 7 days data\n` +
    `/kpi - Weekly KPI dashboard\n` +
    `/reset - Clear chat\n\n` +
    `*CRM:*\n` +
    `/segments - Customer segment counts\n` +
    `/campaign <segment> - Generate offers\n` +
    `/next - Send next CRM message\n` +
    `/crm - Dashboard stats\n\n` +
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
      const t = health.checks.traffic || {};
      ctx.reply(
        `✅ *All Systems Online!*\n\n` +
        `Website: ${health.website_url}\n` +
        `Status: ${health.status}\n` +
        `Online orders today: ${t.online_orders_today || 0}\n` +
        `POS orders today: ${t.pos_orders_today || 0}\n` +
        `Revenue today: ₹${((t.online_revenue_today || 0) + (t.pos_revenue_today || 0)).toLocaleString('en-IN')}`,
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
      `Orders: ${s.total_orders} (${s.online_orders} online / ${s.pos_orders} POS)\n` +
      `Revenue: ₹${s.total_revenue.toLocaleString('en-IN')}\n` +
      `AOV: ₹${s.avg_order_value}\n` +
      `New customers: ${s.new_customers}\n` +
      `Offers redeemed: ${s.offer_redemptions}`,
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

bot.command('kpi', async (ctx) => {
  try {
    const days = ctx.message.text.split(' ')[1] || '7';
    const data = await callAPI(`/api/marketing/kpi?days=${days}`);
    if (data.error) {
      ctx.reply(`⚠️ ${data.error}`);
      return;
    }

    const k = data.kpi;
    const lines = [
      `📊 *Weekly KPI Dashboard* (${data.period})`,
      ``,
      `💰 *Revenue*`,
      `Revenue: ₹${k.total_revenue.value.toLocaleString('en-IN')} (${k.total_revenue.delta})`,
      `Orders: ${k.total_orders.value} (${k.total_orders.delta})`,
      `AOV: ₹${k.avg_order_value.value} (${k.avg_order_value.delta})`,
      `Channel: ${k.online_vs_pos}`,
      `Online share: ${k.online_share.value}`,
      ``,
      `👥 *Customers*`,
      `New signups: ${k.new_customers.value} (${k.new_customers.delta})`,
      `Repeat buyers: ${k.repeat_customers.value}`,
      `Unique online: ${k.unique_online_customers.value}`,
      ``,
      `📣 *Marketing*`,
      `Social posts: ${k.social_posts.value}`,
      `Offers redeemed: ${k.offer_redemptions.value} (${k.offer_redemptions.delta})`,
      `CRM sent: ${k.crm_sent.value}`,
      `CRM redeemed: ${k.crm_redeemed.value}`,
      `CRM rate: ${k.crm_redemption_rate.value}`,
    ];

    ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  } catch (error) {
    ctx.reply(`⚠️ ${error.message}`);
  }
});

// ============================================================================
// CRM COMMANDS
// ============================================================================

bot.command('segments', async (ctx) => {
  try {
    const data = await callAPI('/api/crm/segments');
    if (data.error) return ctx.reply(`⚠️ ${data.error}`);

    const lines = (data.segments || []).map(s =>
      `${s.segment.toUpperCase()}: ${s.count} customers`
    );

    ctx.reply(
      `📊 *Customer Segments*\n\n` +
      (lines.length ? lines.join('\n') : 'No data yet') +
      `\n\nUse /campaign <segment> to generate offers`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    ctx.reply(`⚠️ ${err.message}`);
  }
});

bot.command('campaign', async (ctx) => {
  const segment = ctx.message.text.split(' ')[1];
  if (!segment) {
    return ctx.reply('Usage: /campaign <segment>\nSegments: vip, regular, lapsed, dormant, new');
  }

  ctx.reply(`⏳ Generating ${segment} campaign... (this may take a minute)`);
  ctx.sendChatAction('typing');

  try {
    const data = await callAPI('/api/crm/generate-campaign', 'POST', { segment, limit: 15 });
    if (data.error) return ctx.reply(`⚠️ ${data.error}`);

    if (!data.campaign_id) {
      return ctx.reply(`✅ ${data.message}`);
    }

    ctx.reply(
      `✅ *Campaign Created!*\n\n` +
      `Segment: ${segment}\n` +
      `Messages: ${data.total_messages}\n` +
      `Campaign ID: #${data.campaign_id}\n\n` +
      `Use /next to start sending`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    ctx.reply(`⚠️ ${err.message}`);
  }
});

bot.command('next', async (ctx) => {
  try {
    const data = await callAPI('/api/crm/pending-messages?limit=1');
    if (data.error) return ctx.reply(`⚠️ ${data.error}`);

    const messages = data.messages || [];
    if (messages.length === 0) {
      return ctx.reply('✅ No pending messages! All caught up.');
    }

    const msg = messages[0];
    const text =
      `📋 *CRM #${msg.id}* | ${msg.segment || 'Unknown'}\n\n` +
      `👤 ${msg.customer_name || 'Unknown'}\n` +
      `📱 ${msg.customer_phone}\n` +
      `🏷️ Code: ${msg.offer_code}\n\n` +
      `📝 *Copy this message:*\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `${msg.message_text}\n` +
      `━━━━━━━━━━━━━━━━━━━`;

    ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Sent', callback_data: `crm_sent_${msg.id}` },
          { text: '❌ No WhatsApp', callback_data: `crm_nowa_${msg.id}` },
          { text: '⏭️ Skip', callback_data: `crm_skip_${msg.id}` }
        ]]
      }
    });
  } catch (err) {
    ctx.reply(`⚠️ ${err.message}`);
  }
});

bot.command('crm', async (ctx) => {
  try {
    const data = await callAPI('/api/crm/stats');
    if (data.error) return ctx.reply(`⚠️ ${data.error}`);

    const t = data.totals || {};
    const rate = t.sent > 0 ? ((t.redeemed / t.sent) * 100).toFixed(1) : '0';

    ctx.reply(
      `📊 *CRM Dashboard*\n\n` +
      `Total messages: ${t.total || 0}\n` +
      `⏳ Pending: ${t.pending || 0}\n` +
      `✅ Sent: ${t.sent || 0}\n` +
      `🎉 Redeemed: ${t.redeemed || 0}\n` +
      `❌ No WhatsApp: ${t.no_whatsapp || 0}\n` +
      `⏭️ Skipped: ${t.skipped || 0}\n\n` +
      `📈 Redemption rate: ${rate}%`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    ctx.reply(`⚠️ ${err.message}`);
  }
});

// CRM inline keyboard handlers
bot.action(/^crm_(sent|nowa|skip)_(\d+)$/, async (ctx) => {
  const action = ctx.match[1];
  const msgId = ctx.match[2];

  let endpoint;
  let label;
  if (action === 'sent') {
    endpoint = `/api/crm/message/${msgId}/sent`;
    label = '✅ Marked as sent';
  } else if (action === 'nowa') {
    endpoint = `/api/crm/message/${msgId}/no-whatsapp`;
    label = '❌ Marked no WhatsApp';
  } else {
    endpoint = `/api/crm/message/${msgId}/skip`;
    label = '⏭️ Skipped';
  }

  try {
    await callAPI(endpoint, 'POST');
    await ctx.answerCbQuery(label);
    await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: label, callback_data: 'done' }]] });

    // Auto-load next message
    setTimeout(() => {
      ctx.reply('Loading next...').then(() => {
        // Trigger /next
        bot.handleUpdate({
          update_id: Date.now(),
          message: {
            message_id: Date.now(),
            from: ctx.from,
            chat: ctx.chat,
            date: Math.floor(Date.now() / 1000),
            text: '/next'
          }
        });
      });
    }, 500);
  } catch (err) {
    ctx.answerCbQuery(`Error: ${err.message}`);
  }
});

bot.action('done', (ctx) => ctx.answerCbQuery('Done!'));

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