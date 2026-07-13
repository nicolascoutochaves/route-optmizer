import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureHtml = fs.readFileSync(path.join(__dirname, 'fixture.html'), 'utf8');
const fixtureBody = fixtureHtml.match(/<body>([\s\S]*)<\/body>/)[1];

/**
 * O MAPBOX_TOKEN é uma constante fixa no topo do script.js. Para testar o
 * guard "token não configurado" sem tocar no arquivo de produção, geramos
 * uma cópia temporária do script com o placeholder 'SEU_TOKEN' no lugar do
 * token real (o guard em geocodeMapbox() detecta exatamente essa string).
 */
describe('geocodeMapbox — guard de token ausente/placeholder', () => {
  it('lança erro pedindo para inserir a chave Mapbox quando o token contém "SEU_TOKEN"', async () => {
    const original = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');
    const patched = original.replace(
      /const MAPBOX_TOKEN = '[^']*';/,
      "const MAPBOX_TOKEN = 'SEU_TOKEN_AQUI';"
    );
    expect(patched).not.toBe(original);

    const tmpFile = path.join(__dirname, `.tmp-script-no-token-${Date.now()}.js`);
    fs.writeFileSync(tmpFile, patched);

    document.body.innerHTML = fixtureBody;
    vi.resetModules();
    try {
      await import(`${tmpFile}?t=${Date.now()}`);
      const h = window.__testHooks;
      await expect(h.geocodeMapbox('Rua Teste, 100')).rejects.toThrow('Insira a chave Mapbox');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
