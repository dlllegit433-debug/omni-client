const BASE_URL = 'https://omnii.duckdns.org:3000'

let _token = null

export function setToken(t) { _token = t }
export function getToken() { return _token }

export async function api(method, path, opts = {}) {
  const { token, json, form, params } = opts
  const headers = { 'X-Client-Version': '3.0.0' }
  const tok = token ?? _token
  if (tok) headers['Authorization'] = `Bearer ${tok}`

  let url = BASE_URL + path
  if (params) {
    const q = new URLSearchParams(params)
    url += '?' + q.toString()
  }

  const fetchOpts = { method, headers }

  if (json !== undefined) {
    headers['Content-Type'] = 'application/json'
    fetchOpts.body = JSON.stringify(json)
  }
  if (form) {
    fetchOpts.body = form
  }

  const res = await fetch(url, fetchOpts)
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

export const get  = (path, opts) => api('GET',    path, opts)
export const post = (path, opts) => api('POST',   path, opts)
export const put  = (path, opts) => api('PUT',    path, opts)
export const patch= (path, opts) => api('PATCH',  path, opts)
export const del  = (path, opts) => api('DELETE', path, opts)
