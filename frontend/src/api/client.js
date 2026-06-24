async function post(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    let detail = r.statusText
    try { detail = (await r.json()).detail || detail } catch (e) { /* ignore */ }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return r.json()
}

async function get(path) {
  const r = await fetch(path)
  if (!r.ok) throw new Error('请求失败：' + r.status)
  return r.json()
}

async function put(path, body) {
  const r = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    let detail = r.statusText
    try { detail = (await r.json()).detail || detail } catch (e) { /* ignore */ }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return r.json()
}

async function del(path) {
  const r = await fetch(path, { method: 'DELETE' })
  if (!r.ok) {
    let detail = r.statusText
    try { detail = (await r.json()).detail || detail } catch (e) { /* ignore */ }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return r.json()
}

export const api = {
  scheduling: (b) => post('/api/scheduling/run', b),
  disk: (b) => post('/api/disk/run', b),
  diskSimulate: (b) => post('/api/disk/simulate', b),
  diskBenchmark: (b) => post('/api/disk/benchmark', b),
  paging: (b) => post('/api/paging/run', b),
  pagingTranslate: (b) => post('/api/paging/translate', b),
  bankerSafety: (b) => post('/api/banker/safety', b),
  bankerRequest: (b) => post('/api/banker/request', b),
  sync: (b) => post('/api/sync/run', b),
  presets: (m) => get('/api/presets/' + m),
  reportMarkdown: (trace) => post('/api/report/markdown', trace),
  saveScenario: (b) => post('/api/scenarios', b),
  listScenarios: (m) => get('/api/scenarios?module=' + m),
  deleteScenario: (sid) => del('/api/scenarios/' + sid),
  recordHistory: (b) => post('/api/history', b),
  getConfig: () => get('/api/config'),
  putConfig: (config) => put('/api/config', { config }),
  twinTick: (b) => post('/api/twin/tick', b),
}
