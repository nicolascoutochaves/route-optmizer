import { describe, it, expect } from 'vitest';
import { loadApp, mockFetch } from './testUtils.js';

const BASE = { lat: -30.0346, lng: -51.2177 };

describe('buildGoogleMapsUrl', () => {
  it('monta uma URL de direções passando por base -> paradas -> base', async () => {
    const h = await loadApp();
    h.state.startCoord = BASE;
    const stops = [{ lat: -30.01, lng: -51.20 }, { lat: -30.02, lng: -51.21 }];
    const url = h.buildGoogleMapsUrl(stops);

    expect(url.startsWith('https://www.google.com/maps/dir/')).toBe(true);
    expect(url).toContain('-30.034600,-51.217700'); // base
    expect(url).toContain('-30.010000,-51.200000'); // parada 1
    expect(url).toContain('-30.020000,-51.210000'); // parada 2
    // a base aparece 2x (ida e volta)
    expect(url.match(/-30\.034600,-51\.217700/g)).toHaveLength(2);
  });
});

describe('shortenUrl', () => {
  it('usa o link curto do is.gd quando ele responde com sucesso', async () => {
    const h = await loadApp();
    mockFetch(async url => {
      expect(url).toContain('is.gd');
      return { ok: true, text: async () => 'https://is.gd/abc123' };
    });
    const short = await h.shortenUrl('https://www.google.com/maps/dir/...');
    expect(short).toBe('https://is.gd/abc123');
  });

  it('cai para o tinyurl quando o is.gd falha', async () => {
    const h = await loadApp();
    mockFetch(async url => {
      if (url.includes('is.gd')) throw new Error('is.gd fora do ar');
      return { ok: true, text: async () => 'https://tinyurl.com/xyz789' };
    });
    const short = await h.shortenUrl('https://www.google.com/maps/dir/...');
    expect(short).toBe('https://tinyurl.com/xyz789');
  });

  it('retorna a URL longa original quando nenhum encurtador responde (offline)', async () => {
    const h = await loadApp();
    mockFetch(async () => { throw new Error('sem conexão'); });
    const longUrl = 'https://www.google.com/maps/dir/x,y/z,w';
    const short = await h.shortenUrl(longUrl);
    expect(short).toBe(longUrl);
  });

  it('ignora resposta que não parece uma URL válida e tenta o próximo encurtador', async () => {
    const h = await loadApp();
    mockFetch(async url => {
      if (url.includes('is.gd')) return { ok: true, text: async () => 'Error: URL inválida' };
      return { ok: true, text: async () => 'https://tinyurl.com/ok' };
    });
    const short = await h.shortenUrl('https://www.google.com/maps/dir/...');
    expect(short).toBe('https://tinyurl.com/ok');
  });
});

describe('updateShareLink (link + QR code)', () => {
  it('gera link curto, exibe na caixa de texto e renderiza o QR code', async () => {
    const h = await loadApp();
    h.state.startCoord = BASE;
    mockFetch(async () => ({ ok: true, text: async () => 'https://is.gd/rota1' }));

    const stops = [{ lat: -30.01, lng: -51.20 }];
    const short = await h.updateShareLink(stops);

    expect(short).toBe('https://is.gd/rota1');
    expect(document.getElementById('lbox').textContent).toBe('https://is.gd/rota1');
    expect(document.getElementById('lbox').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('qr-section').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('qrcode').dataset.qrText).toBe('https://is.gd/rota1');
    expect(h.state.links).toEqual(['https://is.gd/rota1']);
  });
});
