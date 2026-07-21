export default async function handler(req, res) {
  // 1. Pega a query enviada pelo frontend
  const { query } = req.query;
  if (!query) {
    return res.status(400).json({ error: 'Query não fornecida' });
  }

  // 2. Pega o token oculto nas variáveis de ambiente
  const token = process.env.MAPBOX_API_KEY;
  if (!token) {
    return res.status(500).json({ error: 'Token do Mapbox não configurado no servidor' });
  }

  // Funções utilitárias trazidas do seu código original (script.js), sem
  // nenhuma alteração de lógica — só o token deixou de vir do HTML e passou
  // a vir de process.env, que só existe aqui no servidor.
  const escURL = str => encodeURIComponent(str || '');
  const normalizeText = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const titleCasePt = s => (s || '').toLowerCase().replace(/(^|[\s-])([a-zà-ÿ])/g, (m, sep, ch) => sep + ch.toUpperCase());

  const formatAddr = raw => {
    let s = (raw || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    s = s.replace(/\s+Porto Alegre\s*$/i, '').replace(/\s+RS\s*$/i, '').replace(/\s+Brasil\s*$/i, '').replace(/\s+Viamão\s*$/i, '');
    const m = s.match(/^(.+?)\s+(\d+[A-Za-z]?(?:\/\d+)?|S\/?N)\s*(.*)$/i);
    if (m) {
      let out = titleCasePt(m[1].trim()) + ', ' + m[2].trim();
      if (m[3].trim()) out += ', ' + titleCasePt(m[3].trim());
      return out + ', Porto Alegre, RS, Brasil';
    }
    return titleCasePt(s) + ', Porto Alegre, RS, Brasil';
  };

  const pickBestFeature = (features, variantQuery) => {
    if (!features?.length) return null;
    const qn = normalizeText(variantQuery);
    const street = qn.split(',')[0].trim();
    const numM = qn.match(/(?:,\s*|\s)(\d+[a-z]?)(?:\b|$)/i);
    const num = numM ? numM[1] : '';
    let best = null, bestScore = -999;
    features.forEach(f => {
      const label = normalizeText(f.place_name || '');
      let score = (f.relevance || 0) * 10;
      if (num && label.includes(num)) score += 8;
      if (num && f.properties?.address === num) score += 15;
      if (label.includes('porto alegre')) score += 3;
      if (label.includes('rs')) score += 1;
      if (label.includes('cidade baixa') && qn.includes('cidade baixa')) score += 4;
      if (street && label.includes(street.split(' ')[0])) score += 1;
      if (score > bestScore) { bestScore = score; best = f; }
    });
    return best;
  };

  const q0 = query.replace(/\s+/g, ' ').trim();
  const variants = [...new Set([q0, formatAddr(q0), titleCasePt(q0.replace(/,/g, ' ')), titleCasePt(q0)].filter(Boolean))];

  try {
    for (const variant of variants) {
      // Chamada segura: o token nunca é exposto ao cliente final
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${escURL(variant)}.json?access_token=${escURL(token)}&country=br&language=pt&limit=1&types=address&autocomplete=false&proximity=-51.2177,-30.0346`;
      
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Mapbox HTTP ${response.status}`);
      
      const data = await response.json();
      const best = pickBestFeature(data.features, variant);
      
      if (best?.center?.length >= 2) {
        return res.status(200).json({
          lng: best.center[0],
          lat: best.center[1],
          label: best.place_name || variant
        });
      }
    }
    return res.status(404).json({ error: 'Nenhum local encontrado' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}