export function getCodexPlanOptions() {
  return {
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
  };
}

export function applyCodexTaskMasterPolicy(config, taskMasterReadOnly) {
  if (!taskMasterReadOnly) {
    return config;
  }
  return {
    ...(config || {}),
    mcp_servers: {
      ...(config?.mcp_servers || {}),
      'task-master-ai': {
        ...(config?.mcp_servers?.['task-master-ai'] || {}),
        enabled: false,
      },
    },
  };
}

export function resolveCursorPermissionArgs(permissionMode) {
  return permissionMode === 'plan' ? ['--mode', 'plan'] : [];
}
