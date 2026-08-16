import { createServer as createHttpServer } from 'node:http';

import { createServer as createViteServer } from 'vite';
import { WebSocketServer } from 'ws';

const host = '127.0.0.1';
const port = Number.parseInt(process.env.PORT || '4173', 10);
const vite = await createViteServer({
  appType: 'spa',
  logLevel: 'error',
  server: { middlewareMode: true },
});
const sockets = new WebSocketServer({ noServer: true });
const processingSessions = new Set();
const pendingPermissionsBySession = new Map();

const server = createHttpServer((request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host}`);
  if (request.method === 'POST' && requestUrl.pathname === '/__e2e__/disconnect') {
    for (const client of sockets.clients) {
      client.close(1012, 'E2E reconnect');
    }
    response.statusCode = 204;
    response.end();
    return;
  }
  vite.middlewares(request, response, () => {
    response.statusCode = 404;
    response.end('Not found');
  });
});

server.on('upgrade', (request, socket, head) => {
  if (new URL(request.url || '/', `http://${request.headers.host}`).pathname !== '/ws') {
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(request, socket, head, (websocket) => sockets.emit('connection', websocket, request));
});

sockets.on('connection', (websocket) => {
  websocket.on('close', (code) => {
    if (code !== 1012) {
      processingSessions.clear();
      pendingPermissionsBySession.clear();
    }
  });
  websocket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (message.type === 'chat.subscribe') {
      for (const target of message.sessions || []) {
        websocket.send(JSON.stringify({
          kind: 'chat_subscribed',
          sessionId: target.sessionId,
          isProcessing: processingSessions.has(target.sessionId),
          pendingPermissions: pendingPermissionsBySession.get(target.sessionId) ?? [],
          timestamp: new Date().toISOString(),
        }));
      }
      return;
    }

    if (message.type === 'chat.send') {
      processingSessions.add(message.sessionId);
      websocket.send(JSON.stringify({
        kind: 'status',
        sessionId: message.sessionId,
        text: 'Thinking',
        canInterrupt: true,
        timestamp: new Date().toISOString(),
      }));
      const content = String(message.content || '');
      const sendPermission = (requestId, toolName, input) => {
        const permission = {
          requestId,
          toolName,
          input,
          sessionId: message.sessionId,
          receivedAt: new Date().toISOString(),
        };
        const pending = pendingPermissionsBySession.get(message.sessionId) ?? [];
        pendingPermissionsBySession.set(message.sessionId, [...pending, permission]);
        websocket.send(JSON.stringify({
          kind: 'permission_request',
          sessionId: message.sessionId,
          ...permission,
          timestamp: new Date().toISOString(),
        }));
      };
      const questionInput = {
        questions: [{
          question: 'Which path should continue?',
          options: [{ label: 'Local' }, { label: 'Remote' }],
          multiSelect: false,
        }],
      };
      if (content.includes('[multi-permission]')) {
        sendPermission('permission-1', 'Bash', { command: 'pwd' });
        sendPermission('permission-2', 'Write', { file_path: '/workspace/local-project/file.txt' });
      } else if (content.includes('[mixed-permission]')) {
        sendPermission('question-1', 'AskUserQuestion', questionInput);
        sendPermission('permission-2', 'Bash', { command: 'pwd' });
      } else if (content.includes('[generic-permission]')) {
        sendPermission('permission-1', 'Bash', { command: 'pwd' });
      } else if (content.includes('[ask-user]')) {
        sendPermission('question-1', 'AskUserQuestion', questionInput);
      }
      return;
    }

    if (message.type === 'chat.abort') {
      processingSessions.delete(message.sessionId);
      pendingPermissionsBySession.delete(message.sessionId);
      websocket.send(JSON.stringify({
        kind: 'complete',
        sessionId: message.sessionId,
        aborted: true,
        success: false,
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    if (message.type === 'chat.permission-response') {
      const sessionId = [...pendingPermissionsBySession.entries()]
        .find(([, pending]) => pending.some((request) => request.requestId === message.requestId))?.[0];
      if (sessionId) {
        const remaining = (pendingPermissionsBySession.get(sessionId) ?? [])
          .filter((request) => request.requestId !== message.requestId);
        pendingPermissionsBySession.set(sessionId, remaining);
        if (remaining.length === 0) {
          pendingPermissionsBySession.delete(sessionId);
          processingSessions.delete(sessionId);
          websocket.send(JSON.stringify({
            kind: 'complete',
            sessionId,
            success: true,
            timestamp: new Date().toISOString(),
          }));
        }
      }
    }
  });
});

await new Promise((resolve) => server.listen(port, host, resolve));

const close = async () => {
  sockets.close();
  await vite.close();
  server.close(() => process.exit(0));
};
process.on('SIGTERM', () => { void close(); });
process.on('SIGINT', () => { void close(); });
