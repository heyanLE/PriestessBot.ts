import { requiredRuntimeState, runtimeStateLabels, runtimeStateCapabilities, RuntimeStateSchema, type RuntimeState } from '../../../../typescript/packages/contracts/src/index';
import { commandPolicyByState, restrictedCommandDefinitions } from '../../../../typescript/packages/contracts/src/command-policy';

export type CommandDisplayDefinition = (typeof restrictedCommandDefinitions)[number];

export function commandDefinitionsForState(state: RuntimeState): readonly CommandDisplayDefinition[] {
  const policy = commandPolicyByState[state];
  return policy.fullShell ? [] : restrictedCommandDefinitions.filter(definition => policy.commands.includes(definition.name));
}

export function commandEnvironmentText(state: RuntimeState): string {
  return commandPolicyByState[state].requiresContainer ? '仅 Docker 或 SDK Docker 环境' : '使用所选执行环境。本机环境按服务账户权限运行';
}

export function commandInputText(state: RuntimeState): string {
  const inputState = requiredRuntimeState(['process.pty']);
  return runtimeStateCapabilities[state].includes('process.pty') ? '可以向进程写入输入' : `不能向进程写入内容。需要输入时，由管理员分配${runtimeStateLabels[inputState]}`;
}

export function commandToolNotice(toolName: string | undefined): string | undefined {
  if (toolName === 'exec_command') { const shellStates=RuntimeStateSchema.options.filter(state=>commandPolicyByState[state].fullShell).map(state=>runtimeStateLabels[state]); return `最低运行态只开放该态允许的命令与参数。完整 Shell 仅供${shellStates.join('或')}使用。`; }
  if (toolName === 'write_stdin') return `向进程写入内容需要${runtimeStateLabels[requiredRuntimeState(['process.pty'])]}。等待结果请使用进程轮询工具。`;
  return undefined;
}
