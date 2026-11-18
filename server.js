const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const COMPANIES_FILE = path.join(DATA_DIR, 'companies.json');
const sessions = new Map();
const otpChallenges = new Map();
const IAM_PERMISSIONS = [
  { id: 'warehouse.inward', label: 'Warehouse · Inward management' },
  { id: 'warehouse.quality', label: 'Warehouse · GRN & quality check' },
  { id: 'warehouse.putaway', label: 'Warehouse · Putaway management' },
  { id: 'warehouse.inventory', label: 'Warehouse · Stock management' },
  { id: 'warehouse.dispatch', label: 'Warehouse · Outward & dispatch' },
  { id: 'inventory.view', label: 'Inventory · View stock' },
  { id: 'inventory.adjust', label: 'Inventory · Adjust stock' },
  { id: 'purchasing.manage', label: 'Purchasing · Manage purchase orders' },
  { id: 'sales.manage', label: 'Sales · Manage sales orders' },
  { id: 'finance.view', label: 'Finance · View reports' },
  { id: 'crm.manage', label: 'CRM · Manage customers and leads' },
  { id: 'hr.manage', label: 'HR · Manage employees and attendance' }
];
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(COMPANIES_FILE)) fs.writeFileSync(COMPANIES_FILE, '[]');

// This is the first backend data store. It is intentionally in memory for now;
// it can be replaced by a database without changing the API used by the UI.
const services = [
  { id: 'warehouse-management', name: 'Warehouse management', description: 'Run B2B and B2C warehouse operations from inward receiving to dispatch, stock audits, transfers, and returns.', platform: 'web', icon: '▦', color: 'purple' },
  { id: 'team-analytics', name: 'Team analytics', description: "See the numbers behind your team's progress.", platform: 'web', icon: '▥', color: 'blue' },
  { id: 'project-hub', name: 'Project hub', description: "Plan, track, and ship your team's biggest ideas.", platform: 'web', icon: '◇', color: 'orange' },
  { id: 'resource-center', name: 'Resource center', description: 'Find guides, templates, and everything you need.', platform: 'web', icon: '⌂', color: 'green' }
];

const activity = [];

services.push(
  { id: 'finance-accounting', name: 'Finance & Accounting', description: 'Manage journals, receivables, payables, budgets, and financial reporting.', platform: 'web', icon: 'FA', color: 'orange' },
  { id: 'purchasing', name: 'Purchasing', description: 'Manage vendors, purchase requests, purchase orders, and goods receipts.', platform: 'web', icon: 'PO', color: 'blue' },
  { id: 'sales', name: 'Sales', description: 'Manage customers, quotations, sales orders, deliveries, and invoices.', platform: 'web', icon: 'SO', color: 'purple' },
  { id: 'inventory-management', name: 'Inventory management', description: 'Track items, stock levels, transfers, batches, and inventory valuation.', platform: 'web', icon: 'ST', color: 'green' },
  { id: 'banking', name: 'Banking', description: 'Reconcile accounts, record payments, and manage cash flow.', platform: 'web', icon: 'BK', color: 'blue' },
  { id: 'production', name: 'Production', description: 'Plan bills of material, production orders, and material consumption.', platform: 'web', icon: 'PR', color: 'orange' },
  { id: 'human-resources', name: 'Human resources', description: 'Manage employees, attendance, leave, payroll inputs, and teams.', platform: 'web', icon: 'HR', color: 'purple' },
  { id: 'crm', name: 'CRM', description: 'Manage leads, opportunities, activities, and customer relationships.', platform: 'web', icon: 'CR', color: 'green' }
);
for (let index = services.length - 1; index > 0; index -= 1) {
  if (!['finance-accounting', 'purchasing', 'sales', 'inventory-management', 'banking', 'production', 'human-resources', 'crm'].includes(services[index].id)) services.splice(index, 1);
}

function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; }
}

function writeUsers(users) { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }

function readCompanies() {
  try { return JSON.parse(fs.readFileSync(COMPANIES_FILE, 'utf8')); } catch { return []; }
}

function writeCompanies(companies) { fs.writeFileSync(COMPANIES_FILE, JSON.stringify(companies, null, 2)); }

function publicUser(user) {
  return { id: user.id, username: user.username, email: user.email, mobile: user.mobile, name: user.name, companyId: user.companyId, role: user.role || 'admin', status: user.status || 'active', permissions: user.permissions || [], createdAt: user.createdAt };
}

function isAdmin(session) { return session && session.role === 'admin'; }

function canLaunchService(session, serviceId) {
  if (isAdmin(session)) return true;
  const permissions = session?.permissions || [];
  const required = {
    'warehouse-management': ['warehouse.inward', 'warehouse.quality', 'warehouse.putaway', 'warehouse.inventory', 'warehouse.dispatch'],
    'inventory-management': ['inventory.view', 'inventory.adjust'],
    purchasing: ['purchasing.manage'],
    sales: ['sales.manage'],
    crm: ['crm.manage'],
    'finance-accounting': ['finance.view'],
    banking: ['finance.view'],
    production: ['inventory.view'],
    'human-resources': ['hr.manage']
  }[serviceId] || [];
  return required.some((permission) => permissions.includes(permission));
}

function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }

function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

function normalizeMobile(mobile) { return String(mobile || '').replace(/[\s()-]/g, ''); }

function validMobile(mobile) { return /^\+?[1-9]\d{9,14}$/.test(normalizeMobile(mobile)); }

function createOtp() { return String(crypto.randomInt(100000, 1000000)); }

async function deliverOtp(channel, destination, otp) {
  // Configure an email/SMS provider webhook in production. Development returns
  // the code so the local flow can be tested without third-party credentials.
  if (process.env.OTP_PROVIDER_URL) {
    const response = await fetch(process.env.OTP_PROVIDER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, destination, otp }) });
    if (!response.ok) throw new Error('OTP provider rejected the request');
  } else {
    console.log(`[OTP:${channel}] ${destination}: ${otp}`);
  }
}

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
  sessions.set(token, { userId: user.id, username: user.username, email: user.email, mobile: user.mobile, name: user.name, companyId: user.companyId, role: user.role || 'admin', permissions: user.permissions || [] });
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

function serveFile(req, res, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.resolve(ROOT, requested);
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return sendJson(res, 404, { error: 'File not found' });
  }
  const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml' };
  res.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  if (url.pathname === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, service: 'servicedesk-api', time: new Date().toISOString() });
  }

  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    const session = getSession(req);
    return sendJson(res, 200, { authenticated: Boolean(session), user: session || null });
  }

  if (url.pathname === '/api/auth/request-otp' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const email = normalizeEmail(body.email);
      const mobile = normalizeMobile(body.mobile);
      const companyName = String(body.companyName || '').trim().slice(0, 120);
      if (!validEmail(email)) return sendJson(res, 400, { error: 'Please enter a valid email address.' });
      if (!validMobile(mobile)) return sendJson(res, 400, { error: 'Enter a valid mobile number with country code, for example +919876543210.' });
      const challengeId = crypto.randomUUID();
      const emailOtp = createOtp();
      const mobileOtp = createOtp();
      otpChallenges.set(challengeId, { email, mobile, emailOtp, mobileOtp, emailVerified: false, mobileVerified: false, expiresAt: Date.now() + 10 * 60 * 1000, attempts: 0 });
      await Promise.all([deliverOtp('email', email, emailOtp), deliverOtp('sms', mobile, mobileOtp)]);
      const response = { challengeId, expiresInSeconds: 600, message: 'Verification codes sent to your email and mobile.' };
      if (process.env.NODE_ENV !== 'production') { response.emailOtp = emailOtp; response.mobileOtp = mobileOtp; }
      return sendJson(res, 200, response);
    } catch { return sendJson(res, 502, { error: 'Unable to send verification codes.' }); }
  }

  if (url.pathname === '/api/auth/verify-otp' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const challenge = otpChallenges.get(String(body.challengeId || ''));
      const channel = body.channel === 'mobile' ? 'mobile' : 'email';
      if (!challenge || challenge.expiresAt < Date.now()) return sendJson(res, 400, { error: 'This verification session has expired. Request new codes.' });
      if (challenge.attempts >= 5) return sendJson(res, 429, { error: 'Too many incorrect attempts. Request new codes.' });
      challenge.attempts += 1;
      const expected = channel === 'email' ? challenge.emailOtp : challenge.mobileOtp;
      if (String(body.otp || '').trim() !== expected) return sendJson(res, 400, { error: `Incorrect ${channel} OTP.` });
      if (channel === 'email') challenge.emailVerified = true;
      else challenge.mobileVerified = true;
      return sendJson(res, 200, { verified: true, channel, emailVerified: challenge.emailVerified, mobileVerified: challenge.mobileVerified });
    } catch { return sendJson(res, 400, { error: 'Unable to verify OTP.' }); }
  }

  if (url.pathname === '/api/auth/register' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const email = normalizeEmail(body.email);
      const mobile = normalizeMobile(body.mobile);
      const password = String(body.password || '');
      const confirmPassword = String(body.confirmPassword || '');
      const username = String(body.username || '').trim().toLowerCase();
      const name = String(body.name || username || email.split('@')[0]).trim().slice(0, 80);
      if (!validEmail(email)) return sendJson(res, 400, { error: 'Please enter a valid email address.' });
      if (!validMobile(mobile)) return sendJson(res, 400, { error: 'Please enter a valid mobile number.' });
      if (companyName.length < 2) return sendJson(res, 400, { error: 'Please enter your company name.' });
      if (!/^[a-z0-9_.-]{3,30}$/.test(username)) return sendJson(res, 400, { error: 'Username must be 3-30 characters using letters, numbers, dot, dash, or underscore.' });
      if (password.length < 8) return sendJson(res, 400, { error: 'Password must be at least 8 characters.' });
      if (password !== confirmPassword) return sendJson(res, 400, { error: 'Passwords do not match.' });
      const challenge = otpChallenges.get(String(body.challengeId || ''));
      if (!challenge || challenge.expiresAt < Date.now() || challenge.email !== email || challenge.mobile !== mobile || !challenge.emailVerified || !challenge.mobileVerified) return sendJson(res, 400, { error: 'Verify both your email and mobile number with OTP before creating the account.' });
      const users = readUsers();
      if (users.some((user) => user.email === email)) return sendJson(res, 409, { error: 'An account with this email already exists.' });
      if (users.some((user) => user.username === username)) return sendJson(res, 409, { error: 'That username is already taken.' });
      if (users.some((user) => user.mobile === mobile)) return sendJson(res, 409, { error: 'That mobile number is already registered.' });
      const userId = crypto.randomUUID();
      const companyId = crypto.randomUUID();
      const registrationId = `CMP-${crypto.randomInt(100000, 1000000)}`;
      const user = { id: userId, username, email, mobile, name, companyId, role: 'admin', status: 'active', emailVerified: true, mobileVerified: true, passwordHash: await hashPassword(password), createdAt: new Date().toISOString() };
      const companies = readCompanies();
      companies.push({ id: companyId, registrationId, name: companyName, adminUserId: userId, createdAt: new Date().toISOString() });
      users.push(user);
      writeUsers(users);
      writeCompanies(companies);
      otpChallenges.delete(String(body.challengeId));
      setSession(res, user);
      return sendJson(res, 201, { user: publicUser(user), company: companies.at(-1) });
    } catch { return sendJson(res, 400, { error: 'Unable to create account.' }); }
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const identifier = String(body.identifier || '').trim().toLowerCase();
      const user = readUsers().find((item) => item.email === identifier || item.username === identifier);
      if (!user || !(await verifyPassword(String(body.password || ''), user.passwordHash))) return sendJson(res, 401, { error: 'Email or password is incorrect.' });
       if (user.status === 'inactive') return sendJson(res, 403, { error: 'This user account is inactive. Contact your company admin.' });
      setSession(res, user);
       return sendJson(res, 200, { user: publicUser(user) });
    } catch { return sendJson(res, 400, { error: 'Unable to sign in.' }); }
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    clearSession(req, res);
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === '/api/iam/company' && req.method === 'GET') {
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: 'AUTH_REQUIRED' });
    const company = readCompanies().find((item) => item.id === session.companyId);
    return company ? sendJson(res, 200, { company }) : sendJson(res, 404, { error: 'Company not found' });
  }

  if (url.pathname === '/api/iam/permissions' && req.method === 'GET') {
    if (!getSession(req)) return sendJson(res, 401, { error: 'AUTH_REQUIRED' });
    return sendJson(res, 200, { permissions: IAM_PERMISSIONS });
  }

  if (url.pathname === '/api/iam/users' && req.method === 'GET') {
    const session = getSession(req);
    if (!isAdmin(session)) return sendJson(res, 403, { error: 'ADMIN_REQUIRED' });
    const users = readUsers().filter((user) => user.companyId === session.companyId);
    return sendJson(res, 200, { users: users.map(publicUser) });
  }

  if (url.pathname === '/api/iam/users' && req.method === 'POST') {
    const session = getSession(req);
    if (!isAdmin(session)) return sendJson(res, 403, { error: 'ADMIN_REQUIRED' });
    try {
      const body = await readBody(req);
      const email = normalizeEmail(body.email);
      const mobile = normalizeMobile(body.mobile);
      const name = String(body.name || '').trim().slice(0, 80);
      const username = String(body.username || '').trim().toLowerCase();
      const role = ['user', 'manager', 'viewer'].includes(body.role) ? body.role : 'user';
      const password = String(body.password || '');
      const permissions = Array.isArray(body.permissions) ? [...new Set(body.permissions.filter((permission) => IAM_PERMISSIONS.some((item) => item.id === permission)))] : [];
      if (!name || !/^[a-z0-9_.-]{3,30}$/.test(username) || password.length < 8) return sendJson(res, 400, { error: 'Enter a valid name, username, and password (8+ characters).' });
      const users = readUsers();
      if (email && users.some((user) => user.email === email)) return sendJson(res, 409, { error: 'That email is already registered.' });
      if (users.some((user) => user.username === username)) return sendJson(res, 409, { error: 'That username is already taken.' });
      if (mobile && users.some((user) => user.mobile === mobile)) return sendJson(res, 409, { error: 'That mobile number is already registered.' });
      const user = { id: crypto.randomUUID(), username, email: email || null, mobile: mobile || null, name, companyId: session.companyId, role, permissions, status: 'active', createdBy: session.userId, emailVerified: false, mobileVerified: false, passwordHash: await hashPassword(password), createdAt: new Date().toISOString() };
      users.push(user);
      writeUsers(users);
      return sendJson(res, 201, { user: publicUser(user) });
    } catch { return sendJson(res, 400, { error: 'Unable to create user.' }); }
  }

  const iamUserMatch = url.pathname.match(/^\/api\/iam\/users\/([^/]+)$/);
  if (iamUserMatch && req.method === 'PATCH') {
    const session = getSession(req);
    if (!isAdmin(session)) return sendJson(res, 403, { error: 'ADMIN_REQUIRED' });
    const users = readUsers();
    const user = users.find((item) => item.id === iamUserMatch[1] && item.companyId === session.companyId);
    if (!user) return sendJson(res, 404, { error: 'User not found' });
    if (user.id === session.userId) return sendJson(res, 400, { error: 'The company admin cannot deactivate or change their own role.' });
    try {
      const body = await readBody(req);
      if (body.role && ['user', 'manager', 'viewer'].includes(body.role)) user.role = body.role;
      if (body.status && ['active', 'inactive'].includes(body.status)) user.status = body.status;
      if (Array.isArray(body.permissions)) user.permissions = [...new Set(body.permissions.filter((permission) => IAM_PERMISSIONS.some((item) => item.id === permission)))];
      writeUsers(users);
      return sendJson(res, 200, { user: publicUser(user) });
    } catch { return sendJson(res, 400, { error: 'Unable to update user.' }); }
  }


  if (url.pathname === '/api/services' && req.method === 'GET') {
    return sendJson(res, 200, { services });
  }

  if (url.pathname === '/api/activity' && req.method === 'GET') {
    return sendJson(res, 200, { activity });
  }

  const launchMatch = url.pathname.match(/^\/api\/services\/([^/]+)\/launch$/);
  if (launchMatch && req.method === 'POST') {
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: 'AUTH_REQUIRED' });
    const service = services.find((item) => item.id === launchMatch[1]);
    if (!service) return sendJson(res, 404, { error: 'Service not found' });
    if (!canLaunchService(session, service.id)) return sendJson(res, 403, { error: 'PERMISSION_REQUIRED', message: 'Your company admin has not granted access to this service.' });

    const event = { serviceId: service.id, serviceName: service.name, openedAt: new Date().toISOString() };
    activity.unshift(event);
    return sendJson(res, 200, { ok: true, message: `${service.name} is ready to open in your web browser.`, browserUrl: `/browser/${service.id}`, service, event });
  }

  const browserServiceMatch = url.pathname.match(/^\/browser\/([^/]+)$/);
  if (browserServiceMatch && req.method === 'GET') {
    const service = services.find((item) => item.id === browserServiceMatch[1]);
    if (!service) return sendJson(res, 404, { error: 'Service not found' });
    if (service.id === 'warehouse-management') return serveFile(req, res, '/warehouse.html');
     if (['finance-accounting', 'purchasing', 'sales', 'inventory-management', 'banking', 'production', 'human-resources', 'crm'].includes(service.id)) return serveFile(req, res, '/business.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><html><head><meta name="viewport" content="width=1280"><title>${service.name} | servicedesk</title><style>*{box-sizing:border-box}body{margin:0;min-width:1100px;background:#fbfbfc;color:#252332;font:14px Arial,sans-serif}.top{height:72px;background:#fff;border-bottom:1px solid #e9e8ee;display:flex;align-items:center;justify-content:space-between;padding:0 7%}.brand{font-weight:bold;font-size:18px;color:#252332}.brand b{display:inline-grid;place-items:center;background:#5b45e5;color:#fff;border-radius:8px;width:29px;height:29px;margin-right:8px}.user{color:#777481;font-size:12px}.layout{max-width:1050px;margin:65px auto;padding:0 25px}.eyebrow{color:#a19fa9;font-size:10px;font-weight:bold;letter-spacing:1.7px}.layout h1{font-size:34px;margin:13px 0 10px}.sub{color:#92909c;font-size:14px}.panel{margin-top:35px;background:#fff;border:1px solid #e9e8ee;border-radius:15px;padding:30px;display:grid;grid-template-columns:1fr 1fr;gap:25px}.metric{background:#f8f7ff;border-radius:12px;padding:22px}.metric strong{font-size:28px;display:block;margin:12px 0 4px}.metric span{color:#9996a5;font-size:12px}.back{display:inline-block;margin-top:28px;color:#5b45e5;text-decoration:none;font-weight:bold;font-size:13px}</style></head><body><header class="top"><div class="brand"><b>S</b>servicedesk</div><div class="user">Desktop site mode · ${service.name}</div></header><main class="layout"><span class="eyebrow">DESKTOP SERVICE</span><h1>${service.name}</h1><p class="sub">${service.description}</p><section class="panel"><div class="metric"><span>Workspace status</span><strong>Ready</strong><span>Your service is open in desktop site mode.</span></div><div class="metric"><span>Access</span><strong>Active</strong><span>Continue using this browser tab for the full experience.</span></div></section><a class="back" href="/">← Back to servicedesk</a></main></body></html>`);
  }

  if (req.method === 'GET') return serveFile(req, res, url.pathname);
  return sendJson(res, 404, { error: 'Route not found' });
});

server.listen(PORT, () => console.log(`ServiceDesk API running at http://localhost:${PORT}`));
