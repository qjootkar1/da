// ════════════════════════════════════════════════════════
//  InvTube — Invidious 프록시  (api/proxy.js)
//  - ?path=/videos/ID  → Invidious API JSON 반환
//  - ?stream=ID        → 영상 스트림 URL 추출 후 JSON 반환
//  - 상위 5개 병렬 시도 → 나머지 순차 fallback
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

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getInstances(preferred) {
  let list = shuffle(DEFAULT_INSTANCES);
  if (preferred && DEFAULT_INSTANCES.includes(preferred)) {
    list = [preferred, ...list.filter(i => i !== preferred)];
  }
  return list;
}

async function tryFetch(base, path) {
  const url = `${base}/api/v1${path}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return { data, base };
}

async function fetchFromInstances(instances, path) {
  const top5 = instances.slice(0, 5);
  const rest  = instances.slice(5);
  try {
    return await Promise.any(top5.map(b => tryFetch(b, path)));
  } catch (_) {}
  for (const base of rest) {
    try { return await tryFetch(base, path); }
    catch (e) { console.warn(`[proxy] ❌ ${base}: ${e.message}`); }
  }
  return null;
}

function pickStream(formatStreams, adaptiveFormats) {
  const muxed = (formatStreams || [])
    .filter(f => f.url && f.type && f.type.startsWith('video/mp4'))
    .sort((a, b) => (parseInt(b.resolution) || 0) - (parseInt(a.resolution) || 0));
  if (muxed.length > 0) {
    const prefer = muxed.find(f => parseInt(f.resolution) <= 720) || muxed[0];
    return { url: prefer.url, label: prefer.qualityLabel || prefer.resolution || 'mp4' };
  }
  const webm = (formatStreams || [])
    .filter(f => f.url && f.type && f.type.startsWith('video/webm'))
    .sort((a, b) => (parseInt(b.resolution) || 0) - (parseInt(a.resolution) || 0));
  if (webm.length > 0) return { url: webm[0].url, label: webm[0].qualityLabel || 'webm' };
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { path, stream, preferred } = req.query;
  const instances = getInstances(preferred);

  // ── 스트림 모드: ?stream=VIDEO_ID
  if (stream) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    const result = await fetchFromInstances(instances, `/videos/${stream}`);
    if (!result) return res.status(502).json({ error: '스트림을 가져올 수 없습니다.' });

    const picked = pickStream(result.data.formatStreams, result.data.adaptiveFormats);
    if (!picked) return res.status(404).json({ error: '재생 가능한 스트림이 없습니다.' });

    const allStreams = (result.data.formatStreams || [])
      .filter(f => f.url && f.type && (f.type.startsWith('video/mp4') || f.type.startsWith('video/webm')))
      .map(f => ({ url: f.url, label: f.qualityLabel || f.resolution || 'mp4', type: f.type }));

    return res.status(200).json({
      url: picked.url,
      label: picked.label,
      instance: result.base,
      title: result.data.title || '',
      lengthSeconds: result.data.lengthSeconds || 0,
      allStreams,
    });
  }

  // ── 일반 API 프록시: ?path=/...
  if (!path) return res.status(400).json({ error: 'path or stream required' });
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  const result = await fetchFromInstances(instances, path);
  if (!result) return res.status(502).json({ error: '모든 Invidious 인스턴스가 응답하지 않습니다.' });

  res.setHeader('X-Instance-Used', result.base);
  return res.status(200).json(result.data);
}
