// InvTube proxy — Vercel 10초 제한 안에 맞게 최적화
// 클라이언트 직접 CORS 호출 실패 시에만 여기로 옴

const DEFAULT_INSTANCES = [
  'https://invidious.privacyredirect.com',
  'https://inv.nadeko.net',
  'https://yewtu.be',
  'https://invidious.perennialte.ch',
  'https://inv.tux.pizza',
  'https://invidious.io.lol',
  'https://invidious.nerdvpn.de',
  'https://invidious.privacydev.net',
  'https://invidious.kavin.rocks',
  'https://yt.cdaut.de',
  'https://invidious.lunar.icu',
  'https://invidious.fdn.fr',
  'https://invidious.flokinet.to',
  'https://iv.datura.network',
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function tryFetch(base, path) {
  const url = `${base}/api/v1${path}`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; InvTube/1.0)',
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(4000), // 4초로 줄임
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return { data: await r.json(), base };
}

async function fetchAny(instances, path) {
  // 3개 병렬 (4s × 3 = 최대 4s, Vercel 10s 안에 충분)
  const top = instances.slice(0, 3);
  const rest = instances.slice(3);
  try {
    return await Promise.any(top.map(b => tryFetch(b, path)));
  } catch (_) {}
  // 순차 fallback (각 4s, 최대 2개만 더 시도)
  for (const base of rest.slice(0, 2)) {
    try { return await tryFetch(base, path); }
    catch (e) { console.warn(`❌ ${base}: ${e.message}`); }
  }
  return null;
}

function pickStream(formatStreams) {
  const muxed = (formatStreams || [])
    .filter(f => f.url && f.type && (f.type.includes('mp4') || f.type.includes('webm')))
    .sort((a, b) => (parseInt(b.resolution) || 0) - (parseInt(a.resolution) || 0));
  if (!muxed.length) return null;
  const prefer = muxed.find(f => parseInt(f.resolution) <= 720) || muxed[0];
  return { url: prefer.url, label: prefer.qualityLabel || prefer.resolution || 'mp4', type: prefer.type };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { path, stream, preferred } = req.query;

  let instances = shuffle(DEFAULT_INSTANCES);
  if (preferred && DEFAULT_INSTANCES.includes(preferred)) {
    instances = [preferred, ...instances.filter(i => i !== preferred)];
  }

  // 스트림 모드
  if (stream) {
    res.setHeader('Cache-Control', 's-maxage=300');
    const result = await fetchAny(instances, `/videos/${stream}`);
    if (!result) return res.status(502).json({ error: '스트림 없음' });

    const picked = pickStream(result.data.formatStreams);
    if (!picked) return res.status(404).json({ error: '재생 가능한 스트림 없음' });

    const allStreams = (result.data.formatStreams || [])
      .filter(f => f.url && f.type && (f.type.includes('mp4') || f.type.includes('webm')))
      .map(f => ({ url: f.url, label: f.qualityLabel || f.resolution || 'mp4', type: f.type }));

    return res.status(200).json({
      url: picked.url, label: picked.label,
      instance: result.base, title: result.data.title || '',
      lengthSeconds: result.data.lengthSeconds || 0, allStreams,
    });
  }

  // 일반 API
  if (!path) return res.status(400).json({ error: 'path required' });
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  const result = await fetchAny(instances, path);
  if (!result) return res.status(502).json({ error: '모든 인스턴스 실패' });

  res.setHeader('X-Instance-Used', result.base);
  return res.status(200).json(result.data);
}
