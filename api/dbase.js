// api/supabase/[...path].js
//
// Vercel Serverless Function (rota catch-all) que repassa chamadas do
// client para o Supabase (PostgREST em /rest/v1/* e GoTrue/Auth em
// /auth/v1/*), injetando a anon key no servidor — mesmo padrão já usado em
// api/request.js para o Mapbox: a chave nunca aparece no client, só as
// variáveis de ambiente do Vercel.
//
// Client chama, por exemplo:
//   /api/supabase/rest/v1/route_points?select=*
//   /api/supabase/auth/v1/token?grant_type=password
// e este handler repassa para:
//   ${SUPABASE_URL}/rest/v1/route_points?select=*
//   ${SUPABASE_URL}/auth/v1/token?grant_type=password
//
// Variáveis de ambiente necessárias no projeto Vercel (Settings > Environment
// Variables), iguais para Preview/Production:
//   SUPABASE_URL        -> ex: https://xxxxxxxx.supabase.co
//   SUPABASE_ANON_KEY   -> anon/public key do projeto
//
// Autorização real é 100% feita pelo RLS no Postgres (ver schema.sql /
// authorized_users). Este proxy só repassa o `Authorization: Bearer <token>`
// que o client mandar (sessão do usuário logado); se o client não mandar
// nenhum, usamos a anon key (equivalente ao usuário "anônimo" do Supabase,
// que sem policy correspondente não enxerga as tabelas sigilosas).

const ALLOWED_ROOTS = new Set(['rest', 'auth']);

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    res.status(500).json({ error: 'Supabase não configurado no servidor (SUPABASE_URL/SUPABASE_ANON_KEY ausentes)' });
    return;
  }

  const segments = Array.isArray(req.query.path) ? req.query.path : [req.query.path].filter(Boolean);
  if (!segments.length || !ALLOWED_ROOTS.has(segments[0])) {
    res.status(404).json({ error: 'Rota não permitida' });
    return;
  }

  // Reconstrói a query string original, removendo o parâmetro de rota do Next/Vercel (`path`)
  const url = new URL(req.url, 'http://localhost');
  url.searchParams.delete('path');
  const qs = url.searchParams.toString();

  const target = `${SUPABASE_URL.replace(/\/+$/, '')}/${segments.join('/')}${qs ? `?${qs}` : ''}`;

  const headers = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
    Authorization: req.headers.authorization || `Bearer ${SUPABASE_ANON_KEY}`,
  };
  if (req.headers.prefer) headers.Prefer = req.headers.prefer;

  const init = { method: req.method, headers };
  if (!['GET', 'HEAD'].includes(req.method) && req.body !== undefined) {
    init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }

  let upstream;
  try {
    upstream = await fetch(target, init);
  } catch (e) {
    res.status(502).json({ error: 'Falha ao contatar o Supabase' });
    return;
  }

  const text = await upstream.text();
  const contentType = upstream.headers.get('content-type');
  if (contentType) res.setHeader('Content-Type', contentType);
  res.status(upstream.status).send(text);
}
