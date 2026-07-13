import { describe, it, expect } from 'vitest';
import { loadApp, mockFetch, mapboxSuccessResponse, mapboxEmptyResponse, samplePoint } from './testUtils.js';

function setupRouteWithOnePoint(h) {
  h.state.routes = { R1: [samplePoint({ name: 'P1', address: 'Rua Velha, 10' })] };
  h.renderRouteButtons();
  const btn = document.querySelector('.route-btn');
  btn.click(); // dispara o onclick real, que define currentRouteKey e chama selectRoute()
  return btn;
}

describe('Correção pontual de endereço (fix box)', () => {
  it('openFix preenche a caixa de correção com os dados do ponto selecionado', async () => {
    const h = await loadApp();
    setupRouteWithOnePoint(h);
    h.openFix(0);
    expect(document.getElementById('fix-pname').textContent).toBe('P1');
    expect(document.getElementById('fix-box').classList.contains('hidden')).toBe(false);
  });

  it('btn-fix-geo geocodifica o novo endereço digitado e atualiza o ponto (marcando corrected=true)', async () => {
    const h = await loadApp();
    setupRouteWithOnePoint(h);
    h.openFix(0);
    document.getElementById('fix-input').value = 'Rua Nova, 200, Porto Alegre, RS, Brasil';
    mockFetch(async () => mapboxSuccessResponse({ lng: -51.19, lat: -30.05, place_name: 'Rua Nova, 200' }));

    const btn = document.getElementById('btn-fix-geo');
    await btn.onclick.call(btn);

    expect(h.state.points[0].lat).toBeCloseTo(-30.05);
    expect(h.state.points[0].lng).toBeCloseTo(-51.19);
    expect(h.state.points[0].corrected).toBe(true);
    expect(h.state.points[0].status).toBe('ok');
    expect(document.getElementById('fix-result').textContent).toContain('Reposicionado');
    // syncPointsToRoute() deve refletir no `routes`
    expect(h.state.routes.R1[0].corrected).toBe(true);
  });

  it('btn-fix-geo mostra mensagem de erro quando o endereço não é encontrado', async () => {
    const h = await loadApp();
    setupRouteWithOnePoint(h);
    h.openFix(0);
    document.getElementById('fix-input').value = 'Endereço Inexistente, 99999999';
    mockFetch(async () => mapboxEmptyResponse());

    const btn = document.getElementById('btn-fix-geo');
    await btn.onclick.call(btn);

    expect(document.getElementById('fix-result').textContent).toContain('Não encontrado');
    expect(h.state.points[0].corrected).toBe(false);
  });

  it('btn-fix-cancel fecha a caixa de correção sem alterar o ponto', async () => {
    const h = await loadApp();
    setupRouteWithOnePoint(h);
    h.openFix(0);
    const original = { ...h.state.points[0] };

    document.getElementById('btn-fix-cancel').click();

    expect(document.getElementById('fix-box').classList.contains('hidden')).toBe(true);
    expect(h.state.points[0]).toEqual(original);
  });
});

describe('Painel de edição de pontos (adicionar / editar / remover)', () => {
  it('openEditPanel cria uma cópia de trabalho (editDraftPoints) sem afetar `points` até salvar', async () => {
    const h = await loadApp();
    setupRouteWithOnePoint(h);
    h.openEditPanel();
    expect(h.state.editDraftPoints).toHaveLength(1);
    expect(document.getElementById('edit-panel').classList.contains('hidden')).toBe(false);
    // renderEditRows populou o DOM
    expect(document.querySelectorAll('#edit-rows .edit-row')).toHaveLength(1);
  });

  it('adicionar ponto: btn-edit-add insere uma nova linha em branco com coordenadas travadas', async () => {
    const h = await loadApp();
    setupRouteWithOnePoint(h);
    h.openEditPanel();

    document.getElementById('btn-edit-add').click();

    expect(h.state.editDraftPoints).toHaveLength(2);
    expect(h.state.editDraftPoints[1].isGeocodable).toBe(false);
    expect(document.querySelectorAll('#edit-rows .edit-row')).toHaveLength(2);
  });

  it('editar ponto: alterar os inputs e chamar collectEditRowsIntoDraft atualiza editDraftPoints', async () => {
    const h = await loadApp();
    setupRouteWithOnePoint(h);
    h.openEditPanel();

    const row = document.querySelector('#edit-rows .edit-row');
    row.querySelector('.edit-name').value = 'Ponto Renomeado';
    row.querySelector('.edit-address').value = 'Rua Editada, 55';
    row.querySelector('.edit-lat').value = '-30.5';
    row.querySelector('.edit-lng').value = '-51.5';

    h.collectEditRowsIntoDraft();

    expect(h.state.editDraftPoints[0].name).toBe('Ponto Renomeado');
    expect(h.state.editDraftPoints[0].address).toBe('Rua Editada, 55');
    expect(h.state.editDraftPoints[0].lat).toBe(-30.5);
    expect(h.state.editDraftPoints[0].lng).toBe(-51.5);
    expect(h.state.editDraftPoints[0].status).toBe('ok');
  });

  it('travar coordenadas (checkbox de lock) marca isGeocodable=false e corrected=true quando há lat/lng', async () => {
    const h = await loadApp();
    setupRouteWithOnePoint(h);
    h.openEditPanel();

    const row = document.querySelector('#edit-rows .edit-row');
    row.querySelector('.edit-lat').value = '-30.1';
    row.querySelector('.edit-lng').value = '-51.1';
    row.querySelector('.edit-lock').checked = true;

    h.collectEditRowsIntoDraft();

    expect(h.state.editDraftPoints[0].isGeocodable).toBe(false);
    expect(h.state.editDraftPoints[0].corrected).toBe(true);
  });

  it('remover ponto: botão de remover na linha tira o ponto de editDraftPoints e do DOM', async () => {
    const h = await loadApp();
    setupRouteWithOnePoint(h);
    h.openEditPanel();
    document.getElementById('btn-edit-add').click(); // agora tem 2 pontos

    expect(h.state.editDraftPoints).toHaveLength(2);
    const rows = document.querySelectorAll('#edit-rows .edit-row');
    rows[0].querySelector('.edit-row-remove').click();

    expect(h.state.editDraftPoints).toHaveLength(1);
    expect(document.querySelectorAll('#edit-rows .edit-row')).toHaveLength(1);
  });

  it('btn-edit-save aplica editDraftPoints de volta a `points`/`routes` e persiste no localStorage', async () => {
    const h = await loadApp();
    setupRouteWithOnePoint(h);
    h.openEditPanel();
    document.getElementById('btn-edit-add').click();
    const rows = document.querySelectorAll('#edit-rows .edit-row');
    rows[1].querySelector('.edit-name').value = 'Ponto Novo';
    rows[1].querySelector('.edit-address').value = 'Rua Nova, 300';
    rows[1].querySelector('.edit-lat').value = '-30.2';
    rows[1].querySelector('.edit-lng').value = '-51.2';

    const saveBtn = document.getElementById('btn-edit-save');
    await saveBtn.onclick.call(saveBtn);

    expect(h.state.points).toHaveLength(2);
    expect(h.state.points[1].name).toBe('Ponto Novo');
    expect(h.state.routes.R1).toHaveLength(2);
    const persisted = JSON.parse(localStorage.getItem(h.STORAGE_KEY));
    expect(persisted.routes.R1).toHaveLength(2);
    expect(document.getElementById('edit-status').textContent).toContain('salvas');
  });

  it('renderEditRows mostra mensagem quando o roteiro fica sem nenhum ponto', async () => {
    const h = await loadApp();
    setupRouteWithOnePoint(h);
    h.openEditPanel();
    document.querySelector('#edit-rows .edit-row .edit-row-remove').click();

    expect(h.state.editDraftPoints).toHaveLength(0);
    expect(document.getElementById('edit-rows').textContent).toContain('Nenhum ponto neste roteiro');
  });
});
