const TOKEN_KEY = 'nw_token';
const USER_KEY  = 'nw_user';

export function getToken()  { return localStorage.getItem(TOKEN_KEY) || ''; }
export function getUser()   {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
  catch { return null; }
}
export function setAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
export function isLoggedIn() { return !!getToken(); }

export function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getToken()}`,
  };
}

/** fetch wrapper — redirects to /login on 401 */
export async function apiFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  if (res.status === 401) {
    clearAuth();
    window.location.replace('/login');
    throw new Error('Session expired — please log in again');
  }
  return res;
}
