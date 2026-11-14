import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { runElectronFixture } from './helpers/electron-fixture';

it('renders identical particle layouts through OBS events and the actual sandboxed desktop preload',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'casmate-reaction-parity-'));
  try{
    await build({configFile:false,plugins:[react()],logLevel:'silent',oxc:{jsx:{development:false}},define:{'process.env.NODE_ENV':'"production"'},build:{outDir:directory,emptyOutDir:false,cssCodeSplit:false,lib:{entry:resolve('tests/fixtures/reaction-parity-renderer.tsx'),name:'ReactionParity',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});
    const html=join(directory,'index.html');await writeFile(html,'<!doctype html><html><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><body><div id="root"></div><script src="harness.js"></script></body></html>');
    const {stdout}=await runElectronFixture('tests/fixtures/reaction-parity.mjs',html,directory,[resolve('resources/reactions/desktop-preload.cjs'),resolve('tmp/reaction-parity')],40000);
    expect(stdout).toContain('PASS: OBS and desktop particle parity');
  }finally{await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},60000);
