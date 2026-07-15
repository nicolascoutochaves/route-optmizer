// tests/supabase.test.js
//
// Segue a mesma convenção dos demais testes do projeto: o `pretest`
// (build-fixture.js) gera tests/fixture.html com todos os ids que script.js
// busca via getElementById; o beforeAll carrega esse fixture e executa
// script.js na mesma realm de `window` (via window.eval), expondo
// `window.__testHooks`.
//
// SUPABASE_PROXY_URL é um caminho relativo ('/api/supabase', mesma origem
// da Vercel Function) — não há placeholder para substituir aqui, diferente
// do que seria necessário com um domínio externo. Como `fetch` é mockado em
// todo teste (`global.fetch = vi.fn()`), nenhuma chamada de rede real
// acontece.

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

let hooks;

beforeAll(async () => {
  const html = fs.readFileSync(path.resolve(__dirname, './fixture.html'), 'utf-8');
  document.documentElement.innerHTML = html;

  const scriptSrc = fs.readFileSync(path.resolve(__dirname, '../script.js'), 'utf-8');

  // window.eval garante que script.js executa na MESMA realm que `window`
  // usado pelo teste. Uma injeção via <script> criado com createElement +
  // appendChild rodava numa realm separada nesse ambiente jsdom/vitest: o
  // script executava (os side-effects aconteciam, o evento disparava), mas
  // qualquer propriedade atribuída a `window` dentro dele (window.__testHooks
  // etc.) não ficava visível pelo `window` acessado aqui fora depois do
  // await — daí o antigo erro "script.js rodou mas não expôs
  // window.__testHooks".
  try {
    window.eval(scriptSrc);
  } catch (e) {
    console.error('[DIAGNÓSTICO] Erro ao executar script.js:', e);
    throw e;
  }

  hooks = window.__testHooks;
  if (!hooks) {
    throw new Error('script.js rodou mas não expôs window.__testHooks — verifique fixture.html e script.js.');
  }
});

beforeEach(() => {
  localStorage.clear();
  hooks.state.supabaseSession = null;
  hooks.state.isAuthorizedUser = false;
  hooks.state.dataSource = 'local';
  hooks.state.dbToggleOn = true;
  hooks.state.suppressDBSync = false;
  hooks.state.routes = {};
  hooks.state.loadedFileNames = [];
  global.fetch = vi.fn();
});

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

  it('lança erro com a mensagem do corpo quando a resposta falha', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: 'RLS negou o acesso' }),
    });
    await expect(hooks.supabaseRequest('/rest/v1/route_points')).rejects.toThrow('RLS negou o acesso');
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
});

describe('checkAuthorization', () => {
  it('marca isAuthorizedUser=false quando não há sessão', async () => {
    const result = await hooks.checkAuthorization();
    expect(result).toBe(false);
    expect(hooks.state.isAuthorizedUser).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('marca isAuthorizedUser=true quando authorized_users retorna uma linha', async () => {
    hooks.state.supabaseSession = { access_token: 'tok', user: { id: 'uuid-1' } };
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ([{ user_id: 'uuid-1' }]) });
    const result = await hooks.checkAuthorization();
    expect(result).toBe(true);
    expect(hooks.state.isAuthorizedUser).toBe(true);
  });

  it('marca isAuthorizedUser=false quando authorized_users retorna vazio', async () => {
    hooks.state.supabaseSession = { access_token: 'tok', user: { id: 'uuid-1' } };
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ([]) });
    const result = await hooks.checkAuthorization();
    expect(result).toBe(false);
    expect(hooks.state.isAuthorizedUser).toBe(false);
  });

  it('marca isAuthorizedUser=false quando a requisição falha (rede ou RLS)', async () => {
    hooks.state.supabaseSession = { access_token: 'tok', user: { id: 'uuid-1' } };
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await hooks.checkAuthorization();
    expect(result).toBe(false);
    expect(hooks.state.isAuthorizedUser).toBe(false);
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
});

describe('loadRoutesFromDB', () => {
  it('não faz nada e avisa quando o usuário não é autorizado', async () => {
    hooks.state.isAuthorizedUser = false;
    const result = await hooks.loadRoutesFromDB();
    expect(result).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
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

  it('retorna false e mostra aviso quando a requisição falha', async () => {
    hooks.state.isAuthorizedUser = true;
    hooks.state.supabaseSession = { access_token: 'tok', user: { id: 'uuid-1' } };
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await hooks.loadRoutesFromDB();
    expect(result).toBe(false);
    expect(hooks.state.dataSource).toBe('local');
  });
});

describe('saveRoutesToDB', () => {
  it('rejeita quando o usuário não é autorizado', async () => {
    hooks.state.isAuthorizedUser = false;
    await expect(hooks.saveRoutesToDB()).rejects.toThrow(/autoriza/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('faz DELETE seguido de POST (bulk insert) e upsert em dataset_meta', async () => {
    hooks.state.isAuthorizedUser = true;
    hooks.state.supabaseSession = { access_token: 'tok' };
    hooks.state.routes = { ILHA: [{ name: 'I01', address: 'A', lat: -30, lng: -51 }] };
    global.fetch.mockResolvedValue({ ok: true, status: 204 });

    await hooks.saveRoutesToDB();

    const methods = global.fetch.mock.calls.map(([, opts]) => opts.method);
    expect(methods).toEqual(['DELETE', 'POST', 'POST']); // delete tudo, insere pontos, upsert meta
  });

  it('quando routes está vazio, pula o POST de pontos (só DELETE + upsert meta)', async () => {
    hooks.state.isAuthorizedUser = true;
    hooks.state.supabaseSession = { access_token: 'tok' };
    hooks.state.routes = {};
    global.fetch.mockResolvedValue({ ok: true, status: 204 });

    await hooks.saveRoutesToDB();

    const calls = global.fetch.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][1].method).toBe('DELETE');
    expect(calls[1][0]).toContain('/rest/v1/dataset_meta');
    expect(calls[1][1].method).toBe('POST');
  });
});

describe('maybeSyncRoutesToDB', () => {
  it('não sincroniza quando suppressDBSync está ativo', () => {
    hooks.state.suppressDBSync = true;
    hooks.state.dataSource = 'db';
    hooks.state.isAuthorizedUser = true;
    hooks.state.supabaseSession = { access_token: 'tok' };
    hooks.maybeSyncRoutesToDB();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('não sincroniza quando dataSource não é "db"', () => {
    hooks.state.dataSource = 'local';
    hooks.state.isAuthorizedUser = true;
    hooks.state.supabaseSession = { access_token: 'tok' };
    hooks.maybeSyncRoutesToDB();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('não sincroniza quando o usuário não é autorizado ou não há sessão', () => {
    hooks.state.dataSource = 'db';
    hooks.state.isAuthorizedUser = false;
    hooks.state.supabaseSession = { access_token: 'tok' };
    hooks.maybeSyncRoutesToDB();
    expect(global.fetch).not.toHaveBeenCalled();

    hooks.state.isAuthorizedUser = true;
    hooks.state.supabaseSession = null;
    hooks.maybeSyncRoutesToDB();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sincroniza (dispara saveRoutesToDB) quando todas as condições são satisfeitas', async () => {
    hooks.state.dataSource = 'db';
    hooks.state.isAuthorizedUser = true;
    hooks.state.supabaseSession = { access_token: 'tok' };
    hooks.state.routes = {};
    global.fetch.mockResolvedValue({ ok: true, status: 204 });

    hooks.maybeSyncRoutesToDB();
    // saveRoutesToDB roda de forma assíncrona (fire-and-forget); aguarda os microtasks.
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    expect(global.fetch).toHaveBeenCalled();
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
  it('supabaseSignIn autentica, persiste sessão e carrega do banco quando autorizado', async () => {
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

  it('supabaseSignOut limpa sessão e, se dataSource era "db", volta para "local"', async () => {
    hooks.state.supabaseSession = { access_token: 'tok' };
    hooks.state.isAuthorizedUser = true;
    hooks.state.dataSource = 'db';
    hooks.state.routes = { ILHA: [{ name: 'I01' }] };
    global.fetch.mockResolvedValue({ ok: true, status: 204 });

    await hooks.supabaseSignOut();

    expect(hooks.state.supabaseSession).toBeNull();
    expect(hooks.state.isAuthorizedUser).toBe(false);
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