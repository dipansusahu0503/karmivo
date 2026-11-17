const deviceLabel = document.querySelector('#deviceLabel');
const serviceGrid = document.querySelector('.service-grid');
const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
let registerMode = false;

async function checkAuth() {
  try {
    const response = await fetch(`${API_BASE}/api/auth/me`);
    const data = await response.json();
    if (data.authenticated) showApp(data.user);
    else document.querySelector('.app-shell').style.display = 'none';
  } catch { document.querySelector('.app-shell').style.display = 'none'; showAuthError('Start the backend with npm start before signing in.'); }
}

function showApp(user) {
  document.querySelector('#authScreen').style.display = 'none';
  document.querySelector('.app-shell').style.display = 'flex';
  document.querySelector('.profile strong').textContent = user.name;
  document.querySelector('.profile small').textContent = user.email;
  document.querySelector('.top-avatar').textContent = user.name.slice(0, 2).toUpperCase();
  loadServices();
}

function showAuthError(message) { document.querySelector('#authError').textContent = message; }

document.querySelector('#authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  showAuthError('');
  const form = new FormData(event.currentTarget);
  const values = Object.fromEntries(form);
  if (registerMode) values.email = values.identifier;
  const endpoint = registerMode ? '/api/auth/register' : '/api/auth/login';
  const response = await fetch(`${API_BASE}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
  const data = await response.json();
  if (!response.ok) return showAuthError(data.error || 'Something went wrong.');
  showApp(data.user);
});

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
  document.querySelector('#switchPrompt').textContent = registerMode ? 'Already have an account?' : 'New to servicedesk?';
  document.querySelector('#switchMode').textContent = registerMode ? 'Sign in' : 'Create an account';
  document.querySelector('#password').autocomplete = registerMode ? 'new-password' : 'current-password';
});

document.querySelector('#logoutButton').addEventListener('click', async () => { await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST' }); window.location.reload(); });

function renderServices(services) {
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
    if (!response.ok) throw new Error(data.error || 'Unable to open service');
    window.location.href = `${API_BASE}${data.browserUrl}`;
  } catch (error) {
    alert('The backend is unavailable. Start the server with npm start and try again.');
  }
}

document.querySelector('.tip-banner button').addEventListener('click', (event) => event.currentTarget.parentElement.remove());

function updateDeviceLabel() {
  deviceLabel.textContent = 'Desktop web workspace';
}
checkAuth();
document.querySelector('#username').required = false;
document.querySelector('#confirmPassword').required = false;
