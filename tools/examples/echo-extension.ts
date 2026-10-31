import { defineExtension } from '../../packages/adapters/src/extensions/index.js';

/** Compile with the runtime build, then install dist/tools/examples/echo-extension.js explicitly. */
export default defineExtension({
  manifest: {
    id: 'friendly_echo', name: '友好回声', version: '1.0.0', description: '原生扩展示例：有权限的发送者可调用回声工具和指令。', configuration: {},
    tools: [{ name: 'friendly_echo_tool', description: 'Echo a short text.', capabilities: ['chat'], parameters: { text: { type: 'string', description: 'Text to echo', maxLength: 1000 } } }],
    commands: [{ name: 'friendly_echo_command', description: 'Echo command with JSON parameters.', capabilities: ['chat'], parameters: { text: { type: 'string', description: 'Text to echo', maxLength: 1000 } } }],
  },
  execute: (_operation, parameters, context) => {
    context.signal.throwIfAborted();
    const text = parameters.text;
    if (typeof text !== 'string') throw new Error('Text is required');
    context.state.set('last-text', text);
    return Promise.resolve(text);
  },
});
