// Invidious 공개 인스턴스 목록 (하나 죽으면 다음으로)
const INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.privacydev.net',
  'https://yt.cdaut.de',
  'https://invidious.nerdvpn.de',
  'https://iv.melmac.space',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  const path = req.query.path;
  if (!path) return res.status(400).json({ error: 'path required' });

  let lastError = null;

  for (const base of INSTANCES) {
    try {
      const url = `${base}/api/v1${path}`;
      console.log(`trying: ${url}`);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        lastError = `${base} → ${response.status}`;
        continue; // 다음 인스턴스 시도
      }

      const data = await response.json();

      // 썸네일 URL을 현재 성공한 인스턴스로 교체 (선택)
      res.setHeader('X-Instance-Used', base);
      return res.status(200).json(data);

    } catch (e) {
      lastError = `${base} → ${e.message}`;
      continue;
    }
  }

  // 모든 인스턴스 실패
  return res.status(502).json({
    error: '모든 Invidious 인스턴스 응답 없음',
    detail: lastError,
  });
}
