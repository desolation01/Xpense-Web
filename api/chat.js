const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// CSRF Token storage
const csrfTokens = new Map();

// Validate CSRF token
function validateCsrfToken(token) {
  if (!token || !csrfTokens.has(token)) {
    return false;
  }
  const tokenTime = csrfTokens.get(token);
  // Check if token is older than 1 hour
  if (Date.now() - tokenTime > 3600000) {
    csrfTokens.delete(token);
    return false;
  }
  return true;
}

// Generate user ID from IP and User Agent
function generateUserId(ip, userAgent) {
  return crypto.createHash('md5').update(ip + userAgent).digest('hex');
}

// HTML escape function
function h(string) {
  return String(string)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const MAX_CHAT_TEXT_LEN = 500;
const MAX_CHAT_USER_LEN = 20;

function sanitizeChatText(value, maxLen) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen);
}

// CORS headers
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token',
    'Content-Type': 'application/json'
  };
}

module.exports = async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  // Set CORS headers
  Object.entries(corsHeaders()).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  const userIp = req.ip || req.socket.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || '';
  const userId = generateUserId(userIp, userAgent);
  const action = req.query.action || 'get';

  try {
    // Update online status
    const now = Math.floor(Date.now() / 1000);
    
    // Insert or update online status
    await supabase
      .from('online_users')
      .upsert({
        user_id: userId,
        last_seen: now
      }, {
        onConflict: 'user_id'
      });

    // Cleanup old users (older than 15 seconds)
    const fifteenSecondsAgo = now - 15;
    await supabase
      .from('online_users')
      .delete()
      .lt('last_seen', fifteenSecondsAgo);

    if (action === 'send' && req.method === 'POST') {
      // CSRF Check
      const token = req.headers['x-csrf-token'] || '';
      if (!validateCsrfToken(token)) {
        return res.status(403).json({ status: 'error', message: 'Invalid CSRF token' });
      }

      const { text, user = 'Anonymous' } = req.body || {};
      const trimmedText = sanitizeChatText(text, MAX_CHAT_TEXT_LEN);
      const trimmedUser = sanitizeChatText(user, MAX_CHAT_USER_LEN) || 'Anonymous';

      if (!trimmedText) {
        return res.status(400).json({ status: 'error', message: 'Empty text' });
      }

      // Insert chat message
      const { error } = await supabase
        .from('chat_messages')
        .insert([{
          user: h(trimmedUser.substring(0, 20)),
          text: h(trimmedText.substring(0, 500)),
          time: new Date().toTimeString().slice(0, 5), // HH:MM format
          ts: now
        }]);

      if (error) {
        console.error('Chat message insert error:', error);
        return res.status(500).json({ status: 'error', message: 'Failed to save message' });
      }

      // Keep only last 50 messages
      const { data: messageCount } = await supabase
        .from('chat_messages')
        .select('*', { count: 'exact', head: true });

      if (messageCount && messageCount.count > 50) {
        // Get oldest messages to delete
        const { data: oldMessages } = await supabase
          .from('chat_messages')
          .select('id')
          .order('ts', { ascending: true })
          .limit(messageCount.count - 50);

        if (oldMessages && oldMessages.length > 0) {
          const idsToDelete = oldMessages.map(m => m.id);
          await supabase
            .from('chat_messages')
            .delete()
            .in('id', idsToDelete);
        }
      }

      return res.status(200).json({ status: 'success' });

    } else {
      // Action: GET (fetch messages + online count)
      const { data: messages } = await supabase
        .from('chat_messages')
        .select('*')
        .order('ts', { ascending: true })
        .limit(50);

      const { count: onlineCount } = await supabase
        .from('online_users')
        .select('*', { count: 'exact', head: true });

      return res.status(200).json({
        messages: messages || [],
        online: onlineCount || 0
      });
    }

  } catch (error) {
    console.error('Chat API Error:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
};
