import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadApp } from './testUtils.js';

/** Intercepta o download disparado por `a.click()` sem navegar de verdade no jsdom. */
function captureDownload() {
  let captured = { blob: null, filename: null };
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { captured.blob = blob; return 'blob:mock'; });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    captured.filename = this.download;
  });
  return captured;
}

describe('buildKmlFromOptimizedRoute (exportação de rota única otimizada)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('gera um KML válido com BASE, cada parada e a LineString da rota', async () => {
    const h = await loadApp();
    h.state.startCoord = { lat: -30.0346, lng: -51.2177 };
    const captured = captureDownload();

    const stops = [
      { name: 'Ponto A', address: 'Rua A, 1', lat: -30.01, lng: -51.20, corrected: false },
      { name: 'Ponto B', address: 'Rua B, 2', lat: -30.02, lng: -51.21, corrected: true }
    ];
    h.buildKmlFromOptimizedRoute(stops, 'Meu Roteiro');

    expect(captured.filename).toBe('Meu Roteiro.kml');
    const text = await captured.blob.text();
    expect(text).toContain('<name>Meu Roteiro</name>');
    expect(text).toContain('<name>BASE</name>');
    expect(text).toContain('Ponto A');
    expect(text).toContain('Ponto B');
    expect(text).toContain('[CORRIGIDO]'); // Ponto B foi marcado como corrigido
    expect(text).toContain('<LineString>');
  });

  it('usa currentRoute como nome padrão quando nenhum nome é passado', async () => {
    const h = await loadApp();
    h.state.startCoord = { lat: -30.0346, lng: -51.2177 };
    h.state.currentRoute = 'ILHA';
    const captured = captureDownload();

    h.buildKmlFromOptimizedRoute([{ name: 'P', address: 'A', lat: -30, lng: -51 }]);
    expect(captured.filename).toBe('ILHA.kml');
  });
});

describe('buildMultiRouteKml / exportRoutesAsKml (exportação em camadas)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('cria uma <Folder> por roteiro selecionado, cada uma com seus próprios pontos', async () => {
    const h = await loadApp();
    h.state.startCoord = { lat: -30.0346, lng: -51.2177 };
    h.state.routes = {
      ILHA: [{ name: 'I01', address: 'A', lat: -30.01, lng: -51.20 }],
      NORTE: [{ name: 'N01', address: 'B', lat: -29.9, lng: -51.1 }]
    };

    const { kml, skipped } = h.buildMultiRouteKml(['ILHA', 'NORTE'], 'Export Teste');
    expect(kml).toContain('<name>ILHA</name>');
    expect(kml).toContain('<name>NORTE</name>');
    expect(kml).toContain('I01');
    expect(kml).toContain('N01');
    expect(skipped).toBe(0);
  });

  it('ignora (mas conta) pontos sem coordenadas ao exportar', async () => {
    const h = await loadApp();
    h.state.startCoord = { lat: -30.0346, lng: -51.2177 };
    h.state.routes = {
      ILHA: [
        { name: 'I01', address: 'A', lat: -30.01, lng: -51.20 },
        { name: 'I02', address: 'B', lat: null, lng: null }
      ]
    };
    const { kml, skipped } = h.buildMultiRouteKml(['ILHA'], 'Export Teste');
    expect(skipped).toBe(1);
    expect(kml).toContain('I01');
    expect(kml).not.toContain('I02');
  });

  it('exportRoutesAsKml baixa o arquivo com o nome informado', async () => {
    const h = await loadApp();
    h.state.startCoord = { lat: -30.0346, lng: -51.2177 };
    h.state.routes = { ILHA: [{ name: 'I01', address: 'A', lat: -30.01, lng: -51.20 }] };
    const captured = captureDownload();

    h.exportRoutesAsKml(['ILHA'], 'roteiros_completos.kml');
    expect(captured.filename).toBe('roteiros_completos.kml');
    const text = await captured.blob.text();
    expect(text).toContain('<name>ILHA</name>');
  });

  it('exportRoutesAsKml não faz nada (e não quebra) quando a lista de roteiros está vazia', async () => {
    const h = await loadApp();
    const captured = captureDownload();
    h.exportRoutesAsKml([], 'vazio.kml');
    expect(captured.filename).toBeNull();
  });
});
