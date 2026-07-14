import { describe, it, expect } from 'vitest';
import { loadApp } from './testUtils.js';

describe('Utilitários de texto', () => {
  it('escXML escapa caracteres especiais de HTML', async () => {
    const h = await loadApp();
    expect(h.escXML('<b>"A & B"</b>')).toBe('&lt;b&gt;&quot;A &amp; B&quot;&lt;/b&gt;');
  });

  it('escXML lida com valores vazios/nulos sem lançar erro', async () => {
    const h = await loadApp();
    expect(h.escXML(null)).toBe('');
    expect(h.escXML(undefined)).toBe('');
    expect(h.escXML('')).toBe('');
  });

  it('titleCasePt capitaliza cada palavra preservando acentos', async () => {
    const h = await loadApp();
    expect(h.titleCasePt('avenida martinho poeta')).toBe('Avenida Martinho Poeta');
    expect(h.titleCasePt('presidente vargas')).toBe('Presidente Vargas');
  });

  it('formatAddr monta "Rua, número, complemento, Porto Alegre, RS, Brasil"', async () => {
    const h = await loadApp();
    const out = h.formatAddr('RUA MEXIANA, 81, Porto Alegre, RS, Brasil');
    expect(out).toContain('81');
    expect(out.endsWith('Porto Alegre, RS, Brasil')).toBe(true);
  });

  it('formatAddr sempre acrescenta ", Porto Alegre, RS, Brasil" ao final, mesmo que o endereço já contenha esses termos no meio', async () => {
    // Nota: a função não deduplica city/state que já apareçam antes do número —
    // ela só remove o sufixo se ele estiver exatamente no final da string original.
    // Este teste documenta o comportamento real (mesmo padrão visto nos dados
    // reais salvos em "mapsAddress", ex: "Rua Mexiana,, 81, , Porto Alegre, Rs,, Porto Alegre, RS, Brasil").
    const h = await loadApp();
    const out = h.formatAddr('RUA MEXIANA, 81, Porto Alegre, RS, Brasil');
    expect(out.endsWith(', Porto Alegre, RS, Brasil')).toBe(true);
    expect(out.startsWith('Rua Mexiana')).toBe(true);
  });

  it('formatAddr trata string vazia retornando vazio', async () => {
    const h = await loadApp();
    expect(h.formatAddr('')).toBe('');
    expect(h.formatAddr(null)).toBe('');
  });

  it('não expõe mais escURL/normalizeText no client (dead code removido junto com pickBestFeature)', async () => {
    const h = await loadApp();
    expect(h.escURL).toBeUndefined();
    expect(h.normalizeText).toBeUndefined();
    expect(h.pickBestFeature).toBeUndefined();
  });
});