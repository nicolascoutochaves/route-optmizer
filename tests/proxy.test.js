// @vitest-environment jsdom
//
// tests/proxy.test.js
// -----------------------------------------------------------------------
// Diferente de tests/supabase.test.js (que mocka `fetch` inteiro e testa
// só o script.js do client), este arquivo importa e executa o HANDLER REAL
// de api/supabase/proxy.js, com req/res fake e SOMENTE o `fetch` de saída
// (proxy -> Supabase) mockado. Ou seja: testa de verdade a lógica de
// parsing de URL, filtragem de query string e montagem de headers — que é
// exatamente onde o bug do parâmetro "path" (injetado pelo rewrite do
// vercel.json) escapou dos testes anteriores.
//
// OBS: o ambiente padrão global deste projeto é "node" (por isso o pragma
// aqui precisa declarar "jsdom" explicitamente, não omitir). O setupFiles
// global (setup.js) assume que `window` existe (configura clipboard, alert,
// etc.) e quebra sem jsdom. api/supabase/proxy.js em si não usa DOM — só
// herdamos jsdom pra satisfazer o setup.js compartilhado.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '../api/supabase/proxy.js';

const ENV_BACKUP = { ...process.env };

function makeReq({ method = 'GET', url, headers = {}, body } = {}) {
  // Node/Vercel normalizam nomes de header para minúsculo — replicamos isso aqui.
  const lowerHeaders = {};
  for (const [k, v] of Object.entries(headers)) lowerHeaders[k.toLowerCase()] = v;
  return { method, url, headers: lowerHeaders, body };
}

function makeRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    send(text) { this.body = text; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
  };
  return res;
}

function mockUpstream({ status = 200, text = '{}', contentType = 'application/json' } = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    status,
    text: async () => text,
    headers: { get: h => (h.toLowerCase() === 'content-type' ? contentType : null) },
  });
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://xyzcompany.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key-123';
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  vi.restoreAllMocks();
});

describe('proxy.js — configuração ausente', () => {
  it('responde 500 quando SUPABASE_URL não está definido', async () => {
    delete process.env.SUPABASE_URL;
    global.fetch = vi.fn();
    const req = makeReq({ url: '/api/supabase/rest/v1/route_points' });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('responde 500 quando SUPABASE_ANON_KEY não está definido', async () => {
    delete process.env.SUPABASE_ANON_KEY;
    const req = makeReq({ url: '/api/supabase/rest/v1/route_points' });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(500);
  });
});

describe('proxy.js — validação de rota', () => {
  it('responde 404 para uma raiz não permitida (nem rest nem auth)', async () => {
    mockUpstream();
    const req = makeReq({ url: '/api/supabase/storage/v1/object/foo' });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(404);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('responde 404 quando não há segmentos de path', async () => {
    mockUpstream();
    const req = makeReq({ url: '/api/supabase/' });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(404);
  });

  it('aceita rotas sob /rest e /auth', async () => {
    mockUpstream();
    for (const url of ['/api/supabase/rest/v1/route_points', '/api/supabase/auth/v1/token']) {
      global.fetch.mockClear();
      const res = makeRes();
      await handler(makeReq({ url }), res);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(200);
    }
  });
});

describe('proxy.js — montagem da URL de destino (regressão do bug "path=")', () => {
  it('NÃO repassa o parâmetro "path" injetado pelo rewrite do vercel.json', async () => {
    mockUpstream();
    const req = makeReq({
      url: '/api/supabase/rest/v1/authorized_users?select=user_id&user_id=eq.ee2489d4-5f52-4b85-9ce1-5e1ad3586801&path=rest%2Fv1%2Fauthorized_users',
    });
    await handler(req, makeRes());

    const [targetUrl] = global.fetch.mock.calls[0];
    expect(targetUrl).not.toContain('path=');
    expect(targetUrl).toBe(
      'https://xyzcompany.supabase.co/rest/v1/authorized_users?select=user_id&user_id=eq.ee2489d4-5f52-4b85-9ce1-5e1ad3586801'
    );
  });

  it('preserva todos os demais query params intactos (incluindo múltiplos filtros e caracteres codificados)', async () => {
    mockUpstream();
    const req = makeReq({
      url: '/api/supabase/rest/v1/route_points?select=*&order=route_key.asc,point_order.asc&route_key=eq.J_SUL%20I',
    });
    await handler(req, makeRes());

    const [targetUrl] = global.fetch.mock.calls[0];
    const parsed = new URL(targetUrl);
    expect(parsed.searchParams.get('select')).toBe('*');
    expect(parsed.searchParams.get('order')).toBe('route_key.asc,point_order.asc');
    expect(parsed.searchParams.get('route_key')).toBe('eq.J_SUL I');
    expect(parsed.searchParams.has('path')).toBe(false);
  });

  it('monta o pathname de destino concatenando todos os segmentos da rota', async () => {
    mockUpstream();
    const req = makeReq({ url: '/api/supabase/rest/v1/dataset_meta?id=eq.1' });
    await handler(req, makeRes());
    const [targetUrl] = global.fetch.mock.calls[0];
    expect(new URL(targetUrl).pathname).toBe('/rest/v1/dataset_meta');
  });

  it('usa o header x-forwarded-url quando presente, em vez de req.url', async () => {
    mockUpstream();
    const req = makeReq({
      url: '/api/supabase/proxy.js?path=rest%2Fv1%2Froute_points',
      headers: { 'x-forwarded-url': '/api/supabase/rest/v1/route_points?select=*' },
    });
    await handler(req, makeRes());
    const [targetUrl] = global.fetch.mock.calls[0];
    expect(new URL(targetUrl).pathname).toBe('/rest/v1/route_points');
    expect(new URL(targetUrl).searchParams.get('select')).toBe('*');
  });
});

describe('proxy.js — headers repassados ao Supabase', () => {
  it('sempre inclui o header apikey com a anon key do servidor', async () => {
    mockUpstream();
    await handler(makeReq({ url: '/api/supabase/rest/v1/route_points' }), makeRes());
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers.apikey).toBe('anon-key-123');
  });

  it('repassa o Authorization do usuário verbatim quando presente e no formato Bearer', async () => {
    mockUpstream();
    const req = makeReq({
      url: '/api/supabase/rest/v1/route_points',
      headers: { Authorization: 'Bearer token-do-usuario' },
    });
    await handler(req, makeRes());
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer token-do-usuario');
  });

  it('cai para a anon key quando não há Authorization do usuário', async () => {
    mockUpstream();
    await handler(makeReq({ url: '/api/supabase/rest/v1/route_points' }), makeRes());
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer anon-key-123');
  });

  it('cai para a anon key quando o Authorization recebido não está no formato Bearer', async () => {
    mockUpstream();
    const req = makeReq({
      url: '/api/supabase/rest/v1/route_points',
      headers: { Authorization: 'Basic xyz' },
    });
    await handler(req, makeRes());
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer anon-key-123');
  });

  it('repassa o header Prefer quando presente', async () => {
    mockUpstream();
    const req = makeReq({
      url: '/api/supabase/rest/v1/route_points',
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: {},
    });
    await handler(req, makeRes());
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers.Prefer).toBe('return=minimal');
  });

  it('não inclui o header Prefer quando ausente', async () => {
    mockUpstream();
    await handler(makeReq({ url: '/api/supabase/rest/v1/route_points' }), makeRes());
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers.Prefer).toBeUndefined();
  });
});

describe('proxy.js — repasse do body', () => {
  it('NÃO envia body em requisições GET, mesmo se req.body vier preenchido', async () => {
    mockUpstream();
    const req = makeReq({ url: '/api/supabase/rest/v1/route_points', method: 'GET', body: { foo: 'bar' } });
    await handler(req, makeRes());
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.body).toBeUndefined();
  });

  it('serializa req.body (objeto) como JSON em requisições de escrita', async () => {
    mockUpstream();
    const req = makeReq({
      url: '/api/supabase/rest/v1/route_points',
      method: 'POST',
      body: [{ route_key: 'ILHA', point_order: 0, name: 'I01' }],
    });
    await handler(req, makeRes());
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.body).toBe(JSON.stringify(req.body));
  });

  it('repassa req.body como string sem re-serializar, se já vier como string', async () => {
    mockUpstream();
    const raw = '{"id":1,"saved_at":"2026-01-01T00:00:00Z"}';
    const req = makeReq({ url: '/api/supabase/rest/v1/dataset_meta', method: 'PATCH', body: raw });
    await handler(req, makeRes());
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.body).toBe(raw);
  });

  it('não envia body quando ausente em requisição de escrita (ex: DELETE sem corpo)', async () => {
    mockUpstream();
    const req = makeReq({ url: '/api/supabase/rest/v1/route_points?route_key=not.is.null', method: 'DELETE' });
    await handler(req, makeRes());
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.body).toBeUndefined();
  });
});

describe('proxy.js — repasse da resposta do Supabase ao client', () => {
  it('propaga status, content-type e corpo da resposta upstream', async () => {
    mockUpstream({ status: 201, text: '[{"id":"abc"}]', contentType: 'application/json; charset=utf-8' });
    const req = makeReq({ url: '/api/supabase/rest/v1/route_points', method: 'POST', body: [{}] });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(201);
    expect(res.headers['Content-Type']).toBe('application/json; charset=utf-8');
    expect(res.body).toBe('[{"id":"abc"}]');
  });

  it('propaga um erro 400 do PostgREST tal como veio (mensagem original preservada)', async () => {
    mockUpstream({ status: 400, text: '{"message":"column authorized_users.path does not exist"}' });
    const req = makeReq({ url: '/api/supabase/rest/v1/authorized_users?path=x' });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('column authorized_users.path does not exist');
  });

  it('responde 502 quando o fetch para o Supabase falha (rede)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const req = makeReq({ url: '/api/supabase/rest/v1/route_points' });
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });
});
