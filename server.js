const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const sessions = new Map();
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');

// This is the first backend data store. It is intentionally in memory for now;
// it can be replaced by a database without changing the API used by the UI.
const services = [
  { id: 'pocket-tasks', name: 'Pocket tasks', description: 'Keep your daily work moving, wherever you are.', platform: 'mobile', icon: '⌁', color: 'purple' },
  { id: 'team-analytics', name: 'Team analytics', description: "See the numbers behind your team's progress.", platform: 'desktop', icon: '▥', color: 'blue' },
  { id: 'project-hub', name: 'Project hub', description: "Plan, track, and ship your team's biggest ideas.", platform: 'desktop', icon: '◇', color: 'orange' },
  { id: 'resource-center', name: 'Resource center', description: 'Find guides, templates, and everything you need.', platform: 'desktop', icon: '⌂', color: 'green' }
];

const activity = [];

function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; }
}

function writeUsers(users) { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }

function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }

function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, derivedKey) => error ? reject(error) : resolve(`${salt}:${derivedKey.toString('hex')}`)));
}

function verifyPassword(password, storedHash) {
  const [salt, key] = String(storedHash).split(':');
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, derivedKey) => {
    if (error) return reject(error);
    resolve(key && crypto.timingSafeEqual(Buffer.from(key, 'hex'), derivedKey));
  }));
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').filter(Boolean).map((item) => {
    const index = item.indexOf('=');
    return [item.slice(0, index).trim(), decodeURIComponent(item.slice(index + 1).trim())];
  }));
}

function getSession(req) {
  const token = parseCookies(req).session;
  return token ? sessions.get(token) : null;
}

function setSession(res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId: user.id, username: user.username, email: user.email, name: user.name });
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
}

function clearSession(req, res) {
  const token = parseCookies(req).session;
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 10000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(payload));
}

function getDeviceType(req) {
  const requested = String(req.headers['x-device-type'] || '').toLowerCase();
  if (requested === 'mobile' || requested === 'desktop') return requested;
  return /mobile|android|iphone|ipad/i.test(String(req.headers['user-agent'])) ? 'mobile' : 'desktop';
}

function serveFile(req, res, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.resolve(ROOT, requested);
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return sendJson(res, 404, { error: 'File not found' });
  }
  const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
  res.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const deviceType = getDeviceType(req);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Device-Type' });
    return res.end();
  }

  if (url.pathname === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, service: 'servicedesk-api', time: new Date().toISOString() });
  }

  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    const session = getSession(req);
    return sendJson(res, 200, { authenticated: Boolean(session), user: session || null });
  }

  if (url.pathname === '/api/auth/register' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const email = normalizeEmail(body.email);
      const password = String(body.password || '');
      const confirmPassword = String(body.confirmPassword || '');
      const username = String(body.username || '').trim().toLowerCase();
      const name = String(body.name || username || email.split('@')[0]).trim().slice(0, 80);
      if (!validEmail(email)) return sendJson(res, 400, { error: 'Please enter a valid email address.' });
      if (!/^[a-z0-9_.-]{3,30}$/.test(username)) return sendJson(res, 400, { error: 'Username must be 3-30 characters using letters, numbers, dot, dash, or underscore.' });
      if (password.length < 8) return sendJson(res, 400, { error: 'Password must be at least 8 characters.' });
      if (password !== confirmPassword) return sendJson(res, 400, { error: 'Passwords do not match.' });
      const users = readUsers();
      if (users.some((user) => user.email === email)) return sendJson(res, 409, { error: 'An account with this email already exists.' });
      if (users.some((user) => user.username === username)) return sendJson(res, 409, { error: 'That username is already taken.' });
      const user = { id: crypto.randomUUID(), username, email, name, passwordHash: await hashPassword(password), createdAt: new Date().toISOString() };
      users.push(user);
      writeUsers(users);
      setSession(res, user);
      return sendJson(res, 201, { user: { id: user.id, username: user.username, email: user.email, name: user.name } });
    } catch { return sendJson(res, 400, { error: 'Unable to create account.' }); }
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const identifier = String(body.identifier || '').trim().toLowerCase();
      const user = readUsers().find((item) => item.email === identifier || item.username === identifier);
      if (!user || !(await verifyPassword(String(body.password || ''), user.passwordHash))) return sendJson(res, 401, { error: 'Email or password is incorrect.' });
      setSession(res, user);
      return sendJson(res, 200, { user: { id: user.id, username: user.username, email: user.email, name: user.name } });
    } catch { return sendJson(res, 400, { error: 'Unable to sign in.' }); }
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    clearSession(req, res);
    return sendJson(res, 200, { ok: true });
  }


  if (url.pathname === '/api/services' && req.method === 'GET') {
    return sendJson(res, 200, { services, deviceType });
  }

  if (url.pathname === '/api/activity' && req.method === 'GET') {
    return sendJson(res, 200, { activity });
  }

  const launchMatch = url.pathname.match(/^\/api\/services\/([^/]+)\/launch$/);
  if (launchMatch && req.method === 'POST') {
    if (!getSession(req)) return sendJson(res, 401, { error: 'AUTH_REQUIRED' });
    const service = services.find((item) => item.id === launchMatch[1]);
    if (!service) return sendJson(res, 404, { error: 'Service not found' });

    if (service.platform === 'desktop' && deviceType === 'mobile') {
      return sendJson(res, 403, {
        error: 'DESKTOP_ONLY',
        message: `${service.name} is only available on desktop or laptop. Please switch devices to continue.`,
        service,
        browserUrl: `/browser/${service.id}`
      });
    }

    const event = { serviceId: service.id, serviceName: service.name, deviceType, openedAt: new Date().toISOString() };
    activity.unshift(event);
    return sendJson(res, 200, { ok: true, message: `${service.name} is ready to open on this device.`, service, event });
  }

  const browserServiceMatch = url.pathname.match(/^\/browser\/([^/]+)$/);
  if (browserServiceMatch && req.method === 'GET') {
    const service = services.find((item) => item.id === browserServiceMatch[1]);
    if (!service) return sendJson(res, 404, { error: 'Service not found' });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><html><head><meta name="viewport" content="width=1280"><title>${service.name} | servicedesk</title><style>*{box-sizing:border-box}body{margin:0;min-width:1100px;background:#fbfbfc;color:#252332;font:14px Arial,sans-serif}.top{height:72px;background:#fff;border-bottom:1px solid #e9e8ee;display:flex;align-items:center;justify-content:space-between;padding:0 7%}.brand{font-weight:bold;font-size:18px;color:#252332}.brand b{display:inline-grid;place-items:center;background:#5b45e5;color:#fff;border-radius:8px;width:29px;height:29px;margin-right:8px}.user{color:#777481;font-size:12px}.layout{max-width:1050px;margin:65px auto;padding:0 25px}.eyebrow{color:#a19fa9;font-size:10px;font-weight:bold;letter-spacing:1.7px}.layout h1{font-size:34px;margin:13px 0 10px}.sub{color:#92909c;font-size:14px}.panel{margin-top:35px;background:#fff;border:1px solid #e9e8ee;border-radius:15px;padding:30px;display:grid;grid-template-columns:1fr 1fr;gap:25px}.metric{background:#f8f7ff;border-radius:12px;padding:22px}.metric strong{font-size:28px;display:block;margin:12px 0 4px}.metric span{color:#9996a5;font-size:12px}.back{display:inline-block;margin-top:28px;color:#5b45e5;text-decoration:none;font-weight:bold;font-size:13px}</style></head><body><header class="top"><div class="brand"><b>S</b>servicedesk</div><div class="user">Desktop site mode · ${service.name}</div></header><main class="layout"><span class="eyebrow">DESKTOP SERVICE</span><h1>${service.name}</h1><p class="sub">${service.description}</p><section class="panel"><div class="metric"><span>Workspace status</span><strong>Ready</strong><span>Your service is open in desktop site mode.</span></div><div class="metric"><span>Access</span><strong>Active</strong><span>Continue using this browser tab for the full experience.</span></div></section><a class="back" href="/">← Back to servicedesk</a></main></body></html>`);
  }

  if (req.method === 'GET') return serveFile(req, res, url.pathname);
  return sendJson(res, 404, { error: 'Route not found' });
});

server.listen(PORT, () => console.log(`ServiceDesk API running at http://localhost:${PORT}`));
