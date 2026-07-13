import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadApp, samplePoint, makeFile } from './testUtils.js';

describe('saveToStorage / loadFromStorage', () => {
  it('salva routes + fileNames no localStorage e recarrega corretamente', async () => {
    const h = await loadApp();
    h.state.routes = { R1: [samplePoint()] };
    h.state.loadedFileNames = ['arq.kml'];
    h.saveToStorage();

    const raw = localStorage.getItem(h.STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw);
    expect(parsed.routes.R1).toHaveLength(1);
    expect(parsed.fileNames).toEqual(['arq.kml']);

    // limpa o estado em memória e recarrega
    h.state.routes = {};
    const ok = h.loadFromStorage();
    expect(ok).toBe(true);
    expect(h.state.routes.R1).toHaveLength(1);
  });

  it('loadFromStorage retorna false quando não há nada salvo', async () => {
    const h = await loadApp();
    expect(h.loadFromStorage()).toBe(false);
  });

  it('loadFromStorage retorna false para JSON inválido/corrompido', async () => {
    const h = await loadApp();
    localStorage.setItem(h.STORAGE_KEY, '{ isso não é json válido ]');
    expect(h.loadFromStorage()).toBe(false);
  });

  it('loadFromStorage retorna false quando "routes" está vazio', async () => {
    const h = await loadApp();
    localStorage.setItem(h.STORAGE_KEY, JSON.stringify({ routes: {} }));
    expect(h.loadFromStorage()).toBe(false);
  });
});

describe('exportJSON', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('baixa um arquivo roteiros.json contendo o estado atual de routes', async () => {
    const h = await loadApp();
    h.state.routes = { R1: [samplePoint({ name: 'X' })] };
    h.state.loadedFileNames = ['x.kml'];

    let captured = { blob: null, filename: null };
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { captured.blob = blob; return 'blob:x'; });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { captured.filename = this.download; });

    h.exportJSON();
    expect(captured.filename).toBe('roteiros.json');
    const text = await captured.blob.text();
    const parsed = JSON.parse(text);
    expect(parsed.routes.R1[0].name).toBe('X');
    expect(parsed.fileNames).toEqual(['x.kml']);
  });
});

describe('importFromJSON / applyLoadedRoutes', () => {
  it('importa um roteiros.json válido e popula routes + localStorage', async () => {
    const h = await loadApp();
    const payload = {
      savedAt: new Date().toISOString(),
      fileNames: ['a.kml', 'b.kml'],
      routes: { R1: [samplePoint()], R2: [samplePoint({ name: 'Y' })] }
    };
    const file = makeFile(JSON.stringify(payload), 'roteiros.json', 'application/json');

    h.importFromJSON(file);
    await new Promise(r => setTimeout(r, 30)); // FileReader é assíncrono

    expect(Object.keys(h.state.routes).sort()).toEqual(['R1', 'R2']);
    expect(h.state.loadedFileNames).toEqual(['a.kml', 'b.kml']);
    expect(JSON.parse(localStorage.getItem(h.STORAGE_KEY)).routes.R2[0].name).toBe('Y');
  });

  it('applyLoadedRoutes lança erro quando o JSON não tem roteiros', async () => {
    const h = await loadApp();
    expect(() => h.applyLoadedRoutes({ routes: {} }, 'teste')).toThrow('sem roteiros válidos');
    expect(() => h.applyLoadedRoutes({}, 'teste')).toThrow('sem roteiros válidos');
  });

  it('importFromJSON exibe mensagem de erro (sem lançar) quando o arquivo tem JSON malformado', async () => {
    const h = await loadApp();
    const file = makeFile('{ json quebrado', 'ruim.json', 'application/json');
    h.importFromJSON(file);
    await new Promise(r => setTimeout(r, 30));
    expect(document.getElementById('fi-msg').textContent).toContain('Erro ao importar JSON');
  });

  it('roundtrip: exportar e reimportar preserva os dados (incluindo campos do KML: setorAbastecimento, sistema)', async () => {
    const h = await loadApp();
    h.state.routes = {
      ILHA: [samplePoint({ name: 'I01', setorAbastecimento: 'EBAT ILHAS (INLINE)', sistema: 'SAA - Ilha da Pintada' })]
    };
    h.saveToStorage();
    const saved = JSON.parse(localStorage.getItem(h.STORAGE_KEY));

    // "reimporta" simulando um novo arquivo a partir do que foi salvo
    h.state.routes = {};
    const file = makeFile(JSON.stringify(saved), 'roteiros.json', 'application/json');
    h.importFromJSON(file);
    await new Promise(r => setTimeout(r, 30));

    expect(h.state.routes.ILHA[0].setorAbastecimento).toBe('EBAT ILHAS (INLINE)');
    expect(h.state.routes.ILHA[0].sistema).toBe('SAA - Ilha da Pintada');
  });
});
