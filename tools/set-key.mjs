// Saves your Supabase publishable key into config.js.
// Run: node tools/set-key.mjs   then paste the key and press Return.
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';

const file = new URL('../config.js', import.meta.url);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const key = (await rl.question('Paste your Supabase publishable key, then press Return: ')).trim();
rl.close();

if (key.startsWith('sb_secret_') || key.includes('service_role')) {
  console.log('\n✋ That is a SECRET key. It must never go in the app. Copy the publishable key instead.');
  process.exit(1);
}
if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
  console.log('\nThat does not look like a publishable key (it should start with sb_publishable_). Nothing was changed.');
  process.exit(1);
}
const text = await readFile(file, 'utf8');
await writeFile(file, text.replace(/export const SUPABASE_ANON_KEY = '.*';/, `export const SUPABASE_ANON_KEY = '${key}';`));
console.log('\n✅ Saved. The app is now connected to your Supabase project.');
