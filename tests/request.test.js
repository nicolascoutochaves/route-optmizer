import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '../api/request.js'; // ajuste o caminho conforme a estrutura real do seu repo
import {
  mockFetch,
  mapboxFeatureResponse,
  mapboxEmptyFeaturesResponse,
  mapboxHttpErrorResponse
} from './testUtils.js';

/** Fabrica um objeto `res` estilo Vercel (status().json() encadeável e espionável). */
const createRes = () => {
  const res = {};
  res.status = vi.fn(code => { res._status = code; return res; });
  res.json = vi.fn(body => { res._body = body; return res; });
  return res;
};

const createReq = query => ({ query: { query } });

beforeEach(() => {
  vi.stubEnv('MAPBOX_API_KEY', 'test-token-123');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ============================================================================
// Guard de entrada / configuração
// ============================================================================
describe('handler /api/request — validação de entrada e configuração', () => {
  it('retorna 400 quando a query não é fornecida', async () => {
    const res = createRes();
    await handler(createReq(undefined), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Query não fornecida' });
  });

  it('retorna 500 quando MAPBOX_API_KEY não está configurada no ambiente', async () => {
    vi.unstubAllEnvs();
    delete process.env.MAPBOX_API_KEY;
    const res = createRes();

    await handler(createReq('Rua Teste, 100'), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token do Mapbox não configurado no servidor' });
  });
});

// ============================================================================
// Fluxo de sucesso
// ============================================================================
describe('handler /api/request — geocodificação bem-sucedida', () => {
  it('retorna 200 com lng/lat/label quando o Mapbox encontra o endereço na 1ª variante', async () => {
    mockFetch(async () => mapboxFeatureResponse({ lng: -51.23, lat: -30.03, place_name: 'Rua Teste, Porto Alegre - RS' }));
    const res = createRes();

    await handler(createReq('Rua Teste, 100, Porto Alegre, RS, Brasil'), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ lng: -51.23, lat: -30.03, label: 'Rua Teste, Porto Alegre - RS' });
  });

  it('usa a query original como label quando o feature não tem place_name', async () => {
    mockFetch(async () => mapboxFeatureResponse({ lng: -51.2, lat: -30.0, place_name: undefined }));
    const res = createRes();

    await handler(createReq('rua sem nome, 1'), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ lng: -51.2, lat: -30.0 }));
    expect(res.json.mock.calls[0][0].label).toBeTruthy();
  });

  it('inclui o token e a query codificada na URL chamada ao Mapbox', async () => {
    const fetchSpy = mockFetch(async () => mapboxFeatureResponse({ lng: 0, lat: 0 }));
    const res = createRes();

    await handler(createReq('Rua Teste, 100'), res);

    const calledUrl = fetchSpy.mock.calls[0][0];
    expect(calledUrl).toContain('access_token=test-token-123');
    expect(calledUrl).toContain('mapbox.places');
    expect(calledUrl).toContain(encodeURIComponent('Rua Teste, 100'));
  });

  it('tenta múltiplas variantes do endereço até encontrar um resultado', async () => {
    let call = 0;
    const fetchSpy = mockFetch(async () => {
      call++;
      if (call < 3) return mapboxEmptyFeaturesResponse(); // primeiras variantes sem resultado
      return mapboxFeatureResponse({ lng: -51.2, lat: -30.0, place_name: 'Rua Mexiana, 81' });
    });
    const res = createRes();

    await handler(createReq('rua mexiana, 81'), res);

    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ lng: -51.2, lat: -30.0 }));
  });
});

// ============================================================================
// Nenhum resultado encontrado
// ============================================================================
describe('handler /api/request — endereço não encontrado', () => {
  it('retorna 404 quando nenhuma variante do endereço retorna features', async () => {
    mockFetch(async () => mapboxEmptyFeaturesResponse());
    const res = createRes();

    await handler(createReq('Endereço Que Não Existe, 99999'), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Nenhum local encontrado' });
  });
});

// ============================================================================
// Erros ao conversar com o Mapbox
// ============================================================================
describe('handler /api/request — erros de upstream (Mapbox) e de rede', () => {
  it('retorna 500 quando o Mapbox responde com status HTTP de erro (ex: 401/429)', async () => {
    mockFetch(async () => mapboxHttpErrorResponse(429));
    const res = createRes();

    await handler(createReq('Rua Teste, 100'), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Mapbox HTTP 429' });
  });

  it('retorna 500 quando o fetch para o Mapbox rejeita (rede fora do ar)', async () => {
    mockFetch(async () => { throw new Error('Failed to fetch'); });
    const res = createRes();

    await handler(createReq('Rua Teste, 100'), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to fetch' });
  });
});

// ============================================================================
// Heurística de escolha (pickBestFeature) — agora portada de script.js,
// não é mais o stub `features[0]`.
// ============================================================================
describe('handler /api/request — heurística de escolha do melhor feature', () => {
  it('escolhe o feature com número de endereço exato entre múltiplos resultados', async () => {
    mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        features: [
          { place_name: 'Rua X, 50, Porto Alegre, RS', relevance: 0.9, center: [-51.1, -30.1], properties: { address: '50' } },
          { place_name: 'Rua X, 81, Porto Alegre, RS', relevance: 0.8, center: [-51.2, -30.2], properties: { address: '81' } }
        ]
      })
    }));
    const res = createRes();

    await handler(createReq('Rua X, 81, Porto Alegre'), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ lng: -51.2, lat: -30.2, label: 'Rua X, 81, Porto Alegre, RS' });
  });

  it('favorece resultados que mencionam "porto alegre" quando o número não desempata', async () => {
    mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        features: [
          { place_name: 'Rua Y, 10, Viamão, RS', relevance: 0.95, center: [-51.0, -30.0], properties: {} },
          { place_name: 'Rua Y, 10, Porto Alegre, RS', relevance: 0.9, center: [-51.1, -30.1], properties: {} }
        ]
      })
    }));
    const res = createRes();

    await handler(createReq('Rua Y, 10'), res);

    expect(res.json.mock.calls[0][0].label).toContain('Porto Alegre');
  });
});