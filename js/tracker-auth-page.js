// ============================================
//  tracker-auth-page.js
//  Login/Register page logic for tracker-login.html
//  On success: redirects to expense-tracker.html
// ============================================

const AUTH_TOKEN_KEY = 'auth_token';
const AUTH_USER_KEY  = 'auth_username';

function setAuthToken(token, username) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, username);
}

let _csrfToken = null;
async function fetchCsrfToken() {
  if (_csrfToken) return _csrfToken;
  try {
    const r = await fetch('/api/api?action=token');
    const data = await r.json();
    if (data.token) _csrfToken = data.token;
    return _csrfToken;
  } catch (e) {
    return null;
  }
}

// --- If already logged in, bounce straight to dashboard ---
(function checkAlreadyLoggedIn() {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) return;
  fetch('/api/api?action=status', {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
  })
    .then(r => r.json())
    .then(data => {
      if (data && data.logged_in) {
        window.location.replace('./expense-tracker.html');
      }
    })
    .catch(() => {});
})();

// --- DOM refs ---
const authTitle           = document.getElementById('authTitle');
const authForm            = document.getElementById('authForm');
const authUsername        = document.getElementById('authUsername');
const authPassword        = document.getElementById('authPassword');
const authError           = document.getElementById('authError');
const authSubmitBtn       = document.getElementById('authSubmitBtn');
const authToggleBtn       = document.getElementById('authToggleBtn');
const authToggleText      = document.getElementById('authToggleText');
const authPasswordToggle  = document.getElementById('authPasswordToggle');
const authCard            = document.getElementById('authCard');
const authSuccessCard     = document.getElementById('authSuccessCard');
const authSuccessCountdown = document.getElementById('authSuccessCountdown');

let isRegisterMode = false;
let lastAuthTime = 0;

// --- Toggle login ↔ register ---
authToggleBtn.addEventListener('click', () => {
  isRegisterMode = !isRegisterMode;
  authTitle.textContent      = isRegisterMode ? 'Create Account'           : 'Login to Tracker';
  authSubmitBtn.textContent  = isRegisterMode ? 'Register'                 : 'Login';
  authToggleText.textContent = isRegisterMode ? 'Already have an account?' : "Don't have an account?";
  authToggleBtn.textContent  = isRegisterMode ? 'Login'                    : 'Register';
  authError.style.display = 'none';
  authPassword.setAttribute('autocomplete', isRegisterMode ? 'new-password' : 'current-password');
});

// --- Password visibility toggle ---
if (authPasswordToggle) {
  authPasswordToggle.addEventListener('click', () => {
    const isHidden = authPassword.getAttribute('type') === 'password';
    authPassword.setAttribute('type', isHidden ? 'text' : 'password');
    authPasswordToggle.innerHTML = isHidden
      ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
           <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
           <line x1="1" y1="1" x2="23" y2="23"></line>
         </svg>`
      : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
           <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
           <circle cx="12" cy="12" r="3"></circle>
         </svg>`;
  });
}

// --- Form submit ---
authForm.onsubmit = async (e) => {
  e.preventDefault();
  const action = isRegisterMode ? 'register' : 'login';
  authError.style.display = 'none';

  const now = Date.now();
  const waitSecs = Math.ceil((5000 - (now - lastAuthTime)) / 1000);
  if (waitSecs > 0) {
    authError.textContent = `Please wait ${waitSecs}s before trying again.`;
    authError.style.display = 'block';
    return;
  }
  lastAuthTime = now;

  authSubmitBtn.disabled = true;
  const originalText = authSubmitBtn.textContent;
  authSubmitBtn.textContent = 'Processing\u2026';

  try {
    const token = await fetchCsrfToken();
    const res = await fetch(`/api/api?action=${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({ username: authUsername.value, password: authPassword.value })
    });
    const data = await res.json();

    if (data.error) {
      authError.textContent = data.error;
      authError.style.display = 'block';
      return;
    }

    if (isRegisterMode) {
      // Show success card, auto-login, then redirect
      authCard.style.display = 'none';
      authSuccessCard.style.display = 'block';
      let secs = 3;
      const tick = setInterval(async () => {
        secs--;
        if (authSuccessCountdown) authSuccessCountdown.textContent = `Redirecting in ${secs}s`;
        if (secs <= 0) {
          clearInterval(tick);
          try {
            const csrf2 = await fetchCsrfToken();
            const loginRes = await fetch('/api/api?action=login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf2 },
              body: JSON.stringify({ username: authUsername.value, password: authPassword.value })
            });
            const loginData = await loginRes.json();
            if (loginData.token) setAuthToken(loginData.token, loginData.username);
          } catch (_) {}
          window.location.replace('./expense-tracker.html');
        }
      }, 1000);
    } else {
      if (data.token) setAuthToken(data.token, data.username);
      window.location.replace('./expense-tracker.html');
    }
  } catch (err) {
    authError.textContent = err.message || 'Connection failed. Is the server running?';
    authError.style.display = 'block';
  } finally {
    authSubmitBtn.disabled = false;
    authSubmitBtn.textContent = originalText;
  }
};
