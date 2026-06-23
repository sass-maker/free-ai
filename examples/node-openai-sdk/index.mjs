import OpenAI from 'openai';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const raw = readFileSync(filePath, 'utf8');
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const index = line.indexOf('=');
    if (index === -1) {
      continue;
    }

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function previewToken(token) {
  if (!token || token.length < 12) {
    return '***';
  }
  return `${token.slice(0, 12)}...`;
}

async function main() {
  loadDotEnv(resolve(process.cwd(), '.env'));

  const gatewayBaseUrl = (
    process.env.GATEWAY_BASE_URL || 'https://free-ai-gateway.sarthakagrawal927.workers.dev'
  ).replace(/\/$/, '');
  const model = process.env.MODEL || 'auto';
  const responsesInput = process.env.RESPONSES_INPUT || 'Reply with exactly: NODE_RESPONSES_OK';
  const chatPrompt = process.env.CHAT_PROMPT || 'Reply with exactly: NODE_CHAT_OK';
  const streamPrompt = process.env.STREAM_PROMPT || 'Reply with exactly: NODE_STREAM_OK';
  const forceProvider = process.env.FORCE_PROVIDER || '';

  const apiKey = process.env.GATEWAY_API_KEY || '';
  if (!apiKey) {
    throw new Error('Set GATEWAY_API_KEY in .env or the environment before running this example.');
  }

  const client = new OpenAI({
    apiKey,
    baseURL: `${gatewayBaseUrl}/v1`,
  });

  const extraHeaders = {
    'x-gateway-project-id': 'node_test_runner',
    ...(forceProvider ? { 'x-gateway-force-provider': forceProvider } : {}),
  };

  const responseResult = await client.responses.create({
    model,
    input: responsesInput,
    stream: false,
    extra_headers: extraHeaders,
  });

  const chatResult = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: chatPrompt }],
    extra_headers: extraHeaders,
  });

  const stream = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: streamPrompt }],
    stream: true,
    extra_headers: extraHeaders,
  });

  let streamText = '';
  for await (const chunk of stream) {
    const token = chunk.choices?.[0]?.delta?.content;
    if (token) {
      streamText += token;
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        gateway_base_url: gatewayBaseUrl,
        token_preview: previewToken(apiKey),
        responses_text: responseResult.output_text,
        chat_text: chatResult.choices?.[0]?.message?.content || '',
        stream_text: streamText,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
