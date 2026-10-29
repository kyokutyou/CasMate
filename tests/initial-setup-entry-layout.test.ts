import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,join,resolve,sep} from 'node:path';
import react from '@vitejs/plugin-react';
import {build} from 'vite';
import {expect,it} from 'vitest';
import {InitialSetupStore} from '../src/main/core/initial-setup-store';
import {obsRegistrationSnapshot} from './fixtures/obs-registration-state';
import {runElectronFixture} from './helpers/electron-fixture';

async function removeFixture(directory:string) {
  const target=resolve(directory);
  if(!target.startsWith(resolve(tmpdir())+sep)||!basename(target).startsWith('casmate-entry-updates-'))throw Error('Unexpected fixture directory');
  await rm(target,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}

it('確認結果の外部更新でも操作位置とフォーカスを保ち、広幅でC案と同じ本文幅を使う',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'casmate-entry-updates-'));
  try {
    await build({configFile:false,plugins:[react()],logLevel:'error',resolve:{alias:[{find:/^\.\.\/api$/,replacement:resolve('tests/fixtures/board-management-api.ts')}]},define:{'process.env.NODE_ENV':'"production"'},oxc:{jsx:{development:false}},build:{outDir:directory,emptyOutDir:false,cssCodeSplit:false,lib:{entry:resolve('tests/fixtures/board-management-renderer.tsx'),name:'EntryUpdates',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});
    const snapshot=obsRegistrationSnapshot();
    snapshot.initialSetup={...new InitialSetupStore('unused',false).view(snapshot),started:true,selected:['sources'],position:'summary'};
    const html=join(directory,'index.html');
    await writeFile(html,`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><div id="root"></div><script id="fixture-data" type="application/json">${JSON.stringify(snapshot).replace(/</g,'\\u003c')}</script><script src="harness.js"></script>`);
    const {stdout,stderr}=await runElectronFixture('tests/fixtures/initial-setup-entry-updates.mjs',html,directory,[],20000);
    expect(stdout,stderr).toContain('PASS: entry result updates and C sample width');
  } finally {
    await removeFixture(directory);
  }
},30000);
