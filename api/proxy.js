// ════════════════════════════════════════════════════════
//  InvTube — Invidious 프록시  (api/proxy.js)
//  - 상위 3개 병렬 시도 → 나머지 순차 fallback
//  - ?preferred=https://... 로 클라이언트가 우선 인스턴스 지정 가능
//  - X-Instance-Used 응답 헤더로 성공 인스턴스 알림
// ════════════════════════════════════════════════════════

const DEFAULT_INSTANCES = [
  'https://inv.nadeko.net',
  'https://yewtu.be',
  'https://invidious.nerdvpn.de',
  'https://invidious.privacydev.net',
  'https://iv.melmac.space',
  'https://invidious.kavin.rocks',
  'https://yt.cdaut.de',
  'https://invidious.lunar.icu',
  'https://invidious.fdn.fr',
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  const { path, preferred } = req.query;
  if (!path) return res.status(400).json({ error: 'path required' });

  // preferred 인스턴스(클라이언트 localStorage 선택)를 맨 앞에 배치
  let instances = shuffle(DEFAULT_INSTANCES);
  if (preferred && DEFAULT_INSTANCES.includes(preferred)) {
    instances = [preferred, ...instances.filter(i => i !== preferred)];
    console.log(`[proxy] preferred: ${preferred}`);
  }

  const top3 = instances.slice(0, 3);
  const rest  = instances.slice(3);

  async function tryInstance(base) {
    const url = `${base}/api/v1${path}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':     'application/json',
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return { data, base };
  }

  // 1단계: 상위 3개 병렬 — 가장 빠른 응답 채택
  try {
    const result = await Promise.any(top3.map(tryInstance));
    console.log(`[proxy] ✅ ${result.base} (parallel)`);
    res.setHeader('X-Instance-Used', result.base);
    return res.status(200).json(result.data);
  } catch (errs) {
    console.warn('[proxy] parallel top3 all failed, trying rest sequentially…');
  }

  // 2단계: 나머지 순차 시도
  for (const base of rest) {
    try {
      const result = await tryInstance(base);
      console.log(`[proxy] ✅ ${result.base} (sequential fallback)`);
      res.setHeader('X-Instance-Used', result.base);
      return res.status(200).json(result.data);
    } catch (e) {
      console.warn(`[proxy] ❌ ${base}: ${e.message}`);
    }
  }

  console.error('[proxy] 💀 모든 인스턴스 실패');
  return res.status(502).json({ error: '모든 Invidious 인스턴스가 응답하지 않습니다.' });
}
