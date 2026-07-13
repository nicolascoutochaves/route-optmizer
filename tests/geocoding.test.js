import { describe, it, expect, vi } from 'vitest';
import { loadApp, mockFetch, mapboxSuccessResponse, mapboxEmptyResponse } from './testUtils.js';

describe('geocodeMapbox', () => {
  it('retorna lat/lng/label quando a API encontra o endereço', async () => {
    const h = await loadApp();
    mockFetch(async () => mapboxSuccessResponse({ lng: -51.23, lat: -30.03, place_name: 'Rua Teste, Porto Alegre - RS' }));

    const r = await h.geocodeMapbox('Rua Teste, 100, Porto Alegre, RS, Brasil');
    expect(r).toEqual({ lng: -51.23, lat: -30.03, label: 'Rua Teste, Porto Alegre - RS' });
  });

  it('retorna null quando nenhuma variante do endereço é encontrada (todas vazias)', async () => {
    const h = await loadApp();
    mockFetch(async () => mapboxEmptyResponse());

    const r = await h.geocodeMapbox('Endereço Que Não Existe, 99999');
    expect(r).toBeNull();
  });

  it('propaga erro de conectividade (fetch rejeitado / rede fora do ar)', async () => {
    const h = await loadApp();
    mockFetch(async () => { throw new Error('Failed to fetch'); });

    await expect(h.geocodeMapbox('Rua Teste, 100')).rejects.toThrow('Failed to fetch');
  });

  it('lança erro quando a API responde com status HTTP de erro (ex: 401/429)', async () => {
    const h = await loadApp();
    mockFetch(async () => ({ ok: false, status: 429, json: async () => ({}), text: async () => '' }));

    await expect(h.geocodeMapbox('Rua Teste, 100')).rejects.toThrow('Mapbox HTTP 429');
  });

  it('possui um token Mapbox configurado (guard de token ausente é coberto em mapbox-token.test.js)', async () => {
    const h = await loadApp();
    expect(h.getToken().length).toBeGreaterThan(0);
  });

  it('retorna null para consulta vazia sem chamar a API', async () => {
    const h = await loadApp();
    const fetchSpy = mockFetch(async () => mapboxSuccessResponse({ lng: 0, lat: 0 }));
    const r = await h.geocodeMapbox('   ');
    expect(r).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('tenta múltiplas variantes do endereço até encontrar um resultado', async () => {
    const h = await loadApp();
    let call = 0;
    const fetchSpy = mockFetch(async () => {
      call++;
      // primeira variante falha (sem features), segunda variante tem sucesso
      if (call === 1) return mapboxEmptyResponse();
      return mapboxSuccessResponse({ lng: -51.2, lat: -30.0 });
    });
    const r = await h.geocodeMapbox('rua mexiana 81');
    expect(r).not.toBeNull();
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('pickBestFeature (heurística de escolha do melhor resultado)', () => {
  it('prioriza feature cujo número de endereço bate exatamente', async () => {
    const h = await loadApp();
    const features = [
      { place_name: 'Rua X, 50, Porto Alegre, RS', relevance: 0.9, center: [-51.1, -30.1], properties: { address: '50' } },
      { place_name: 'Rua X, 81, Porto Alegre, RS', relevance: 0.8, center: [-51.2, -30.2], properties: { address: '81' } }
    ];
    const best = h.pickBestFeature(features, 'Rua X, 81, Porto Alegre');
    expect(best.properties.address).toBe('81');
  });

  it('retorna null quando a lista de features está vazia', async () => {
    const h = await loadApp();
    expect(h.pickBestFeature([], 'qualquer coisa')).toBeNull();
    expect(h.pickBestFeature(undefined, 'qualquer coisa')).toBeNull();
  });

  it('favorece resultados que mencionam "porto alegre"', async () => {
    const h = await loadApp();
    const features = [
      { place_name: 'Rua Y, 10, Viamão, RS', relevance: 0.95, center: [-51.0, -30.0], properties: {} },
      { place_name: 'Rua Y, 10, Porto Alegre, RS', relevance: 0.9, center: [-51.1, -30.1], properties: {} }
    ];
    const best = h.pickBestFeature(features, 'Rua Y, 10');
    expect(best.place_name).toContain('Porto Alegre');
  });
});

describe('ensureStartCoord', () => {
  it('geocodifica o endereço base apenas uma vez e reaproveita o cache', async () => {
    const h = await loadApp();
    const fetchSpy = mockFetch(async () => mapboxSuccessResponse({ lng: -51.21, lat: -30.02 }));

    const first = await h.ensureStartCoord();
    const callsAfterFirst = fetchSpy.mock.calls.length;
    const second = await h.ensureStartCoord();

    expect(first).toEqual(second);
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst); // não geocodificou de novo
    expect(h.state.startCoord).toEqual(first);
  });
});
