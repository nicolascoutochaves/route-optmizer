import { describe, it, expect } from 'vitest';
import { loadApp } from './testUtils.js';

const BASE = { lat: -30.0346, lng: -51.2177 }; // aprox. centro de Porto Alegre

describe('haversine', () => {
  it('retorna 0 para o mesmo ponto', async () => {
    const h = await loadApp();
    expect(h.haversine(BASE, BASE)).toBe(0);
  });

  it('calcula distância aproximada correta entre dois pontos conhecidos', async () => {
    const h = await loadApp();
    // ~1.2km ao norte
    const d = h.haversine(BASE, { lat: BASE.lat + 0.01, lng: BASE.lng });
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(1300);
  });
});

describe('solveTSP (nearest neighbor + 2-opt)', () => {
  it('com 0 ou 1 ponto, retorna a lista sem alterações', async () => {
    const h = await loadApp();
    h.state.startCoord = BASE;
    expect(h.solveTSP([])).toEqual([]);
    const single = [{ lat: -30.01, lng: -51.2, name: 'A' }];
    expect(h.solveTSP(single)).toEqual(single);
  });

  it('retorna todos os pontos de entrada, sem duplicar nem perder nenhum', async () => {
    const h = await loadApp();
    h.state.startCoord = BASE;
    const stops = [
      { lat: -30.10, lng: -51.30, name: 'longe-sudoeste' },
      { lat: -30.00, lng: -51.20, name: 'perto-base' },
      { lat: -29.95, lng: -51.25, name: 'norte' },
      { lat: -30.05, lng: -51.10, name: 'leste' }
    ];
    const order = h.solveTSP(stops.map(s => ({ ...s })));
    expect(order.length).toBe(stops.length);
    const namesIn = stops.map(s => s.name).sort();
    const namesOut = order.map(s => s.name).sort();
    expect(namesOut).toEqual(namesIn);
  });

  it('produz uma rota cuja distância total não é maior que a ordem original (otimiza ou mantém)', async () => {
    const h = await loadApp();
    h.state.startCoord = BASE;
    // pontos deliberadamente "fora de ordem" geograficamente
    const stops = [
      { lat: -29.90, lng: -51.35, name: 'longe1' },
      { lat: -30.20, lng: -51.05, name: 'longe2' },
      { lat: -30.02, lng: -51.22, name: 'perto1' },
      { lat: -30.03, lng: -51.21, name: 'perto2' }
    ];
    const originalDist = parseFloat(h.tourDistanceKm(stops));
    const optimized = h.solveTSP(stops.map(s => ({ ...s })));
    const optimizedDist = parseFloat(h.tourDistanceKm(optimized));
    expect(optimizedDist).toBeLessThanOrEqual(originalDist + 0.05); // tolerância de arredondamento
  });

  it('é determinístico para a mesma entrada (mesma rota sempre)', async () => {
    const h = await loadApp();
    h.state.startCoord = BASE;
    const stops = [
      { lat: -30.10, lng: -51.30, name: 'A' },
      { lat: -30.00, lng: -51.20, name: 'B' },
      { lat: -29.95, lng: -51.25, name: 'C' }
    ];
    const r1 = h.solveTSP(stops.map(s => ({ ...s }))).map(s => s.name);
    const r2 = h.solveTSP(stops.map(s => ({ ...s }))).map(s => s.name);
    expect(r1).toEqual(r2);
  });
});

describe('tourDistanceKm', () => {
  it('retorna "0" quando não há paradas ou não há base geocodificada', async () => {
    const h = await loadApp();
    h.state.startCoord = null;
    expect(h.tourDistanceKm([{ lat: -30, lng: -51 }])).toBe('0');
    h.state.startCoord = BASE;
    expect(h.tourDistanceKm([])).toBe('0');
  });

  it('soma ida (base->paradas) e volta (última parada->base)', async () => {
    const h = await loadApp();
    h.state.startCoord = BASE;
    const stops = [{ lat: BASE.lat + 0.01, lng: BASE.lng }];
    const km = parseFloat(h.tourDistanceKm(stops));
    // ida ~1.1km + volta ~1.1km
    expect(km).toBeGreaterThan(2.0);
    expect(km).toBeLessThan(2.6);
  });
});

describe('Reordenação manual (drag-and-drop) dos pontos na lista', () => {
  it('trocar dois pontos de posição em `points` reflete na leitura via state', async () => {
    const h = await loadApp();
    h.state.routes = {
      R1: [
        { name: 'P1', address: 'A', lat: -30, lng: -51, status: 'ok', isGeocodable: true },
        { name: 'P2', address: 'B', lat: -30.01, lng: -51.01, status: 'ok', isGeocodable: true },
        { name: 'P3', address: 'C', lat: -30.02, lng: -51.02, status: 'ok', isGeocodable: true }
      ]
    };
    h.renderRouteButtons();
    const btn = document.querySelector('.route-btn');
    h.selectRoute('R1', btn);

    expect(h.state.points.map(p => p.name)).toEqual(['P1', 'P2', 'P3']);

    // simula o swap que ondrop faz: [points[from], points[to]] = [points[to], points[from]]
    const pts = h.state.points;
    [pts[0], pts[2]] = [pts[2], pts[0]];
    h.state.points = pts;

    expect(h.state.points.map(p => p.name)).toEqual(['P3', 'P2', 'P1']);
  });
});
