import { describe, it, expect } from 'vitest';
import { loadApp, mockFetch, mapboxSuccessResponse, samplePoint } from './testUtils.js';

function setupTwoRoutes(h) {
  h.state.routes = {
    ILHA: [samplePoint({ name: 'I01', address: 'Rua I, 1' }), samplePoint({ name: 'I02', address: 'Rua I, 2' })],
    NORTE: [samplePoint({ name: 'N01', address: 'Rua N, 1' })]
  };
  h.renderRouteButtons();
}

describe('Seleção de pontos no painel "Personalizar"', () => {
  it('togglePointSelection adiciona e depois remove um ponto da seleção', async () => {
    const h = await loadApp();
    setupTwoRoutes(h);

    h.togglePointSelection('ILHA', 0);
    expect(h.state.customSelection).toHaveLength(1);
    expect(h.state.customSelection[0].point.name).toBe('I01');

    h.togglePointSelection('ILHA', 0);
    expect(h.state.customSelection).toHaveLength(0);
  });

  it('selectAllPoints seleciona todos os pontos de um roteiro; unselectAllPoints limpa', async () => {
    const h = await loadApp();
    setupTwoRoutes(h);

    h.selectAllPoints('ILHA');
    expect(h.state.customSelection).toHaveLength(2);
    expect(h.state.customSelection.every(s => s.routeName === 'ILHA')).toBe(true);

    h.unselectAllPoints('ILHA');
    expect(h.state.customSelection).toHaveLength(0);
  });

  it('permite combinar pontos de roteiros diferentes na mesma seleção personalizada', async () => {
    const h = await loadApp();
    setupTwoRoutes(h);

    h.togglePointSelection('ILHA', 0);
    h.togglePointSelection('NORTE', 0);

    expect(h.state.customSelection.map(s => s.routeName).sort()).toEqual(['ILHA', 'NORTE']);
  });
});

describe('Criação de roteiro personalizado (salvar)', () => {
  it('panel-btn-save cria um novo roteiro virtual com prefixo "✏️ " em `routes` e o persiste', async () => {
    const h = await loadApp();
    setupTwoRoutes(h);
    h.togglePointSelection('ILHA', 0);
    h.togglePointSelection('NORTE', 0);

    document.getElementById('panel-route-name').value = 'Minha Rota';
    const saveBtn = document.getElementById('panel-btn-save');
    saveBtn.onclick.call(saveBtn);

    const key = h.CUSTOM_ROUTE_PREFIX + 'Minha Rota';
    expect(h.state.routes[key]).toBeDefined();
    expect(h.state.routes[key]).toHaveLength(2);
    expect(h.isCustomRouteKey(key)).toBe(true);
    expect(h.state.currentRouteKey).toBe(key);

    // persistiu tanto em `routes` (STORAGE_KEY) quanto na lista de roteiros salvos (CUSTOM_LS_KEY)
    const savedRoutesRaw = JSON.parse(localStorage.getItem(h.STORAGE_KEY));
    expect(savedRoutesRaw.routes[key]).toHaveLength(2);
    const savedCustom = JSON.parse(localStorage.getItem(h.CUSTOM_LS_KEY));
    expect(savedCustom.some(r => r.name === 'Minha Rota')).toBe(true);
  });

  it('panel-btn-save não salva quando nenhum ponto foi selecionado', async () => {
    const h = await loadApp();
    setupTwoRoutes(h);
    document.getElementById('panel-route-name').value = 'Rota Vazia';

    const saveBtn = document.getElementById('panel-btn-save');
    saveBtn.onclick.call(saveBtn);

    expect(h.state.routes[h.CUSTOM_ROUTE_PREFIX + 'Rota Vazia']).toBeUndefined();
    expect(document.getElementById('panel-status').textContent).toContain('Selecione pelo menos um ponto');
  });

  it('panel-btn-save não salva quando o nome está vazio', async () => {
    const h = await loadApp();
    setupTwoRoutes(h);
    h.togglePointSelection('ILHA', 0);
    document.getElementById('panel-route-name').value = '   ';

    const saveBtn = document.getElementById('panel-btn-save');
    saveBtn.onclick.call(saveBtn);

    expect(document.getElementById('panel-status').textContent).toContain('Digite um nome');
  });
});

describe('Edição de roteiro personalizado já salvo', () => {
  it('salvar novamente com o mesmo nome sobrescreve a seleção anterior (não duplica)', async () => {
    const h = await loadApp();
    setupTwoRoutes(h);

    // primeira versão: só I01
    h.togglePointSelection('ILHA', 0);
    document.getElementById('panel-route-name').value = 'Rota Editável';
    document.getElementById('panel-btn-save').onclick.call(document.getElementById('panel-btn-save'));

    const key = h.CUSTOM_ROUTE_PREFIX + 'Rota Editável';
    expect(h.state.routes[key]).toHaveLength(1);

    // edita a seleção: adiciona I02 também, salva de novo com o MESMO nome
    h.togglePointSelection('ILHA', 1);
    document.getElementById('panel-route-name').value = 'Rota Editável';
    document.getElementById('panel-btn-save').onclick.call(document.getElementById('panel-btn-save'));

    expect(h.state.routes[key]).toHaveLength(2);
    const savedCustom = JSON.parse(localStorage.getItem(h.CUSTOM_LS_KEY));
    // não deve haver duas entradas "Rota Editável" na lista de salvos
    expect(savedCustom.filter(r => r.name === 'Rota Editável')).toHaveLength(1);
  });
});

describe('Remoção de roteiro personalizado', () => {
  it('btn-del-route remove o roteiro personalizado de `routes` e da lista de salvos', async () => {
    const h = await loadApp();
    setupTwoRoutes(h);
    h.togglePointSelection('ILHA', 0);
    document.getElementById('panel-route-name').value = 'Para Remover';
    document.getElementById('panel-btn-save').onclick.call(document.getElementById('panel-btn-save'));

    const key = h.CUSTOM_ROUTE_PREFIX + 'Para Remover';
    expect(h.state.routes[key]).toBeDefined();
    h.state.currentRouteKey = key; // simula o roteiro personalizado estar selecionado no grid

    const delBtn = document.getElementById('btn-del-route');
    delBtn.onclick.call(delBtn); // confirm() está mockado para retornar true

    expect(h.state.routes[key]).toBeUndefined();
    const savedCustom = JSON.parse(localStorage.getItem(h.CUSTOM_LS_KEY));
    expect(savedCustom.some(r => r.name === 'Para Remover')).toBe(false);
    expect(h.state.currentRouteKey).toBe('');
  });

  it('btn-del-route não faz nada em roteiros normais (não personalizados)', async () => {
    const h = await loadApp();
    setupTwoRoutes(h);
    h.state.currentRouteKey = 'ILHA';

    const delBtn = document.getElementById('btn-del-route');
    delBtn.onclick.call(delBtn);

    expect(h.state.routes.ILHA).toBeDefined();
    expect(h.state.currentRouteKey).toBe('ILHA');
  });

  it('isCustomRouteKey / getCustomRouteName identificam corretamente as chaves personalizadas', async () => {
    const h = await loadApp();
    expect(h.isCustomRouteKey(h.CUSTOM_ROUTE_PREFIX + 'X')).toBe(true);
    expect(h.isCustomRouteKey('ILHA')).toBe(false);
    expect(h.getCustomRouteName(h.CUSTOM_ROUTE_PREFIX + 'Minha Rota')).toBe('Minha Rota');
    expect(h.getCustomRouteName('ILHA')).toBe('');
  });
});

describe('Geração de link/otimização a partir da seleção personalizada', () => {
  it('panel-btn-gen-link geocodifica pendências e gera link mantendo a ordem selecionada', async () => {
    const h = await loadApp();
    setupTwoRoutes(h);
    h.togglePointSelection('ILHA', 0);
    h.togglePointSelection('NORTE', 0);
    mockFetch(async url => {
      if (url.includes('is.gd') || url.includes('tinyurl')) return { ok: true, text: async () => 'https://is.gd/custom1' };
      return mapboxSuccessResponse({ lng: -51.21, lat: -30.03 }); // base
    });

    const genBtn = document.getElementById('panel-btn-gen-link');
    await genBtn.onclick.call(genBtn);

    expect(document.getElementById('panel-link-box').textContent).toBe('https://is.gd/custom1');
    expect(h.state.customOptimizedStops).toHaveLength(2);
  });

  it('panel-btn-clear limpa a seleção e os resultados do painel', async () => {
    const h = await loadApp();
    setupTwoRoutes(h);
    h.togglePointSelection('ILHA', 0);

    const clearBtn = document.getElementById('panel-btn-clear');
    clearBtn.onclick.call(clearBtn);

    expect(h.state.customSelection).toHaveLength(0);
    expect(document.getElementById('panel-link-box').style.display).toBe('none');
  });
});
