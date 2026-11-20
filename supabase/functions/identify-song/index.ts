// "What song is this?" helper on Supabase (Edge Functions → identify-song).
// "Verify JWT with legacy secret" is OFF because this code checks the sign-in itself.
// Receives a short recording from the app, asks AudD (audd.io) to recognize it, and returns
// the title and artist. Needs the secret AUDD_API_TOKEN, which the keeper sets in
// Edge Functions → Secrets. Without it, this answers "not set up yet".

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const auth = req.headers.get('authorization') ?? '';
  const apikey = req.headers.get('apikey') ?? '';
  if (!auth.startsWith('Bearer ') || !apikey) return json({ error: 'Please sign in first.' }, 401);
  const who = await fetch(Deno.env.get('SUPABASE_URL') + '/auth/v1/user', { headers: { authorization: auth, apikey } });
  if (!who.ok) return json({ error: 'Please sign in first.' }, 401);

  const token = Deno.env.get('AUDD_API_TOKEN');
  if (!token) return json({ error: "Song recognition isn't set up yet." }, 503);

  const audio = await req.blob();
  if (!audio.size) return json({ error: 'The recording was empty. Try again.' }, 400);
  if (audio.size > 5_000_000) return json({ error: 'The recording was too long.' }, 400);

  const form = new FormData();
  form.append('api_token', token);
  form.append('file', audio, 'clip');
  const res = await fetch('https://api.audd.io/', { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
  const j = await res.json();
  if (j.status !== 'success') return json({ error: j.error?.error_message ?? 'Recognition failed.' }, 502);
  if (!j.result) return json({ found: false });
  return json({
    found: true,
    title: j.result.title,
    artist: j.result.artist,
    album: j.result.album ?? null,
    release_year: j.result.release_date ? Number(String(j.result.release_date).slice(0, 4)) : null,
  });
});
