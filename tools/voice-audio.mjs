// Records the app's spoken words with good macOS voices, so every phone plays the same clear audio instead
// of whatever robotic voice the browser has: English with Tara (Siri, Indian English), Tamil with Vani.
//   node tools/voice-audio.mjs        renders only clips that are missing
// Output: audio/<en|ta>/<hash>.m4a and audio/voice.json, a map from the spoken text to its clip.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PLANTS, GROUPS } from '../data.js';
import { TA_NAMES } from '../data-ta.js';
import { STR, TA_GROUPS, FORM_ONE } from '../i18n.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const AUDIO = path.join(ROOT, 'audio');
const VOICE = { en: ['Tara (English (India))', 150], ta: ['Vani', 140] };
export const norm = s => s.trim().toLowerCase().replace(/\s+/g, ' ');

const words = { en: new Set(), ta: new Set() };
for (const p of PLANTS) { words.en.add(p.name); if (TA_NAMES[p.key]) words.ta.add(TA_NAMES[p.key]); }
for (const g of GROUPS) { words.en.add(g.label); if (TA_GROUPS[g.key]) words.ta.add(TA_GROUPS[g.key]); }
for (const l of ['en', 'ta']) {
  for (const v of Object.values(FORM_ONE[l])) words[l].add(v);
  for (const [k, v] of Object.entries(STR[l])) if (/^g_\w+_ask$|^g_\w+$/.test(k) && !/[{}]/.test(v)) words[l].add(v);
}

const map = { en: {}, ta: {} };
const tmp = fs.mkdtempSync(path.join(ROOT, '.tts-'));
let made = 0;
for (const l of ['en', 'ta']) {
  fs.mkdirSync(path.join(AUDIO, l), { recursive: true });
  for (const text of words[l]) {
    const id = crypto.createHash('sha1').update(`${VOICE[l][0]}|${text}`).digest('hex').slice(0, 12);
    const out = path.join(AUDIO, l, `${id}.m4a`);
    if (!fs.existsSync(out)) {
      const aiff = path.join(tmp, `${id}.aiff`);
      // The Siri voice now and then hangs: give each clip 30 s, then try once more.
      for (let i = 0; ; i++) {
        try { execFileSync('say', ['-v', VOICE[l][0], '-r', String(VOICE[l][1]), '-o', aiff, text], { timeout: 30000 }); break; }
        catch (e) { if (i) throw e; }
      }
      execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', '-c', '1', aiff, out]);
      made++;
    }
    map[l][norm(text)] = `${l}/${id}.m4a`;
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
fs.writeFileSync(path.join(AUDIO, 'voice.json'), JSON.stringify(map));
console.log(`clips: en ${Object.keys(map.en).length}, ta ${Object.keys(map.ta).length}; rendered ${made} new`);
