// api/supabase/proxy.js

const ALLOWED_ROOTS = new Set(['rest', 'auth']);

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("[PROXY DIAGO] ERRO: Variáveis de ambiente ausentes!");
    return res.status(500).json({ error: 'Supabase não configurado no servidor.' });
  }

  // 1. Detecta a URL original recebida pelo Vercel
  const originalUrl = req.headers['x-forwarded-url'] || req.url || '';
  const urlObj = new URL(originalUrl, 'http://localhost');

  // Log do que chegou do teu frontend (browser)
  console.log("=== NOVA REQUISIÇÃO RECEBIDA NO PROXY ===");
  console.log(`[CLIENTE -> PROXY] Método: ${req.method}`);
  console.log(`[CLIENTE -> PROXY] URL Original: ${originalUrl}`);
  console.log(`[CLIENTE -> PROXY] Header Authorization recebido: ${req.headers.authorization || "Nenhum"}`);

  // 2. Extrai e limpa o caminho (path)
  const pathClean = urlObj.pathname
    .replace('/api/supabase/', '')
    .replace('proxy.js', '');

  const segments = pathClean.split('/').filter(Boolean);

  if (!segments.length || !ALLOWED_ROOTS.has(segments[0])) {
    console.warn(`[PROXY DIAGO] Rota Bloqueada ou Inválida. Segmentos:`, segments);
    return res.status(404).json({ error: 'Rota não permitida' });
  }

  // 3. Monta a URL de destino final para o Supabase
  const targetUrl = new URL(SUPABASE_URL);
  targetUrl.pathname = `/${segments.join('/')}`;

  // O rewrite do vercel.json ("/api/supabase/:path*" -> "/api/supabase/proxy.js")
  // injeta automaticamente o trecho capturado como querystring "path=..." (já que o
  // destination não o referencia). Esse parâmetro não existe no Supabase — se
  // repassado, o PostgREST o interpreta como filtro numa coluna "path" inexistente
  // e responde 400. Precisa ser removido antes de montar a URL final.
  const cleanSearchParams = new URLSearchParams(urlObj.search);
  cleanSearchParams.delete('path');
  targetUrl.search = cleanSearchParams.toString();

  console.log(`[PROXY -> SUPABASE] URL Final Alvo: ${targetUrl.toString()}`);

  // 4. Configura os headers corretos para o Supabase
  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
  };

  // Verifica se o authorization é válido; sem token de usuário, cai para a anon key
  // (mesmo comportamento do supabase-js: toda chamada leva um Authorization, seja do
  // usuário logado, seja o da role "anon").
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    headers['Authorization'] = req.headers.authorization;
    console.log(`[PROXY -> SUPABASE] Repassando Token de Usuário Válido: ${req.headers.authorization.substring(0, 20)}...`);
  } else {
    headers['Authorization'] = `Bearer ${SUPABASE_ANON_KEY}`;
    console.warn(`[PROXY -> SUPABASE] Sem token de usuário. Enviando requisição ANÓNIMA (anon key) ao Supabase.`);
  }

  if (req.headers.prefer) {
    headers['Prefer'] = req.headers.prefer;
  }

  const init = { 
    method: req.method, 
    headers 
  };

  // 5. Repassa o body para requisições de escrita
  if (!['GET', 'HEAD'].includes(req.method) && req.body) {
    init.body = typeof req.body === 'object' ? JSON.stringify(req.body) : req.body;
    console.log(`[PROXY -> SUPABASE] Enviando Corpo (Body):`, init.body);
  }

  try {
    const upstream = await fetch(targetUrl.toString(), init);
    const text = await upstream.text();
    
    // Log do que o Supabase respondeu ao teu servidor proxy
    console.log(`[SUPABASE -> PROXY] Status da Resposta: ${upstream.status}`);
    console.log(`[SUPABASE -> PROXY] Corpo da Resposta:`, text);

    const contentType = upstream.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    
    console.log("=== FIM DA REQUISIÇÃO ===\n");
    return res.status(upstream.status).send(text);
  } catch (e) {
    console.error("[PROXY DIAGO] Erro crítico ao fazer fetch no Supabase:", e.message);
    return res.status(502).json({ error: 'Falha ao contatar o Supabase via Proxy.' });
  }
}