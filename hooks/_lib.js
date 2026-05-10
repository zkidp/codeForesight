export async function readStdinJSON() {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) return resolve({});
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => data += c);
    process.stdin.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
    setTimeout(() => resolve({}), 1500);
  });
}

export function safe(fn) {
  return async (...args) => {
    try { return await fn(...args); } catch (e) {
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const os = await import('node:os');
        const log = path.join(os.homedir(), '.claude', 'codepr-hook-errors.log');
        fs.appendFileSync(log, `${new Date().toISOString()} ${e.stack || e.message}\n`);
      } catch {}
      process.exit(0);
    }
  };
}
