const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const jwtSecret = process.env.JWT_SECRET;
const groqApiKey = process.env.GROQ_API_KEY;

if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error('Missing or weak JWT_SECRET. Set a strong secret (32+ chars).');
}

// Lazy Supabase client — created only when needed so the function
// loads successfully even when Supabase env vars are not set.
let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables');
  }
  _supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  return _supabase;
}

// Stateless HMAC-based CSRF tokens (works across serverless instances)
const crypto = require('crypto');
const csrfSecret = jwtSecret;

const RATE_LIMIT_STORE = new Map();
const RATE_LIMIT_RULES = {
  token: { max: 60, windowMs: 60_000 },
  login: { max: 12, windowMs: 15 * 60_000 },
  register: { max: 8, windowMs: 60 * 60_000 },
  chat: { max: 30, windowMs: 60_000 },
  buildInfo: { max: 180, windowMs: 60_000 },
  syncPost: { max: 20, windowMs: 60_000 },
  default: { max: 120, windowMs: 60_000 }
};

const ACTIVE_WINDOW_SECONDS = 120;

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(key, max, windowMs) {
  const now = Date.now();
  const entry = RATE_LIMIT_STORE.get(key);
  if (!entry || now >= entry.resetAt) {
    RATE_LIMIT_STORE.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false, retryAfterSec: 0 };
  }

  if (entry.count >= max) {
    return {
      limited: true,
      retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    };
  }

  entry.count += 1;
  RATE_LIMIT_STORE.set(key, entry);
  return { limited: false, retryAfterSec: 0 };
}

function applyRateLimit(req, res, action) {
  const ip = getClientIp(req);
  const method = (req.method || 'GET').toUpperCase();
  const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  let rule = RATE_LIMIT_RULES.default;
  let scopedKey = `${action}:${method}:${ip}`;

  if (action === 'token') rule = RATE_LIMIT_RULES.token;
  if (action === 'chat' && method === 'POST') rule = RATE_LIMIT_RULES.chat;
  if (action === 'build_info' && method === 'GET') rule = RATE_LIMIT_RULES.buildInfo;
  if (action === 'register' && method === 'POST') rule = RATE_LIMIT_RULES.register;
  if (action === 'login' && method === 'POST') {
    rule = RATE_LIMIT_RULES.login;
    if (username) scopedKey = `${action}:${method}:${ip}:${username}`;
  }
  if (action === 'sync' && method === 'POST') rule = RATE_LIMIT_RULES.syncPost;

  const limit = checkRateLimit(scopedKey, rule.max, rule.windowMs);
  if (limit.limited) {
    res.setHeader('Retry-After', String(limit.retryAfterSec));
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  return null;
}

async function touchActiveUser(userId) {
  if (!userId) return;
  const now = Math.floor(Date.now() / 1000);
  await getSupabase()
    .from('online_users')
    .upsert({
      user_id: String(userId),
      last_seen: now
    }, {
      onConflict: 'user_id'
    });
}

async function getActiveStats() {
  const now = Math.floor(Date.now() / 1000);
  const staleThreshold = now - ACTIVE_WINDOW_SECONDS;

  // Cleanup stale presence rows first.
  await getSupabase()
    .from('online_users')
    .delete()
    .lt('last_seen', staleThreshold);

  const { count } = await getSupabase()
    .from('online_users')
    .select('*', { count: 'exact', head: true });

  const registeredActive = count || 0;
  return {
    registered_active_users: registeredActive,
    active_users: registeredActive,
  };
}

function getDeployVersion() {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.RENDER_GIT_COMMIT ||
    process.env.BUILD_ID ||
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.npm_package_version ||
    'dev'
  );
}

function generateCsrfToken() {
  const timestamp = Date.now().toString();
  const hmac = crypto.createHmac('sha256', csrfSecret).update(timestamp).digest('hex');
  return `${timestamp}.${hmac}`;
}

function validateCsrfToken(token) {
  try {
    if (!token || !token.includes('.')) return false;
    const [timestamp, hmac] = token.split('.');
    if (Date.now() - Number(timestamp) > 3600000) return false;
    const expected = crypto.createHmac('sha256', csrfSecret).update(timestamp).digest('hex');
    if (hmac.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected));
  } catch {
    return false;
  }
}

function buildAllowedOrigins(req) {
  const envOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
  const host = req.headers.host || '';
  const hostOrigins = host ? [`https://${host}`, `http://${host}`] : [];
  return new Set([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    ...hostOrigins,
    ...envOrigins
  ]);
}

function resolveAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return null;
  const allowed = buildAllowedOrigins(req);
  return allowed.has(origin) ? origin : null;
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
}

// Verify JWT token
function verifyToken(token) {
  try {
    return jwt.verify(token, jwtSecret);
  } catch (err) {
    return null;
  }
}

// Extract and verify auth from request
function requireAuth(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  
  if (!token) {
    return null;
  }
  
  const decoded = verifyToken(token);
  if (!decoded || !decoded.userId) {
    return null;
  }
  
  return decoded;
}

const MAX_TEXT_LEN = 120;
const MAX_CATEGORY_LEN = 60;
const MAX_AMOUNT = 1_000_000_000;
const ALLOWED_ENTRY_TYPES = new Set(['gain', 'expense']);
const ALLOWED_RECURRING = new Set(['none', 'daily', 'weekly', 'monthly']);

function sanitizePlainText(value, maxLen, fallback = '') {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen);
  return text || fallback;
}

function parseOptionalNonNegativeNumber(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > MAX_AMOUNT) {
    throw new Error(`Invalid ${fieldName}.`);
  }
  return Number(num.toFixed(2));
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

function normalizeRecurring(value) {
  const recurring = String(value || 'none').trim().toLowerCase();
  return ALLOWED_RECURRING.has(recurring) ? recurring : 'none';
}

function normalizeSyncPayload(payload) {
  const salary = parseOptionalNonNegativeNumber(payload.salary, 'salary');
  const budget = parseOptionalNonNegativeNumber(payload.budget, 'budget');
  const weeklyBudget = parseOptionalNonNegativeNumber(payload.weeklyBudget, 'weekly budget');
  const entriesByDayRaw = payload.entriesByDay || {};

  if (typeof entriesByDayRaw !== 'object' || entriesByDayRaw === null || Array.isArray(entriesByDayRaw)) {
    throw new Error('Invalid entries payload.');
  }

  const normalizedEntriesByDay = {};
  let normalizedCount = 0;

  for (const [date, dayItems] of Object.entries(entriesByDayRaw)) {
    if (!isIsoDate(date)) {
      throw new Error(`Invalid entry date: ${date}`);
    }
    if (!Array.isArray(dayItems)) {
      throw new Error(`Invalid entries format for date: ${date}`);
    }

    const normalizedItems = [];
    for (const raw of dayItems) {
      if (!raw || typeof raw !== 'object') {
        throw new Error(`Invalid entry object on ${date}.`);
      }

      const type = String(raw.type || '').trim().toLowerCase();
      if (!ALLOWED_ENTRY_TYPES.has(type)) {
        throw new Error(`Invalid entry type on ${date}.`);
      }

      const amount = Number(raw.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
        throw new Error(`Invalid amount on ${date}.`);
      }

      const label = sanitizePlainText(raw.label, MAX_TEXT_LEN, 'Entry');
      const category = sanitizePlainText(raw.category, MAX_CATEGORY_LEN, 'Other');
      const recurring = normalizeRecurring(raw.recurring);
      const ts = Number.isFinite(Number(raw.ts)) && Number(raw.ts) > 0
        ? Math.floor(Number(raw.ts))
        : Date.now();

      normalizedItems.push({
        type,
        amount: Number(amount.toFixed(2)),
        label,
        category,
        recurring,
        ts
      });
    }

    if (normalizedItems.length > 0) {
      normalizedEntriesByDay[date] = normalizedItems;
      normalizedCount += normalizedItems.length;
    }
  }

  if ((Number(payload.entriesCount) || 0) > 0 && normalizedCount === 0) {
    throw new Error('Entries count mismatch.');
  }

  return { salary, budget, weeklyBudget, entriesByDay: normalizedEntriesByDay };
}

// CORS headers
function corsHeaders(req) {
  const allowedOrigin = resolveAllowedOrigin(req);
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token',
    'Content-Type': 'application/json',
    'Vary': 'Origin'
  };
  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
  }
  return headers;
}

module.exports = async (req, res) => {
  setSecurityHeaders(res);

  const requestOrigin = req.headers.origin;
  const allowedOrigin = resolveAllowedOrigin(req);
  if (requestOrigin && !allowedOrigin) {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    Object.entries(corsHeaders(req)).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    return res.status(200).json({});
  }

  // Set CORS headers
  Object.entries(corsHeaders(req)).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  const action = req.query.action || '';
  const limited = applyRateLimit(req, res, action);
  if (limited) return;

  try {
    // 0. FETCH CSRF TOKEN
    if (action === 'token' && req.method === 'GET') {
      const token = generateCsrfToken();
      return res.status(200).json({ token });
    }

    // 1. AUTHENTICATION ACTIONS (PUBLIC)
    if (action === 'register' && req.method === 'POST') {
      const token = req.headers['x-csrf-token'] || '';
      if (!validateCsrfToken(token)) {
        return res.status(403).json({ error: 'Invalid CSRF token.' });
      }

      const { username, password } = req.body || {};
      const user = (username || '').trim();

      if (user.length < 3 || (password || '').length < 6) {
        return res.status(400).json({ error: 'Username must be 3+ and Password 6+ chars.' });
      }

      // Check if user exists
      const { data: existingUser } = await getSupabase()
        .from('users')
        .select('id')
        .eq('username', user)
        .single();

      if (existingUser) {
        return res.status(409).json({ error: 'Username already taken.' });
      }

      // Create user
      const passwordHash = await bcrypt.hash(password, 10);
      const { data: newUser, error } = await getSupabase()
        .from('users')
        .insert([{ username: user, password_hash: passwordHash }])
        .select()
        .single();

      if (error) {
        console.error('Registration error:', error);
        return res.status(500).json({ error: `Registration failed: ${error.message || error.code || JSON.stringify(error)}` });
      }

      return res.status(200).json({ ok: true, message: 'Account created! You can now log in.' });
    }

    if (action === 'login' && req.method === 'POST') {
      const { username, password } = req.body || {};
      const user = (username || '').trim();

      const { data: userRow, error } = await getSupabase()
        .from('users')
        .select('id, password_hash, username')
        .eq('username', user)
        .single();

      if (!userRow || !await bcrypt.compare(password, userRow.password_hash)) {
        return res.status(401).json({ error: 'Invalid username or password.' });
      }

      // Generate JWT token
      const token = jwt.sign(
        { userId: userRow.id, username: userRow.username },
        jwtSecret,
        { expiresIn: '7d' }
      );

      return res.status(200).json({
        ok: true,
        username: userRow.username,
        token,
        userId: userRow.id
      });
    }

    if (action === 'status') {
      const auth = requireAuth(req);
      if (auth) {
        return res.status(200).json({ logged_in: true, username: auth.username, userId: auth.userId });
      } else {
        return res.status(200).json({ logged_in: false });
      }
    }

    if (action === 'public_stats') {
      const { count: userCount } = await getSupabase()
        .from('users')
        .select('*', { count: 'exact', head: true });

      const { count: entryCount } = await getSupabase()
        .from('entries')
        .select('*', { count: 'exact', head: true });

      const { data: expenseData } = await getSupabase()
        .from('entries')
        .select('amount')
        .eq('entry_type', 'expense');

      const { data: gainData } = await getSupabase()
        .from('entries')
        .select('amount')
        .eq('entry_type', 'gain');

      const totalExpenses = expenseData?.reduce((sum, e) => sum + (e.amount || 0), 0) || 0;
      const totalGains = gainData?.reduce((sum, e) => sum + (e.amount || 0), 0) || 0;

      const activeStats = await getActiveStats();
      return res.status(200).json({
        user_count: userCount || 0,
        entry_count: entryCount || 0,
        total_expenses: totalExpenses,
        total_gains: totalGains,
        ...activeStats
      });
    }

    if (action === 'build_info' && req.method === 'GET') {
      return res.status(200).json({
        deploy_version: getDeployVersion(),
        server_time: new Date().toISOString(),
      });
    }

    if (action === 'active_users' && req.method === 'GET') {
      const auth = requireAuth(req);
      if (!auth) {
        return res.status(401).json({ error: 'Unauthorized. Please log in.' });
      }
      await touchActiveUser(auth.userId);
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      return res.status(200).json(await getActiveStats());
    }

    if (action === 'logout') {
      // With JWT, logout is handled client-side by deleting the token
      return res.status(200).json({ ok: true });
    }

    // 2. CHAT PROXY (Public — portfolio assistant)
    if (action === 'chat' && req.method === 'POST') {
      const csrfToken = req.headers['x-csrf-token'] || '';
      if (!validateCsrfToken(csrfToken)) {
        return res.status(403).json({ error: 'Invalid CSRF token.' });
      }

      if (!groqApiKey) {
        return res.status(503).json({ error: 'Chat is not configured on this server.' });
      }

      const { model = 'llama-3.3-70b-versatile', messages = [], temperature = 0.4 } = req.body || {};

      const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqApiKey}`
        },
        body: JSON.stringify({
          model,
          messages,
          temperature
        })
      });

      const groqData = await groqResponse.json();

      if (groqResponse.status !== 200) {
        return res.status(groqResponse.status).json(groqData);
      }

      return res.status(200).json({
        content: groqData.choices?.[0]?.message?.content || '',
        raw: groqData
      });
    }

    // --- SECURE ACTIONS (REQUIRE LOGIN) ---
    const auth = requireAuth(req);
    if (!auth) {
      return res.status(401).json({ error: 'Unauthorized. Please log in.' });
    }

    const userId = auth.userId;

    // 3. DATA SYNC
    if (action === 'sync') {
      if (req.method === 'POST') {
        const token = req.headers['x-csrf-token'] || '';
        if (!validateCsrfToken(token)) {
          return res.status(403).json({ status: 'error', error: 'Invalid CSRF token.' });
        }

        let normalizedPayload;
        try {
          normalizedPayload = normalizeSyncPayload(req.body || {});
        } catch (validationError) {
          return res.status(400).json({
            status: 'error',
            error: validationError.message || 'Invalid sync payload.'
          });
        }
        const { salary, budget, weeklyBudget, entriesByDay } = normalizedPayload;

        try {
          // Update user settings
          const { error: settingsError } = await getSupabase()
            .from('users')
            .update({
              salary: salary !== undefined ? salary : null,
              monthly_budget: budget !== undefined ? budget : null,
              weekly_budget: weeklyBudget !== undefined ? weeklyBudget : null
            })
            .eq('id', userId);

          if (settingsError) {
            console.error('Settings update error:', settingsError);
            return res.status(500).json({ status: 'error', error: 'Failed to update settings.' });
          }

          // Delete old entries and insert new ones
          const { error: deleteError } = await getSupabase()
            .from('entries')
            .delete()
            .eq('user_id', userId);

          if (deleteError) {
            console.error('Delete error:', deleteError);
            return res.status(500).json({ status: 'error', error: 'Failed to sync entries.' });
          }

          let savedCount = 0;
          const entriesToInsert = [];

          for (const [date, dayItems] of Object.entries(entriesByDay)) {
            for (const item of dayItems) {
              entriesToInsert.push({
                user_id: userId,
                entry_date: date,
                label: item.label,
                category: item.category,
                entry_type: item.type === 'gain' ? 'gain' : 'expense',
                amount: item.amount,
                recurring: item.recurring,
                entry_ts: item.ts
              });
            }
          }

          if (entriesToInsert.length > 0) {
            const { error: insertError, count } = await getSupabase()
              .from('entries')
              .insert(entriesToInsert);

            if (insertError) {
              console.error('Insert error:', insertError);
              return res.status(500).json({ status: 'error', error: 'Failed to insert entries.' });
            }

            savedCount = entriesToInsert.length;
          }

          return res.status(200).json({
            status: 'success',
            ok: true,
            userId,
            saved_entries: savedCount,
            received_days: Object.keys(entriesByDay).length
          });
        } catch (error) {
          console.error('Sync error:', error);
          return res.status(500).json({ status: 'error', error: `Sync failed: ${error.message}` });
        }
      }

      if (req.method === 'GET') {
        // Load user settings
        const { data: settings, error: settingsError } = await getSupabase()
          .from('users')
          .select('salary, monthly_budget, weekly_budget')
          .eq('id', userId)
          .single();

        if (settingsError) {
          console.error('Settings load error:', settingsError);
        }

        // Load entries
        let { data: rows, error: entriesError } = await getSupabase()
          .from('entries')
          .select('entry_date, label, category, entry_type, amount, recurring, entry_ts')
          .eq('user_id', userId);

        if (entriesError) {
          console.error('Entries load error:', entriesError);
          rows = [];
        }

        const entriesByDay = {};
        for (const row of (rows || [])) {
          const date = row.entry_date;
          if (!isIsoDate(date)) continue;
          const type = ALLOWED_ENTRY_TYPES.has(String(row.entry_type || '').toLowerCase())
            ? String(row.entry_type).toLowerCase()
            : 'expense';
          const amount = Number(row.amount);
          if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT) continue;
          if (!entriesByDay[date]) {
            entriesByDay[date] = [];
          }
          entriesByDay[date].push({
            label: sanitizePlainText(row.label, MAX_TEXT_LEN, 'Entry'),
            category: sanitizePlainText(row.category, MAX_CATEGORY_LEN, 'Other'),
            type,
            amount: Number(amount.toFixed(2)),
            recurring: normalizeRecurring(row.recurring),
            ts: Number.isFinite(Number(row.entry_ts)) && Number(row.entry_ts) > 0
              ? Math.floor(Number(row.entry_ts))
              : Date.now()
          });
        }

        return res.status(200).json({
          salary: settings?.salary !== null && settings?.salary !== undefined ? parseFloat(settings.salary) : null,
          budget: settings?.monthly_budget !== null && settings?.monthly_budget !== undefined ? parseFloat(settings.monthly_budget) : null,
          weeklyBudget: settings?.weekly_budget !== null && settings?.weekly_budget !== undefined ? parseFloat(settings.weekly_budget) : null,
          entriesByDay
        });
      }
    }

    // 4. CONTACT FORM (Public)
    if (action === 'contact' && req.method === 'POST') {
      const { name, email, message } = req.body || {};
      
      // Basic validation
      if (!name || !email || !message) {
        return res.status(400).json({ error: 'All fields are required.' });
      }

      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email address.' });
      }

      // In a real app, you would save to database or send email
      // For now, just acknowledge receipt
      console.log('Contact form submission:', { name, email, message: message.substring(0, 100) });

      return res.status(200).json({
        ok: true,
        message: 'Thank you for your message! I will get back to you soon.'
      });
    }

    // Default response
    return res.status(400).json({ error: 'Invalid action or method' });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
