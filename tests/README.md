# Testes automatizados — roteiros-tests

Suíte de testes unitários para o script de otimização de roteiros (Mapbox +
KML/JSON + TSP + links/QR code + roteiros personalizados).

## Como rodar

```bash
npm install
npm test          # roda tudo uma vez
npm run test:watch  # modo watch
```

O `npm test` já regenera o `fixture.html` automaticamente (hook `pretest`).

## Como isso funciona

`../script.js` (na raiz do repositório) é o seu script real de produção, com um único
acréscimo no final: um bloco `TEST HOOKS` que expõe as funções internas e o
estado (`routes`, `points`, `startCoord`, etc — que no arquivo original são
`let`/`const` de escopo de módulo, inacessíveis de fora) em
`window.__testHooks`. Nada nesse bloco muda o comportamento do app; ele só
existe para os testes conseguirem chamar as funções diretamente, sem precisar
clicar em botões de verdade.

Como o script não é um módulo ES (não usa `import`/`export`, e assume que vai
rodar direto num `<script>` de página), ele referencia dezenas de elementos
via `document.getElementById(...)` assim que é carregado (para registrar os
`onclick`/`onchange`). Por isso:

- `test/build-fixture.js` varre o `script.js` e gera automaticamente
  `test/fixture.html` com **todos** os elementos que ele espera encontrar.
- `test/testUtils.js` (`loadApp()`) recarrega esse fixture no `document`,
  reseta os módulos do Vitest e reimporta `script.js` do zero antes de cada
  teste — garantindo estado limpo (`routes = {}`, `points = []`, etc).
- `test/setup.js` fornece os mocks globais necessários no jsdom: `fetch`
  (rede), `QRCode` (lib externa de QR code), `indexedDB` (via
  `fake-indexeddb`, para o vínculo de arquivo), `navigator.clipboard`,
  `Blob.prototype.text()`, `alert`/`confirm`/`window.open`, etc.

## Cobertura dos testes

| Arquivo | Cobre |
|---|---|
| `utils.test.js` | `escXML`, `normalizeText`, `titleCasePt`, `formatAddr` |
| `geocoding.test.js` | `geocodeMapbox` (sucesso, não encontrado, timeout/erro de rede, HTTP de erro, múltiplas variantes de endereço), `pickBestFeature`, `ensureStartCoord` (cache) |
| `mapbox-token.test.js` | guard de token Mapbox ausente/placeholder |
| `tsp-ordering.test.js` | `haversine`, `solveTSP` (nearest-neighbor + 2-opt), `tourDistanceKm`, reordenação manual (drag-and-drop) |
| `kml-import.test.js` | `parseKMLText` (nome, endereço, coordenadas, `description`, campos do `ExtendedData`: roteiro, bairro, setor de abastecimento, sistema), colisão de nomes de pasta, `processKMLFiles` (fluxo real via `FileReader`) |
| `kml-export.test.js` | `buildKmlFromOptimizedRoute`, `buildMultiRouteKml`, `exportRoutesAsKml` (com pontos sem coordenadas ignorados) |
| `json-persistence.test.js` | `saveToStorage`/`loadFromStorage`, `exportJSON`, `importFromJSON`/`applyLoadedRoutes` (incluindo JSON corrompido) e roundtrip export→import |
| `links-qrcode.test.js` | `buildGoogleMapsUrl`, `shortenUrl` (is.gd → tinyurl → fallback para URL longa), `updateShareLink` + geração de QR code |
| `points-crud.test.js` | correção pontual de endereço (fix box), painel de edição: adicionar / editar / travar coordenadas / remover pontos, salvar |
| `custom-routes.test.js` | seleção de pontos de vários roteiros, criar roteiro personalizado, editar (salvar de novo com o mesmo nome sem duplicar), remover, gerar link a partir da seleção |

## Observações sobre comportamentos "reais" documentados nos testes

Alguns testes documentam comportamentos existentes no script (não são bugs
introduzidos pelos testes):

- `formatAddr` sempre acrescenta `, Porto Alegre, RS, Brasil` ao final,
  mesmo que o endereço original já contenha esses termos no meio — por isso
  o `mapsAddress` salvo pode ficar com "Porto Alegre"/"RS" duplicados (é o
  que você já via nos dados reais, ex: `"Rua Mexiana,, 81, , Porto Alegre,
  Rs,, Porto Alegre, RS, Brasil"`).
- A desambiguação de pastas com nomes repetidos (`"ILHA (arquivo.kml)"`) só
  acontece dentro do **mesmo** arquivo KML (duas `<Folder>` com o mesmo
  `<name>`); entre arquivos diferentes, `processKMLFiles` mescla tudo com
  `Object.assign`, então um roteiro do segundo arquivo com o mesmo nome
  substitui o do primeiro silenciosamente.

Se algum desses comportamentos não for o que você espera, me avise — dá pra
ajustar o `script.js` e o teste correspondente já vai apontar a regressão.
