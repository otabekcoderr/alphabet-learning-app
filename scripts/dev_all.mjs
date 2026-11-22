import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const host = process.env.ALIFBO_HOST || '127.0.0.1';
const port = Number(process.env.ALIFBO_PORT || '8765');
const healthUrl = `http://${host}:${port}/api/health`;

function checkVoiceServerHealth(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(healthUrl, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(Boolean(res.statusCode && res.statusCode < 400 && parsed && parsed.ok));
        } catch {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function formatStatusLine(online) {
  return online
    ? `[alifbo] voice server online (${healthUrl})`
    : `[alifbo] voice server offline (${healthUrl} unreachable)`;
}

async function main() {
  const checkOnce = process.argv.includes('--check-once');
  if (checkOnce) {
    const online = await checkVoiceServerHealth();
    console.log(formatStatusLine(online));
    process.exit(0);
  }

  console.log(formatStatusLine(false));
  console.log('[alifbo] Starting Vite web app and local Python voice server (backend/server.py)...');

  const pythonExe = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const serverScript = path.join(projectRoot, 'backend', 'server.py');
  const viteBin = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');

  const children = [];
  let lastOnline = null;
  let shuttingDown = false;

  const shutdown = (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(pollTimer);
    for (const child of children) {
      if (!child.killed) {
        try {
          child.kill('SIGTERM');
        } catch {
          // Ignore already-exited child errors
        }
      }
    }
    process.exit(code);
  };

  const viteProc = spawn(process.execPath, [viteBin], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  children.push(viteProc);

  const pythonProc = spawn(pythonExe, [serverScript], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  children.push(pythonProc);

  pythonProc.on('error', (err) => {
    console.error(`[alifbo] Could not start backend/server.py (${err.message}).`);
    console.log(formatStatusLine(false));
  });

  pythonProc.on('exit', (code) => {
    if (!shuttingDown) {
      console.log(formatStatusLine(false));
      if (code !== null && code !== 0) {
        console.error(`[alifbo] voice server exited with code ${code}; web app continues in offline mode.`);
      }
    }
  });

  viteProc.on('exit', (code) => {
    if (!shuttingDown) {
      shutdown(code ?? 0);
    }
  });

  const pollHealth = async () => {
    const online = await checkVoiceServerHealth();
    if (online !== lastOnline) {
      lastOnline = online;
      console.log(formatStatusLine(online));
    }
  };

  const pollTimer = setInterval(() => {
    void pollHealth();
  }, 2000);
  void pollHealth();

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
}

void main();
