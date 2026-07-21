import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadApp } from './testUtils.js';

/**
 * Intercepta o(s) download(s) disparado(s) por `a.click()` sem navegar de
 * verdade no jsdom. Como `exportRoutesAsKml` agora dispara DOIS downloads
 * (pontos_por_roteiro.kml + pontos_por_subsistema.kml), este helper acumula
 * todas as chamadas em arrays, além de manter `filename`/`blob` como atalho
 * para a ÚLTIMA chamada (útil nos testes de arquivo único).
 */
function captureDownload() {
  const captured = { blob: null, filename: null, blobs: [], filenames: [] };
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
    captured.blob = blob;
    captured.blobs.push(blob);
    return 'blob:mock';
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    captured.filename = this.download;
    captured.filenames.push(this.download);
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

describe('buildKmlByRoute (agrupamento "por roteiro")', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('cria uma <Folder> por roteiro selecionado, cada uma com seus próprios pontos', async () => {
    const h = await loadApp();
    h.state.startCoord = { lat: -30.0346, lng: -51.2177 };
    h.state.routes = {
      ILHA: [{ name: 'I01', address: 'A', lat: -30.01, lng: -51.20 }],
      NORTE: [{ name: 'N01', address: 'B', lat: -29.9, lng: -51.1 }]
    };

    const { kml, skipped } = h.buildKmlByRoute(['ILHA', 'NORTE'], 'Export Teste');
    expect(kml).toContain('<name>Export Teste</name>');
    expect(kml).toContain('<name>🗂️ Por roteiro</name>');
    expect(kml).toContain('<name>ILHA</name>');
    expect(kml).toContain('<name>NORTE</name>');
    expect(kml).toContain('I01');
    expect(kml).toContain('N01');
    expect(skipped).toBe(0);
  });

  it('ignora (mas conta) pontos sem coordenadas', async () => {
    const h = await loadApp();
    h.state.startCoord = { lat: -30.0346, lng: -51.2177 };
    h.state.routes = {
      ILHA: [
        { name: 'I01', address: 'A', lat: -30.01, lng: -51.20 },
        { name: 'I02', address: 'B', lat: null, lng: null }
      ]
    };
    const { kml, skipped } = h.buildKmlByRoute(['ILHA'], 'Export Teste');
    expect(skipped).toBe(1);
    expect(kml).toContain('I01');
    expect(kml).not.toContain('I02');
  });

  it('inclui a pasta "📍 Base" com o Placemark BASE usando o style #base', async () => {
    const h = await loadApp();
    h.state.startCoord = { lat: -30.0346, lng: -51.2177 };
    h.state.routes = { ILHA: [{ name: 'I01', address: 'A', lat: -30.01, lng: -51.20 }] };
    const { kml } = h.buildKmlByRoute(['ILHA'], 'Export Teste');
    expect(kml).toContain('<name>📍 Base</name>');
    expect(kml).toContain('<name>BASE</name>');
    expect(kml).toContain('styleUrl>#base');
  });

  it('aplica uma cor/estilo distinto (styleUrl) por índice de roteiro', async () => {
    const h = await loadApp();
    h.state.startCoord = { lat: -30.0346, lng: -51.2177 };
    h.state.routes = {
      ILHA: [{ name: 'I01', address: 'A', lat: -30.01, lng: -51.20 }],
      NORTE: [{ name: 'N01', address: 'B', lat: -29.9, lng: -51.1 }]
    };
    const { kml } = h.buildKmlByRoute(['ILHA', 'NORTE'], 'Export Teste');
    expect(kml).toContain('<Style id="route0">');
    expect(kml).toContain('<Style id="route1">');
    expect(kml).toContain('styleUrl>#route0');
    expect(kml).toContain('styleUrl>#route1');
  });

  it('não quebra quando startCoord ainda é null (omite o Point de BASE)', async () => {
    const h = await loadApp();
    h.state.startCoord = null;
    h.state.routes = { ILHA: [{ name: 'I01', address: 'A', lat: -30.01, lng: -51.20 }] };
    const { kml } = h.buildKmlByRoute(['ILHA'], 'Export Teste');
    expect(kml).toContain('<name>BASE</name>');
    expect(kml).not.toMatch(/<Point><coordinates>undefined/);
  });
});

describe('buildKmlBySistema (agrupamento "por sistema de abastecimento")', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('agrupa pontos de todos os roteiros por sistema, com fallback "Sem sistema"', async () => {
    const h = await loadApp();
    h.state.startCoord = { lat: -30.0346, lng: -51.2177 };
    h.state.routes = {
      ILHA: [
        { name: 'I01', address: 'A', lat: -30.01, lng: -51.20, sistema: 'Sistema X' },
        { name: 'I02', address: 'B', lat: -30.02, lng: -51.21 } // sem "sistema"
      ],
      NORTE: [{ name: 'N01', address: 'C', lat: -29.9, lng: -51.1, sistema: 'Sistema X' }]
    };

    const { kml, skipped } = h.buildKmlBySistema(['ILHA', 'NORTE'], 'Export Teste');
    expect(kml).toContain('<name>🚰 Por sistema de abastecimento</name>');
    expect(kml).toContain('Sistema X (2)');
    expect(kml).toContain('Sem sistema (1)');
    expect(skipped).toBe(0);
  });

  it('ignora (mas conta) pontos sem coordenadas', async () => {
    const h = await loadApp();
    h.state.startCoord = { lat: -30.0346, lng: -51.2177 };
    h.state.routes = {
      ILHA: [
        { name: 'I01', address: 'A', lat: -30.01, lng: -51.20, sistema: 'Sistema X' },
        { name: 'I02', address: 'B', lat: null, lng: null, sistema: 'Sistema X' }
      ]
    };
    const { kml, skipped } = h.buildKmlBySistema(['ILHA'], 'Export Teste');
    expect(skipped).toBe(1);
    expect(kml).toContain('I01');
    expect(kml).not.toContain('I02');
  });

  it('mantém a mesma cor/estilo do roteiro de origem também neste agrupamento', async () => {
    const h = await loadApp();
    h.state.startCoord = { lat: -30.0346, lng: -51.2177 };
    h.state.routes = {
      ILHA: [{ name: 'I01', address: 'A', lat: -30.01, lng: -51.20, sistema: 'Sistema X' }],
      NORTE: [{ name: 'N01', address: 'B', lat: -29.9, lng: -51.1, sistema: 'Sistema Y' }]
    };
    const { kml } = h.buildKmlBySistema(['ILHA', 'NORTE'], 'Export Teste');
    // ILHA é índice 0, NORTE é índice 1 (mesma ordem/índice usada em buildKmlByRoute)
    expect(kml).toContain('styleUrl>#route0');
    expect(kml).toContain('styleUrl>#route1');
  });

  it('descrição do ponto menciona o roteiro de origem', async () => {
    const h = await loadApp();
    h.state.startCoord = { lat: -30.0346, lng: -51.2177 };
    h.state.routes = {
      ILHA: [{ name: 'I01', address: 'Rua A, 1', lat: -30.01, lng: -51.20, sistema: 'Sistema X' }]
    };
    const { kml } = h.buildKmlBySistema(['ILHA'], 'Export Teste');
    expect(kml).toContain('Roteiro: ILHA');
  });
});

describe('exportRoutesAsKml (dispara os dois downloads: por roteiro + por subsistema)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('baixa DOIS arquivos com nomes fixos, independente do nome informado', async () => {
    const h = await loadApp();
    h.state.startCoord = { lat: -30.0346, lng: -51.2177 };
    h.state.routes = { ILHA: [{ name: 'I01', address: 'A', lat: -30.01, lng: -51.20, sistema: 'Sistema X' }] };
    const captured = captureDownload();

    h.exportRoutesAsKml(['ILHA'], 'roteiros_completos.kml');

    expect(captured.filenames).toEqual(['pontos_por_roteiro.kml', 'pontos_por_subsistema.kml']);
    expect(captured.blobs.length).toBe(2);

    const [porRoteiroText, porSistemaText] = await Promise.all(captured.blobs.map(b => b.text()));
    expect(porRoteiroText).toContain('<name>🗂️ Por roteiro</name>');
    expect(porRoteiroText).toContain('I01');
    expect(porSistemaText).toContain('<name>🚰 Por sistema de abastecimento</name>');
    expect(porSistemaText).toContain('Sistema X (1)');
  });

  it('não faz nada (e não quebra) quando a lista de roteiros está vazia', async () => {
    const h = await loadApp();
    const captured = captureDownload();
    h.exportRoutesAsKml([], 'vazio.kml');
    expect(captured.filenames).toEqual([]);
    expect(captured.filename).toBeNull();
  });
});
