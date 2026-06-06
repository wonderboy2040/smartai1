import fs from 'fs';

// Read .env manually
let NVIDIA_KEY = '';

try {
  const envContent = fs.readFileSync('.env', 'utf8');
  const lines = envContent.split('\n');
  for (const line of lines) {
    const parts = line.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      if (key === 'VITE_NVIDIA_API_KEY') NVIDIA_KEY = val;
    }
  }
} catch(e) {}

async function testNvidia(modelName) {
  if (!NVIDIA_KEY) {
    console.log('No Nvidia Key');
    return;
  }
  console.log(`\nTesting Nvidia with ${modelName}...`);
  try {
    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NVIDIA_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 15
      })
    });
    console.log('Nvidia Status:', res.status);
    const data = await res.json();
    if (res.ok) {
      console.log('Nvidia Reply:', data.choices?.[0]?.message?.content);
    } else {
      console.log('Nvidia Error:', JSON.stringify(data, null, 2));
    }
  } catch(e) {
    console.log('Nvidia exception:', e.message);
  }
}

async function run() {
  await testNvidia('deepseek-ai/deepseek-v4-flash');
  await testNvidia('deepseek-ai/deepseek-v4-pro');
  await testNvidia('meta/llama-3.3-70b-instruct');
}

run();
