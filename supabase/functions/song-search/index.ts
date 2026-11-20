// Backup song search: the app calls this when a phone or network blocks Apple's catalog.
// Runs on Supabase (Edge Functions → song-search, with "Verify JWT with legacy secret" OFF,
// because this code checks the sign-in itself). Only signed-in people get results.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Ask Supabase who this is; refuse anyone not signed in.
  const auth = req.headers.get('authorization') ?? '';
  const apikey = req.headers.get('apikey') ?? '';
  if (!auth.startsWith('Bearer ') || !apikey) return json({ error: 'Please sign in first.' }, 401);
  const who = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, { headers: { authorization: auth, apikey } });
  if (!who.ok) return json({ error: 'Please sign in first.' }, 401);

  let term = '';
  try {
    term = String((await req.json()).term ?? '').slice(0, 100).trim();
  } catch { /* no body */ }
  if (!term) return json({ results: [] });

  const params = new URLSearchParams({ term, entity: 'song', media: 'music', limit: '14' });
  const res = await fetch('https://itunes.apple.com/search?' + params);
  return new Response(await res.text(), {
    status: res.status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
