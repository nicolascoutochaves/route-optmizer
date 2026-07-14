import { describe, it, expect } from 'vitest';
import {
  loadApp,
  mockFetch,
  apiSuccessResponse,
  apiNotFoundResponse,
  apiErrorResponse
} from './testUtils.js';

// ============================================================================
// geocodeMapbox (client) — agora só fala com /api/request (a serverless
// function que esconde a chave do Mapbox no Vercel). O client faz UMA
// chamada por endereço e recebe { lng, lat, label } já pronto, ou um status
// HTTP de erro. Tentar múltiplas variantes / escolher o melhor feature
// passou a ser responsabilidade do servidor (ver request.test.js).
// ============================================================================
describe('geocodeMapbox', () => {
  it('retorna lng/lat/label quando o servidor encontra o endereço', async () => {
    const h = await loadApp();
    mockFetch(async () => apiSuccessResponse({ lng: -51.23, lat: -30.03, label: 'Rua Teste, Porto Alegre - RS' }));

    const r = await h.geocodeMapbox('Rua Teste, 100, Porto Alegre, RS, Brasil');
    expect(r).toEqual({ lng: -51.23, lat: -30.03, label: 'Rua Teste, Porto Alegre - RS' });
  });

  it('chama o endpoint /api/request com a query codificada', async () => {
    const h = await loadApp();
    const fetchSpy = mockFetch(async () => apiSuccessResponse({ lng: 0, lat: 0, label: 'x' }));

    await h.geocodeMapbox('Rua Teste, 100, Porto Alegre');
    expect(fetchSpy).toHaveBeenCalledWith(`/api/request?query=${encodeURIComponent('Rua Teste, 100, Porto Alegre')}`);
  });

  it('retorna null para consulta vazia, sem chamar o servidor', async () => {
    const h = await loadApp();
    const fetchSpy = mockFetch(async () => apiSuccessResponse({ lng: 0, lat: 0, label: 'x' }));

    const r = await h.geocodeMapbox('   ');
    expect(r).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('retorna null quando o servidor responde 404 (endereço não encontrado)', async () => {
    const h = await loadApp();
    mockFetch(async () => apiNotFoundResponse());

    const r = await h.geocodeMapbox('Endereço Que Não Existe, 99999');
    expect(r).toBeNull();
  });

  it('propaga erro de conectividade quando o fetch rejeita (rede fora do ar)', async () => {
    const h = await loadApp();
    mockFetch(async () => { throw new Error('network down'); });

    await expect(h.geocodeMapbox('Rua Teste, 100'))
      .rejects.toThrow('Não foi possível contatar o servidor de geocodificação. Verifique sua conexão.');
  });

  it('lança erro específico quando a chave não está configurada no servidor (401/403)', async () => {
    const h = await loadApp();
    mockFetch(async () => apiErrorResponse(401));

    await expect(h.geocodeMapbox('Rua Teste, 100'))
      .rejects.toThrow('Chave de API inválida ou não configurada no servidor (Vercel).');
  });

  it('lança erro de limite de requisições quando o servidor responde 429', async () => {
    const h = await loadApp();
    mockFetch(async () => apiErrorResponse(429));

    await expect(h.geocodeMapbox('Rua Teste, 100'))
      .rejects.toThrow('Limite de requisições de geocodificação excedido. Tente novamente em instantes.');
  });

  it('lança erro genérico de servidor para status 5xx', async () => {
    const h = await loadApp();
    mockFetch(async () => apiErrorResponse(503));

    await expect(h.geocodeMapbox('Rua Teste, 100'))
      .rejects.toThrow('Erro no servidor de geocodificação. Tente novamente em instantes.');
  });

  it('lança erro com o status para outros códigos HTTP inesperados', async () => {
    const h = await loadApp();
    mockFetch(async () => apiErrorResponse(418));

    await expect(h.geocodeMapbox('Rua Teste, 100')).rejects.toThrow('Erro no servidor: 418');
  });

  it('lança erro quando o corpo da resposta não é um JSON válido', async () => {
    const h = await loadApp();
    mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected token'); },
      text: async () => 'not json'
    }));

    await expect(h.geocodeMapbox('Rua Teste, 100'))
      .rejects.toThrow('Resposta inválida do servidor de geocodificação.');
  });

  it('não expõe token/chave do Mapbox no client', async () => {
    const h = await loadApp();
    // A chave agora vive só em process.env.MAPBOX_API_KEY, dentro de request.js.
    // O client não deve ter getToken(), MAPBOX_TOKEN, nem nada equivalente.
    expect(h.getToken).toBeUndefined();
    expect(h.MAPBOX_TOKEN).toBeUndefined();
  });
});

// ============================================================================
// pickBestFeature (e normalizeText, que só existia pra apoiá-la) saíram do
// client — eram dead code depois que a heurística de escolha migrou para
// request.js. A cobertura equivalente agora vive em request.test.js.
// ============================================================================
// ensureStartCoord — mantém o cache do endereço base; a única mudança real é
// o formato da resposta mockada (agora vem do /api/request).
// ============================================================================
describe('ensureStartCoord', () => {
  it('geocodifica o endereço base apenas uma vez e reaproveita o cache', async () => {
    const h = await loadApp();
    const fetchSpy = mockFetch(async () => apiSuccessResponse({ lng: -51.21, lat: -30.02, label: 'Base' }));

    const first = await h.ensureStartCoord();
    const callsAfterFirst = fetchSpy.mock.calls.length;
    const second = await h.ensureStartCoord();

    expect(first).toEqual(second);
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst); // não geocodificou de novo
    expect(h.state.startCoord).toEqual(first);
  });

  it('propaga erro do servidor ao geocodificar o endereço base', async () => {
    const h = await loadApp();
    mockFetch(async () => apiErrorResponse(500));

    await expect(h.ensureStartCoord())
      .rejects.toThrow('Erro no servidor de geocodificação. Tente novamente em instantes.');
  });
});