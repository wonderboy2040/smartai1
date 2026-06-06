import fs from 'fs';

let envFile = '';
try {
  envFile = fs.readFileSync('.env', 'utf8');
} catch(e) {
  console.log('No .env file found');
  process.exit(1);
}

const keyMatch = envFile.match(/VITE_GEMINI_API_KEY=(.+)/);
if (!keyMatch) {
  console.log('No Gemini key found in .env');
  process.exit(1);
}
const apiKey = keyMatch[1].trim();

async function testGemini() {
  console.log('Testing gemini-3.5-flash...');
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Hello, what is your model version?' }] }]
      })
    });
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2));
  } catch(e) {
    console.error('Error:', e.message);
  }
}
testGemini();
