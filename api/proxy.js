export default async function handler(req, res) {
  // CORS 헤더
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  const path = req.query.path;
  if (!path) return res.status(400).json({ error: 'path required' });

  try {
    const url = `https://inv.nadeko.net/api/v1${path}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error(`upstream ${response.status}`);

    const data = await response.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
