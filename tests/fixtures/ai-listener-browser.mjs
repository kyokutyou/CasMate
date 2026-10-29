import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import { verifyAiListener } from './ai-listener-checks.mjs';
const profile=join(process.argv[4],'chrome-profile');
const browser=spawn(resolve(process.argv[2]),['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-sync','--disable-extensions','about:blank'],{cwd:resolve(process.argv[4]),windowsHide:true,stdio:'ignore'});
let socket,session,sequence=0;const pending=new Map(),errors=[],requests=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const until=async check=>{const end=Date.now()+15000;while(Date.now()<end){if(await check())return;await delay(50)}throw Error('Browser fixture timeout')};
const command=(method,params={},sessionId=session)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout'))},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))});
const evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value};
try{
  let port;await until(async()=>{try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);return true}catch{return false}});
  socket=new WebSocket(`ws://127.0.0.1:${port[0]}${port[1]}`);await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject)});
  socket.on('message',data=>{const m=JSON.parse(data.toString()),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))requests.push(m.params.request.url)});
  const {targetId}=await command('Target.createTarget',{url:'about:blank'},null);({sessionId:session}=await command('Target.attachToTarget',{targetId,flatten:true},null));
  await Promise.all([command('Page.enable'),command('Runtime.enable'),command('Network.enable')]);
  await command('Page.navigate',{url:pathToFileURL(resolve(process.argv[3])).href});await until(()=>evaluate('Boolean(window.aiLayoutHarness)'));
  const settle=()=>evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const resize=async(width,height)=>{await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await settle()};
  const count=await verifyAiListener({evaluate,resize,settle,capture:async name=>{await mkdir(process.argv[5],{recursive:true});const {data}=await command('Page.captureScreenshot',{format:'png'});await writeFile(join(process.argv[5],'chrome-'+name),Buffer.from(data,'base64'))}});
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);console.log(`PASS: ${count} AI listener UI scenarios`);
}finally{if(socket?.readyState===WebSocket.OPEN){try{await command('Browser.close',{},null)}catch{/* Process teardown may close CDP first. */}}socket?.close();if(browser.exitCode===null)browser.kill();}
