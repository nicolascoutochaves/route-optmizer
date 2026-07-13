import 'fake-indexeddb/auto'; // polyfill global de indexedDB (usado pelo vínculo de arquivo/FSA)
import { vi } from 'vitest';

// -----------------------------------------------------------------------
// Node 22+ tem um `globalThis.localStorage` experimental embutido que, sem a
// flag `--localstorage-file`, resolve para `undefined`. Em alguns Node/jsdom
// esse global nativo conflita com o `localStorage` que o jsdom cria, fazendo
// com que o `localStorage` "global" visto pelos testes/pelo script.js fique
// undefined. Só substituímos quando detectamos que está de fato quebrado —
// no ambiente do jsdom normalmente `window === globalThis`, então usamos um
// Storage próprio em memória (nunca um getter que reaponte para si mesmo,
// o que causaria recursão infinita).
// -----------------------------------------------------------------------
const hasWorkingLocalStorage = (() => {
  try {
    return typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function';
  } catch {
    return false;
  }
})();

if (!hasWorkingLocalStorage) {
  class MemoryStorage {
    constructor() { this._map = new Map(); }
    getItem(key) { return this._map.has(String(key)) ? this._map.get(String(key)) : null; }
    setItem(key, value) { this._map.set(String(key), String(value)); }
    removeItem(key) { this._map.delete(String(key)); }
    clear() { this._map.clear(); }
    key(i) { return [...this._map.keys()][i] ?? null; }
    get length() { return this._map.size; }
  }

  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      enumerable: true,
      value: new MemoryStorage()
    });
  } catch (e) {
    console.warn(
      '[setup] Não foi possível sobrescrever globalThis.localStorage. ' +
      'Se os testes falharem com "localStorage is undefined", rode com: ' +
      'node --no-experimental-webstorage ./node_modules/.bin/vitest run', e
    );
  }
}

// -----------------------------------------------------------------------
// QRCode: o script instancia `new QRCode(container, opts)`. Na página real
// isso vem de uma lib externa (qrcode.js) carregada via <script>. Aqui
// fornecemos um stub mínimo que só registra a chamada.
// -----------------------------------------------------------------------
class QRCodeStub {
  constructor(container, opts) {
    this.container = container;
    this.opts = opts;
    if (container) container.dataset.qrText = opts?.text || '';
  }
}
QRCodeStub.CorrectLevel = { H: 'H', Q: 'Q', M: 'M', L: 'L' };
vi.stubGlobal('QRCode', QRCodeStub);

// -----------------------------------------------------------------------
// fetch: por padrão, nenhuma rede real. Cada teste deve fazer
// vi.stubGlobal('fetch', ...) ou usar os helpers de test/mocks.js.
// Deixamos aqui um fallback que rejeita, para pegar chamadas não mockadas.
// -----------------------------------------------------------------------
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('fetch não mockado neste teste'))));

// -----------------------------------------------------------------------
// clipboard / URL.createObjectURL / URL.revokeObjectURL / alert / confirm
// -----------------------------------------------------------------------
Object.defineProperty(window.navigator, 'clipboard', {
  value: { writeText: vi.fn(() => Promise.resolve()) },
  writable: true,
  configurable: true
});

if (!window.URL.createObjectURL) window.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
if (!window.URL.revokeObjectURL) window.URL.revokeObjectURL = vi.fn();

window.alert = vi.fn();
window.confirm = vi.fn(() => true);
window.open = vi.fn();

// jsdom não implementa Blob.prototype.text() em todas as versões — os testes de
// exportação (KML/JSON) precisam ler o conteúdo do Blob gerado pelo script.
if (typeof Blob !== 'undefined' && !Blob.prototype.text) {
  Blob.prototype.text = function () {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsText(this);
    });
  };
}

// scrollIntoView não existe no jsdom
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
