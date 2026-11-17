import assert from 'node:assert/strict';
import { test } from 'node:test';
import { protocol, type Model, type ModelRequest } from '@openai/agents';
import { PriestessRuntime } from '../apps/server/src/runtime.js';
import { MessageEventSchema, RuntimeConfigSchema } from '../packages/contracts/src/index.js';

void test('plugin injects only the index, loads references through read_skill, and revokes reads when disabled', async () => {
  const requests: ModelRequest[] = [];
  let disableBeforeRead = false;
  const model: Model = {
    getResponse: () => Promise.reject(new Error('Streaming only')),
    async *getStreamedResponse(request): AsyncIterable<protocol.StreamEvent> {
      requests.push(request);
      const call = requests.length === 1 || disableBeforeRead;
      if (disableBeforeRead) {
        runtime.plugins.settings.update('response_scenes', { enabled: false }, 1);
        disableBeforeRead = false;
      }
      await Promise.resolve();
      yield protocol.StreamEvent.parse({ type: 'response_done', response: { id: String(requests.length), usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, output: call
        ? [{ type: 'function_call', name: 'read_skill', callId: String(requests.length), arguments: JSON.stringify({ libraryId: 'plugin-response-scenes', path: 'response-scenes/references/analysis.md' }), status: 'completed' }]
        : [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok' }] }],
      } });
    },
  };
  const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [{ id: 'assistant', displayName: '菲亚梅塔', resources: { tools: ['read_skill', 'list_skills'] } }], flow: { routing: { defaultAgentId: 'assistant', rules: [], cascade: { obsolete: true } } } });
  assert.deepEqual(config.flow.routing, { defaultAgentId: 'assistant', rules: [] });
  const runtime = new PriestessRuntime({ database: ':memory:', config, model });
  function submit(id: string) {
    return runtime.submit(MessageEventSchema.parse({ platform: 'test', platformType: 'telegram', sessionId: id, sessionType: 'private', senderId: 'alice', messageId: id, timestamp: Date.now(), botId: 'bot', parts: [{ type: 'text', text: '分析这份材料' }] }));
  }
  try {
    runtime.plugins.settings.update('response_scenes', { enabled: true, agentIds: ['assistant'] }, 0);
    const first = submit('first'); await runtime.idle();
    assert.equal(runtime.detail(first.id).run.status, 'completed');
    assert.match(JSON.stringify(requests[0]?.input), /回答剧本索引/);
    assert.match(requests[0]?.systemInstructions ?? '', /默认短答，先给最短可用答案/);
    assert.match(requests[0]?.systemInstructions ?? '', /当前快照没有索引或工具不可用时，本条不生效/);
    assert.doesNotMatch(JSON.stringify(requests[0]?.input), /轻量档（默认）/);
    assert.match(JSON.stringify(requests[1]?.input), /轻量档（默认）/);
    assert.doesNotMatch(JSON.stringify(requests[1]?.input), /全片最配合/);
    disableBeforeRead = true;
    const second = submit('second'); await runtime.idle();
    assert.equal(runtime.detail(second.id).run.status, 'completed');
    assert.doesNotMatch(JSON.stringify(requests.at(-1)?.input), /轻量档（默认）/);
    assert.match(JSON.stringify(requests.at(-1)?.input), /skill library is not authorized/);
  } finally { await runtime.stop(); }
});
