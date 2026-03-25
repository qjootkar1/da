// Invidious 공개 인스턴스 목록 (하나 죽으면 다음으로)
// 2025년 기준 비교적 안정적인 인스턴스 우선 배치
const INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.privacydev.net',
  'https://invidious.nerdvpn.de',
  'https://iv.melmac.space',
  'https://invidious.kavin.rocks',
  'https://yt.cdaut.de',
  'https://invidious.lunar.icu',
  'https://invidious.fdn.fr',
];

// 랜덤 셔플로 특정 인스턴스 쏠림 방지
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

  const path = req.query.path;
  if (!path) return res.status(400).json({ error: 'path required' });

  // 병렬로 상위 3개 인스턴스를 동시에 시도 — 가장 빠른 응답 채택
  const instances = shuffle(INSTANCES);
  const top3 = instances.slice(0, 3);
  const rest = instances.slice(3);

  async function tryInstance(base) {
    const url = `${base}/api/v1${path}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw new Error(`${base} → ${response.status}`);
    const data = await response.json();
    return { data, base };
  }

  // 1단계: 상위 3개 병렬 시도
  try {
    const result = await Promise.any(top3.map(tryInstance));
    res.setHeader('X-Instance-Used', result.base);
    return res.status(200).json(result.data);
  } catch (_) {
    // 모두 실패 시 나머지 순차 시도
  }

  // 2단계: 나머지 인스턴스 순차 시도
  for (const base of rest) {
    try {
      const result = await tryInstance(base);
      res.setHeader('X-Instance-Used', result.base);
      return res.status(200).json(result.data);
    } catch (e) {
      continue;
    }
  }

  // 모든 인스턴스 실패
  return res.status(502).json({
    error: '모든 Invidious 인스턴스 응답 없음',
  });
}
