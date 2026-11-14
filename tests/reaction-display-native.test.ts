import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { expect, it } from 'vitest';
it.skipIf(process.platform!=='win32')('enumerates real monitor interfaces and physical bounds using the production tracker',async()=>{
 const source=await readFile('resources/reactions/window-tracker.ps1','utf8');const code=source.slice(0,source.indexOf('while ($true)'))+'\n@([CasMateOverlayWindows]::Displays()) | ConvertTo-Json -Compress -Depth 4';
 const {stdout}=await promisify(execFile)(join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',code],{windowsHide:true,timeout:15000});
 const parsed=JSON.parse(stdout);const monitors=Array.isArray(parsed)?parsed:[parsed];expect(monitors.length).toBeGreaterThan(0);
 expect(new Set(monitors.map(m=>m.id)).size).toBe(monitors.length);
 for(const monitor of monitors){expect(monitor.processName).toBe('@display');expect(monitor.className).toBe('@display');expect(monitor.id).toBe('display:'+monitor.title);expect(monitor.pid).toBe(0);expect(monitor.width).toBeGreaterThan(0);expect(monitor.height).toBeGreaterThan(0);expect(Number.isInteger(monitor.x)&&Number.isInteger(monitor.y)).toBe(true);expect(monitor.displayName).toMatch(/DISPLAY/u);}
},20000);
