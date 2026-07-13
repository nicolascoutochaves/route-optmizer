import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureHtml = fs.readFileSync(path.join(__dirname, 'fixture.html'), 'utf8');
const fixtureBody = fixtureHtml.match(/<body>([\s\S]*)<\/body>/)[1];

/**
 * Recarrega o DOM fixture (todos os elementos que o script.js espera) e
 * reimporta src/script.js do zero, para que cada teste comece com um estado
 * limpo (routes = {}, points = [], startCoord = null, etc).
 *
 * Retorna `window.__testHooks`, o objeto de funções/estado exposto pelo
 * próprio script.js para fins de teste (ver bloco TEST HOOKS no final do
 * arquivo original).
 */
export async function loadApp() {
  document.body.innerHTML = fixtureBody;
  localStorage.clear();
  vi.resetModules();
  await import('../script.js?t=' + Date.now() + Math.random());
  return window.__testHooks;
}

/** Substitui window.fetch por um mock controlado pelo teste. */
export function mockFetch(impl) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** Resposta Mapbox de sucesso, com um único feature na coordenada dada. */
export function mapboxSuccessResponse({ lng, lat, place_name = 'Endereço Mock, Porto Alegre - RS, Brasil', address = '', relevance = 1 }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      features: [
        {
          place_name,
          relevance,
          center: [lng, lat],
          properties: { address }
        }
      ]
    }),
    text: async () => JSON.stringify({})
  };
}

/** Resposta Mapbox "não encontrado" (sem features). */
export function mapboxEmptyResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ features: [] }),
    text: async () => JSON.stringify({})
  };
}

export function samplePoint(overrides = {}) {
  return {
    isGeocodable: true,
    name: 'P1',
    address: 'Rua Teste, 100, Porto Alegre, RS, Brasil',
    origAddress: 'Rua Teste, 100, Porto Alegre, RS, Brasil',
    mapsAddress: 'Rua Teste, 100, Porto Alegre, RS, Brasil',
    lat: -30.03,
    lng: -51.23,
    status: 'ok',
    corrected: false,
    ...overrides
  };
}

export const SAMPLE_KML = fname => `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <Folder>
    <name>ILHA</name>
    <Placemark>
      <name>I01</name>
      <address>AVENIDA MARTINHO POETA-ELDORADO DO SUL, 2423, Porto Alegre, RS, Brasil</address>
      <description><![CDATA[ROTEIRO: I SUL<br>SUB-ROTEIRO: I SUL I<br>RUA: AVENIDA MARTINHO POETA-ELDORADO DO SUL<br>NUM: 2423<br>BAIRRO: ELDORADO DO SUL<br>CIDADE: Porto Alegre<br>COMPLEMENTO: <br>SETOR ABASTECIMENTO: EBAT ILHA DA PINTADA/RES ILHA<br>SISTEMA: SAA - Ilha da Pintada<br>ENDERECO_COMPLETO: AVENIDA MARTINHO POETA-ELDORADO DO SUL, 2423, Porto Alegre, RS, Brasil]]></description>
      <ExtendedData>
        <Data name="ROTEIRO"><value>I SUL</value></Data>
        <Data name="SUB-ROTEIRO"><value>I SUL I</value></Data>
        <Data name="BAIRRO"><value>ELDORADO DO SUL</value></Data>
        <Data name="CIDADE"><value>Porto Alegre</value></Data>
        <Data name="COMPLEMENTO"><value></value></Data>
        <Data name="SETOR ABASTECIMENTO"><value>EBAT ILHA DA PINTADA/RES ILHA</value></Data>
        <Data name="SISTEMA"><value>SAA - Ilha da Pintada</value></Data>
      </ExtendedData>
      <Point><coordinates>-51.273944,-29.99135,0</coordinates></Point>
    </Placemark>
    <Placemark>
      <name>I02</name>
      <address>RUA MEXIANA, 81, Porto Alegre, RS, Brasil</address>
      <description><![CDATA[ROTEIRO: I SUL<br>SUB-ROTEIRO: I SUL I<br>BAIRRO: ARQUIPÉLAGO<br>SETOR ABASTECIMENTO: EBAT ILHAS (INLINE)<br>SISTEMA: SAA - Ilha da Pintada]]></description>
      <ExtendedData>
        <Data name="ROTEIRO"><value>I SUL</value></Data>
        <Data name="SUB-ROTEIRO"><value>I SUL I</value></Data>
        <Data name="BAIRRO"><value>ARQUIPÉLAGO</value></Data>
        <Data name="SETOR ABASTECIMENTO"><value>EBAT ILHAS (INLINE)</value></Data>
        <Data name="SISTEMA"><value>SAA - Ilha da Pintada</value></Data>
      </ExtendedData>
      <Point><coordinates>-51.262858,-30.013627,0</coordinates></Point>
    </Placemark>
  </Folder>
</Document>
</kml>`;

/** Simula um File real (usado por FileReader dentro do script). */
export function makeFile(content, name, type = 'application/xml') {
  return new File([content], name, { type });
}
