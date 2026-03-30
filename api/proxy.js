// ════════════════════════════════════════════════════════
//  InvTube — Invidious 프록시  (api/proxy.js)
//  - 상위 3개 병렬 시도 → 나머지 순차 fallback
//  - ?preferred=https://... 로 클라이언트가 우선 인스턴스 지정 가능
//  - X-Instance-Used 응답 헤더로 성공 인스턴스 알림
//  - 동적 인스턴스 목록 fallback 지원
// ════════════════════════════════════════════════════════

const DEFAULT_INSTANCES = [
  'https://iv.datura.network',
  'https://invidious.privacyredirect.com',
  'https://invidious.perennialte.ch',
  'https://inv.tux.pizza',
  'https://invidious.io.lol',
  'https://inv.nadeko.net',
  'https://yewtu.be',
  'https://invidious.nerdvpn.de',
  'https://invidious.privacydev.net',
  'https://invidious.kavin.rocks',
  'https://yt.cdaut.de',
  'https://invidious.lunar.icu',
  'https://invidious.fdn.fr',
  'https://invidious.flokinet.to',
];

// 동적으로 살아있는 인스턴스 목록 가져오기 (실패시 DEFAULT 사용)
async function fetchLiveInstances() {
  try {
    const r = await fetch('https://api.invidious.io/instances.json?sort_by=health', {
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const live = data
      .filter(([, info]) => info.api && info.type === 'https')
      .slice(0, 10)
      .map(([host]) => `https://${host}`);
    return live.length >= 3 ? live : null;
  } catch {
    return null;
  }
}

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { path, preferred } = req.query;
  if (!path) return res.status(400).json({ error: 'path required' });

  // 동적 인스턴스 목록 시도 (실패하면 DEFAULT 사용)
  const liveInstances = await fetchLiveInstances();
  const baseList = liveInstances || DEFAULT_INSTANCES;

  // preferred 인스턴스(클라이언트 localStorage 선택)를 맨 앞에 배치
  let instances = shuffle(baseList);
  if (preferred) {
    const allKnown = [...new Set([...DEFAULT_INSTANCES, preferred])];
    if (allKnown.includes(preferred)) {
      instances = [preferred, ...instances.filter(i => i !== preferred)];
      console.log(`[proxy] preferred: ${preferred}`);
    }
  }

  const top5 = instances.slice(0, 5);
  const rest  = instances.slice(5);

  async function tryInstance(base) {
    const url = `${base}/api/v1${path}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept':     'application/json',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return { data, base };
  }

  // 1단계: 상위 5개 병렬 — 가장 빠른 응답 채택
  try {
    const result = await Promise.any(top5.map(tryInstance));
    console.log(`[proxy] ✅ ${result.base} (parallel)`);
    res.setHeader('X-Instance-Used', result.base);
    return res.status(200).json(result.data);
  } catch (errs) {
    console.warn('[proxy] parallel top5 all failed, trying rest sequentially…');
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
