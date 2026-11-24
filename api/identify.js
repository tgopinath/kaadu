// Identify a plant from a photo: the app posts the photo here and this edge function asks Pl@ntNet
// (https://my.plantnet.org), so the API key stays on the server. Set PLANTNET_KEY in the Vercel project.
export const config = { runtime: 'edge' };

const ALLOWED = /^https:\/\/kaadu-plants(-[a-z0-9-]+)?\.vercel\.app$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'post_only' }, 405);
  const origin = req.headers.get('origin');
  if (origin && !ALLOWED.test(origin)) return json({ error: 'forbidden' }, 403);
  const key = process.env.PLANTNET_KEY;
  if (!key) return json({ error: 'not_configured' }, 503);

  let form;
  try { form = await req.formData(); } catch { return json({ error: 'bad_request' }, 400); }
  const image = form.get('image');
  if (!image || typeof image === 'string') return json({ error: 'no_image' }, 400);
  if (image.size > 4_000_000) return json({ error: 'too_big' }, 413);
  const lang = form.get('lang') === 'ta' ? 'ta' : 'en';

  const out = new FormData();
  out.append('images', image, 'plant.jpg');
  out.append('organs', 'auto');
  const url = `https://my-api.plantnet.org/v2/identify/all?api-key=${encodeURIComponent(key)}&lang=${lang}&nb-results=5&include-related-images=false`;
  let r;
  try { r = await fetch(url, { method: 'POST', body: out }); } catch { return json({ error: 'upstream' }, 502); }
  if (r.status === 404) return json({ results: [] }); // Pl@ntNet found no plant in the photo
  if (r.status === 429) return json({ error: 'quota' }, 429);
  if (!r.ok) return json({ error: 'upstream', status: r.status }, 502);
  const j = await r.json();
  return json({
    results: (j.results || []).map(x => ({
      score: x.score,
      sci: x.species?.scientificNameWithoutAuthor || '',
      common: x.species?.commonNames || [],
      family: x.species?.family?.scientificNameWithoutAuthor || '',
    })).filter(x => x.sci),
  });
}
