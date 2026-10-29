import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { obsRegistrationSnapshot } from './fixtures/obs-registration-state';
import { runElectronFixture } from './helpers/electron-fixture';

it('接続状態・色と不透明度・OBS追加先を両配色・拡大文字・狭幅でElectronと通常ブラウザに描画する', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-ui-clarity-'));
  const target=resolve(directory);
  if(!target.startsWith(resolve(tmpdir())+sep)||!basename(target).startsWith('casmate-ui-clarity-'))throw new Error('Unexpected fixture directory');
  const captures = resolve('tmp/ui-clarity-layout');
  await mkdir(captures,{recursive:true});
  try {
    for (const registration of [false,true]) {
      await build({configFile:false,plugins:[react()],logLevel:'error',
        resolve:{alias:registration?[]:[{find:/^\.\.\/api$/,replacement:resolve('tests/fixtures/board-management-api.ts')}]},
        define:{'process.env.NODE_ENV':'"production"'},oxc:{jsx:{development:false}},
        build:{outDir:directory,emptyOutDir:false,cssCodeSplit:false,lib:{entry:resolve(registration?'tests/fixtures/obs-registration-renderer.tsx':'tests/fixtures/ui-clarity-renderer.tsx'),name:'Clarity',formats:['iife'],fileName:()=>registration?'registration.js':'clarity.js',cssFileName:registration?'registration':'clarity'}}});
    }
    const browser = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
    expect(browser,'通常ブラウザの実行環境').toBeTruthy();
    for(const kind of ['comments','effects','registration']) {
      const snapshot=obsRegistrationSnapshot();
      const html=join(directory,kind+'.html');
      await writeFile(html,`<!doctype html><meta charset="utf-8">${kind==='comments'?'<meta name="ui-clarity-comments">':''}<link rel="stylesheet" href="${kind==='registration'?'registration':'clarity'}.css"><div id="root"></div><script id="fixture-data" type="application/json">${JSON.stringify(snapshot).replaceAll('<','\\u003c')}</script><script src="${kind==='registration'?'registration':'clarity'}.js"></script>`);
      const result=await runElectronFixture('tests/fixtures/ui-clarity-electron.mjs',html,directory,[captures],65_000).catch(error=>{throw new Error(`${String(error)}\n${error.stdout ?? ''}\n${error.stderr ?? ''}`);});
      expect(result.stdout,result.stderr).toContain('PASS: 8 UI clarity scenarios; zero HTTP(S) requests');
      const native=await promisify(execFile)(process.execPath,[resolve('tests/fixtures/management-studio-native-browser.mjs'),browser!,html,captures,'--ui-clarity-only'],{cwd:directory,windowsHide:true,timeout:65_000});
      expect(native.stdout,native.stderr).toContain('PASS: 8 UI clarity scenarios; zero HTTP(S) requests');
    }
  }finally{
    await rm(target,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
},240_000);
