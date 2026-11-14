import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const spec = JSON.parse(fs.readFileSync(process.env.NARRATION || path.join(root, 'narration.json'), 'utf8'));
const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error('ELEVENLABS_API_KEY missing');
const out = '/bulk2/runs/linearcodereview/demo/audio';
fs.mkdirSync(out, {recursive: true});

for (const [i, shot] of spec.shots.entries()) {
  const name = `${String(i).padStart(2, '0')}-${shot.id}`;
  const mp3 = path.join(out, `${name}.mp3`);
  const meta = path.join(out, `${name}.json`);
  let m = fs.existsSync(meta) ? JSON.parse(fs.readFileSync(meta, 'utf8')) : null;
  if (!m || m.text !== shot.text || m.voice !== spec.voice || !m.chars || !fs.existsSync(mp3)) {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${spec.voice}/with-timestamps?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: {'xi-api-key': key, 'content-type': 'application/json'},
      body: JSON.stringify({text: shot.text, model_id: 'eleven_multilingual_v2', voice_settings: {stability: 0.42, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true, speed: 1.04}})
    });
    if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const j = await r.json();
    fs.writeFileSync(mp3, Buffer.from(j.audio_base64, 'base64'));
    m = {text: shot.text, voice: spec.voice, dur: j.alignment.character_end_times_seconds.at(-1) + 0.35, chars: j.alignment.characters.join(''), starts: j.alignment.character_start_times_seconds};
    fs.writeFileSync(meta, JSON.stringify(m, null, 2));
    console.log(`${shot.id}: ${m.dur.toFixed(2)}s`);
  }
}
console.log('TTS ready');
