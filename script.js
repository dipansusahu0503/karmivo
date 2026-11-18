const deviceLabel = document.querySelector('#deviceLabel');
const serviceGrid = document.querySelector('.service-grid');
const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
let registerMode = false;
let currentUser = null;
let otpChallengeId = '';
let emailVerified = false;
let mobileVerified = false;

function setOtpStatus(message, error = false) {
  const status = document.querySelector('#otpStatus');
  status.textContent = message;
  status.style.color = error ? '#c44b55' : '#27865e';
}

async function requestOtps() {
  const email = document.querySelector('#identifier').value.trim();
  const mobile = document.querySelector('#mobile').value.trim();
  setOtpStatus('Sending verification codes...');
  const response = await fetch(`${API_BASE}/api/auth/request-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, mobile }) });
  const data = await response.json();
  if (!response.ok) return setOtpStatus(data.error || 'Unable to send OTPs.', true);
  otpChallengeId = data.challengeId;
  emailVerified = false;
  mobileVerified = false;
  if (data.emailOtp && data.mobileOtp) setOtpStatus(`Development OTPs — email: ${data.emailOtp}, mobile: ${data.mobileOtp}`);
  else setOtpStatus(data.message);
}

async function verifyOtp(channel) {
  const otp = document.querySelector(channel === 'email' ? '#emailOtp' : '#mobileOtp').value.trim();
  if (!otpChallengeId) return setOtpStatus('Send OTPs first.', true);
  const response = await fetch(`${API_BASE}/api/auth/verify-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challengeId: otpChallengeId, channel, otp }) });
  const data = await response.json();
  if (!response.ok) return setOtpStatus(data.error || 'OTP verification failed.', true);
  emailVerified = data.emailVerified;
  mobileVerified = data.mobileVerified;
  setOtpStatus(`${channel === 'email' ? 'Email' : 'Mobile'} verified. ${emailVerified && mobileVerified ? 'Both contacts are verified.' : 'Verify the other contact too.'}`);
}

async function checkAuth() {
  try {
    const response = await fetch(`${API_BASE}/api/auth/me`);
    const data = await response.json();
    if (data.authenticated) showApp(data.user);
    else document.querySelector('.app-shell').style.display = 'none';
  } catch { document.querySelector('.app-shell').style.display = 'none'; showAuthError('Start the backend with npm start before signing in.'); }
}

function showApp(user) {
  currentUser = user;
  document.querySelector('#authScreen').style.display = 'none';
  document.querySelector('.app-shell').style.display = 'flex';
  document.querySelector('.profile strong').textContent = user.name;
  document.querySelector('.profile small').textContent = user.email;
  document.querySelector('.top-avatar').textContent = user.name.slice(0, 2).toUpperCase();
  const iamNav = document.querySelector('#iamNav');
  iamNav.hidden = user.role !== 'admin';
  if (user.role === 'admin') loadIAM();
  loadServices();
}

function showAuthError(message) { document.querySelector('#authError').textContent = message; }

function renderIAMUsers(users) {
  const container = document.querySelector('#iamUsers');
  container.innerHTML = users.map((user) => `<div class="iam-user"><span><strong>${user.name}</strong><small>${user.email || 'No email'} · ${user.username} · ${user.status} · ${(user.permissions || []).length} privileges</small></span><span><select data-role-id="${user.id}"><option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option><option value="manager" ${user.role === 'manager' ? 'selected' : ''}>Manager</option><option value="viewer" ${user.role === 'viewer' ? 'selected' : ''}>Viewer</option></select><button type="button" data-status-id="${user.id}" data-status="${user.status}">${user.status === 'active' ? 'Deactivate' : 'Activate'}</button></span></div>`).join('') || '<p>No users created yet.</p>';
  container.querySelectorAll('[data-role-id]').forEach((select) => select.addEventListener('change', () => updateIAMUser(select.dataset.roleId, { role: select.value })));
  container.querySelectorAll('[data-status-id]').forEach((button) => button.addEventListener('click', () => updateIAMUser(button.dataset.statusId, { status: button.dataset.status === 'active' ? 'inactive' : 'active' })));
}

function renderIAMPermissions(permissions) {
  document.querySelector('#iamPermissions').innerHTML = permissions.map((permission) => `<label class="permission-option"><input type="checkbox" name="permissions" value="${permission.id}"><span>${permission.label}</span></label>`).join('');
}

async function loadIAM() {
  const [companyResponse, usersResponse, permissionsResponse] = await Promise.all([fetch(`${API_BASE}/api/iam/company`), fetch(`${API_BASE}/api/iam/users`), fetch(`${API_BASE}/api/iam/permissions`)]);
  if (!companyResponse.ok || !usersResponse.ok || !permissionsResponse.ok) return;
  const company = (await companyResponse.json()).company;
  const users = (await usersResponse.json()).users;
  renderIAMPermissions((await permissionsResponse.json()).permissions);
  document.querySelector('#companyIdentity').textContent = `${company.name} · Registration ID: ${company.registrationId}`;
  renderIAMUsers(users);
}

async function updateIAMUser(id, changes) {
  const response = await fetch(`${API_BASE}/api/iam/users/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) });
  const data = await response.json();
  if (!response.ok) return showAuthError(data.error || 'Unable to update user.');
  loadIAM();
}

document.querySelector('#authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  showAuthError('');
  const form = new FormData(event.currentTarget);
  const values = Object.fromEntries(form);
  if (registerMode) {
    values.email = values.identifier;
    values.challengeId = otpChallengeId;
    if (!emailVerified || !mobileVerified) return showAuthError('Verify both your email and mobile number with OTP first.');
  }
  const endpoint = registerMode ? '/api/auth/register' : '/api/auth/login';
  const response = await fetch(`${API_BASE}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
  const data = await response.json();
  if (!response.ok) return showAuthError(data.error || 'Something went wrong.');
  showApp(data.user);
});

document.querySelector('#sendOtp').addEventListener('click', requestOtps);
document.querySelector('#verifyEmailOtp').addEventListener('click', () => verifyOtp('email'));
document.querySelector('#verifyMobileOtp').addEventListener('click', () => verifyOtp('mobile'));

document.querySelector('#switchMode').addEventListener('click', () => {
  registerMode = !registerMode;
  document.querySelectorAll('.register-only').forEach((element) => { element.hidden = !registerMode; });
  document.querySelector('#authTitle').textContent = registerMode ? 'Create your account' : 'Welcome back';
  document.querySelector('#authSubtitle').textContent = registerMode ? 'Set up your account to access every service.' : 'Sign in to access all your services in one place.';
  document.querySelector('#authSubmit').innerHTML = registerMode ? 'Create account <span>→</span>' : 'Sign in <span>→</span>';
  document.querySelector('#identifierLabel').textContent = registerMode ? 'Personal email address' : 'Username or email';
  document.querySelector('#identifier').placeholder = registerMode ? 'you@gmail.com' : 'dipansu.sahu or you@gmail.com';
  document.querySelector('#passwordLabel').textContent = registerMode ? 'Create password' : 'Password';
  document.querySelector('#username').required = registerMode;
  document.querySelector('#confirmPassword').required = registerMode;
  document.querySelector('#companyName').required = registerMode;
  document.querySelector('#mobile').required = registerMode;
  otpChallengeId = '';
  emailVerified = false;
  mobileVerified = false;
  document.querySelector('#emailOtp').value = '';
  document.querySelector('#mobileOtp').value = '';
  setOtpStatus('');
  document.querySelector('#switchPrompt').textContent = registerMode ? 'Already have an account?' : 'New to servicedesk?';
  document.querySelector('#switchMode').textContent = registerMode ? 'Sign in' : 'Create an account';
  document.querySelector('#password').autocomplete = registerMode ? 'new-password' : 'current-password';
});

document.querySelector('#logoutButton').addEventListener('click', async () => { await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST' }); window.location.reload(); });

document.querySelector('#iamUserForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const values = Object.fromEntries(form);
  values.permissions = form.getAll('permissions');
  const response = await fetch(`${API_BASE}/api/iam/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
  const data = await response.json();
  document.querySelector('#iamError').textContent = response.ok ? `User ${data.user.username} created successfully.` : (data.error || 'Unable to create user.');
  if (response.ok) { event.currentTarget.reset(); loadIAM(); }
});

document.querySelector('#iamNav').addEventListener('click', () => { document.querySelector('#iam').hidden = false; loadIAM(); });

function renderServices(services) {
  if (currentUser && currentUser.role !== 'admin') {
    const permissions = currentUser.permissions || [];
    const access = {
      'warehouse-management': ['warehouse.inward', 'warehouse.quality', 'warehouse.putaway', 'warehouse.inventory', 'warehouse.dispatch'],
      'inventory-management': ['inventory.view', 'inventory.adjust'],
      purchasing: ['purchasing.manage'], sales: ['sales.manage'], crm: ['crm.manage'],
      'finance-accounting': ['finance.view'], banking: ['finance.view'], production: ['inventory.view'], 'human-resources': ['hr.manage']
    };
    services = services.filter((service) => (access[service.id] || []).some((permission) => permissions.includes(permission)));
  }
  serviceGrid.innerHTML = services.map((service) => `
    <article class="service-card" data-service-id="${service.id}" data-platform="${service.platform}">
      <div class="card-top"><span class="service-icon ${service.color}">${service.icon}</span><span class="platform-badge desktop-badge">▣ Web service</span></div>
      <div class="card-body"><h3>${service.name}</h3><p>${service.description}</p></div>
      <div class="card-footer"><span class="available">● Ready to use</span><button class="launch-button" data-service-id="${service.id}">Open service <span>↗</span></button></div>
    </article>`).join('');
  serviceGrid.querySelectorAll('.launch-button').forEach((button) => button.addEventListener('click', () => launchService(button.dataset.serviceId)));
  serviceGrid.querySelectorAll('.platform-badge').forEach((badge) => { badge.textContent = '▣ Web service'; });
}

async function loadServices() {
  deviceLabel.textContent = 'Desktop web workspace';
  try {
    const response = await fetch(`${API_BASE}/api/services`);
    if (!response.ok) throw new Error('Unable to load services');
    const data = await response.json();
    renderServices(data.services);
  } catch (error) {
    serviceGrid.innerHTML = '<p class="api-error">Backend is not running. Start it with <code>npm start</code> to load services.</p>';
  }
}

async function launchService(id) {
  try {
    const response = await fetch(`${API_BASE}/api/services/${id}/launch`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || 'Unable to open service');
    window.location.href = `${API_BASE}${data.browserUrl}`;
  } catch (error) {
    alert(error.message || 'The backend is unavailable. Start the server with npm start and try again.');
  }
}

document.querySelector('.tip-banner button').addEventListener('click', (event) => event.currentTarget.parentElement.remove());

function updateDeviceLabel() {
  deviceLabel.textContent = 'Desktop web workspace';
}
checkAuth();
document.querySelector('#username').required = false;
document.querySelector('#confirmPassword').required = false;
document.querySelector('#companyName').required = false;
document.querySelector('#mobile').required = false;
