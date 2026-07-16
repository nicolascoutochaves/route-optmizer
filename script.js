// ============================================================================
// CONFIGURAÇÃO
// ============================================================================
const START_END = 'Rua Barão do Guaíba, 781, Porto Alegre, RS, Brasil';
const STORAGE_KEY = 'roteiros_kml_data';
const CUSTOM_LS_KEY = 'roteiros_custom_saved';
const CUSTOM_ROUTE_PREFIX = '✏️ ';
const FSA_DB_NAME = 'roteiros_fsa', FSA_DB_VER = 1, FSA_STORE = 'handles', FSA_KEY = 'json_handle';

let startCoord = null;
let routes = {};
let currentRoute = null;
let currentRouteKey = '';
let points = [];
let links = [];
let selectedIdx = -1;
let exportSelection = new Set(); // nomes dos roteiros marcados para exportação
let geocodeDone = false;
let isOptimized = false;
let optimizedStops = [];
let currentLongUrl = '';
let currentShortUrl = '';
let loadedFileNames = [];

// Custom panel state
let customSelection = [];
let panelCurrentRoute = null;
let customPanelGeocodeDone = false;
let customOptimizedStops = [];
let customCurrentLink = '';
let savedCustomRoutes = [];

// Edit panel state (cópia de trabalho dos pontos do roteiro selecionado)
let editDraftPoints = [];

// ============================================================================
// UTILITIES
// ============================================================================
const escXML = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const titleCasePt = s => (s || '').toLowerCase().replace(/(^|[\s-])([a-zà-ÿ])/g, (m, sep, ch) => sep + ch.toUpperCase());

const formatAddr = raw => {
  let s = (raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  s = s.replace(/\s+Porto Alegre\s*$/i, '').replace(/\s+RS\s*$/i, '').replace(/\s+Brasil\s*$/i, '').replace(/\s+Viamão\s*$/i, '');
  const m = s.match(/^(.+?)\s+(\d+[A-Za-z]?(?:\/\d+)?|S\/?N)\s*(.*)$/i);
  if (m) {
    let out = titleCasePt(m[1].trim()) + ', ' + m[2].trim();
    if (m[3].trim()) out += ', ' + titleCasePt(m[3].trim());
    return out + ', Porto Alegre, RS, Brasil';
  }
  return titleCasePt(s) + ', Porto Alegre, RS, Brasil';
};

const showToast = (message, type = 'success') => {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideInUp 0.3s ease-out reverse';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
};

const showSuccessMessage = message => {
  const c = document.getElementById('success-message');
  c.innerHTML = `<div class="success-box">${message}</div>`;
  setTimeout(() => c.innerHTML = '', 3000);
};

const generateQRCode = (url, containerId) => {
  const c = document.getElementById(containerId);
  c.innerHTML = '';
  return new QRCode(c, { text: url, width: 200, height: 200, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H });
};

const shortenUrl = async longUrl => {
  const eps = [
    `https://is.gd/create.php?format=simple&url=${encodeURIComponent(longUrl)}`,
    `https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`
  ];
  for (const ep of eps) {
    try {
      const res = await fetch(ep);
      if (!res.ok) continue;
      const t = (await res.text()).trim();
      if (t && /^https?:\/\//i.test(t)) return t;
    } catch (e) { }
  }
  return longUrl;
};

const updateShareLink = async stops => {
  currentLongUrl = buildGoogleMapsUrl(stops);
  currentShortUrl = await shortenUrl(currentLongUrl);
  links = [currentShortUrl];
  const lb = document.getElementById('lbox');
  lb.textContent = currentShortUrl;
  lb.classList.remove('hidden');
  generateQRCode(currentShortUrl, 'qrcode');
  document.getElementById('qr-section').classList.remove('hidden');
  return currentShortUrl;
};

// ============================================================================
// FILE SYSTEM ACCESS API — IndexedDB helpers (guarda o handle do JSON vinculado)
// ============================================================================
const openFSADB = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(FSA_DB_NAME, FSA_DB_VER);
  req.onupgradeneeded = e => e.target.result.createObjectStore(FSA_STORE);
  req.onsuccess = e => resolve(e.target.result);
  req.onerror = e => reject(e.target.error);
});

const fsaTx = async (mode, fn) => {
  const db = await openFSADB();
  return new Promise((resolve, reject) => {
    const store = db.transaction(FSA_STORE, mode).objectStore(FSA_STORE);
    const req = fn(store);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror = e => reject(e.target.error);
  });
};

const saveHandleToDB = handle => fsaTx('readwrite', store => store.put(handle, FSA_KEY));
const loadHandleFromDB = () => fsaTx('readonly', store => store.get(FSA_KEY)).catch(() => null);
const deleteHandleFromDB = () => fsaTx('readwrite', store => store.delete(FSA_KEY)).catch(() => { });

const verifyPermission = async (handle, interactive = false, mode = 'read') => {
  try {
    const opts = { mode };
    const state = await handle.queryPermission(opts);
    if (state === 'granted') return true;
    if (!interactive) return false;
    return (await handle.requestPermission(opts)) === 'granted';
  } catch { return false; }
};

/**
 * Aplica um JSON de roteiros já parseado ao estado da aplicação.
 * Usado tanto pelo fluxo principal (FSA handle) quanto pelo fallback (input file).
 * Lança erro se o JSON não tiver roteiros válidos.
 */
const applyLoadedRoutes = (parsed, msgSuffix, source = 'local') => {
  if (!parsed.routes || !Object.keys(parsed.routes).length) throw new Error('JSON sem roteiros válidos');
  dataSource = source; // 'local' (KML/JSON importado à mão) ou 'db' (Supabase)
  routes = parsed.routes;
  loadedFileNames = parsed.fileNames || [];
  saveToStorage();
  showSavedBar(parsed.savedAt || new Date().toISOString());
  renderLoadedFilesList(loadedFileNames);
  renderRouteButtons();
  updateJsonExportButtonState();
  updateDBToggleUI();
  document.getElementById('sec-routes').classList.remove('hidden');
  document.getElementById('fi-msg').textContent = `✓ ${Object.keys(routes).length} roteiro(s) carregados ${msgSuffix}`;
};

/** Lê e processa o arquivo apontado pelo handle (fluxo padrão). Retorna true em caso de sucesso. */
const readFromHandle = async handle => {
  try {
    const file = await handle.getFile();
    const p = JSON.parse(await file.text());
    applyLoadedRoutes(p, `de "${file.name}"`);
    updateFSABar(handle.name);
    return true;
  } catch (e) {
    console.warn('[FSA] Falha ao ler handle:', e);
    return false;
  }
};

/** Escreve o estado atual de `routes` de volta no arquivo JSON vinculado (se houver). */
const trySaveLinkedFile = async () => {
  try {
    const handle = await loadHandleFromDB();
    if (!handle) return false;
    const ok = await verifyPermission(handle, true, 'readwrite');
    if (!ok) { showToast('⚠️ Permissão de escrita negada para o arquivo vinculado.', 'error'); return false; }
    const writable = await handle.createWritable();
    const data = JSON.stringify({ savedAt: new Date().toISOString(), fileNames: loadedFileNames, routes }, null, 2);
    await writable.write(data);
    await writable.close();
    showToast('💾 Alterações salvas no arquivo vinculado', 'success');
    return true;
  } catch (e) {
    console.warn('[FSA] Falha ao salvar no handle:', e);
    return false;
  }
};

const updateFSABar = filename => {
  const bar = document.getElementById('fsa-bar');
  document.getElementById('fsa-filename').textContent = filename || '';
  bar.style.display = filename ? 'flex' : 'none';
};

document.getElementById('btn-fsa-link').onclick = async () => {
  setDBToggle(false); // importar manualmente sempre sai do modo "Carregar do Banco"
  if (!('showOpenFilePicker' in window)) {
    // Fallback: navegador sem suporte a File System Access API (Firefox, Safari).
    showToast('Seu navegador não suporta vínculo de arquivo. Importando em modo avulso…', 'info');
    document.getElementById('fi-json-fallback')?.click();
    return;
  }
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'JSON de roteiros', accept: { 'application/json': ['.json'] } }],
      multiple: false
    });
    await saveHandleToDB(handle);
    if (!(await verifyPermission(handle, true))) { showToast('Permissão negada', 'error'); return; }
    const ok = await readFromHandle(handle);
    showToast(ok ? '✓ JSON vinculado com sucesso' : 'Falha ao ler o arquivo', ok ? 'success' : 'error');
  } catch (e) {
    if (e.name !== 'AbortError') showToast('Erro: ' + e.message, 'error');
  }
};

document.getElementById('btn-fsa-reload').onclick = async () => {
  const handle = await loadHandleFromDB();
  if (!handle) { showToast('Nenhum arquivo vinculado', 'error'); return; }
  if (!(await verifyPermission(handle, true))) { showToast('Permissão negada', 'error'); return; }
  const ok = await readFromHandle(handle);
  showToast(ok ? '✓ Recarregado' : 'Falha ao recarregar', ok ? 'success' : 'error');
};

document.getElementById('btn-fsa-unlink').onclick = async () => {
  await deleteHandleFromDB();
  updateFSABar(null);
  showToast('🔌 Arquivo desvinculado', 'info');
};

// ============================================================================
// SUPABASE — auth + persistência de roteiros no banco (via Vercel Serverless
// Function, mesmo padrão já usado para o Mapbox em /api/request)
// ============================================================================
const SUPABASE_PROXY_URL = '/api/supabase'; // Vercel Serverless Function — ver api/supabase/[...path].js
const SUPABASE_SESSION_KEY = 'roteiros_supabase_session';
const DB_TOGGLE_KEY = 'roteiros_db_toggle';

let supabaseSession = null;  // { access_token, refresh_token, user, expires_at }
let isAuthorizedUser = false;
let canWriteDB = false;      // true só para authorized_users.can_write = true (RLS já bloqueia mesmo assim; isso só evita tentativas inúteis na UI)
let dataSource = 'local';    // 'local' (KML/JSON manual) | 'db' (Supabase)
let dbToggleOn = true;
let suppressDBSync = false;  // evita reescrever o banco logo após lê-lo

/** Chamada genérica ao proxy do Supabase (REST/Auth). Lança erro com mensagem legível em caso de falha. */
const supabaseRequest = async (path, { method = 'GET', body, headers = {}, auth = true } = {}) => {
  const finalHeaders = { ...headers };
  
  // SÓ adiciona Content-Type se houver um corpo (ex: POST, PUT, DELETE, PATCH)
  if (body !== undefined && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase())) {
    finalHeaders['Content-Type'] = 'application/json';
  }
  
  // Garante que o access_token realmente existe e é válido antes de injetar
  if (auth && supabaseSession?.access_token && supabaseSession.access_token !== 'undefined') {
    finalHeaders['Authorization'] = `Bearer ${supabaseSession.access_token}`;
  }
  
  let res;
  try {
    const fetchOptions = { 
      method, 
      headers: finalHeaders 
    };
    
    // Só anexa o body em requisições que aceitam body
    if (body !== undefined && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase())) {
      fetchOptions.body = JSON.stringify(body);
    }

    res = await fetch(`${SUPABASE_PROXY_URL}${path}`, fetchOptions);
  } catch (e) {
    throw new Error('Não foi possível contatar o servidor (proxy Supabase). Verifique sua conexão.');
  }
  
  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try { 
      const j = await res.json(); 
      msg = j.error_description || j.msg || j.message || msg; 
    } catch (e) { }
    throw new Error(msg);
  }
  
  if (res.status === 204) return null;
  try { return await res.json(); } catch (e) { return null; }
};

const persistSupabaseSession = () => {
  try {
    if (supabaseSession) localStorage.setItem(SUPABASE_SESSION_KEY, JSON.stringify(supabaseSession));
    else localStorage.removeItem(SUPABASE_SESSION_KEY);
  } catch (e) { }
};

const persistDBToggle = () => {
  try { localStorage.setItem(DB_TOGGLE_KEY, dbToggleOn ? '1' : '0'); } catch (e) { }
};

/** Liga/desliga o toggle "Carregar do Banco" e atualiza a UI relacionada. */
const setDBToggle = on => {
  dbToggleOn = !!on;
  persistDBToggle();
  updateDBToggleUI();
};

const updateDBToggleUI = () => {
  const checkbox = document.getElementById('db-toggle');
  const importBtn = document.getElementById('btn-fsa-link');
  if (checkbox) checkbox.checked = dbToggleOn;
  if (importBtn) importBtn.classList.toggle('db-mode-dimmed', dbToggleOn);
  const badge = document.getElementById('db-source-badge');
  if (badge) badge.textContent = dataSource === 'db'
    ? (canWriteDB ? '🔒 Roteiros carregados do banco (sigiloso)' : '🔒👁️ Roteiros carregados do banco — acesso somente leitura')
    : '';
};

const updateJsonExportButtonState = () => {
  const btn = document.getElementById('btn-export-json');
  if (!btn) return;
  btn.disabled = dataSource === 'db';
  btn.title = dataSource === 'db' ? 'Indisponível: roteiros sigilosos carregados do banco' : '';
};

const updateAuthUI = () => {
  const btn = document.getElementById('btn-auth');
  const logoutBtn = document.getElementById('btn-auth-logout');
  if (btn) {
    if (supabaseSession?.user) {
      const roleIcon = isAuthorizedUser ? (canWriteDB ? '🔓' : '👁️') : '⚠️';
      btn.textContent = `${roleIcon} ${supabaseSession.user.email}`;
      btn.title = !isAuthorizedUser
        ? 'Autenticado, mas sem autorização de acesso ao banco'
        : (canWriteDB ? 'Autenticado com acesso de leitura e escrita ao banco' : 'Autenticado com acesso somente leitura ao banco');
    } else {
      btn.textContent = '🔐 Entrar';
      btn.title = '';
    }
  }
  if (logoutBtn) logoutBtn.classList.toggle('btn-hidden', !supabaseSession?.user);
  updateDBToggleUI();
  updateJsonExportButtonState();
};

/** Converte uma linha da tabela route_points (snake_case) para o formato de ponto usado no app (camelCase). */
const dbRowToPoint = row => ({
  name: row.name, address: row.address, origAddress: row.orig_address, mapsAddress: row.maps_address,
  lat: row.lat, lng: row.lng, status: row.status, corrected: !!row.corrected,
  isGeocodable: row.is_geocodable !== false, description: row.description,
  roteiro: row.roteiro, subRoteiro: row.sub_roteiro,
  setorAbastecimento: row.setor_abastecimento, sistema: row.sistema,
});

/** Converte um ponto do app (camelCase) para uma linha da tabela route_points (snake_case). */
const pointToDbRow = (routeKey, order, p) => ({
  route_key: routeKey, point_order: order,
  name: p.name ?? null, address: p.address ?? null, orig_address: p.origAddress ?? null, maps_address: p.mapsAddress ?? null,
  lat: p.lat ?? null, lng: p.lng ?? null, status: p.status ?? null, corrected: !!p.corrected,
  is_geocodable: p.isGeocodable !== false, description: p.description ?? null,
  roteiro: p.roteiro ?? null, sub_roteiro: p.subRoteiro ?? null,
  setor_abastecimento: p.setorAbastecimento ?? null, sistema: p.sistema ?? null,
});

/** Confere se o usuário logado está cadastrado em `authorized_users` (RLS decide o resto) e se tem permissão de escrita. */
const checkAuthorization = async () => {
  if (!supabaseSession?.user?.id) { isAuthorizedUser = false; canWriteDB = false; updateAuthUI(); return false; }
  try {
    const rows = await supabaseRequest(`/rest/v1/authorized_users?select=user_id,can_write&user_id=eq.${supabaseSession.user.id}`);
    isAuthorizedUser = Array.isArray(rows) && rows.length > 0;
    canWriteDB = isAuthorizedUser && rows[0]?.can_write === true;
  } catch (e) {
    isAuthorizedUser = false;
    canWriteDB = false;
  }
  updateAuthUI();
  return isAuthorizedUser;
};

const supabaseSignIn = async (email, password) => {
  const data = await supabaseRequest('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email, password } });
  supabaseSession = { access_token: data.access_token, refresh_token: data.refresh_token, user: data.user, expires_at: Date.now() + (data.expires_in || 3600) * 1000 };
  persistSupabaseSession();
  await checkAuthorization();
  if (isAuthorizedUser && dbToggleOn) await loadRoutesFromDB();
  return supabaseSession;
};

const supabaseSignOut = async () => {
  try { if (supabaseSession?.access_token) await supabaseRequest('/auth/v1/logout', { method: 'POST' }); } catch (e) { }
  supabaseSession = null; isAuthorizedUser = false; canWriteDB = false;
  persistSupabaseSession();
  if (dataSource === 'db') {
    routes = {}; loadedFileNames = []; dataSource = 'local';
    saveToStorage(); hideSavedBar(); renderLoadedFilesList([]);
    ['sec-routes', 'sec-proc', 'sec-out'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
  }
  updateAuthUI();
};

/** Restaura sessão salva (se houver) ao carregar a página. */
const restoreSupabaseSession = async () => {
  try {
    const raw = localStorage.getItem(SUPABASE_SESSION_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (!s?.access_token) return false;
    supabaseSession = s;
    await checkAuthorization();
    return true;
  } catch (e) {
    supabaseSession = null;
    return false;
  }
};

/** Busca todos os roteiros do banco e aplica ao estado do app (dataSource = 'db'). */
const loadRoutesFromDB = async () => {
  if (!isAuthorizedUser) { showToast('Você não tem acesso ao banco de roteiros.', 'error'); return false; }
  document.getElementById('fi-msg').textContent = '⏳ Carregando roteiros do banco…';
  try {
    const [pointsRows, metaRows] = await Promise.all([
      supabaseRequest('/rest/v1/route_points?select=*&order=route_key.asc,point_order.asc'),
      supabaseRequest('/rest/v1/dataset_meta?select=*&id=eq.1'),
    ]);
    const grouped = {};
    for (const row of (pointsRows || [])) {
      (grouped[row.route_key] ||= []).push(dbRowToPoint(row));
    }
    const meta = (metaRows && metaRows[0]) || {};

    suppressDBSync = true;
    if (!Object.keys(grouped).length) {
      routes = {}; loadedFileNames = meta.file_names || []; dataSource = 'db';
      saveToStorage(); hideSavedBar(); renderLoadedFilesList(loadedFileNames);
      document.getElementById('fi-msg').textContent = 'ℹ️ Banco conectado — nenhum roteiro cadastrado ainda.';
    } else {
      applyLoadedRoutes({ routes: grouped, fileNames: meta.file_names || [], savedAt: meta.saved_at }, 'do banco de dados', 'db');
    }
    suppressDBSync = false;

    showToast('✓ Roteiros carregados do banco', 'success');
    return true;
  } catch (e) {
    showToast('⚠️ Falha ao carregar do banco: ' + e.message, 'error');
    return false;
  }
};

/**
 * Sincroniza com o banco SOMENTE os route_key(s) informados — nunca o dataset inteiro.
 * Usa a função RPC `save_routes_partial` (transação atômica no Postgres: DELETE + INSERT
 * escopados aos route_keys, dentro da mesma transação). Depois confirma via GET/RPC de
 * contagem que o banco realmente ficou com o número de linhas esperado antes de considerar
 * a operação bem-sucedida.
 */
const saveRouteKeysToDB = async (routeKeys) => {
  if (!isAuthorizedUser) throw new Error('Usuário sem autorização de acesso ao banco.');
  if (!canWriteDB) throw new Error('Usuário com acesso somente leitura ao banco.');
  if (!routeKeys || !routeKeys.length) return;

  const rows = [];
  routeKeys.forEach(routeKey => {
    (routes[routeKey] || []).forEach((p, i) => rows.push(pointToDbRow(routeKey, i, p)));
  });

  await supabaseRequest('/rest/v1/rpc/save_routes_partial', {
    method: 'POST',
    body: { p_route_keys: routeKeys, p_route_points: rows, p_file_names: loadedFileNames },
  });

  // Verificação real pós-write: pergunta ao banco quantas linhas existem para
  // exatamente esses route_keys e compara com o que devíamos ter mandado.
  // Só depois disso a operação é considerada "salva".
  const dbCount = await supabaseRequest('/rest/v1/rpc/count_route_points', {
    method: 'POST',
    body: { p_route_keys: routeKeys },
  });
  if (dbCount !== rows.length) {
    throw new Error(`Verificação falhou: banco tem ${dbCount} linha(s) para ${routeKeys.length} roteiro(s), esperado ${rows.length}.`);
  }

  showToast(`💾 ${routeKeys.length === 1 ? 'Roteiro salvo' : routeKeys.length + ' roteiros salvos'} e confirmado(s) no banco`, 'success');
};

/**
 * Fila de sincronização: garante que nunca haja duas escritas de banco em paralelo
 * (evita corrida/lost-update entre saves quase simultâneos) e acumula os route_keys
 * "sujos" enquanto uma sincronização está em andamento, rodando-os na sequência.
 */


const syncQueue = { running: false, pendingKeys: new Set(), retryCount: new Map(), backoffTimer: null };
const SYNC_RETRY_DELAY_MS = 3000; // espera antes de tentar de novo após uma falha

const runSyncQueue = () => {
  if (syncQueue.running || !syncQueue.pendingKeys.size) return;
  const keysToSync = Array.from(syncQueue.pendingKeys);
  syncQueue.pendingKeys.clear();
  syncQueue.running = true;
  setSaveStatus('syncing');
  saveRouteKeysToDB(keysToSync)
    .then(() => {
      keysToSync.forEach(k => syncQueue.retryCount.delete(k));
      setSaveStatus('confirmed');
    })
    .catch(e => {
      keysToSync.forEach(k => {
        syncQueue.pendingKeys.add(k);
        syncQueue.retryCount.set(k, (syncQueue.retryCount.get(k) || 0) + 1);
      });
      setSaveStatus('failed', e.message);
      showToast('⚠️ NÃO salvo no banco — ' + e.message, 'error');
    })
    .finally(() => {
      syncQueue.running = false;
      if (!syncQueue.pendingKeys.size) return;
      // Se a última rodada falhou, espera antes de tentar de novo — evita martelar
      // o banco/servidor em loop apertado numa falha persistente (ver observação
      // do teste "queda de conexão"). Chaves novas acumuladas durante um sync
      // bem-sucedido continuam sendo processadas na hora.
      const lastRunFailed = Array.from(syncQueue.pendingKeys).some(k => syncQueue.retryCount.has(k));
      if (lastRunFailed) {
        clearTimeout(syncQueue.backoffTimer);
        syncQueue.backoffTimer = setTimeout(runSyncQueue, SYNC_RETRY_DELAY_MS);
      } else {
        runSyncQueue();
      }
    });
};

/** Chamado após um save explícito (botão): agenda a sincronização só dos route_key(s) tocados. */
const syncRouteKeysToDB = (routeKeys) => {
  if (suppressDBSync || dataSource !== 'db' || !isAuthorizedUser || !supabaseSession) return;
  if (!canWriteDB) {
    showToast('👁️ Alteração salva só localmente — seu acesso ao banco é somente leitura.', 'info');
    return;
  }
  const keys = (routeKeys || []).filter(Boolean);
  if (!keys.length) return;
  keys.forEach(k => syncQueue.pendingKeys.add(k));
  runSyncQueue();
};

/** Atualiza o indicador visual de estado do banco (não mexe na badge de save local). */
const setSaveStatus = (state, errMsg) => {
  if (dataSource !== 'db') return;
  const info = document.getElementById('saved-info');
  if (!info) return;
  info.classList.remove('success', 'error', 'warning');
  if (state === 'syncing') { info.classList.add('warning'); info.textContent = '⏳ Salvando no banco…'; }
  else if (state === 'confirmed') { info.classList.add('success'); info.textContent = `✓ Confirmado no banco · ${new Date().toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`; }
  else if (state === 'failed') { info.classList.add('error'); info.textContent = `✗ NÃO salvo no banco — ${errMsg || 'erro'}`; }
};

// Evita fechar/recarregar a aba com uma sincronização em andamento (perderia a alteração
// no meio do caminho, o mesmo cenário do DELETE que abortou no seu HAR).
window.addEventListener('beforeunload', e => {
  if (syncQueue.running || syncQueue.pendingKeys.size) { e.preventDefault(); e.returnValue = ''; }
});

document.getElementById('db-toggle')?.addEventListener('change', async e => {
  setDBToggle(e.target.checked);
  if (dbToggleOn && isAuthorizedUser) await loadRoutesFromDB();
});

document.getElementById('btn-auth').onclick = () => {
  document.getElementById('auth-box').classList.remove('hidden');
  document.getElementById('auth-box').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  document.getElementById('auth-result').textContent = '';
  if (supabaseSession?.user) document.getElementById('auth-email').value = supabaseSession.user.email || '';
};

document.getElementById('btn-auth-cancel').onclick = () => document.getElementById('auth-box').classList.add('hidden');

document.getElementById('btn-auth-submit').onclick = async function () {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  if (!email || !password) { document.getElementById('auth-result').textContent = 'Preencha e-mail e senha.'; return; }
  this.disabled = true;
  document.getElementById('auth-result').textContent = 'Entrando…';
  try {
    await supabaseSignIn(email, password);
    document.getElementById('auth-result').textContent = !isAuthorizedUser
      ? '✓ Login realizado, mas este usuário não tem acesso ao banco de roteiros.'
      : (canWriteDB ? '✓ Login realizado com acesso de leitura e escrita ao banco.' : '✓ Login realizado com acesso somente leitura ao banco.');
    document.getElementById('auth-password').value = '';
    showToast('✓ Login realizado', 'success');
    setTimeout(() => document.getElementById('auth-box').classList.add('hidden'), 1200);
  } catch (e) {
    document.getElementById('auth-result').textContent = '⚠️ ' + e.message;
  } finally {
    this.disabled = false;
  }
};

document.getElementById('btn-auth-logout').onclick = async () => {
  await supabaseSignOut();
  document.getElementById('auth-box').classList.add('hidden');
  showToast('Sessão encerrada', 'info');
};

// ============================================================================
// GEOCODING (via serverless function no Vercel — a chave Mapbox fica no servidor)
// ============================================================================
const geocodeMapbox = async query => {
  const q0 = (query || '').trim();
  if (!q0) return null;

  const url = `/api/request?query=${encodeURIComponent(q0)}`;

  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error('Não foi possível contatar o servidor de geocodificação. Verifique sua conexão.');
  }

  if (!res.ok) {
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) throw new Error('Chave de API inválida ou não configurada no servidor (Vercel).');
    if (res.status === 429) throw new Error('Limite de requisições de geocodificação excedido. Tente novamente em instantes.');
    if (res.status >= 500) throw new Error('Erro no servidor de geocodificação. Tente novamente em instantes.');
    throw new Error(`Erro no servidor: ${res.status}`);
  }

  try {
    return await res.json();
  } catch (e) {
    throw new Error('Resposta inválida do servidor de geocodificação.');
  }
};

const ensureStartCoord = async () => {
  if (!startCoord) startCoord = await geocodeMapbox(START_END);
  return startCoord;
};

// ============================================================================
// TSP LOCAL (nearest neighbor + 2-opt)
// ============================================================================
const haversine = (a, b) => {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

const buildDistMatrix = pts => {
  const n = pts.length, d = Array.from({ length: n }, () => Array(n));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) d[i][j] = haversine(pts[i], pts[j]);
  return d;
};

const nearestNeighbor = (dist, startIdx) => {
  const n = dist.length, visited = new Array(n).fill(false), tour = [startIdx];
  visited[startIdx] = true;
  for (let s = 1; s < n; s++) {
    const last = tour[tour.length - 1]; let best = -1, bestD = Infinity;
    for (let j = 0; j < n; j++) if (!visited[j] && dist[last][j] < bestD) { bestD = dist[last][j]; best = j; }
    tour.push(best); visited[best] = true;
  }
  return tour;
};

const twoOpt = (tour, dist) => {
  const n = tour.length; let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < n - 1; i++) for (let j = i + 1; j < n; j++) {
      const a = tour[i - 1], b = tour[i], c = tour[j], d = (j + 1 < n) ? tour[j + 1] : tour[0];
      if (dist[a][c] + dist[b][d] < dist[a][b] + dist[c][d] - 0.01) {
        let lo = i, hi = j;
        while (lo < hi) { [tour[lo], tour[hi]] = [tour[hi], tour[lo]]; lo++; hi--; }
        improved = true;
      }
    }
  }
  return tour;
};

const solveTSP = stops => {
  if (stops.length <= 1) return stops;
  const pts = [{ lat: startCoord.lat, lng: startCoord.lng }, ...stops];
  const dist = buildDistMatrix(pts);
  let tour = twoOpt(nearestNeighbor(dist, 0), dist);
  const bp = tour.indexOf(0);
  if (bp !== 0) tour = [...tour.slice(bp), ...tour.slice(0, bp)];
  return tour.slice(1).map(idx => stops[idx - 1]);
};

const tourDistanceKm = stops => {
  if (!stops.length || !startCoord) return '0';
  let total = haversine(startCoord, stops[0]);
  for (let i = 0; i < stops.length - 1; i++) total += haversine(stops[i], stops[i + 1]);
  total += haversine(stops[stops.length - 1], startCoord);
  return (total / 1000).toFixed(1);
};

// ============================================================================
// PERSISTENCE — MAIN ROUTES (localStorage)
// ============================================================================
const saveToStorage = () => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), fileNames: loadedFileNames, routes })); } catch (e) { }
  // A sincronização com o banco NÃO acontece mais aqui de forma implícita.
  // Cada ação explícita de "salvar" chama syncRouteKeysToDB([...]) logo em seguida,
  // só com o(s) route_key(s) que ela realmente tocou — nunca o dataset inteiro.
};

const loadFromStorage = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const p = JSON.parse(raw);
    if (!p.routes || !Object.keys(p.routes).length) return false;
    routes = p.routes; loadedFileNames = p.fileNames || []; dataSource = 'local';
    showSavedBar(p.savedAt); renderLoadedFilesList(loadedFileNames);
    updateJsonExportButtonState(); updateDBToggleUI();
    document.getElementById('sec-routes').classList.remove('hidden');
    return true;
  } catch (e) { return false; }
};

const exportJSON = () => {
  if (dataSource === 'db') {
    showToast('⚠️ Exportação desabilitada: estes roteiros vieram do banco e são sigilosos.', 'error');
    return;
  }
  const blob = new Blob([JSON.stringify({ savedAt: new Date().toISOString(), fileNames: loadedFileNames, routes }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'roteiros.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast('✓ roteiros.json exportado', 'success');
};

const importFromJSON = file => {
  const r = new FileReader();
  r.onload = ev => {
    try {
      const p = JSON.parse(ev.target.result);
      applyLoadedRoutes(p, `de ${file.name} (modo avulso — sem vínculo com arquivo)`);
      showToast(`✓ ${Object.keys(routes).length} roteiro(s) importados`, 'success');
    } catch (e) {
      document.getElementById('fi-msg').textContent = '⚠️ Erro ao importar JSON: ' + e.message;
    }
  };
  r.readAsText(file, 'UTF-8');
};

const showSavedBar = savedAt => {
  const bar = document.getElementById('saved-bar'), info = document.getElementById('saved-info');
  const n = Object.keys(routes).length;
  const date = savedAt ? new Date(savedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  info.textContent = `✓ ${n} roteiro(s) salvos · ${date}`;
  bar.style.display = 'flex';
};

const hideSavedBar = () => { document.getElementById('saved-bar').style.display = 'none'; };

const renderLoadedFilesList = names => {
  document.getElementById('loaded-files-list').innerHTML = names
    .map(n => `<span class="loaded-file-chip">📄 ${escXML(n)}</span>`)
    .join('');
};

document.getElementById('btn-export-json').onclick = exportJSON;
document.getElementById('btn-clear-storage').onclick = () => {
  localStorage.removeItem(STORAGE_KEY); routes = {}; loadedFileNames = []; dataSource = 'local';
  hideSavedBar(); renderLoadedFilesList([]);
  document.getElementById('fi-msg').textContent = '🗑️ Dados removidos. Carregue os KMLs novamente.';
  ['sec-routes', 'sec-proc', 'sec-out'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('fi').value = '';
  updateJsonExportButtonState(); updateDBToggleUI();
  showToast('Dados removidos', 'info');
};

document.getElementById('fi-json-fallback')?.addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) importFromJSON(f);
  e.target.value = '';
});

// ============================================================================
// DROP ZONE + KML PARSING
// ============================================================================
const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drop-zone-active'); });
dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('drop-zone-active'); });
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drop-zone-active');
  const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.kml'));
  if (files.length) processKMLFiles(files);
});

document.getElementById('fi').onchange = e => { const files = Array.from(e.target.files); if (files.length) processKMLFiles(files); };

/**
 * Mescla os roteiros recém-lidos de um arquivo em `routes`, sem sobrescrever
 * silenciosamente um roteiro já existente com o mesmo nome (vindo de outro
 * arquivo). Em caso de colisão, aplica o mesmo padrão de desambiguação usado
 * dentro de um único arquivo em parseKMLText(): sufixo " (nome-do-arquivo)".
 */
const mergeRoutesFromFile = (target, newRoutes, fileName) => {
  const base = fileName.replace(/\.kml$/i, '');
  Object.keys(newRoutes).forEach(key => {
    let finalKey = key;
    if (target[finalKey]) {
      finalKey = `${key} (${base})`;
      let n = 2;
      while (target[finalKey]) { finalKey = `${key} (${base} ${n})`; n++; }
    }
    target[finalKey] = newRoutes[key];
  });
};

const processKMLFiles = files => {
  const msg = document.getElementById('fi-msg');
  msg.textContent = `⏳ Lendo ${files.length} arquivo(s)…`;
  routes = {}; loadedFileNames = [];
  dataSource = 'local'; // reimportar KML é sempre local; nunca deve sobrescrever o banco sem uma ação explícita de save
  let pending = files.length, totalRoutes = 0, errors = 0;
  files.forEach(file => {
    const r = new FileReader();
    r.onload = ev => {
      try {
        const nr = parseKMLText(ev.target.result, file.name);
        mergeRoutesFromFile(routes, nr, file.name); totalRoutes += Object.keys(nr).length; loadedFileNames.push(file.name);
      } catch (ex) { errors++; }
      if (--pending === 0) {
        if (!Object.keys(routes).length) { msg.textContent = errors ? `⚠️ Erro em ${errors} arquivo(s).` : 'Nenhum roteiro encontrado.'; return; }
        saveToStorage(); showSavedBar(new Date().toISOString()); renderLoadedFilesList(loadedFileNames);
        msg.textContent = `✓ ${totalRoutes} roteiro(s) de ${loadedFileNames.length} arquivo(s)${errors ? ` (${errors} com erro)` : ''} — salvos no navegador`;
        renderRouteButtons(); document.getElementById('sec-routes').classList.remove('hidden');
        showToast(`✓ ${totalRoutes} roteiro(s) carregados`, 'success');
      }
    };
    r.onerror = () => { errors++; pending--; };
    r.readAsText(file, 'UTF-8');
  });
};

const parseKMLText = (xml, fname) => {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const folders = doc.querySelectorAll('Document > Folder');
  if (!folders.length) throw new Error('Nenhuma pasta em ' + fname);
  const result = {};
  folders.forEach(folder => {
    const name = folder.querySelector('name')?.textContent || 'Sem nome';
    const arr = [];
    folder.querySelectorAll('Placemark').forEach(pm => {
      const pn = pm.querySelector('name')?.textContent || '';
      const ad = (pm.querySelector('address')?.textContent || '').trim();

      // NOVO: descrição em texto limpo (o KML traz como HTML com <br>)
      const descRaw = pm.querySelector('description')?.textContent || '';
      const description = descRaw
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .trim();

      // NOVO: lê todos os campos do ExtendedData num objeto
      const extData = {};
      pm.querySelectorAll('ExtendedData > Data').forEach(d => {
        const key = d.getAttribute('name');
        const val = d.querySelector('value')?.textContent ?? '';
        if (key) extData[key] = val.trim();
      });

      const ce = pm.querySelector('Point > coordinates');
      let lat = null, lng = null;
      if (ce) { const p = ce.textContent.trim().split(','); if (p.length >= 2) { lng = parseFloat(p[0]); lat = parseFloat(p[1]); } }

      arr.push({
        name: pn,
        address: ad,
        origAddress: ad,
        mapsAddress: formatAddr(ad),
        lat, lng,
        status: (lat !== null && lng !== null) ? 'ok' : 'pending',
        corrected: false,
        isGeocodable: true,
        description,
        roteiro: extData['ROTEIRO'] || '',
        subRoteiro: extData['SUB-ROTEIRO'] || '',
        setorAbastecimento: extData['SETOR ABASTECIMENTO'] || '',
        sistema: extData['SISTEMA'] || ''
      });
    });
    const key = result[name] ? `${name} (${fname.replace(/\.kml$/i, '')})` : name;
    result[key] = arr;
  });
  return result;
};


// ============================================================================
// ROUTE BUTTONS (grid principal) — inclui o card "Personalizar"
// ============================================================================

const renderRouteButtons = () => {
  const g = document.getElementById('route-grid');
  g.innerHTML = '';
  exportSelection = new Set([...exportSelection].filter(n => routes[n])); // limpa roteiros removidos

  Object.keys(routes).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })).forEach(name => {
    const n = routes[name].length;
    const c = routes[name].filter(p => p.lat !== null && p.lng !== null).length;
    const btn = document.createElement('button');
    btn.className = 'route-btn';
    btn.innerHTML = `<input type="checkbox" class="route-checkbox" ${exportSelection.has(name) ? 'checked' : ''}><span class="route-btn-title">${escXML(name.replace(/\.xlsx$/i, ''))}</span><span class="route-btn-info">${n} pontos${c ? ` · ${c} coord` : ''}`;
    btn.querySelector('.route-checkbox').onclick = e => {
      e.stopPropagation();
      if (e.target.checked) exportSelection.add(name); else exportSelection.delete(name);
      updateExportButtonsState();
    };
    btn.onclick = () => { currentRouteKey = name; selectRoute(name, btn); refreshDeleteRouteButton(); };
    g.appendChild(btn);
  });

  const customBtn = document.createElement('button');
  customBtn.className = 'route-btn custom-card';
  customBtn.id = 'btn-personalizar';
  customBtn.innerHTML = `<span class="route-btn-title custom-card-title">✏️ Personalizar</span><span class="route-btn-info custom-card-info">Criar roteiro customizado</span>`;
  customBtn.onclick = openCustomPanel;
  g.appendChild(customBtn);

  updateExportButtonsState();
  if (document.getElementById('custom-panel').classList.contains('open')) renderPanelRouteTabs();
};

// ============================================================================
// INIT — File System Access API com fallback para localStorage
// ============================================================================
window.addEventListener('DOMContentLoaded', async () => {
  try { dbToggleOn = localStorage.getItem(DB_TOGGLE_KEY) !== '0'; } catch (e) { dbToggleOn = true; }
  updateDBToggleUI();

  await restoreSupabaseSession();
  updateAuthUI();

  let loadedFromDB = false;
  if (dbToggleOn && isAuthorizedUser) {
    loadedFromDB = await loadRoutesFromDB();
  }

  if (!loadedFromDB) {
    try {
      let loaded = false;
      const handle = await loadHandleFromDB();
      if (handle) {
        if (await verifyPermission(handle, false)) {
          loaded = await readFromHandle(handle);
        } else {
          updateFSABar(handle.name);
          document.getElementById('fi-msg').textContent = '⚠️ Clique em "🔄 Recarregar" para atualizar os dados do arquivo vinculado.';
        }
      }
      if (!loaded && loadFromStorage()) {
        renderRouteButtons();
        document.getElementById('sec-routes').classList.remove('hidden');
        showToast(`✓ ${Object.keys(routes).length} roteiro(s) restaurados do cache`, 'info');
      }
    } catch (e) {
      console.error('[init]', e);
      if (loadFromStorage()) {
        renderRouteButtons();
        document.getElementById('sec-routes').classList.remove('hidden');
      }
    }
  }
  loadCustomSavedRoutes();
});

// ============================================================================
// SELEÇÃO DE ROTEIRO (grid principal)
// ============================================================================
const selectRoute = (name, btn) => {
  document.querySelectorAll('.route-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentRoute = name; geocodeDone = false; isOptimized = false; selectedIdx = -1; optimizedStops = [];
  points = routes[name].map(p => ({ isGeocodable: true, ...p }));
  document.getElementById('rname-t').textContent = name.replace(/\.xlsx$/i, '');
  document.getElementById('rname-s').textContent = `${points.length} pontos · ${points.filter(p => p.lat !== null && p.lng !== null).length} com coordenadas`;
  renderList();
  document.getElementById('sec-proc').classList.remove('hidden');
  document.getElementById('sec-out').classList.add('hidden');
  document.getElementById('edit-panel').classList.add('hidden');
  document.getElementById('pbar').classList.add('hidden');
  document.getElementById('ptxt').textContent = '';
  document.getElementById('btn-run').disabled = false;
  document.getElementById('btn-gen-link').disabled = false;
  document.getElementById('order-box').classList.add('hidden');
  document.getElementById('qr-section').classList.add('hidden');
  links = []; currentLongUrl = ''; currentShortUrl = '';
};

/** Grava o estado atual de `points` de volta em `routes[currentRouteKey]` e persiste. */
const syncPointsToRoute = () => {
  if (!currentRouteKey) return;
  routes[currentRouteKey] = points.map(p => ({ ...p }));
  saveToStorage();
  syncRouteKeysToDB([currentRouteKey]);
};

const mkBadge = p => {
  const lock = p.isGeocodable === false ? '<span class="badge locked" title="Coordenadas travadas — não serão geocodificadas">🔒</span>' : '';
  if (p.corrected) return lock + '<span class="badge corrected">✏️</span>';
  if (p.status === 'ok') return lock + '<span class="badge success">✓</span>';
  if (p.status === 'error') return lock + '<span class="badge error">✕ Corrigir</span>';
  return lock + '<span class="badge warning">…</span>';
};

const updateRow = i => {
  const p = points[i]; const row = document.getElementById('r' + i); if (!row) return;
  const coord = (p.lat !== null && p.lng !== null) ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : '';
  const ad = p.address ? p.address.substring(0, 48) + (p.address.length > 48 ? '…' : '') : '(sem endereço)';
  row.classList.toggle('selected', i === selectedIdx);
  row.draggable = true; row.dataset.index = i;
  row.innerHTML = `<span class="drag-handle">☰</span><span class="row-name">${escXML(p.name)}</span><span class="row-address" title="${escXML(p.address)}">${escXML(ad)}</span><span class="row-coord">${coord}</span>${mkBadge(p)}`;
  row.ondragstart = e => { row.classList.add('dragging'); e.dataTransfer.setData('text/plain', i); };
  row.ondragend = () => {
    row.classList.remove('dragging');
    document.querySelectorAll('#pts-list .row').forEach(r => r.classList.remove('drop-above', 'drop-below'));
  };
  row.ondragover = e => {
    e.preventDefault();
    const rect = row.getBoundingClientRect();
    const isAfter = (e.clientY - rect.top) > rect.height / 2;
    row.classList.toggle('drop-below', isAfter);
    row.classList.toggle('drop-above', !isAfter);
  };
  row.ondragleave = () => row.classList.remove('drop-above', 'drop-below');
  row.ondrop = e => {
    e.preventDefault();
    const isAfter = row.classList.contains('drop-below');
    row.classList.remove('drop-above', 'drop-below');
    const from = parseInt(e.dataTransfer.getData('text/plain'));
    const to = parseInt(row.dataset.index);
    if (from === to) return;
    const adjustedTo = from < to ? to - 1 : to;
    const insertAt = isAfter ? adjustedTo + 1 : adjustedTo;
    const moved = points.splice(from, 1)[0];
    points.splice(insertAt, 0, moved);
    renderList();
    if (geocodeDone && startCoord) {
      const valid = points.filter(p => p.status === 'ok');
      showOptimizedOrder(isOptimized ? solveTSP(valid) : valid);
    }
  };
};

const renderList = () => {
  const c = document.getElementById('pts-list'); c.innerHTML = '';
  points.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'row'; row.id = 'r' + i;
    c.appendChild(row); updateRow(i);
  });
  document.getElementById('btn-save-drag-order').classList.toggle('hidden', points.length === 0);
};

// ============================================================================
// EDITOR DE PONTOS DO ROTEIRO (nome, endereço, lat/lng, travar coordenadas)
// ============================================================================
const openEditPanel = () => {
  editDraftPoints = points.map(p => ({ ...p, isGeocodable: p.isGeocodable !== false }));
  renderEditRows();
  const status = document.getElementById('edit-status');
  status.textContent = '';
  status.style.color = '';
  document.getElementById('edit-panel').classList.remove('hidden');
  document.getElementById('edit-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

const closeEditPanel = () => {
  document.getElementById('edit-panel').classList.add('hidden');
};

const renderEditRows = () => {
  const c = document.getElementById('edit-rows');
  c.innerHTML = '';
  if (!editDraftPoints.length) {
    const empty = document.createElement('p');
    empty.className = 'note';
    empty.textContent = 'Nenhum ponto neste roteiro ainda. Use "➕ Adicionar ponto" para criar o primeiro.';
    c.appendChild(empty);
    return;
  }
  editDraftPoints.forEach((p, idx) => c.appendChild(buildEditRow(p, idx)));
};

const buildEditRow = (p, idx) => {
  const row = document.createElement('div');
  row.className = 'edit-row';
  row.dataset.idx = idx;
  const latVal = (p.lat !== null && p.lat !== undefined && !isNaN(p.lat)) ? p.lat : '';
  const lngVal = (p.lng !== null && p.lng !== undefined && !isNaN(p.lng)) ? p.lng : '';
  row.innerHTML = `
    <div class="edit-row-grid">
      <label>Nome
        <input type="text" class="edit-name" value="${escXML(p.name || '')}" placeholder="Nome do ponto">
      </label>
      <label>Endereço
        <input type="text" class="edit-address" value="${escXML(p.address || '')}" placeholder="Endereço completo">
      </label>
      <label>Latitude
        <input type="text" inputmode="decimal" class="edit-lat" value="${latVal}" placeholder="-30.0346">
      </label>
      <label>Longitude
        <input type="text" inputmode="decimal" class="edit-lng" value="${lngVal}" placeholder="-51.2177">
      </label>
    </div>
    <div class="edit-row-controls">
      <label class="edit-lock-label">
        <input type="checkbox" class="edit-lock" ${p.isGeocodable === false ? 'checked' : ''}>
        🔒 Travar coordenadas (não geocodificar)
      </label>
      <button type="button" class="btn btn-sm btn-danger-outline edit-row-remove">🗑️ Remover ponto</button>
    </div>
  `;
  row.querySelector('.edit-row-remove').onclick = () => {
    editDraftPoints.splice(idx, 1);
    renderEditRows();
  };

  const latInput = row.querySelector('.edit-lat');
  const lngInput = row.querySelector('.edit-lng');
  const lockInput = row.querySelector('.edit-lock');

  latInput.addEventListener('input', () => {
    const raw = latInput.value;
    const parts = raw.split(',');
    if (parts.length === 2) {
      const latNum = parseFloat(parts[0].trim());
      const lngNum = parseFloat(parts[1].trim());
      if (!isNaN(latNum) && !isNaN(lngNum)) {
        latInput.value = latNum;
        lngInput.value = lngNum;
      }
    }
    if (latInput.value.trim() !== '') lockInput.checked = true;
  });
  lngInput.addEventListener('input', () => {
    if (lngInput.value.trim() !== '') lockInput.checked = true;
  });

  return row;
};

/** Lê os valores atuais dos inputs do editor de volta para editDraftPoints. */
const collectEditRowsIntoDraft = () => {
  document.querySelectorAll('#edit-rows .edit-row').forEach(row => {
    const idx = parseInt(row.dataset.idx, 10);
    const p = editDraftPoints[idx];
    if (!p) return;
    p.name = row.querySelector('.edit-name').value.trim() || 'Sem nome';
    p.address = row.querySelector('.edit-address').value.trim();
    if (!p.origAddress) p.origAddress = p.address;
    const latStr = row.querySelector('.edit-lat').value.trim();
    const lngStr = row.querySelector('.edit-lng').value.trim();
    p.lat = latStr === '' ? null : parseFloat(latStr);
    p.lng = lngStr === '' ? null : parseFloat(lngStr);
    if (isNaN(p.lat)) p.lat = null;
    if (isNaN(p.lng)) p.lng = null;
    p.isGeocodable = !row.querySelector('.edit-lock').checked;
    p.mapsAddress = p.mapsAddress || formatAddr(p.address);
    p.status = (p.lat !== null && p.lng !== null) ? 'ok' : (p.address ? 'pending' : 'error');
    if (p.isGeocodable === false && p.lat !== null && p.lng !== null) p.corrected = true;
  });
};

document.getElementById('btn-edit-add').onclick = () => {
  editDraftPoints.push({
    name: '', address: '', origAddress: '', mapsAddress: '',
    lat: null, lng: null, status: 'pending', corrected: false, isGeocodable: false
  });
  renderEditRows();
  const rows = document.querySelectorAll('#edit-rows .edit-row');
  const last = rows[rows.length - 1];
  last?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  last?.querySelector('.edit-name')?.focus();
};

document.getElementById('btn-edit-save').onclick = async function () {
  this.disabled = true;
  collectEditRowsIntoDraft();
  points = editDraftPoints.map(p => ({ ...p }));
  if (currentRouteKey) routes[currentRouteKey] = points.map(p => ({ ...p }));
  saveToStorage();
  if (currentRouteKey) syncRouteKeysToDB([currentRouteKey]);
  await trySaveLinkedFile();
  renderList();
  renderRouteButtons();
  document.getElementById('rname-s').textContent = `${points.length} pontos · ${points.filter(p => p.lat !== null && p.lng !== null).length} com coordenadas`;
  const status = document.getElementById('edit-status');
  status.style.color = 'var(--color-success)';
  status.textContent = '✓ Alterações salvas no roteiro.';
  showToast('✓ Roteiro atualizado', 'success');
  geocodeDone = false; isOptimized = false;
  this.disabled = false;
};

document.getElementById('btn-edit-close').onclick = closeEditPanel;

document.getElementById('btn-save-drag-order').onclick = async function () {
  this.disabled = true;
  syncPointsToRoute();
  await trySaveLinkedFile();
  showToast('✓ Ordem salva no roteiro', 'success');
  this.disabled = false;
};

document.getElementById('btn-save-tsp-order').onclick = async function () {
  if (!optimizedStops?.length) { showToast('Nenhuma rota otimizada para salvar.', 'error'); return; }
  this.disabled = true;
  const leftover = points.filter(p => !optimizedStops.includes(p));
  points = [...optimizedStops, ...leftover];
  syncPointsToRoute();
  await trySaveLinkedFile();
  renderList();
  showToast('✓ Ordem otimizada salva no roteiro', 'success');
  this.disabled = false;
};

document.getElementById('btn-edit-route').onclick = () => {
  if (document.getElementById('edit-panel').classList.contains('hidden')) openEditPanel();
  else closeEditPanel();
};

// ============================================================================
// GOOGLE MAPS URL / SAÍDA
// ============================================================================
const buildGoogleMapsUrl = stops => {
  const all = [{ lat: startCoord.lat, lng: startCoord.lng }, ...stops, { lat: startCoord.lat, lng: startCoord.lng }];
  const path = all.map(p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('/');
  const cLat = all.reduce((s, p) => s + p.lat, 0) / all.length, cLng = all.reduce((s, p) => s + p.lng, 0) / all.length;
  return `https://www.google.com/maps/dir/${path}/@${cLat.toFixed(7)},${cLng.toFixed(7)},13z?entry=ttu`;
};

const buildOutputs = async () => {
  const valid = points.filter(p => p.status === 'ok'), errs = points.filter(p => p.status === 'error');
  if (!valid.length) { document.getElementById('ptxt').textContent = 'Nenhum ponto válido.'; return; }
  if (!startCoord) { document.getElementById('ptxt').textContent = 'Endereço base não geocodificado.'; return; }
  document.getElementById('ptxt').textContent = 'Calculando rota otimizada…';
  const t0 = performance.now();
  optimizedStops = solveTSP(valid.slice());
  const ms = (performance.now() - t0).toFixed(1);
  const distKm = tourDistanceKm(optimizedStops);
  showOptimizedOrder(optimizedStops);
  await updateShareLink(optimizedStops);
  document.getElementById('st-ok').textContent = valid.length;
  document.getElementById('st-err').textContent = errs.length;
  const sn = document.getElementById('split-note');
  sn.classList.remove('hidden');
  sn.textContent = `✨ ${optimizedStops.length} pontos otimizados. ~${distKm} km. ${ms} ms.`;
  document.getElementById('sec-out').classList.remove('hidden');
  document.getElementById('ptxt').textContent = `Concluído: ${valid.length}/${points.length} geocodificados · ~${distKm} km.`;
  document.querySelector('.error-box')?.remove();
  if (errs.length > 0) {
    const ch = document.createElement('div');
    ch.className = 'error-box error-box-visible';
    ch.textContent = `⚠️ ${errs.length} ponto(s) com erro — clique para corrigir.`;
    document.getElementById('ptxt').parentNode.insertBefore(ch, document.getElementById('pts-list'));
  }
};

// ============================================================================
// EXPORTAÇÃO KML
// ============================================================================
const buildKmlFromOptimizedRoute = (orderedStops, rname) => {
  rname = (rname || currentRoute || 'roteiro').replace(/\.xlsx$/i, '');
  let kml = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n' +
    `<name>${escXML(rname)}</name>\n` +
    '<Style id="pin"><IconStyle><color>ff0055ff</color><scale>1.1</scale></IconStyle><LabelStyle><scale>0.8</scale></LabelStyle></Style>\n' +
    '<Style id="fix"><IconStyle><color>ff00aaff</color><scale>1.2</scale></IconStyle><LabelStyle><scale>0.8</scale></LabelStyle></Style>\n' +
    '<Style id="base"><IconStyle><color>ff00ff00</color><scale>1.3</scale></IconStyle></Style>\n' +
    '<Style id="rota"><LineStyle><color>cc0044ff</color><width>3</width></LineStyle><PolyStyle><fill>0</fill></PolyStyle></Style>\n';
  kml += `<Placemark>\n<name>BASE</name>\n<description>${escXML(START_END)}</description>\n<styleUrl>#base</styleUrl>\n<Point><coordinates>${startCoord.lng.toFixed(6)},${startCoord.lat.toFixed(6)},0</coordinates></Point>\n</Placemark>\n`;
  orderedStops.forEach((p, idx) => {
    kml += `<Placemark>\n<name>${escXML((idx + 1) + '. ' + p.name)}</name>\n<description>${escXML(p.address)}${p.corrected ? ' [CORRIGIDO]' : ''}</description>\n<styleUrl>${p.corrected ? '#fix' : '#pin'}</styleUrl>\n<Point><coordinates>${p.lng.toFixed(6)},${p.lat.toFixed(6)},0</coordinates></Point>\n</Placemark>\n`;
  });
  const coords = [[startCoord.lng, startCoord.lat], ...orderedStops.map(p => [p.lng, p.lat]), [startCoord.lng, startCoord.lat]];
  const lc = coords.map(c => `${c[0].toFixed(6)},${c[1].toFixed(6)},0`).join('\n');
  kml += `<Placemark>\n<name>Rota ${escXML(rname)}</name>\n<styleUrl>#rota</styleUrl>\n<LineString><tessellate>1</tessellate><coordinates>\n${lc}\n</coordinates></LineString>\n</Placemark>\n</Document>\n</kml>`;
  const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = rname + '.kml'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};
// ============================================================================
// EXPORTAÇÃO KML MULTI-ROTEIRO (cada roteiro = uma camada/Folder)
// ============================================================================
const KML_LAYER_COLORS = ['ff0055ff', 'ff00aaff', 'ff22cc55', 'ffaa00ff', 'ff0080ff', 'ff00ffdd', 'ffff6600', 'ffcc00cc'];

const buildMultiRouteKml = (routeNames, docName) => {
  let kml = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n' +
    `<name>${escXML(docName)}</name>\n`;

  routeNames.forEach((_, i) => {
    const color = KML_LAYER_COLORS[i % KML_LAYER_COLORS.length];
    kml += `<Style id="pin${i}"><IconStyle><color>${color}</color><scale>1.1</scale></IconStyle><LabelStyle><scale>0.8</scale></LabelStyle></Style>\n`;
  });
  kml += '<Style id="base"><IconStyle><color>ff00ff00</color><scale>1.3</scale></IconStyle></Style>\n';

  kml += '<Folder>\n<name>📍 Base</name>\n' +
    `<Placemark>\n<name>BASE</name>\n<description>${escXML(START_END)}</description>\n<styleUrl>#base</styleUrl>\n` +
    (startCoord ? `<Point><coordinates>${startCoord.lng.toFixed(6)},${startCoord.lat.toFixed(6)},0</coordinates></Point>\n` : '') +
    '</Placemark>\n</Folder>\n';

  let skipped = 0;
  routeNames.forEach((name, i) => {
    const pts = routes[name] || [];
    const valid = pts.filter(p => p.lat !== null && p.lat !== undefined && p.lng !== null && p.lng !== undefined && !isNaN(p.lat) && !isNaN(p.lng));
    skipped += pts.length - valid.length;
    kml += `<Folder>\n<name>${escXML(name.replace(/\.xlsx$/i, ''))}</name>\n`;
    valid.forEach((p, idx) => {
      kml += `<Placemark>\n<name>${escXML((idx + 1) + '. ' + (p.name || 'Sem nome'))}</name>\n<description>${escXML(p.address || '')}</description>\n<styleUrl>#pin${i % KML_LAYER_COLORS.length}</styleUrl>\n<Point><coordinates>${p.lng.toFixed(6)},${p.lat.toFixed(6)},0</coordinates></Point>\n</Placemark>\n`;
    });
    kml += '</Folder>\n';
  });

  kml += '</Document>\n</kml>';
  return { kml, skipped };
};

const exportRoutesAsKml = (routeNames, filename) => {
  if (!routeNames.length) { showToast('Nenhum roteiro selecionado', 'error'); return; }
  const { kml, skipped } = buildMultiRouteKml(routeNames, filename.replace(/\.kml$/i, ''));
  const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast(skipped ? `✓ KML exportado (${skipped} ponto(s) sem coordenadas ignorados)` : '✓ KML exportado com camadas', skipped ? 'info' : 'success');
};

const updateExportButtonsState = () => {
  const btn = document.getElementById('btn-export-selected-kml');
  const label = document.getElementById('export-sel-count');
  if (!btn) return;
  btn.disabled = exportSelection.size === 0;
  label.textContent = exportSelection.size ? `${exportSelection.size} roteiro(s) selecionado(s)` : '';
};

document.getElementById('btn-export-selected-kml').onclick = function () {
  geocodeThenExport([...exportSelection], 'roteiros_selecionados.kml', this);
};
document.getElementById('btn-export-all-kml').onclick = function () {
  geocodeThenExport(Object.keys(routes), 'roteiros_completos.kml', this);
};

const showOptimizedOrder = orderedStops => {
  const box = document.getElementById('order-box');
  const saveBtn = document.getElementById('btn-save-tsp-order');
  if (!orderedStops?.length) { box.classList.add('hidden'); saveBtn.classList.add('hidden'); return; }
  let html = '<p class="order-box-title">✓ Rota da sua preferência</p>';
  html += `<div class="row row-static"><span class="row-name">1</span><div class="row-static-body"><div class="row-static-name">BASE</div><div class="note">${escXML(START_END)}</div></div></div>`;
  orderedStops.forEach((p, idx) => {
    const coord = (p.lat !== null && p.lng !== null) ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : '';
    html += `<div class="row row-static"><span class="row-name">${idx + 2}</span><div class="row-static-body row-static-body-flex"><div class="row-static-name row-static-name-regular">${escXML(p.name)}</div><div class="note">${escXML(p.address || p.mapsAddress)}</div></div><div class="row-static-coord">${coord}</div></div>`;
  });
  html += `<div class="row row-static"><span class="row-name">${orderedStops.length + 2}</span><div class="row-static-body"><div class="row-static-name">BASE</div><div class="note">Retorno ao ponto inicial</div></div></div>`;
  box.innerHTML = html; box.classList.remove('hidden');
  saveBtn.classList.remove('hidden');
};

// ============================================================================
// GEOCODIFICAÇÃO EM LOTE (usada por "Gerar link" e "Otimizar rota")
// ============================================================================
const geocodeAllPoints = async () => {
  const pfill = document.getElementById('pfill'), ptxt = document.getElementById('ptxt');
  document.getElementById('pbar').classList.remove('hidden');
  ptxt.textContent = 'Geocodificando ponto de partida/chegada…';
  try { await ensureStartCoord(); } catch (e) { ptxt.textContent = 'Erro: ' + e.message; showToast(e.message, 'error'); return false; }
  if (!startCoord) { ptxt.textContent = 'Não foi possível geocodificar o endereço base.'; return false; }

  const total = points.length;
  for (let i = 0; i < total; i++) {
    const p = points[i];
    if (p.isGeocodable === false) {
      p.status = (p.lat !== null && p.lng !== null) ? 'ok' : 'error';
      ptxt.textContent = `${i + 1}/${total} — ${p.name} (🔒 coordenadas travadas)`;
    } else if (!p.address) {
      p.status = 'error';
    } else {
      ptxt.textContent = `Geocodificando ${i + 1}/${total} — ${p.name}…`;
      try {
        const r = await geocodeMapbox(formatAddr(p.address));
        if (r) { p.lat = r.lat; p.lng = r.lng; p.status = 'ok'; p.mapsAddress = formatAddr(p.address); }
        else p.status = 'error';
      } catch (e) { p.status = 'error'; }
    }
    pfill.style.width = Math.round((i + 1) / total * 100) + '%';
    updateRow(i);
    if (i < total - 1) await sleep(120);
  }
  geocodeDone = true;
  syncPointsToRoute();
  renderRouteButtons();
  return true;
};

// ============================================================================
// GEOCODIFICAÇÃO DE PENDÊNCIAS (usada antes da exportação em lote)
// ============================================================================
const geocodeMissingInRoutes = async (routeNames, progressCb) => {
  try { await ensureStartCoord(); } catch (e) { throw e; }
  if (!startCoord) throw new Error('Não foi possível geocodificar o endereço base.');

  const targets = [];
  routeNames.forEach(name => {
    (routes[name] || []).forEach((p, idx) => {
      if (p.isGeocodable === false) return;
      const hasCoord = p.lat !== null && p.lat !== undefined && p.lng !== null && p.lng !== undefined && !isNaN(p.lat) && !isNaN(p.lng);
      if (hasCoord || !p.address) return;
      targets.push({ name, idx });
    });
  });

  for (let i = 0; i < targets.length; i++) {
    const { name, idx } = targets[i];
    const p = routes[name][idx];
    progressCb?.(i + 1, targets.length, p.name);
    try {
      const r = await geocodeMapbox(formatAddr(p.address));
      if (r) { p.lat = r.lat; p.lng = r.lng; p.status = 'ok'; p.mapsAddress = formatAddr(p.address); }
      else p.status = 'error';
    } catch (e) { p.status = 'error'; }
    if (i < targets.length - 1) await sleep(120);
  }

  saveToStorage();
  syncRouteKeysToDB(routeNames);
  if (currentRouteKey && routeNames.includes(currentRouteKey)) {
    points = routes[currentRouteKey].map(p => ({ isGeocodable: true, ...p }));
    renderList();
  }
  renderRouteButtons();
  return targets.length;
};

const geocodeThenExport = async (routeNames, filename, btn) => {
  if (!routeNames.length) { showToast('Nenhum roteiro selecionado', 'error'); return; }
  btn.disabled = true;
  const progressEl = document.getElementById('export-progress-text');
  try {
    const n = await geocodeMissingInRoutes(routeNames, (done, total, name) => {
      if (progressEl) progressEl.textContent = `Geocodificando pendências ${done}/${total} — ${name}…`;
    });
    if (progressEl) progressEl.textContent = n ? `✓ ${n} ponto(s) pendente(s) geocodificado(s)` : '';
  } catch (e) {
    showToast('Erro ao geocodificar pendências: ' + e.message, 'error');
    btn.disabled = false;
    return;
  }
  exportRoutesAsKml(routeNames, filename);
  updateExportButtonsState();
  btn.disabled = false;
  if (progressEl) setTimeout(() => { progressEl.textContent = ''; }, 3000);
};

document.getElementById('btn-gen-link').onclick = async function () {
  this.disabled = true;

  if (!geocodeDone && !(await geocodeAllPoints())) { this.disabled = false; return; }

  const valid = points.filter(p => p.status === 'ok'), errs = points.filter(p => p.status === 'error');
  if (!valid.length) { showToast('Nenhum ponto geocodificado', 'error'); this.disabled = false; return; }
  if (!startCoord) { showToast('Base ainda não geocodificada', 'error'); this.disabled = false; return; }

  optimizedStops = valid.slice(); isOptimized = false;
  document.getElementById('st-ok').textContent = valid.length;
  document.getElementById('st-err').textContent = errs.length;
  await updateShareLink(optimizedStops);
  const sn = document.getElementById('split-note');
  sn.classList.remove('hidden');
  sn.textContent = `📍 ${optimizedStops.length} pontos na ordem original.`;
  document.getElementById('sec-out').classList.remove('hidden');
  document.getElementById('ptxt').textContent = `Link gerado: ${valid.length}/${points.length} geocodificados`;
  showOptimizedOrder(optimizedStops);
  showSuccessMessage('✨ Link gerado com sucesso!');
  showToast('✓ Link gerado', 'success');
  this.disabled = false;
};

document.getElementById('btn-run').onclick = async function () {
  this.disabled = true; isOptimized = false;

  if (!(await geocodeAllPoints())) { this.disabled = false; return; }
  isOptimized = true;
  try {
    await buildOutputs();
    showSuccessMessage('✨ Rota otimizada com sucesso!');
    showToast('✓ Otimização concluída', 'success');
  } catch (e) {
    document.getElementById('ptxt').textContent = 'Erro: ' + e.message;
    showToast(e.message, 'error');
  }
  this.disabled = false;
};

// ============================================================================
// BOTÕES DE SAÍDA
// ============================================================================
document.getElementById('btn-maps').onclick = () => { if (links.length) window.open(links[0], '_blank', 'noopener'); };
document.getElementById('btn-copy').onclick = function () {
  if (!links.length) return;
  navigator.clipboard.writeText(links.join('\n\n')).then(() => {
    this.textContent = '✓ Copiado!'; showToast('Link copiado', 'success');
    setTimeout(() => this.innerHTML = '📋 Copiar link', 2000);
  });
};
document.getElementById('btn-rebuild').onclick = async function () {
  this.classList.add('pulse'); setTimeout(() => this.classList.remove('pulse'), 400);
  const valid = points.filter(p => p.status === 'ok');
  if (!valid.length || !startCoord) { showToast('Nenhum ponto válido', 'error'); return; }
  optimizedStops = valid.slice();
  await updateShareLink(optimizedStops);
  document.getElementById('split-note').textContent = `🔄 ${optimizedStops.length} pontos regenerados na ordem personalizada.`;
  showOptimizedOrder(optimizedStops);
  showSuccessMessage('✨ Link regenerado!');
  showToast('✓ Link atualizado', 'success');
};
document.getElementById('btn-kml').onclick = () => {
  if (!optimizedStops.length) { showToast('Nenhuma rota para exportar', 'error'); return; }
  buildKmlFromOptimizedRoute(optimizedStops);
  showToast('✓ KML baixado', 'success');
};

// ============================================================================
// PAINEL "PERSONALIZAR"
// ============================================================================
const openCustomPanel = () => {
  document.getElementById('custom-backdrop').style.display = 'block';
  document.getElementById('custom-panel').classList.add('open');
  renderPanelRouteTabs();
  renderPanelSelectedList();
  loadCustomSavedRouteOptions();
};

const closeCustomPanel = () => {
  document.getElementById('custom-backdrop').style.display = 'none';
  document.getElementById('custom-panel').classList.remove('open');
};

document.getElementById('custom-backdrop').onclick = closeCustomPanel;
document.getElementById('panel-close-btn').onclick = closeCustomPanel;

const renderPanelRouteTabs = () => {
  const c = document.getElementById('panel-route-tabs');
  const names = Object.keys(routes).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  if (!names.length) { c.innerHTML = '<div class="panel-no-routes">Carregue arquivos KML primeiro para selecionar pontos</div>'; return; }
  c.innerHTML = '';
  names.forEach(name => {
    const selCount = customSelection.filter(s => s.routeName === name).length;
    const btn = document.createElement('button');
    btn.className = 'panel-route-tab' + (name === panelCurrentRoute ? ' active' : '');
    btn.innerHTML = escXML(name.replace(/\.xlsx$/i, '')) + (selCount ? `<span class="tab-count">${selCount}</span>` : '');
    btn.onclick = () => { panelCurrentRoute = name; renderPanelRouteTabs(); renderPanelPoints(name); };
    c.appendChild(btn);
  });
};

const renderPanelPoints = routeName => {
  const c = document.getElementById('panel-points-list');
  if (!routeName || !routes[routeName]) { c.innerHTML = '<div class="panel-points-placeholder">Selecione um roteiro acima</div>'; return; }
  const pts = routes[routeName];
  if (!pts.length) { c.innerHTML = '<div class="panel-points-placeholder">Roteiro vazio</div>'; return; }
  c.innerHTML = '';
  pts.forEach((p, idx) => {
    const checked = isPointSelected(routeName, idx);
    const row = document.createElement('div');
    row.className = 'panel-point-row' + (checked ? ' checked' : '');
    row.dataset.routeName = routeName; row.dataset.idx = idx;
    const coord = (p.lat !== null && p.lng !== null) ? '📍' : p.address ? '' : '⚠️';
    row.innerHTML = `<div class="pp-check">${checked ? '✓' : ''}</div><span class="pp-name">${escXML(p.name)}</span><span class="pp-addr" title="${escXML(p.address || '')}">${escXML(p.address || '(sem endereço)')}</span><span class="pp-coord">${coord}</span>`;
    row.onclick = () => togglePointSelection(routeName, idx);
    c.appendChild(row);
  });
  updateSelectAllCheckbox(routeName);
};

const isPointSelected = (routeName, pointIdx) => customSelection.some(s => s.routeName === routeName && s.pointIdx === pointIdx);

const updateSelectAllCheckbox = routeName => {
  const cb = document.getElementById('panel-select-all-check');
  if (!cb) return;
  if (!routeName || !routes[routeName]?.length) { cb.checked = false; cb.indeterminate = false; cb.disabled = true; return; }
  cb.disabled = false;
  const total = routes[routeName].length;
  const selectedCount = routes[routeName].filter((_, idx) => isPointSelected(routeName, idx)).length;
  cb.checked = selectedCount === total;
  cb.indeterminate = selectedCount > 0 && selectedCount < total;
};

const selectAllPoints = routeName => {
  if (!routes[routeName]) return;
  routes[routeName].forEach((p, idx) => {
    if (!isPointSelected(routeName, idx)) customSelection.push({ routeName, pointIdx: idx, point: { ...p } });
  });
  renderPanelPoints(routeName); renderPanelSelectedList(); renderPanelRouteTabs();
  customPanelGeocodeDone = false;
};

const unselectAllPoints = routeName => {
  customSelection = customSelection.filter(s => s.routeName !== routeName);
  renderPanelPoints(routeName); renderPanelSelectedList(); renderPanelRouteTabs();
  customPanelGeocodeDone = false;
};

const togglePointSelection = (routeName, pointIdx) => {
  const existing = customSelection.findIndex(s => s.routeName === routeName && s.pointIdx === pointIdx);
  if (existing >= 0) customSelection.splice(existing, 1);
  else customSelection.push({ routeName, pointIdx, point: { ...routes[routeName][pointIdx] } });
  renderPanelPoints(routeName); renderPanelSelectedList(); renderPanelRouteTabs();
  updateSelectAllCheckbox(routeName);
  customPanelGeocodeDone = false;
};

document.getElementById('panel-select-all-check').onchange = function () {
  if (!panelCurrentRoute) return;
  (this.checked ? selectAllPoints : unselectAllPoints)(panelCurrentRoute);
  updateSelectAllCheckbox(panelCurrentRoute);
};

const createEmptyEl = () => {
  const d = document.createElement('div');
  d.className = 'sel-empty'; d.id = 'panel-sel-empty';
  d.innerHTML = 'Nenhum ponto selecionado ainda.<br><span class="sel-empty-hint">Clique nos pontos acima para adicionar.</span>';
  return d;
};

const renderPanelSelectedList = () => {
  const c = document.getElementById('panel-selected-list');
  document.getElementById('panel-sel-count').textContent = customSelection.length;
  if (!customSelection.length) { c.innerHTML = ''; c.appendChild(createEmptyEl()); return; }
  c.innerHTML = '';
  customSelection.forEach((sel, idx) => {
    const p = sel.point;
    const row = document.createElement('div');
    row.className = 'sel-row'; row.dataset.selIdx = idx; row.draggable = true;
    const shortRoute = sel.routeName.replace(/\.xlsx$/i, '').substring(0, 12) + (sel.routeName.length > 12 ? '…' : '');
    const addr = (p.address || '').substring(0, 35) + (p.address?.length > 35 ? '…' : '');
    const hasCoord = p.lat !== null && p.lng !== null;
    row.innerHTML = `<span class="sel-drag">☰</span><span class="sel-route-badge" title="${escXML(sel.routeName)}">${escXML(shortRoute)}</span><span class="sel-name">${escXML(p.name)}</span><span class="sel-addr">${escXML(addr) || 'sem endereço'}</span>${hasCoord ? '<span class="sel-coord-flag sel-coord-ok">📍</span>' : '<span class="sel-coord-flag sel-coord-warn">⚠️</span>'}<button class="sel-remove" data-idx="${idx}" title="Remover">✕</button>`;

    row.querySelector('.sel-remove').onclick = e => {
      e.stopPropagation();
      customSelection.splice(idx, 1);
      renderPanelSelectedList(); renderPanelRouteTabs();
      if (panelCurrentRoute) renderPanelPoints(panelCurrentRoute);
      customPanelGeocodeDone = false;
    };
    row.ondragstart = e => { row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', idx); };
    row.ondragend = () => { row.classList.remove('dragging'); document.querySelectorAll('.sel-row').forEach(r => r.classList.remove('drag-over')); };
    row.ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; row.classList.add('drag-over'); };
    row.ondragleave = () => row.classList.remove('drag-over');
    row.ondrop = e => {
      e.preventDefault(); row.classList.remove('drag-over');
      const fromIdx = parseInt(e.dataTransfer.getData('text/plain')), toIdx = parseInt(row.dataset.selIdx);
      if (fromIdx === toIdx) return;
      const moved = customSelection.splice(fromIdx, 1)[0];
      customSelection.splice(toIdx, 0, moved);
      renderPanelSelectedList();
      customPanelGeocodeDone = false;
    };
    c.appendChild(row);
  });
};

const setPanelStatus = (msg, type) => {
  const el = document.getElementById('panel-status');
  el.textContent = msg;
  el.style.color = type === 'error' ? 'var(--color-error)' : type === 'success' ? 'var(--color-success)' : 'var(--color-text-secondary)';
};

const geocodeCustomSelectionPoints = async () => {
  const status = document.getElementById('panel-status');
  try { await ensureStartCoord(); } catch (e) { setPanelStatus(e.message, 'error'); return false; }
  if (!startCoord) { setPanelStatus('Não foi possível geocodificar o endereço base.', 'error'); return false; }

  const needsGeocode = customSelection.filter(s => s.point.isGeocodable !== false && (s.point.lat === null || s.point.lng === null));
  if (!needsGeocode.length) { customPanelGeocodeDone = true; return true; }

  const prog = document.getElementById('panel-mini-progress'), fill = document.getElementById('panel-mini-fill');
  prog.style.display = 'block'; fill.style.width = '0%';

  for (let i = 0; i < customSelection.length; i++) {
    const sel = customSelection[i], p = sel.point;
    if (p.isGeocodable === false) {
      p.status = (p.lat !== null && p.lng !== null) ? 'ok' : 'error';
      fill.style.width = Math.round((i + 1) / customSelection.length * 100) + '%';
      continue;
    }
    if (p.lat !== null && p.lng !== null) { fill.style.width = Math.round((i + 1) / customSelection.length * 100) + '%'; continue; }
    if (!p.address) { p.status = 'error'; fill.style.width = Math.round((i + 1) / customSelection.length * 100) + '%'; continue; }
    status.textContent = `Geocodificando ${i + 1}/${customSelection.length} — ${p.name}…`;
    try {
      const r = await geocodeMapbox(formatAddr(p.address));
      if (r) {
        p.lat = r.lat; p.lng = r.lng; p.status = 'ok'; p.mapsAddress = formatAddr(p.address);
        if (routes[sel.routeName]?.[sel.pointIdx]) {
          Object.assign(routes[sel.routeName][sel.pointIdx], { lat: r.lat, lng: r.lng, status: 'ok' });
          saveToStorage();
        }
      } else { p.status = 'error'; }
    } catch (e) { p.status = 'error'; }
    fill.style.width = Math.round((i + 1) / customSelection.length * 100) + '%';
    if (i < customSelection.length - 1) await sleep(120);
  }
  prog.style.display = 'none';
  customPanelGeocodeDone = true;
  renderPanelSelectedList();
  return true;
};

const finishPanelLink = async (stops, label) => {
  const longUrl = buildGoogleMapsUrl(stops);
  customCurrentLink = await shortenUrl(longUrl);
  const lb = document.getElementById('panel-link-box');
  lb.textContent = customCurrentLink; lb.style.display = 'block';
  document.getElementById('panel-qr-section').style.display = 'block';
  generateQRCode(customCurrentLink, 'panel-qrcode');
  setPanelStatus(label, 'success');
  showToast('✓ Link gerado', 'success');
};

document.getElementById('panel-btn-gen-link').onclick = async function () {
  if (!customSelection.length) { setPanelStatus('Selecione pelo menos um ponto primeiro.', 'error'); return; }
  this.disabled = true; setPanelStatus('Processando…');
  try {
    if (!(await geocodeCustomSelectionPoints())) { this.disabled = false; return; }
    const valid = customSelection.filter(s => s.point.lat !== null && s.point.lng !== null).map(s => s.point);
    if (!valid.length) { setPanelStatus('Nenhum ponto com coordenadas válidas.', 'error'); this.disabled = false; return; }
    customOptimizedStops = valid.slice();
    setPanelStatus('Gerando link…');
    await finishPanelLink(customOptimizedStops, `✓ Link gerado · ${valid.length} pontos na ordem selecionada`);
  } catch (err) {
    console.error(err);
    setPanelStatus(err.message || 'Erro ao gerar link.', 'error');
  }
  this.disabled = false;
};

document.getElementById('panel-btn-optimize').onclick = async function () {
  if (!customSelection.length) { setPanelStatus('Selecione pelo menos um ponto primeiro.', 'error'); return; }
  this.disabled = true; setPanelStatus('Processando…');
  if (!(await geocodeCustomSelectionPoints())) { this.disabled = false; return; }
  const valid = customSelection.filter(s => s.point.lat !== null && s.point.lng !== null).map(s => s.point);
  if (!valid.length) { setPanelStatus('Nenhum ponto com coordenadas válidas.', 'error'); this.disabled = false; return; }

  setPanelStatus('Otimizando rota TSP…');
  const t0 = performance.now();
  customOptimizedStops = solveTSP(valid.slice());
  const ms = (performance.now() - t0).toFixed(1);
  const distKm = tourDistanceKm(customOptimizedStops);
  await finishPanelLink(customOptimizedStops, `✓ Otimizado · ${customOptimizedStops.length} pontos · ~${distKm} km · ${ms} ms`);
  this.disabled = false;
};

document.getElementById('panel-btn-copy-link').onclick = () => {
  if (!customCurrentLink) { setPanelStatus('Gere um link primeiro.', 'error'); return; }
  window.open(customCurrentLink, '_blank', 'noopener');
};

document.getElementById('panel-btn-kml').onclick = () => {
  if (!customOptimizedStops.length) { setPanelStatus('Gere/otimize a rota primeiro.', 'error'); return; }
  if (!startCoord) { setPanelStatus('Geocodifique os pontos primeiro.', 'error'); return; }
  const name = document.getElementById('panel-route-name').value.trim() || 'roteiro-personalizado';
  buildKmlFromOptimizedRoute(customOptimizedStops, name);
  showToast('✓ KML baixado', 'success');
};

document.getElementById('panel-btn-clear').onclick = () => {
  customSelection = []; customPanelGeocodeDone = false; customOptimizedStops = []; customCurrentLink = '';
  document.getElementById('panel-link-box').style.display = 'none';
  document.getElementById('panel-qr-section').style.display = 'none';
  document.getElementById('panel-mini-progress').style.display = 'none';
  setPanelStatus('Seleção limpa.', '');
  renderPanelSelectedList(); renderPanelRouteTabs();
  if (panelCurrentRoute) renderPanelPoints(panelCurrentRoute);
  showToast('Seleção limpa', 'info');
};

// ============================================================================
// PERSISTÊNCIA DE ROTEIROS PERSONALIZADOS (localStorage)
// ============================================================================
const isCustomRouteKey = key => typeof key === 'string' && key.startsWith(CUSTOM_ROUTE_PREFIX);
const getCustomRouteName = key => isCustomRouteKey(key) ? key.slice(CUSTOM_ROUTE_PREFIX.length).trim() : '';

const refreshDeleteRouteButton = () => {
  const btn = document.getElementById('btn-del-route');
  if (btn) btn.style.display = isCustomRouteKey(currentRouteKey) ? 'inline-flex' : 'none';
};

document.getElementById('btn-del-route').onclick = function () {
  if (!isCustomRouteKey(currentRouteKey)) return;
  const routeName = getCustomRouteName(currentRouteKey);
  if (!routeName || !confirm(`Remover o roteiro personalizado "${routeName}"?`)) return;

  savedCustomRoutes = savedCustomRoutes.filter(r => r.name !== routeName);
  saveCustomRoutesToStorage();
  loadCustomSavedRouteOptions();

  const deletedRouteKey = currentRouteKey;
  delete routes[currentRouteKey];
  saveToStorage();
  syncRouteKeysToDB([deletedRouteKey]); // routes[deletedRouteKey] não existe mais -> RPC apaga sem reinserir
  renderRouteButtons();

  if (document.getElementById('rname-t').textContent === currentRouteKey) {
    document.getElementById('sec-proc').classList.add('hidden');
    points = []; selectedIdx = -1;
  }
  currentRouteKey = '';
  refreshDeleteRouteButton();
  setPanelStatus(`✓ Roteiro "${routeName}" removido.`, 'success');
  showToast(`✓ "${routeName}" removido`, 'success');
};

const loadCustomSavedRoutes = () => {
  try { savedCustomRoutes = JSON.parse(localStorage.getItem(CUSTOM_LS_KEY)) || []; }
  catch (e) { savedCustomRoutes = []; }
  loadCustomSavedRouteOptions();
};

const saveCustomRoutesToStorage = () => {
  try { localStorage.setItem(CUSTOM_LS_KEY, JSON.stringify(savedCustomRoutes)); } catch (e) { console.warn(e); }
};

const loadCustomSavedRouteOptions = () => {
  let dl = document.getElementById('panel-route-names-dl');
  if (!dl) {
    dl = document.createElement('datalist'); dl.id = 'panel-route-names-dl';
    document.body.appendChild(dl);
    document.getElementById('panel-route-name').setAttribute('list', 'panel-route-names-dl');
  }
  dl.innerHTML = savedCustomRoutes.map(r => `<option value="${escXML(r.name)}">`).join('');
};

document.getElementById('panel-btn-save').onclick = function () {
  const name = document.getElementById('panel-route-name').value.trim();
  if (!name) { setPanelStatus('Digite um nome para o roteiro.', 'error'); document.getElementById('panel-route-name').focus(); return; }
  if (!customSelection.length) { setPanelStatus('Selecione pelo menos um ponto.', 'error'); return; }

  savedCustomRoutes = savedCustomRoutes.filter(r => r.name !== name);
  savedCustomRoutes.push({ name, savedAt: new Date().toISOString(), selection: customSelection.map(s => ({ ...s, point: { ...s.point } })) });
  saveCustomRoutesToStorage();
  loadCustomSavedRouteOptions();
  setPanelStatus(`✓ "${name}" salvo`, 'success');
  showToast(`✓ "${name}" salvo`, 'success');

  const virtualPts = customSelection.map(s => ({ isGeocodable: true, ...s.point, origAddress: s.point.origAddress || s.point.address }));
  routes[CUSTOM_ROUTE_PREFIX + name] = virtualPts;
  saveToStorage(); renderRouteButtons();
  syncRouteKeysToDB([CUSTOM_ROUTE_PREFIX + name]);
  currentRouteKey = CUSTOM_ROUTE_PREFIX + name;
  refreshDeleteRouteButton();
};


// ============================================================================
// TEST HOOKS
// ============================================================================
if (typeof window !== 'undefined') {
  window.__testHooks = {
    escXML, titleCasePt, formatAddr,
    geocodeMapbox, ensureStartCoord,
    haversine, buildDistMatrix, nearestNeighbor, twoOpt, solveTSP, tourDistanceKm,
    saveToStorage, loadFromStorage, exportJSON, importFromJSON, applyLoadedRoutes,
    supabaseRequest, supabaseSignIn, supabaseSignOut, checkAuthorization, restoreSupabaseSession,
    loadRoutesFromDB, saveRouteKeysToDB, syncRouteKeysToDB, dbRowToPoint, pointToDbRow, syncQueue,
    setDBToggle, updateDBToggleUI, updateJsonExportButtonState, updateAuthUI,
    parseKMLText, buildKmlFromOptimizedRoute, buildMultiRouteKml, exportRoutesAsKml,
    processKMLFiles, mergeRoutesFromFile,
    buildGoogleMapsUrl, shortenUrl, updateShareLink, generateQRCode,
    renderRouteButtons, selectRoute, syncPointsToRoute, renderList, updateRow,
    openEditPanel, closeEditPanel, renderEditRows, collectEditRowsIntoDraft, buildEditRow,
    openCustomPanel, closeCustomPanel, togglePointSelection, selectAllPoints, unselectAllPoints,
    isPointSelected, geocodeCustomSelectionPoints, finishPanelLink, renderPanelPoints,
    renderPanelSelectedList, renderPanelRouteTabs,
    isCustomRouteKey, getCustomRouteName, loadCustomSavedRoutes, saveCustomRoutesToStorage,
    loadCustomSavedRouteOptions, refreshDeleteRouteButton,
    CUSTOM_ROUTE_PREFIX, STORAGE_KEY, CUSTOM_LS_KEY, START_END,
    SUPABASE_PROXY_URL, SUPABASE_SESSION_KEY, DB_TOGGLE_KEY,
    state: {
      get routes() { return routes; }, set routes(v) { routes = v; },
      get dataSource() { return dataSource; }, set dataSource(v) { dataSource = v; },
      get dbToggleOn() { return dbToggleOn; }, set dbToggleOn(v) { dbToggleOn = v; },
      get isAuthorizedUser() { return isAuthorizedUser; }, set isAuthorizedUser(v) { isAuthorizedUser = v; },
      get canWriteDB() { return canWriteDB; }, set canWriteDB(v) { canWriteDB = v; },
      get supabaseSession() { return supabaseSession; }, set supabaseSession(v) { supabaseSession = v; },
      get suppressDBSync() { return suppressDBSync; }, set suppressDBSync(v) { suppressDBSync = v; },
      get points() { return points; }, set points(v) { points = v; },
      get startCoord() { return startCoord; }, set startCoord(v) { startCoord = v; },
      get currentRoute() { return currentRoute; }, set currentRoute(v) { currentRoute = v; },
      get currentRouteKey() { return currentRouteKey; }, set currentRouteKey(v) { currentRouteKey = v; },
      get customSelection() { return customSelection; }, set customSelection(v) { customSelection = v; },
      get panelCurrentRoute() { return panelCurrentRoute; }, set panelCurrentRoute(v) { panelCurrentRoute = v; },
      get editDraftPoints() { return editDraftPoints; }, set editDraftPoints(v) { editDraftPoints = v; },
      get savedCustomRoutes() { return savedCustomRoutes; }, set savedCustomRoutes(v) { savedCustomRoutes = v; },
      get exportSelection() { return exportSelection; }, set exportSelection(v) { exportSelection = v; },
      get geocodeDone() { return geocodeDone; }, set geocodeDone(v) { geocodeDone = v; },
      get isOptimized() { return isOptimized; }, set isOptimized(v) { isOptimized = v; },
      get optimizedStops() { return optimizedStops; }, set optimizedStops(v) { optimizedStops = v; },
      get links() { return links; }, set links(v) { links = v; },
      get loadedFileNames() { return loadedFileNames; }, set loadedFileNames(v) { loadedFileNames = v; },
      get customCurrentLink() { return customCurrentLink; }, set customCurrentLink(v) { customCurrentLink = v; },
      get customOptimizedStops() { return customOptimizedStops; }, set customOptimizedStops(v) { customOptimizedStops = v; },
    }
  };
  window.dispatchEvent(new Event('__scriptReady'));
}