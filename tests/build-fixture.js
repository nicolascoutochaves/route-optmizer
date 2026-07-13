// Gera o HTML de fixture usado nos testes: precisa conter TODOS os ids que
// script.js busca via document.getElementById no momento em que é carregado
// (vários listeners são registrados no top-level do arquivo).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');
const ids = new Set();
const re = /getElementById\(['"]([^'"]+)['"]\)/g;
let m;
while ((m = re.exec(src))) ids.add(m[1]);

// Ids usados via variável (ex: generateQRCode(url, 'qrcode') -> getElementById(containerId))
// e por isso não são capturados pelo regex acima.
['qrcode', 'panel-qrcode'].forEach(id => ids.add(id));

// Elementos que precisam ser um tipo específico (não uma <div> genérica)
const TEXT_INPUTS = new Set(['fix-input', 'panel-route-name']);
const CHECKBOXES = new Set(['panel-select-all-check']);
const FILE_INPUTS = new Set(['fi', 'fi-json-fallback']);
const DATALISTS = new Set(['panel-route-names-dl']);

function elementFor(id) {
  if (FILE_INPUTS.has(id)) {
    const multiple = id === 'fi' ? ' multiple' : '';
    return `<input type="file" id="${id}"${multiple}>`;
  }
  if (TEXT_INPUTS.has(id)) return `<input type="text" id="${id}">`;
  if (CHECKBOXES.has(id)) return `<input type="checkbox" id="${id}">`;
  if (DATALISTS.has(id)) return `<datalist id="${id}"></datalist>`;
  if (id === 'drop-zone') return `<div id="${id}"></div>`;
  return `<div id="${id}"></div>`;
}

const body = [...ids].sort().map(elementFor).join('\n    ');

const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><title>Roteiros - fixture de teste</title></head>
<body>
    ${body}
    <div id="success-message-holder"></div>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'fixture.html'), html);
console.log(`fixture.html gerado com ${ids.size} elementos.`);
