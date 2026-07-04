# Otimizador de Roteiros — versão PWA (instalável no celular)

## O que mudou
- `script.js` **não foi alterado** — sua suíte de testes continua valendo 100%.
- Foram adicionados apenas:
  - `manifest.webmanifest` — diz ao celular o nome, ícone e cores do app.
  - `sw.js` — service worker: permite instalar e funcionar offline (cacheia o HTML/CSS/JS).
  - `icons/` — ícones do app (192px, 512px e versões "maskable" para Android).
  - Algumas tags `<meta>`/`<link>` no `<head>` de cada `.html` + 4 linhas no fim de
    cada `<script>` inline pra registrar o service worker. Nada de lógica foi tocado.
- `ajuda_rapida.html` foi movido para dentro de uma pasta `ajuda/`, porque o botão
  de ajuda no `Otimizador_de_Roteiros.html` já aponta para `./ajuda/ajuda_rapida.html`.

## Estrutura final de pastas
```
/ (raiz do site)
├── Otimizador_de_Roteiros.html   ← página principal (start_url do app)
├── tutoriais.html
├── style.css
├── script.js
├── manifest.webmanifest
├── sw.js
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── maskable-192.png
│   └── maskable-512.png
└── ajuda/
    └── ajuda_rapida.html
```

## Por que PWA e não um app "nativo"
- Não precisa de Android Studio, Xcode, conta de desenvolvedor nem loja de apps.
- Roda igual em Android, iPhone, tablet e computador — o mesmo código.
- "Instalar" = a pessoa abre o site e toca em "Adicionar à tela inicial" (ou o navegador
  sugere sozinho). Vira um ícone que abre em tela cheia, sem barra do navegador.
- Se um dia você quiser publicar nas lojas, dá pra reaproveitar 100% desse mesmo
  código com uma ferramenta como Capacitor — nada aqui te tranca nessa decisão.

## ⚠️ Um requisito real: precisa de HTTPS (ou localhost)
Service worker e "instalar app" só funcionam em `https://` ou em `http://localhost`.
Abrir o `.html` direto do computador (`file://`) **não funciona** para a parte de PWA
(o site em si continua funcionando normalmente, só não vai oferecer instalação/offline).

### Onde hospedar de graça (bem simples)
Qualquer um destes serve o site com HTTPS automaticamente, bastando subir a pasta:
- **GitHub Pages** (grátis, se seu código já está num repositório GitHub)
- **Netlify** ou **Vercel** (arrastar a pasta no site deles já publica)
- **Cloudflare Pages**

## Como testar localmente antes de publicar
Dentro da pasta do projeto, rode um servidor simples:
```bash
python3 -m http.server 8080
```
Depois abra `http://localhost:8080/Otimizador_de_Roteiros.html` no navegador do
celular (mesma rede Wi-Fi) usando o IP do computador, ex: `http://192.168.0.10:8080/...`,
**ou** abra no Chrome do próprio computador e use as ferramentas de desenvolvedor
(F12 → aba "Application" → "Manifest"/"Service Workers") pra conferir se está tudo certo.

## Como instalar no celular
- **Android (Chrome):** abra o site → menu (⋮) → "Adicionar à tela inicial" /
  "Instalar app". Às vezes o Chrome já mostra um banner sugerindo instalar.
- **iPhone (Safari):** abra o site → toque no ícone de compartilhar (□↑) →
  "Adicionar à Tela de Início". (No iPhone o Safari não mostra banner automático,
  esse passo manual é sempre necessário — limitação da Apple, não do seu código.)

## Ponto de atenção: importar/vincular arquivo JSON
Seu código já trata isso muito bem:
- `showOpenFilePicker` (vincular e reescrever o JSON direto no arquivo) só existe
  no Chrome/Edge de computador e no Chrome do Android. No iPhone (Safari) e em
  alguns Android ele simplesmente não existe.
- O `script.js` já detecta isso (`if (!('showOpenFilePicker' in window))`) e cai
  automaticamente no modo de importar/exportar `.json` manualmente pelo
  `fi-json-fallback`. Ou seja: no iPhone o app funciona, só que a pessoa precisa
  importar o `.json` de novo e exportar/baixar quando quiser salvar, em vez de ficar
  "vinculado" a um arquivo. Nenhuma mudança de código foi necessária pra isso — já
  estava pronto no seu `script.js`.

## Quando atualizar o site
Sempre que mudar `style.css`, `script.js` ou qualquer `.html`, troque o número em
`CACHE_VERSION` no início do `sw.js` (ex: `roteiros-v1` → `roteiros-v2`). Isso força
o celular a baixar a versão nova em vez de continuar usando a versão guardada em cache.
