function errorText(data) {
  if (!data) return '';
  if (typeof data.detail === 'string') return data.detail;
  if (Array.isArray(data.detail)) return data.detail.map((d) => d.msg).join('; ');
  return '';
}

/** fetch-обгортка: JSON у JSON, FormData як є, помилки як Error з українським текстом. */
export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: {} };
  if (form) {
    opts.body = form;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new Error('Немає звʼязку із сервером');
  }
  let data = null;
  try { data = await res.json(); } catch { /* порожня відповідь (204) */ }
  if (!res.ok) throw new Error(errorText(data) || `Помилка ${res.status}`);
  return data;
}
