// tests/supabase.test.js
//
// Segue o mesmo padrão dos demais arquivos de teste do projeto: usa
// loadApp() de testUtils.js, que recarrega a fixture do DOM e reimporta
// script.js do zero a cada teste (estado limpo garantido), expondo
// window.__testHooks. Nada de ler o HTML "de verdade" nem injetar
// <script> manualmente aqui — era exatamente isso que causava o
// `hooks` undefined (o beforeAll anterior não batia com a fixture real
// do projeto).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadApp } from './testUtils.js';

let hooks;

beforeEach(async () => {
  hooks = await loadApp();
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

  it('lança erro com a mensagem do corpo quando a resposta falha', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: 'RLS negou o acesso' }),
    });
    await expect(hooks.supabaseRequest('/rest/v1/route_points')).rejects.toThrow('RLS negou o acesso');
  });
});

describe('checkAuthorization', () => {
  it('marca isAuthorizedUser=false quando não há sessão', async () => {
    const result = await hooks.checkAuthorization();
    expect(result).toBe(false);
    expect(hooks.state.isAuthorizedUser).toBe(false);
  });

  it('marca isAuthorizedUser=true quando authorized_users retorna uma linha', async () => {
    hooks.state.supabaseSession = { access_token: 'tok', user: { id: 'uuid-1' } };
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ([{ user_id: 'uuid-1' }]) });
    const result = await hooks.checkAuthorization();
    expect(result).toBe(true);
    expect(hooks.state.isAuthorizedUser).toBe(true);
  });
});

describe('dbRowToPoint / pointToDbRow (round-trip)', () => {
  it('preserva os campos ao converter camelCase <-> snake_case', () => {
    // bairro/cidade/complemento foram removidos do modelo de ponto (não são
    // mais lidos/gravados por dbRowToPoint/pointToDbRow), então não entram
    // mais neste objeto de teste.
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
});

describe('saveRoutesToDB', () => {
  it('rejeita quando o usuário não é autorizado', async () => {
    hooks.state.isAuthorizedUser = false;
    await expect(hooks.saveRoutesToDB()).rejects.toThrow(/autoriza/i);
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
});

describe('exportJSON — bloqueado quando dataSource === "db"', () => {
  it('não gera download e mostra aviso', () => {
    hooks.state.dataSource = 'db';
    hooks.state.routes = { ILHA: [{ name: 'I01' }] };
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL');
    hooks.exportJSON();
    expect(createObjectURLSpy).not.toHaveBeenCalled();
  });
});