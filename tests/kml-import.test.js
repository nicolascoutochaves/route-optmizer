import { describe, it, expect } from 'vitest';
import { loadApp, SAMPLE_KML, makeFile } from './testUtils.js';

describe('parseKMLText', () => {
  it('extrai name, address, lat/lng de cada Placemark de cada Folder', async () => {
    const h = await loadApp();
    const result = h.parseKMLText(SAMPLE_KML(), 'teste.kml');
    expect(Object.keys(result)).toEqual(['ILHA']);
    expect(result.ILHA).toHaveLength(2);
    const [p1, p2] = result.ILHA;
    expect(p1.name).toBe('I01');
    expect(p1.address).toContain('MARTINHO POETA');
    expect(p1.lat).toBeCloseTo(-29.99135, 4);
    expect(p1.lng).toBeCloseTo(-51.273944, 4);
    expect(p1.status).toBe('ok');
    expect(p2.name).toBe('I02');
  });

  it('extrai description (convertendo <br> em quebras de linha e removendo tags)', async () => {
    const h = await loadApp();
    const result = h.parseKMLText(SAMPLE_KML(), 'teste.kml');
    const p1 = result.ILHA[0];
    expect(p1.description).toContain('ROTEIRO: I SUL');
    expect(p1.description).toContain('SISTEMA: SAA - Ilha da Pintada');
    expect(p1.description).not.toContain('<br>');
    expect(p1.description).not.toMatch(/<[^>]+>/);
  });

  it('extrai os campos do ExtendedData: roteiro, subRoteiro, bairro, setorAbastecimento, sistema', async () => {
    const h = await loadApp();
    const result = h.parseKMLText(SAMPLE_KML(), 'teste.kml');
    const [p1, p2] = result.ILHA;

    expect(p1.roteiro).toBe('I SUL');
    expect(p1.subRoteiro).toBe('I SUL I');
    expect(p1.bairro).toBe('ELDORADO DO SUL');
    expect(p1.cidade).toBe('Porto Alegre');
    expect(p1.setorAbastecimento).toBe('EBAT ILHA DA PINTADA/RES ILHA');
    expect(p1.sistema).toBe('SAA - Ilha da Pintada');

    expect(p2.bairro).toBe('ARQUIPÉLAGO');
    expect(p2.setorAbastecimento).toBe('EBAT ILHAS (INLINE)');
    expect(p2.sistema).toBe('SAA - Ilha da Pintada');
  });

  it('marca status "pending" quando o Placemark não tem coordenadas', async () => {
    const h = await loadApp();
    const kmlSemCoord = `<?xml version="1.0"?><kml><Document><Folder><name>X</name>
      <Placemark><name>SEM_COORD</name><address>Rua Sem Coordenada, 1</address></Placemark>
    </Folder></Document></kml>`;
    const result = h.parseKMLText(kmlSemCoord, 'x.kml');
    expect(result.X[0].status).toBe('pending');
    expect(result.X[0].lat).toBeNull();
  });

  it('lança erro quando o KML não tem nenhuma pasta (Folder)', async () => {
    const h = await loadApp();
    const semFolder = `<?xml version="1.0"?><kml><Document></Document></kml>`;
    expect(() => h.parseKMLText(semFolder, 'vazio.kml')).toThrow('Nenhuma pasta');
  });

  it('duas pastas com o MESMO nome dentro do MESMO arquivo recebem chaves distintas (sufixo do arquivo)', async () => {
    const h = await loadApp();
    const kmlComDuasPastasIguais = `<?xml version="1.0"?><kml><Document>
      <Folder><name>ILHA</name>
        <Placemark><name>A1</name><address>Rua A, 1</address>
          <Point><coordinates>-51.20,-29.90,0</coordinates></Point>
        </Placemark>
      </Folder>
      <Folder><name>ILHA</name>
        <Placemark><name>A2</name><address>Rua B, 2</address>
          <Point><coordinates>-51.21,-29.91,0</coordinates></Point>
        </Placemark>
      </Folder>
    </Document></kml>`;

    const result = h.parseKMLText(kmlComDuasPastasIguais, 'duplicado.kml');
    const keys = Object.keys(result);
    expect(keys).toContain('ILHA');
    expect(keys).toContain('ILHA (duplicado)');
    expect(result['ILHA'][0].name).toBe('A1');
    expect(result['ILHA (duplicado)'][0].name).toBe('A2');
  });

  it('[FIX] duas pastas com o mesmo nome vindas de ARQUIVOS diferentes NÃO se sobrescrevem mais: mergeRoutesFromFile desambigua com sufixo do arquivo', async () => {
    const h = await loadApp();
    const nr1 = h.parseKMLText(SAMPLE_KML(), 'arquivo1.kml');
    const nr2 = h.parseKMLText(SAMPLE_KML(), 'arquivo2.kml'); // mesmo Folder "ILHA"

    const merged = {};
    h.mergeRoutesFromFile(merged, nr1, 'arquivo1.kml');
    h.mergeRoutesFromFile(merged, nr2, 'arquivo2.kml');

    expect(Object.keys(merged).sort()).toEqual(['ILHA', 'ILHA (arquivo2)']);
    expect(merged['ILHA']).toHaveLength(2); // dados do arquivo1 preservados
    expect(merged['ILHA (arquivo2)']).toHaveLength(2); // dados do arquivo2 preservados, não perdidos
  });

  it('mergeRoutesFromFile não desambigua quando não há colisão de nomes', async () => {
    const h = await loadApp();
    const nr1 = h.parseKMLText(SAMPLE_KML(), 'sul.kml'); // Folder "ILHA"
    const kmlNorte = `<?xml version="1.0"?><kml><Document><Folder><name>NORTE</name>
      <Placemark><name>N01</name><address>Rua Norte, 1</address>
        <Point><coordinates>-51.20,-29.90,0</coordinates></Point>
      </Placemark>
    </Folder></Document></kml>`;
    const nr2 = h.parseKMLText(kmlNorte, 'norte.kml');

    const merged = {};
    h.mergeRoutesFromFile(merged, nr1, 'sul.kml');
    h.mergeRoutesFromFile(merged, nr2, 'norte.kml');

    expect(Object.keys(merged).sort()).toEqual(['ILHA', 'NORTE']);
  });

  it('mergeRoutesFromFile lida com uma terceira colisão do mesmo nome (sufixo numerado)', async () => {
    const h = await loadApp();
    const merged = { ILHA: [{ name: 'original' }], 'ILHA (dup)': [{ name: 'segunda' }] };
    const nr = h.parseKMLText(SAMPLE_KML(), 'dup.kml'); // vai gerar { ILHA: [...] }

    h.mergeRoutesFromFile(merged, nr, 'dup.kml');

    const keys = Object.keys(merged).sort();
    expect(keys).toEqual(['ILHA', 'ILHA (dup 2)', 'ILHA (dup)']);
    // nenhum dos roteiros anteriores foi perdido/sobrescrito
    expect(merged['ILHA'][0].name).toBe('original');
    expect(merged['ILHA (dup)'][0].name).toBe('segunda');
  });
});

describe('processKMLFiles (fluxo de importação via drag-and-drop / input file)', () => {
  it('lê um arquivo .kml real (via FileReader) e popula routes + localStorage', async () => {
    const h = await loadApp();
    const file = makeFile(SAMPLE_KML(), 'ROTEIROS SUL.kml');

    h.processKMLFiles([file]);
    // FileReader é assíncrono mesmo em jsdom; aguarda o próximo tick(s)
    await new Promise(r => setTimeout(r, 50));

    expect(h.state.routes.ILHA).toBeDefined();
    expect(h.state.routes.ILHA).toHaveLength(2);
    expect(h.state.loadedFileNames).toContain('ROTEIROS SUL.kml');
    expect(localStorage.getItem(h.STORAGE_KEY)).not.toBeNull();

    const saved = JSON.parse(localStorage.getItem(h.STORAGE_KEY));
    expect(saved.routes.ILHA[0].setorAbastecimento).toBe('EBAT ILHA DA PINTADA/RES ILHA');
  });

  it('importa múltiplos arquivos .kml de uma vez, mesclando os roteiros', async () => {
    const h = await loadApp();
    const kml2 = `<?xml version="1.0"?><kml><Document><Folder><name>NORTE</name>
      <Placemark><name>N01</name><address>Rua Norte, 1</address>
        <Point><coordinates>-51.20,-29.90,0</coordinates></Point>
      </Placemark>
    </Folder></Document></kml>`;

    h.processKMLFiles([makeFile(SAMPLE_KML(), 'sul.kml'), makeFile(kml2, 'norte.kml')]);
    await new Promise(r => setTimeout(r, 50));

    expect(Object.keys(h.state.routes).sort()).toEqual(['ILHA', 'NORTE']);
  });

  it('[FIX] processKMLFiles não perde mais um roteiro quando dois arquivos têm uma pasta com o mesmo nome', async () => {
    const h = await loadApp();
    // ambos os arquivos têm uma pasta "ILHA", mas com pontos diferentes
    const kmlArquivo2 = `<?xml version="1.0"?><kml><Document><Folder><name>ILHA</name>
      <Placemark><name>I99</name><address>Rua Outra Ilha, 99</address>
        <Point><coordinates>-51.30,-29.80,0</coordinates></Point>
      </Placemark>
    </Folder></Document></kml>`;

    h.processKMLFiles([makeFile(SAMPLE_KML(), 'sul.kml'), makeFile(kmlArquivo2, 'extra.kml')]);
    await new Promise(r => setTimeout(r, 50));

    const keys = Object.keys(h.state.routes).sort();
    expect(keys).toEqual(['ILHA', 'ILHA (extra)']);
    expect(h.state.routes['ILHA']).toHaveLength(2); // I01, I02 (do sul.kml)
    expect(h.state.routes['ILHA (extra)']).toHaveLength(1); // I99 (do extra.kml) — não foi perdido
  });
});
