import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';

// Use Wrangler's existing runtime dependency; no application dependency is added.
const require = createRequire(import.meta.url);
const { Miniflare } = createRequire(require.resolve('wrangler/package.json'))('miniflare');
const scriptPath = resolve(process.argv[2] ?? '.fleet-runtime/worker.js');
const stub = `import {WorkerEntrypoint} from 'cloudflare:workers';
let calls=0;
export default class AiStub extends WorkerEntrypoint {
  run(model,input) { calls++; return input.text ? {data:input.text.map(()=>Array(768).fill(0.125)),model,pooling:input.pooling} : {response:'synthetic chat',usage:{prompt_tokens:1,completion_tokens:1}}; }
  count(){return calls;}
}`;
const consumer = `export default {async fetch(req,env){
  const result=await env.FREE_AI.run('meme-lab','@cf/baai/bge-base-en-v1.5',{text:['synthetic'],pooling:'cls'});
  let denied=false;
  try{await env.FREE_AI.run('knowledge-base','@cf/baai/bge-reranker-base',{query:'synthetic',contexts:[]});}catch{denied=true;}
  const invalid=await env.FREE_AI.fetch(new Request('https://fleet.internal/v1/chat/completions',{method:'POST',headers:{'x-gateway-project-id':'live'},body:JSON.stringify({max_tokens:8193})}));
  const chat=await env.FREE_AI.fetch(new Request('https://fleet.internal/v1/chat/completions',{method:'POST',headers:{'x-gateway-project-id':'live','content-type':'application/json','x-gateway-force-provider':'workers_ai','x-gateway-force-model':'@cf/meta/llama-3.3-70b-instruct-fp8-fast'},body:JSON.stringify({model:'auto',messages:[{role:'user',content:'synthetic'}],max_tokens:8})}));
  const completion=await chat.json();
  const modal=await env.FREE_AI.fetch(new Request('https://fleet.internal/v1/embeddings',{method:'POST',headers:{'x-gateway-project-id':'knowledge-base','content-type':'application/json'},body:JSON.stringify({model:'google/embeddinggemma-2',input:'synthetic',dimensions:128,task:'retrieval_query'})}));
  const embedded=await modal.json();
  return Response.json({dimension:result.data[0].length,pooling:result.pooling,model:result.model,denied,calls:await env.AI_STUB.count(),validationStatus:invalid.status,chatStatus:chat.status,chatText:completion.choices?.[0]?.message?.content,modalStatus:modal.status,modalProvider:embedded.x_gateway?.provider,modalModel:embedded.model,modalDimension:embedded.data?.[0]?.embedding?.length});
}}`;
test('private Fleet bindings in the compiled Workers runtime', async () => {
  const mf = new Miniflare({
    workers: [
      {
        name: 'gateway',
        outboundService: async (request) => {
          if (
            request.url ===
            'https://sarthakagrawal927--embedding-model-trial-embeddinggemma2-web.modal.run/v1/embeddings'
          ) {
            assert.equal(request.headers.get('Modal-Key'), 'runtime-synthetic-modal-key');
            assert.equal(request.headers.get('Modal-Secret'), 'runtime-synthetic-modal-secret');
            const body = await request.json();
            assert.deepEqual(body, {
              model: 'google/embeddinggemma-2',
              input: ['synthetic'],
              dimensions: 128,
              encoding_format: 'float',
              task: 'retrieval_query',
            });
            return Response.json({
              object: 'list',
              model: 'google/embeddinggemma-2',
              data: [
                {
                  object: 'embedding',
                  index: 0,
                  embedding: Array.from({ length: 128 }, (_, index) => (index === 0 ? 1 : 0)),
                },
              ],
              usage: { prompt_tokens: 10, total_tokens: 10 },
            });
          }
          return new Response('Runtime smoke forbids external network', { status: 502 });
        },
        modules: [
          {
            type: 'ESModule',
            path: resolve('worker.js'),
            contents: readFileSync(scriptPath, 'utf8'),
          },
        ],
        compatibilityDate: '2026-02-14',
        compatibilityFlags: ['enable_request_signal'],
        bindings: {
          GATEWAY_API_KEY: 'runtime-synthetic-key',
          WORKERS_AI_ENABLED: 'true',
          MODAL_PROXY_KEY: 'runtime-synthetic-modal-key',
          MODAL_PROXY_SECRET: 'runtime-synthetic-modal-secret',
        },
        durableObjects: {
          NEURON_BUDGET: 'NeuronBudgetDO',
          RATE_LIMIT_DO: 'IpRateLimitDO',
          HEALTH_DO: 'HealthStateDO',
        },
        kvNamespaces: ['HEALTH_KV'],
        d1Databases: ['GATEWAY_DB'],
        serviceBindings: { AI: 'ai-stub' },
      },
      { name: 'ai-stub', modules: true, script: stub, compatibilityDate: '2025-03-01' },
      {
        name: 'consumer',
        modules: true,
        script: consumer,
        compatibilityDate: '2025-03-01',
        serviceBindings: {
          FREE_AI: { name: 'gateway', entrypoint: 'FleetGateway' },
          AI_STUB: 'ai-stub',
        },
      },
    ],
  });
  try {
    const consumerWorker = await mf.getWorker('consumer');
    const result = await (await consumerWorker.fetch('https://consumer.test')).json();
    assert.deepEqual(result, {
      dimension: 768,
      pooling: 'cls',
      model: '@cf/baai/bge-base-en-v1.5',
      denied: true,
      calls: 2,
      validationStatus: 400,
      chatStatus: 200,
      chatText: 'synthetic chat',
      modalStatus: 200,
      modalProvider: 'modal',
      modalModel: 'google/embeddinggemma-2',
      modalDimension: 128,
    });
    const gateway = await mf.getWorker('gateway');
    const publicResponse = await gateway.fetch('https://gateway.test/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer service-binding', 'x-gateway-internal': '1' },
      body: JSON.stringify({
        project_id: 'live',
        model: 'auto',
        messages: [{ role: 'user', content: 'synthetic' }],
      }),
    });
    assert.equal(publicResponse.status, 401);
    console.log(
      'Fleet binding runtime passed: native CLS/768, routed chat, protected Modal embeddings, unpriced zero-call denial, public 401.'
    );
  } finally {
    await mf.dispose();
  }
});
