import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const COOKIE = '__Host-admin_access';
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const clearCookie = () => res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).end();
  }
  // Mutation requests must originate from this host; never enable CORS here.
  if (req.method !== 'GET') {
    let origin;
    try { origin = new URL(req.headers.origin).host; } catch { /* missing origin */ }
    if (!origin || origin !== req.headers.host) return res.status(403).json({ error: 'Доступ запрещён.' });
  }
  if (req.method === 'DELETE') { clearCookie(); return res.status(204).end(); }
  const token = req.method === 'POST'
    ? /^Bearer ([A-Za-z0-9._-]+)$/.exec(req.headers.authorization || '')?.[1]
    : (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const deny = (status, message) => {
    clearCookie();
    if (req.method !== 'GET') return res.status(status).json({ error: message });
    return res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8').end(`<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Административный раздел</title><body style="font-family:system-ui;background:#f6f7fb;color:#202640;padding:24px;max-width:600px;margin:auto"><h1>${message}</h1><p>Войдите в закреплённый аккаунт администратора на главной странице и откройте раздел «Админ».</p><a href="/">На главную</a></body></html>`);
  };
  if (!token || token.length > 8192) return deny(401, 'Требуется вход');
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return deny(503, 'Проверка доступа временно недоступна');
  try {
    const client = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` }, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10000) }) }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await client.auth.getUser(token);
    if (authError && (!authError.status || authError.status >= 500)) return deny(503, 'Проверка доступа временно недоступна');
    if (authError || !user) return deny(401, 'Сессия истекла');
    const { data, error } = await client.rpc('is_current_user_admin');
    if (error) return deny(503, 'Не удалось проверить доступ');
    if (data !== true) return deny(403, 'Доступ запрещён');
    if (req.method === 'POST') {
      res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=300`);
      return res.status(204).end();
    }
    const html = await readFile(join(process.cwd(), 'dist', 'index.html'), 'utf8');
    return res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').end(html);
  } catch { return deny(503, 'Проверка доступа временно недоступна'); }
}
