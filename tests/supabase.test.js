// tests/supabase.test.js
//
// Segue o mesmo padrão dos demais arquivos de teste do projeto: usa
// loadApp() de testUtils.js, que recarrega a fixture do DOM (document.body)
// e reimporta script.js do zero a cada teste, expondo window.__testHooks.
// Isso é importante especialmente para os testes de toast (showToast anexa
// <div class="toast ...) em document.body): com um DOM reciclado por teste,
// não há risco de um toast de um teste anterior "vazar" e falsear a
// asserção de outro teste (o antigo padrão beforeAll + window.eval só
// definia document.documentElement.innerHTML uma vez para todo o arquivo).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadApp } from './testUtils.js';

let hooks;

beforeEach(async () => {
  hooks = await loadApp();
  hooks.state.dbToggleOn = true;
  global.fetch = vi.fn();
});

/** Lê os toasts (showToast) presentes no DOM no momento da chamada. */
const toasts = () => [...document.querySelectorAll('.toast')].map(t => ({
  type: t.className.replace('toast', '').trim(),
  text: t.textContent,
}));
const hasSuccessToast = () => toasts().some(t => t.type.includes('success'));
const hasErrorToast = () => toasts().some(t => t.type.includes('error'));

describe('supabaseRequest', () => {
  it('inclui Authorization quando há sessão ativa', async () => {
    hooks.state.supabaseSession = { access_token: 'tok123' };
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });

    await hooks.supabaseRequest('/rest/v1/route_points');

    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer tok123');
  });

  it('não inclui Authorization quando auth: false, mesmo com sessão ativa', async () => {
    hooks.state.supabaseSession = { access_token: 'tok123' };
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });

    await hooks.supabaseRequest('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: {} });

    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers.Authorization).toBeUndefined();
  });

  it('não inclui Authorization quando o access_token é a string "undefined"', async () => {
    // Guarda contra sessão corrompida (ex: veio de um JSON.stringify(undefined) salvo por engano).
    hooks.state.supabaseSession = { access_token: 'undefined' };
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    await hooks.supabaseRequest('/rest/v1/route_points');

    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers.Authorization).toBeUndefined();
  });

  it('só adiciona Content-Type quando há body em métodos de escrita', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await hooks.supabaseRequest('/rest/v1/route_points');
    expect(global.fetch.mock.calls[0][1].headers['Content-Type']).toBeUndefined();

    global.fetch.mockClear();
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await hooks.supabaseRequest('/rest/v1/route_points', { method: 'POST', body: { a: 1 } });
    expect(global.fetch.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
    expect(global.fetch.mock.calls[0][1].body).toBe(JSON.stringify({ a: 1 }));
  });

  it('lança erro com a mensagem do corpo quando a resposta falha', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: 'RLS negou o acesso' }),
    });
    await expect(hooks.supabaseRequest('/rest/v1/route_points')).rejects.toThrow('RLS negou o acesso');
  });

  it('aceita error_description e msg como formatos alternativos de mensagem de erro', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error_description: 'Credenciais inválidas' }) });
    await expect(hooks.supabaseRequest('/auth/v1/token')).rejects.toThrow('Credenciais inválidas');

    global.fetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ msg: 'Token expirado' }) });
    await expect(hooks.supabaseRequest('/auth/v1/token')).rejects.toThrow('Token expirado');
  });

  it('cai para "Erro <status>" quando o corpo de erro não é JSON válido', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new SyntaxError('unexpected token'); },
    });
    await expect(hooks.supabaseRequest('/rest/v1/route_points')).rejects.toThrow('Erro 500');
  });

  it('lança mensagem de conexão quando fetch rejeita (falha de rede)', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(hooks.supabaseRequest('/rest/v1/route_points')).rejects.toThrow(/conexão/i);
  });

  it('retorna null em respostas 204 sem tentar parsear o corpo', async () => {
    const json = vi.fn();
    global.fetch.mockResolvedValue({ ok: true, status: 204, json });
    const result = await hooks.supabaseRequest('/rest/v1/route_points', { method: 'DELETE' });
    expect(result).toBeNull();
    expect(json).not.toHaveBeenCalled();
  });

  it('retorna null quando a resposta é ok mas o corpo não é JSON parseável', async () => {
    const result = await (async () => {
      global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } });
      return hooks.supabaseRequest('/rest/v1/route_points');
    })();
    expect(result).toBeNull();
  });
});

describe('checkAuthorization', () => {
  it('marca isAuthorizedUser=false quando não há sessão', async () => {
    const result = await hooks.checkAuthorization();
    expect(result).toBe(false);
    expect(hooks.state.isAuthorizedUser).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('marca isAuthorizedUser=true e canWriteDB=true quando authorized_users retorna can_write=true', async () => {
    hooks.state.supabaseSession = { access_token: 'tok', user: { id: 'uuid-1' } };
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ([{ user_id: 'uuid-1', can_write: true }]) });
    const result = await hooks.checkAuthorization();
    expect(result).toBe(true);
    expect(hooks.state.isAuthorizedUser).toBe(true);
    expect(hooks.state.canWriteDB).toBe(true);
  });

  it('marca isAuthorizedUser=true mas canWriteDB=false quando can_write não é true (ausente ou false)', async () => {
    hooks.state.supabaseSession = { access_token: 'tok', user: { id: 'uuid-1' } };
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ([{ user_id: 'uuid-1' }]) });
    let result = await hooks.checkAuthorization();
    expect(result).toBe(true);
    expect(hooks.state.canWriteDB).toBe(false);

    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ([{ user_id: 'uuid-1', can_write: false }]) });
    result = await hooks.checkAuthorization();
    expect(hooks.state.canWriteDB).toBe(false);
  });

  it('marca isAuthorizedUser=false quando authorized_users retorna vazio', async () => {
    hooks.state.supabaseSession = { access_token: 'tok', user: { id: 'uuid-1' } };
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ([]) });
    const result = await hooks.checkAuthorization();
    expect(result).toBe(false);
    expect(hooks.state.isAuthorizedUser).toBe(false);
    expect(hooks.state.canWriteDB).toBe(false);
  });

  it('marca isAuthorizedUser=false quando a requisição falha (rede ou RLS)', async () => {
    hooks.state.supabaseSession = { access_token: 'tok', user: { id: 'uuid-1' } };
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await hooks.checkAuthorization();
    expect(result).toBe(false);
    expect(hooks.state.isAuthorizedUser).toBe(false);
    expect(hooks.state.canWriteDB).toBe(false);
  });
});

describe('dbRowToPoint / pointToDbRow (round-trip)', () => {
  it('preserva os campos ao converter camelCase <-> snake_case', () => {
    const point = {
      name: 'I01', address: 'Rua X, 10', origAddress: 'Rua X, 10', mapsAddress: 'Rua X,, 10',
      lat: -30.01, lng: -51.2, status: 'ok', corrected: false, isGeocodable: true,
      description: 'desc', roteiro: 'I SUL', subRoteiro: 'I SUL I',
      setorAbastecimento: 'EBAT X', sistema: 'SAA - X',
    };
    const row = hooks.pointToDbRow('ILHA', 0, point);
    expect(row.route_key).toBe('ILHA');
    expect(row.point_order).toBe(0);
    expect(row.orig_address).toBe(point.origAddress);
    expect(row.bairro).toBeUndefined();
    expect(row.cidade).toBeUndefined();
    expect(row.complemento).toBeUndefined();

    const back = hooks.dbRowToPoint(row);
    expect(back).toEqual(point);
  });

  it('pointToDbRow usa null para campos ausentes e mantém is_geocodable=true por padrão', () => {
    const row = hooks.pointToDbRow('ILHA', 2, { name: 'I03' });
    expect(row.address).toBeNull();
    expect(row.lat).toBeNull();
    expect(row.lng).toBeNull();
    expect(row.corrected).toBe(false);
    expect(row.is_geocodable).toBe(true);
  });

  it('dbRowToPoint marca isGeocodable=false apenas quando is_geocodable === false explicitamente', () => {
    const point = hooks.dbRowToPoint({ name: 'I04', is_geocodable: false });
    expect(point.isGeocodable).toBe(false);
  });

  it('pointToDbRow marca corrected=true quando o ponto foi corrigido manualmente', () => {
    const row = hooks.pointToDbRow('ILHA', 0, { name: 'I05', corrected: true });
    expect(row.corrected).toBe(true);
  });
});

describe('loadRoutesFromDB', () => {
  it('não faz nada e avisa quando o usuário não é autorizado', async () => {
    hooks.state.isAuthorizedUser = false;
    const result = await hooks.loadRoutesFromDB();
    expect(result).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(hasErrorToast()).toBe(true);
    expect(hasSuccessToast()).toBe(false);
  });

  it('agrupa route_points por route_key respeitando point_order e marca dataSource=db', async () => {
    hooks.state.isAuthorizedUser = true;
    hooks.state.supabaseSession = { access_token: 'tok', user: { id: 'uuid-1' } };

    const rows = [
      { route_key: 'ILHA', point_order: 0, name: 'I01', address: 'A', lat: -30, lng: -51, is_geocodable: true, corrected: false },
      { route_key: 'ILHA', point_order: 1, name: 'I02', address: 'B', lat: -30.1, lng: -51.1, is_geocodable: true, corrected: false },
    ];
    global.fetch.mockImplementation(async url => {
      if (url.includes('/rest/v1/route_points')) return { ok: true, status: 200, json: async () => rows };
      if (url.includes('/rest/v1/dataset_meta')) return { ok: true, status: 200, json: async () => ([{ id: 1, saved_at: '2026-01-01T00:00:00Z', file_names: ['a.kml'] }]) };
      return { ok: true, status: 200, json: async () => ([]) };
    });

    const result = await hooks.loadRoutesFromDB();
    expect(result).toBe(true);
    expect(hooks.state.dataSource).toBe('db');
    expect(hooks.state.routes.ILHA.map(p => p.name)).toEqual(['I01', 'I02']);
    expect(hasSuccessToast()).toBe(true);
  });

  it('agrupa múltiplos route_key diferentes em roteiros separados', async () => {
    hooks.state.isAuthorizedUser = true;
    hooks.state.supabaseSession = { access_token: 'tok', user: { id: 'uuid-1' } };

    const rows = [
      { route_key: 'ILHA', point_order: 0, name: 'I01' },
      { route_key: 'CENTRO', point_order: 0, name: 'C01' },
      { route_key: 'ILHA', point_order: 1, name: 'I02' },
    ];
    global.fetch.mockImplementation(async url => {
      if (url.includes('/rest/v1/route_points')) return { ok: true, status: 200, json: async () => rows };
      return { ok: true, status: 200, json: async () => ([]) };
    });

    await hooks.loadRoutesFromDB();
    expect(Object.keys(hooks.state.routes).sort()).toEqual(['CENTRO', 'ILHA']);
    expect(hooks.state.routes.ILHA.map(p => p.name)).toEqual(['I01', 'I02']);
  });

  it('quando o banco não tem nenhum ponto, zera routes e ainda marca dataSource=db', async () => {
    hooks.state.isAuthorizedUser = true;
    hooks.state.supabaseSession = { access_token: 'tok', user: { id: 'uuid-1' } };
    hooks.state.routes = { ANTIGA: [{ name: 'X' }] };

    global.fetch.mockImplementation(async url => {
      if (url.includes('/rest/v1/route_points')) return { ok: true, status: 200, json: async () => ([]) };
      if (url.includes('/rest/v1/dataset_meta')) return { ok: true, status: 200, json: async () => ([]) };
      return { ok: true, status: 200, json: async () => ([]) };
    });

    const result = await hooks.loadRoutesFromDB();
    expect(result).toBe(true);
    expect(hooks.state.dataSource).toBe('db');
    expect(hooks.state.routes).toEqual({});
  });

  it('não altera routes/dataSource locais e mostra erro quando a requisição falha', async () => {
    hooks.state.isAuthorizedUser = true;
    hooks.state.supabaseSession = { access_token: 'tok', user: { id: 'uuid-1' } };
    hooks.state.routes = { LOCAL: [{ name: 'L01' }] };
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await hooks.loadRoutesFromDB();
    expect(result).toBe(false);
    expect(hooks.state.dataSource).toBe('local');
    expect(hooks.state.routes).toEqual({ LOCAL: [{ name: 'L01' }] });
    expect(hasErrorToast()).toBe(true);
    expect(hasSuccessToast()).toBe(false);
  });
});

// NOTA: as antigas funções `saveRoutesToDB` (bulk DELETE+POST de todo o dataset)
// e `maybeSyncRoutesToDB` foram substituídas por uma arquitetura de sincronização
// parcial por route_key (saveRouteKeysToDB + fila em syncRouteKeysToDB/syncQueue),
// que evita reescrever o banco inteiro a cada save e serializa escritas concorrentes.
// script.js não expõe mais as funções antigas, então os testes abaixo cobrem a
// API atual em vez de forçar a existência de algo que não existe mais.
describe('saveRouteKeysToDB', () => {
  it('rejeita quando o usuário não é autorizado', async () => {
    hooks.state.isAuthorizedUser = false;
    await expect(hooks.saveRouteKeysToDB(['ILHA'])).rejects.toThrow(/autoriza/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejeita quando o usuário só tem acesso de leitura ao banco', async () => {
    hooks.state.isAuthorizedUser = true;
    hooks.state.canWriteDB = false;
    await expect(hooks.saveRouteKeysToDB(['ILHA'])).rejects.toThrow(/leitura/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('não faz nenhuma chamada quando a lista de route_keys está vazia ou ausente', async () => {
    hooks.state.isAuthorizedUser = true;
    hooks.state.canWriteDB = true;
    await hooks.saveRouteKeysToDB([]);
    await hooks.saveRouteKeysToDB();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('chama a RPC save_routes_partial com os pontos convertidos e depois confirma a contagem via count_route_points', async () => {
    hooks.state.isAuthorizedUser = true;
    hooks.state.canWriteDB = true;
    hooks.state.supabaseSession = { access_token: 'tok' };
    hooks.state.loadedFileNames = ['ilha.kml'];
    hooks.state.routes = { ILHA: [{ name: 'I01', address: 'A', lat: -30, lng: -51 }] };

    global.fetch.mockImplementation(async url => {
      if (url.includes('/rpc/save_routes_partial')) return { ok: true, status: 200, json: async () => null };
      if (url.includes('/rpc/count_route_points')) return { ok: true, status: 200, json: async () => 1 };
      return { ok: true, status: 200, json: async () => null };
    });

    await hooks.saveRouteKeysToDB(['ILHA']);

    const calls = global.fetch.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toContain('/rpc/save_routes_partial');
    expect(calls[0][1].method).toBe('POST');
    const savedBody = JSON.parse(calls[0][1].body);
    expect(savedBody.p_route_keys).toEqual(['ILHA']);
    expect(savedBody.p_file_names).toEqual(['ilha.kml']);
    expect(savedBody.p_route_points).toEqual([hooks.pointToDbRow('ILHA', 0, hooks.state.routes.ILHA[0])]);
    expect(calls[1][0]).toContain('/rpc/count_route_points');
    expect(calls[1][1].method).toBe('POST');
    expect(JSON.parse(calls[1][1].body).p_route_keys).toEqual(['ILHA']);
  });

  it('junta os pontos de vários route_keys num único payload quando mais de um roteiro é salvo', async () => {
    hooks.state.isAuthorizedUser = true;
    hooks.state.canWriteDB = true;
    hooks.state.supabaseSession = { access_token: 'tok' };
    hooks.state.routes = {
      ILHA: [{ name: 'I01' }],
      CENTRO: [{ name: 'C01' }, { name: 'C02' }],
    };

    global.fetch.mockImplementation(async url => {
      if (url.includes('/rpc/count_route_points')) return { ok: true, status: 200, json: async () => 3 };
      return { ok: true, status: 200, json: async () => null };
    });

    await hooks.saveRouteKeysToDB(['ILHA', 'CENTRO']);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.p_route_points).toHaveLength(3);
    expect(body.p_route_points.map(p => p.route_key)).toEqual(['ILHA', 'CENTRO', 'CENTRO']);
  });

  it('lança erro de verificação quando a contagem retornada pelo banco não bate com o esperado', async () => {
    hooks.state.isAuthorizedUser = true;
    hooks.state.canWriteDB = true;
    hooks.state.supabaseSession = { access_token: 'tok' };
    hooks.state.routes = { ILHA: [{ name: 'I01' }] };

    global.fetch.mockImplementation(async url => {
      if (url.includes('/rpc/save_routes_partial')) return { ok: true, status: 200, json: async () => null };
      if (url.includes('/rpc/count_route_points')) return { ok: true, status: 200, json: async () => 0 };
      return { ok: true, status: 200, json: async () => null };
    });

    await expect(hooks.saveRouteKeysToDB(['ILHA'])).rejects.toThrow(/Verificação falhou/i);
  });
});

describe('syncRouteKeysToDB (fila de sincronização)', () => {
  it('não enfileira quando suppressDBSync está ativo', () => {
    hooks.state.suppressDBSync = true;
    hooks.state.dataSource = 'db';
    hooks.state.isAuthorizedUser = true;
    hooks.state.canWriteDB = true;
    hooks.state.supabaseSession = { access_token: 'tok' };
    hooks.syncRouteKeysToDB(['ILHA']);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(hooks.syncQueue.pendingKeys.size).toBe(0);
  });

  it('não enfileira quando dataSource não é "db"', () => {
    hooks.state.dataSource = 'local';
    hooks.state.isAuthorizedUser = true;
    hooks.state.canWriteDB = true;
    hooks.state.supabaseSession = { access_token: 'tok' };
    hooks.syncRouteKeysToDB(['ILHA']);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('não enfileira quando o usuário não é autorizado ou não há sessão', () => {
    hooks.state.dataSource = 'db';
    hooks.state.isAuthorizedUser = false;
    hooks.state.supabaseSession = { access_token: 'tok' };
    hooks.syncRouteKeysToDB(['ILHA']);
    expect(global.fetch).not.toHaveBeenCalled();

    hooks.state.isAuthorizedUser = true;
    hooks.state.supabaseSession = null;
    hooks.syncRouteKeysToDB(['ILHA']);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('avisa (toast info) e não sincroniza quando o acesso ao banco é somente leitura', () => {
    hooks.state.dataSource = 'db';
    hooks.state.isAuthorizedUser = true;
    hooks.state.canWriteDB = false;
    hooks.state.supabaseSession = { access_token: 'tok' };
    hooks.syncRouteKeysToDB(['ILHA']);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(hasSuccessToast()).toBe(false);
  });

  it('ignora chaves vazias/falsy na lista antes de enfileirar', () => {
    hooks.state.dataSource = 'db';
    hooks.state.isAuthorizedUser = true;
    hooks.state.canWriteDB = true;
    hooks.state.supabaseSession = { access_token: 'tok' };
    hooks.syncRouteKeysToDB([null, undefined, '']);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(hooks.syncQueue.pendingKeys.size).toBe(0);
  });

  it('sincroniza (dispara saveRouteKeysToDB) quando todas as condições são satisfeitas', async () => {
    hooks.state.dataSource = 'db';
    hooks.state.isAuthorizedUser = true;
    hooks.state.canWriteDB = true;
    hooks.state.supabaseSession = { access_token: 'tok' };
    hooks.state.routes = { ILHA: [{ name: 'I01' }] };

    global.fetch.mockImplementation(async url => {
      if (url.includes('/rpc/count_route_points')) return { ok: true, status: 200, json: async () => 1 };
      return { ok: true, status: 200, json: async () => null };
    });

    hooks.syncRouteKeysToDB(['ILHA']);
    // a fila roda de forma assíncrona (fire-and-forget); aguarda os microtasks/timers.
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    expect(global.fetch).toHaveBeenCalled();
    const urls = global.fetch.mock.calls.map(([url]) => url);
    expect(urls.some(u => u.includes('/rpc/save_routes_partial'))).toBe(true);
    expect(hasSuccessToast()).toBe(true);
  });

  it('acumula route_keys pedidos enquanto uma sincronização anterior ainda está em andamento', async () => {
    hooks.state.dataSource = 'db';
    hooks.state.isAuthorizedUser = true;
    hooks.state.canWriteDB = true;
    hooks.state.supabaseSession = { access_token: 'tok' };
    hooks.state.routes = { ILHA: [{ name: 'I01' }], CENTRO: [{ name: 'C01' }] };

    let resolveFirstSave;
    let saveCalls = 0;
    global.fetch.mockImplementation((url) => {
      if (url.includes('/rpc/save_routes_partial')) {
        saveCalls++;
        if (saveCalls === 1) return new Promise(resolve => { resolveFirstSave = () => resolve({ ok: true, status: 200, json: async () => null }); });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => 1 });
    });

    hooks.syncRouteKeysToDB(['ILHA']); // dispara a 1ª sincronização, que fica "presa" aguardando resolveFirstSave
    await new Promise(r => setTimeout(r, 0));
    expect(hooks.syncQueue.running).toBe(true);

    hooks.syncRouteKeysToDB(['CENTRO']); // chega enquanto a 1ª ainda está rodando: deve só acumular, não disparar 2ª chamada concorrente
    expect(hooks.syncQueue.pendingKeys.has('CENTRO')).toBe(true);
    expect(saveCalls).toBe(1);

    resolveFirstSave();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    expect(saveCalls).toBe(2); // 'CENTRO' processado só depois que a 1ª sincronização terminou
    expect(hooks.syncQueue.pendingKeys.size).toBe(0);
  });

  it('em caso de falha (não relacionada à rede), re-enfileira a chave e marca o indicador de status como falho', async () => {
    hooks.state.dataSource = 'db';
    hooks.state.isAuthorizedUser = true;
    hooks.state.canWriteDB = true;
    hooks.state.supabaseSession = { access_token: 'tok' };
    hooks.state.routes = { ILHA: [{ name: 'I01' }] };

    // save_routes_partial funciona, mas a verificação de contagem não bate — falha "real" de dados.
    global.fetch.mockImplementation(async url => {
      if (url.includes('/rpc/save_routes_partial')) return { ok: true, status: 200, json: async () => null };
      if (url.includes('/rpc/count_route_points')) return { ok: true, status: 200, json: async () => 0 };
      return { ok: true, status: 200, json: async () => null };
    });

    hooks.syncRouteKeysToDB(['ILHA']);
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    expect(hooks.syncQueue.pendingKeys.has('ILHA')).toBe(true);
    expect(hasErrorToast()).toBe(true);
    expect(hasSuccessToast()).toBe(false);
    const savedInfo = document.getElementById('saved-info');
    expect(savedInfo.classList.contains('error')).toBe(true);
  });
});

describe('setDBToggle', () => {
  it('liga/desliga dbToggleOn e persiste em localStorage', () => {
    hooks.setDBToggle(false);
    expect(hooks.state.dbToggleOn).toBe(false);
    expect(localStorage.getItem(hooks.DB_TOGGLE_KEY)).toBe('0');

    hooks.setDBToggle(true);
    expect(hooks.state.dbToggleOn).toBe(true);
    expect(localStorage.getItem(hooks.DB_TOGGLE_KEY)).toBe('1');
  });
});

describe('restoreSupabaseSession', () => {
  it('retorna false quando não há sessão salva em localStorage', async () => {
    const result = await hooks.restoreSupabaseSession();
    expect(result).toBe(false);
    expect(hooks.state.supabaseSession).toBeNull();
  });

  it('retorna false e limpa a sessão quando o JSON salvo está corrompido', async () => {
    localStorage.setItem(hooks.SUPABASE_SESSION_KEY, '{not-json');
    const result = await hooks.restoreSupabaseSession();
    expect(result).toBe(false);
    expect(hooks.state.supabaseSession).toBeNull();
  });

  it('retorna false quando o JSON salvo não tem access_token', async () => {
    localStorage.setItem(hooks.SUPABASE_SESSION_KEY, JSON.stringify({ user: { id: 'uuid-1' } }));
    const result = await hooks.restoreSupabaseSession();
    expect(result).toBe(false);
  });

  it('restaura a sessão salva e confere autorização', async () => {
    const saved = { access_token: 'tok', user: { id: 'uuid-1', email: 'a@b.com' } };
    localStorage.setItem(hooks.SUPABASE_SESSION_KEY, JSON.stringify(saved));
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ([{ user_id: 'uuid-1' }]) });

    const result = await hooks.restoreSupabaseSession();
    expect(result).toBe(true);
    expect(hooks.state.supabaseSession.access_token).toBe('tok');
    expect(hooks.state.isAuthorizedUser).toBe(true);
  });
});

describe('supabaseSignIn / supabaseSignOut', () => {
  it('autentica, persiste sessão e carrega do banco quando autorizado e dbToggleOn=true', async () => {
    hooks.state.dbToggleOn = true;
    global.fetch.mockImplementation(async url => {
      if (url.includes('/auth/v1/token')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'tok', refresh_token: 'ref', user: { id: 'uuid-1', email: 'a@b.com' }, expires_in: 3600 }) };
      }
      if (url.includes('/rest/v1/authorized_users')) {
        return { ok: true, status: 200, json: async () => ([{ user_id: 'uuid-1' }]) };
      }
      if (url.includes('/rest/v1/route_points')) return { ok: true, status: 200, json: async () => ([]) };
      if (url.includes('/rest/v1/dataset_meta')) return { ok: true, status: 200, json: async () => ([]) };
      return { ok: true, status: 200, json: async () => ([]) };
    });

    const session = await hooks.supabaseSignIn('a@b.com', 'senha123');
    expect(session.access_token).toBe('tok');
    expect(hooks.state.isAuthorizedUser).toBe(true);
    expect(JSON.parse(localStorage.getItem(hooks.SUPABASE_SESSION_KEY)).access_token).toBe('tok');
    expect(hooks.state.dataSource).toBe('db');
  });

  it('rejeita e não persiste nada quando as credenciais são inválidas', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error_description: 'Invalid login credentials' }) });

    await expect(hooks.supabaseSignIn('a@b.com', 'senhaerrada')).rejects.toThrow('Invalid login credentials');
    expect(hooks.state.supabaseSession).toBeNull();
    expect(localStorage.getItem(hooks.SUPABASE_SESSION_KEY)).toBeNull();
  });

  it('autentica mas não carrega do banco quando o usuário não é autorizado', async () => {
    global.fetch.mockImplementation(async url => {
      if (url.includes('/auth/v1/token')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'tok', user: { id: 'uuid-2' }, expires_in: 3600 }) };
      }
      if (url.includes('/rest/v1/authorized_users')) return { ok: true, status: 200, json: async () => ([]) };
      return { ok: true, status: 200, json: async () => ([]) };
    });

    await hooks.supabaseSignIn('semacesso@b.com', 'senha123');
    expect(hooks.state.isAuthorizedUser).toBe(false);
    expect(hooks.state.dataSource).toBe('local');
    const urls = global.fetch.mock.calls.map(([url]) => url);
    expect(urls.some(u => u.includes('/rest/v1/route_points'))).toBe(false);
  });

  it('autentica e autoriza mas não carrega do banco quando dbToggleOn=false', async () => {
    hooks.state.dbToggleOn = false;
    global.fetch.mockImplementation(async url => {
      if (url.includes('/auth/v1/token')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'tok', user: { id: 'uuid-1' }, expires_in: 3600 }) };
      }
      if (url.includes('/rest/v1/authorized_users')) return { ok: true, status: 200, json: async () => ([{ user_id: 'uuid-1' }]) };
      return { ok: true, status: 200, json: async () => ([]) };
    });

    await hooks.supabaseSignIn('a@b.com', 'senha123');
    expect(hooks.state.isAuthorizedUser).toBe(true);
    expect(hooks.state.dataSource).toBe('local'); // não muda pra 'db' sem o toggle ligado
    const urls = global.fetch.mock.calls.map(([url]) => url);
    expect(urls.some(u => u.includes('/rest/v1/route_points'))).toBe(false);
  });

  it('supabaseSignOut limpa sessão e permissões e, se dataSource era "db", volta para "local"', async () => {
    hooks.state.supabaseSession = { access_token: 'tok' };
    hooks.state.isAuthorizedUser = true;
    hooks.state.canWriteDB = true;
    hooks.state.dataSource = 'db';
    hooks.state.routes = { ILHA: [{ name: 'I01' }] };
    global.fetch.mockResolvedValue({ ok: true, status: 204 });

    await hooks.supabaseSignOut();

    expect(hooks.state.supabaseSession).toBeNull();
    expect(hooks.state.isAuthorizedUser).toBe(false);
    expect(hooks.state.canWriteDB).toBe(false);
    expect(hooks.state.dataSource).toBe('local');
    expect(hooks.state.routes).toEqual({});
    expect(localStorage.getItem(hooks.SUPABASE_SESSION_KEY)).toBeNull();
  });

  it('supabaseSignOut não falha mesmo se a chamada de logout ao servidor rejeitar', async () => {
    hooks.state.supabaseSession = { access_token: 'tok' };
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(hooks.supabaseSignOut()).resolves.not.toThrow();
    expect(hooks.state.supabaseSession).toBeNull();
  });

  it('supabaseSignOut não tenta chamar o servidor quando não havia sessão ativa', async () => {
    hooks.state.supabaseSession = null;
    await hooks.supabaseSignOut();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('exportJSON', () => {
  it('bloqueado quando dataSource === "db": não gera download e mostra aviso', () => {
    hooks.state.dataSource = 'db';
    hooks.state.routes = { ILHA: [{ name: 'I01' }] };
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL');
    hooks.exportJSON();
    expect(createObjectURLSpy).not.toHaveBeenCalled();
  });

  it('permite export normalmente quando dataSource === "local"', () => {
    hooks.state.dataSource = 'local';
    hooks.state.routes = { ILHA: [{ name: 'I01' }] };
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    hooks.exportJSON();
    expect(createObjectURLSpy).toHaveBeenCalled();
  });
});

// ============================================================================
// CENÁRIO: queda de conexão com a internet
//
// Requisito: quando a conexão cai no meio de uma operação com o banco,
// (1) nenhuma mensagem de SUCESSO pode aparecer, e (2) o erro tem que ser
// necessariamente visível em algum lugar — nunca engolido em silêncio. Para
// funções que a própria API do projeto já documenta como "lançam exceção"
// (supabaseRequest, saveRouteKeysToDB, supabaseSignIn), isso significa a
// Promise rejeitar com uma mensagem clara. Para funções que a própria API
// já documenta como "nunca lançam, sinalizam por toast/estado"
// (loadRoutesFromDB, a fila de syncRouteKeysToDB), isso significa um toast
// de erro visível e o estado interno refletindo a falha.
//
// Todos os mocks de fetch aqui usam TypeError('Failed to fetch'), que é
// exatamente o que o browser lança quando não há conexão.
describe('Cenário: queda de conexão com a internet', () => {
  beforeEach(() => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
  });

  it('loadRoutesFromDB: não mostra sucesso, mostra erro e preserva os dados locais', async () => {
    hooks.state.isAuthorizedUser = true;
    hooks.state.supabaseSession = { access_token: 'tok', user: { id: 'uuid-1' } };
    hooks.state.routes = { LOCAL: [{ name: 'L01' }] };

    const result = await hooks.loadRoutesFromDB();

    expect(result).toBe(false);
    expect(hooks.state.dataSource).toBe('local');
    expect(hooks.state.routes).toEqual({ LOCAL: [{ name: 'L01' }] });
    expect(hasSuccessToast()).toBe(false);
    expect(hasErrorToast()).toBe(true);
  });

  it('checkAuthorization: nunca lança exceção, nunca autoriza e nunca mostra sucesso', async () => {
    hooks.state.supabaseSession = { access_token: 'tok', user: { id: 'uuid-1' } };
    await expect(hooks.checkAuthorization()).resolves.toBe(false);
    expect(hooks.state.isAuthorizedUser).toBe(false);
    expect(hooks.state.canWriteDB).toBe(false);
    expect(hasSuccessToast()).toBe(false);
  });

  it('supabaseRequest: propaga (não engole) o erro de conexão para quem chamou', async () => {
    await expect(hooks.supabaseRequest('/rest/v1/route_points')).rejects.toThrow(/conexão/i);
  });

  it('supabaseSignIn: rejeita com mensagem de conexão, sem persistir sessão nem mostrar sucesso', async () => {
    await expect(hooks.supabaseSignIn('a@b.com', 'senha123')).rejects.toThrow(/conexão/i);
    expect(hooks.state.supabaseSession).toBeNull();
    expect(localStorage.getItem(hooks.SUPABASE_SESSION_KEY)).toBeNull();
    expect(hasSuccessToast()).toBe(false);
  });

  it('supabaseSignOut: mesmo sem conseguir avisar o servidor, limpa a sessão local e não mostra sucesso', async () => {
    hooks.state.supabaseSession = { access_token: 'tok' };
    hooks.state.isAuthorizedUser = true;
    await expect(hooks.supabaseSignOut()).resolves.not.toThrow();
    expect(hooks.state.supabaseSession).toBeNull();
    expect(hasSuccessToast()).toBe(false);
  });

  it('saveRouteKeysToDB: rejeita com mensagem de conexão e não chega a confirmar nada no banco', async () => {
    hooks.state.isAuthorizedUser = true;
    hooks.state.canWriteDB = true;
    hooks.state.supabaseSession = { access_token: 'tok' };
    hooks.state.routes = { ILHA: [{ name: 'I01' }] };

    await expect(hooks.saveRouteKeysToDB(['ILHA'])).rejects.toThrow(/conexão/i);
    expect(hasSuccessToast()).toBe(false);
    // só a 1ª chamada (save_routes_partial) chegou a ser tentada; a queda de conexão
    // interrompe antes da 2ª chamada de verificação (count_route_points).
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('syncRouteKeysToDB (fila): detecta a queda, marca falha, re-enfileira a chave para tentar de novo depois, e nunca mostra sucesso', async () => {
    hooks.state.dataSource = 'db';
    hooks.state.isAuthorizedUser = true;
    hooks.state.canWriteDB = true;
    hooks.state.supabaseSession = { access_token: 'tok' };
    hooks.state.routes = { ILHA: [{ name: 'I01' }] };

    // Simula "internet caiu e continua caída": a 1ª tentativa falha (o que já basta
    // pra verificar o comportamento); a partir da 2ª, o fetch fica pendurado sem
    // nunca resolver, pra não entrarmos numa tempestade de retries dentro do teste
    // (a fila tenta de novo automaticamente e sem limite assim que uma falha
    // termina — ver observação abaixo).
    let calls = 0;
    global.fetch.mockImplementation(() => {
      calls++;
      if (calls === 1) return Promise.reject(new TypeError('Failed to fetch'));
      return new Promise(() => {});
    });

    hooks.syncRouteKeysToDB(['ILHA']);
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    expect(hasSuccessToast()).toBe(false);
    expect(hasErrorToast()).toBe(true);
    expect(hooks.syncQueue.pendingKeys.has('ILHA')).toBe(true);
    const savedInfo = document.getElementById('saved-info');
    expect(savedInfo.classList.contains('error')).toBe(true);
  });

  // OBSERVAÇÃO (não é um teste, é uma nota sobre o comportamento atual de script.js):
  // runSyncQueue() não tem limite de tentativas nem backoff — se a conexão cair de
  // vez, ela tenta de novo imediatamente a cada falha, para sempre, disparando um
  // toast de erro a cada ciclo. Funcionalmente isso está "correto" pro requisito
  // pedido (nunca mostra sucesso, sempre mostra erro), mas pode gerar uma
  // tempestade de tentativas/toasts caso a conexão fique indisponível por muito
  // tempo. Vale considerar um backoff (ex: 5s, 15s, 30s...) numa próxima iteração.
});