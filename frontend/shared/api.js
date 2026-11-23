// Тонкий шар над fetch для виклику API.
async function request(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined && body !== null) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  return parseResponse(res);
}

export async function apiPostForm(path, formData) {
  const res = await fetch(path, { method: "POST", body: formData });
  return parseResponse(res);
}

async function parseResponse(res) {
  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const detail = data && data.detail ? data.detail : `Помилка ${res.status}`;
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const apiGet = (path) => request("GET", path);
export const apiPost = (path, body) => request("POST", path, body);
export const apiPatch = (path, body) => request("PATCH", path, body);
export const apiDelete = (path) => request("DELETE", path);
