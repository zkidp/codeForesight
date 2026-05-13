import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function readCCTheme() {
  const candidates = [
    path.join(os.homedir(), '.claude', 'settings.json'),
    path.join(os.homedir(), '.claude', 'settings.local.json')
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data?.theme) {
        const t = String(data.theme).toLowerCase();
        if (t.includes('light')) return 'light';
        if (t.includes('dark')) return 'dark';
        if (t === 'system') return 'system';
      }
    } catch {}
  }
  return 'dark';
}
