// tests/kml-import.test.js
//
// Este arquivo antes era uma cópia acidental de tests/supabase.test.js: mesmo
// cabeçalho de comentário ("tests/supabase.test.js"), mesmos describes
// (supabaseRequest, checkAuthorization, dbRowToPoint/pointToDbRow,
// loadRoutesFromDB, saveRoutesToDB, exportJSON) — nada relacionado a import de
// KML. Isso fazia cada um desses testes rodar duas vezes na suite (uma vez
// aqui, outra em supabase.test.js) e ainda assim não cobria parseKMLText,
// mergeRoutesFromFile nem processKMLFiles, que são as funções que este
// arquivo deveria testar. Reescrito para cobrir de fato a leitura/mesclagem
// de arquivos KML.
//
// Segue o mesmo padrão dos demais arquivos de teste do projeto: usa
// loadApp() de testUtils.js, que recarrega a fixture do DOM e reimporta
// script.js do zero a cada teste (estado limpo garantido), expondo
// window.__testHooks.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadApp } from './testUtils.js';

let hooks;

beforeEach(async () => {
  hooks = await loadApp();
  global.fetch = vi.fn();
});

const kml = ({ folderName = 'ILHA', placemarks = [] } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Folder>
      <name>${folderName}</name>
      ${placemarks.join('\n')}
    </Folder>
  </Document>
</kml>`;

const placemark = ({
  name = 'I01', address = 'Rua X, 10', description = 'Linha 1<br>Linha 2',
  roteiro = 'I SUL', subRoteiro = 'I SUL I', setor = 'EBAT X', sistema = 'SAA - X',
  lat = -30.01, lng = -51.2,
} = {}) => `<Placemark>
        <name>${name}</name>
        <address>${address}</address>
        <description><![CDATA[${description}]]></description>
        <ExtendedData>
          <Data name="ROTEIRO"><value>${roteiro}</value></Data>
          <Data name="SUB-ROTEIRO"><value>${subRoteiro}</value></Data>
          <Data name="SETOR ABASTECIMENTO"><value>${setor}</value></Data>
          <Data name="SISTEMA"><value>${sistema}</value></Data>
        </ExtendedData>
        ${lat !== null && lng !== null ? `<Point><coordinates>${lng},${lat},0</coordinates></Point>` : ''}
      </Placemark>`;

describe('parseKMLText', () => {
  it('lança erro quando o KML não tem nenhuma pasta (Document > Folder)', () => {
    const xml = `<?xml version="1.0"?><kml><Document></Document></kml>`;
    expect(() => hooks.parseKMLText(xml, 'vazio.kml')).toThrow(/nenhuma pasta/i);
  });

  it('extrai nome, endereço, coordenadas e ExtendedData de cada Placemark', () => {
    const xml = kml({ placemarks: [placemark()] });
    const result = hooks.parseKMLText(xml, 'roteiro.kml');

    expect(Object.keys(result)).toEqual(['ILHA']);
    expect(result.ILHA).toHaveLength(1);

    const p = result.ILHA[0];
    expect(p.name).toBe('I01');
    expect(p.address).toBe('Rua X, 10');
    expect(p.origAddress).toBe('Rua X, 10');
    expect(p.mapsAddress).toBe(hooks.formatAddr('Rua X, 10'));
    expect(p.lat).toBe(-30.01);
    expect(p.lng).toBe(-51.2);
    expect(p.status).toBe('ok');
    expect(p.corrected).toBe(false);
    expect(p.isGeocodable).toBe(true);
    expect(p.description).toBe('Linha 1\nLinha 2');
    expect(p.roteiro).toBe('I SUL');
    expect(p.subRoteiro).toBe('I SUL I');
    expect(p.setorAbastecimento).toBe('EBAT X');
    expect(p.sistema).toBe('SAA - X');
  });

  it('marca status "pending" e lat/lng nulos quando o Placemark não tem coordenadas', () => {
    const xml = kml({ placemarks: [placemark({ lat: null, lng: null })] });
    const result = hooks.parseKMLText(xml, 'sem-coord.kml');

    expect(result.ILHA[0].lat).toBeNull();
    expect(result.ILHA[0].lng).toBeNull();
    expect(result.ILHA[0].status).toBe('pending');
  });

  it('usa valores vazios/padrão quando ExtendedData ou description estão ausentes', () => {
    const xml = `<?xml version="1.0"?>
      <kml><Document><Folder>
        <name>SEM_EXTRA</name>
        <Placemark>
          <name>X01</name>
          <address>Rua Y, 5</address>
          <Point><coordinates>-51.1,-30.2,0</coordinates></Point>
        </Placemark>
      </Folder></Document></kml>`;
    const result = hooks.parseKMLText(xml, 'minimo.kml');
    const p = result.SEM_EXTRA[0];
    expect(p.description).toBe('');
    expect(p.roteiro).toBe('');
    expect(p.subRoteiro).toBe('');
    expect(p.setorAbastecimento).toBe('');
    expect(p.sistema).toBe('');
  });

  it('desambigua pastas com o mesmo nome dentro do mesmo arquivo, adicionando "(nome-do-arquivo)"', () => {
    const xml = `<?xml version="1.0"?>
      <kml><Document>
        <Folder><name>ILHA</name>${placemark({ name: 'I01' })}</Folder>
        <Folder><name>ILHA</name>${placemark({ name: 'I02' })}</Folder>
      </Document></kml>`;
    const result = hooks.parseKMLText(xml, 'duplicado.kml');
    expect(Object.keys(result).sort()).toEqual(['ILHA', 'ILHA (duplicado)'].sort());
  });
});

describe('mergeRoutesFromFile', () => {
  it('adiciona os roteiros do novo arquivo quando não há colisão de nomes', () => {
    const target = { ILHA: [{ name: 'I01' }] };
    hooks.mergeRoutesFromFile(target, { CENTRO: [{ name: 'C01' }] }, 'centro.kml');
    expect(Object.keys(target).sort()).toEqual(['CENTRO', 'ILHA']);
  });

  it('desambigua com "(nome-do-arquivo)" quando o roteiro já existe (veio de outro arquivo)', () => {
    const target = { ILHA: [{ name: 'I01' }] };
    hooks.mergeRoutesFromFile(target, { ILHA: [{ name: 'I02' }] }, 'outro.kml');
    expect(target.ILHA).toEqual([{ name: 'I01' }]);
    expect(target['ILHA (outro)']).toEqual([{ name: 'I02' }]);
  });

  it('incrementa o sufixo numérico em colisões sucessivas do mesmo par nome/arquivo', () => {
    const target = { ILHA: [{ name: 'I01' }], 'ILHA (outro)': [{ name: 'I02' }] };
    hooks.mergeRoutesFromFile(target, { ILHA: [{ name: 'I03' }] }, 'outro.kml');
    expect(target['ILHA (outro 2)']).toEqual([{ name: 'I03' }]);
  });
});

describe('processKMLFiles', () => {
  it('lê um arquivo .kml válido, popula routes, marca dataSource=local e salva a lista de arquivos', async () => {
    const file = new File([kml({ placemarks: [placemark()] })], 'ilha.kml', { type: 'text/xml' });

    hooks.processKMLFiles([file]);
    // FileReader.readAsText resolve de forma assíncrona; aguarda o onload.
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    expect(hooks.state.dataSource).toBe('local');
    expect(hooks.state.loadedFileNames).toEqual(['ilha.kml']);
    expect(Object.keys(hooks.state.routes)).toEqual(['ILHA']);
    expect(hooks.state.routes.ILHA[0].name).toBe('I01');
  });

  it('mescla múltiplos arquivos e desambigua roteiros com nomes repetidos entre eles', async () => {
    const fileA = new File([kml({ folderName: 'ILHA', placemarks: [placemark({ name: 'A01' })] })], 'a.kml', { type: 'text/xml' });
    const fileB = new File([kml({ folderName: 'ILHA', placemarks: [placemark({ name: 'B01' })] })], 'b.kml', { type: 'text/xml' });

    hooks.processKMLFiles([fileA, fileB]);
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    expect(hooks.state.loadedFileNames.sort()).toEqual(['a.kml', 'b.kml']);
    const keys = Object.keys(hooks.state.routes).sort();
    expect(keys).toHaveLength(2);
    expect(keys.some(k => k === 'ILHA')).toBe(true);
    expect(keys.some(k => k.startsWith('ILHA ('))).toBe(true);
  });

  it('ignora um arquivo malformado (sem pastas) sem interromper o processamento dos demais', async () => {
    const good = new File([kml({ placemarks: [placemark()] })], 'ok.kml', { type: 'text/xml' });
    const bad = new File(['<?xml version="1.0"?><kml><Document></Document></kml>'], 'ruim.kml', { type: 'text/xml' });

    hooks.processKMLFiles([good, bad]);
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    expect(hooks.state.loadedFileNames).toEqual(['ok.kml']);
    expect(Object.keys(hooks.state.routes)).toEqual(['ILHA']);
  });
});