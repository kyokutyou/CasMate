import { afterEach, expect, it, vi } from 'vitest';
import { ReactionPublication, type ReactionPublicationServer } from '../src/main/reactions/reaction-publication';
import type { TunnelCallbacks } from '../src/main/poll/srv-us-tunnel';
const cleanup: (()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0)) await close(); vi.useRealTimers();});
function fixture() {
  let callbacks!:TunnelCallbacks;
  const close=vi.fn(async()=>undefined), open=vi.fn(async(_port:number, events:TunnelCallbacks)=>{callbacks=events;return {close};});
  const server:ReactionPublicationServer={host:null,online:false,nonce:'nonce',start:vi.fn(async()=>12345),stop:vi.fn(async()=>undefined),disconnect:()=>{server.online=false;}};
  const verify=vi.fn(async()=>true), publication=new ReactionPublication(server,{open},()=>true,verify);
  cleanup.push(()=>publication.stop()); return {publication,server,close,open,verify,events:()=>callbacks};
}
it('requires endpoint readiness and rejects late readiness after stopping',async()=>{const f=fixture();await f.publication.start();expect(f.server.online).toBe(false);f.events().url('https://aaaaaaaaaaaaaaaaaaaaaaaaaa.srv.us/');await vi.waitFor(()=>expect(f.server.online).toBe(true));await f.publication.stop();f.events().url('https://aaaaaaaaaaaaaaaaaaaaaaaaaa.srv.us/');expect(f.server.online).toBe(false);});
it('waits for disconnected SSH cleanup when stopping during backoff',async()=>{const f=fixture();await f.publication.start();let finish!:()=>void;f.close.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));f.events().disconnected('lost',false);let stopped=false;const stopping=f.publication.stop().then(()=>{stopped=true;});await Promise.resolve();expect(stopped).toBe(false);finish();await stopping;expect(f.publication.view().status).toBe('off');expect(f.open).toHaveBeenCalledTimes(1);});
it('reports cleanup failure and blocks automatic reconnection',async()=>{vi.useFakeTimers();const f=fixture();await f.publication.start();f.close.mockRejectedValueOnce(new Error('cleanup'));f.events().disconnected('lost',false);await vi.advanceTimersByTimeAsync(60000);expect(f.open).toHaveBeenCalledTimes(1);expect(f.publication.view().status).toBe('error');});
it('closes a tunnel returned after stop before reporting stopped',async()=>{const f=fixture();let finish!:(tunnel:{close:()=>Promise<void>})=>void;f.open.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const starting=f.publication.start();await vi.waitFor(()=>expect(f.open).toHaveBeenCalled());const stopping=f.publication.stop();finish({close:f.close});await Promise.all([starting,stopping]);expect(f.close).toHaveBeenCalledTimes(1);expect(f.server.online).toBe(false);});
it('runs the desktop callback once after verified publication, never again on automatic reconnect',async()=>{
  const f=fixture(),published=vi.fn();await f.publication.start(published);expect(published).not.toHaveBeenCalled();f.events().url('https://aaaaaaaaaaaaaaaaaaaaaaaaaa.srv.us/');await vi.waitFor(()=>expect(published).toHaveBeenCalledTimes(1));
  vi.useFakeTimers();f.events().disconnected('lost',false);await vi.advanceTimersByTimeAsync(1000);f.events().url('https://aaaaaaaaaaaaaaaaaaaaaaaaaa.srv.us/');await vi.advanceTimersByTimeAsync(0);expect(f.server.online).toBe(true);expect(published).toHaveBeenCalledTimes(1);
  await f.publication.stop();await f.publication.start(published);f.events().url('https://aaaaaaaaaaaaaaaaaaaaaaaaaa.srv.us/');await vi.advanceTimersByTimeAsync(0);expect(published).toHaveBeenCalledTimes(2);
});
it('discards delayed readiness callbacks after stop',async()=>{
  const f=fixture(),published=vi.fn();let finish!:(value:boolean)=>void;f.verify.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await f.publication.start(published);f.events().url('https://aaaaaaaaaaaaaaaaaaaaaaaaaa.srv.us/');await f.publication.stop();finish(true);await Promise.resolve();expect(published).not.toHaveBeenCalled();
});
it('only accepts one publication request while previous cleanup is pending', async () => {
  const f = fixture();
  await f.publication.start();
  let finish: (() => void) | undefined;
  f.close.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const stopping = f.publication.stop();
  const accepted = vi.fn(), duplicate = vi.fn();
  const first = f.publication.start(undefined, accepted);
  expect(f.publication.start(undefined, duplicate)).toBe(first);
  expect(accepted).toHaveBeenCalledOnce();
  expect(duplicate).not.toHaveBeenCalled();
  finish?.();
  await Promise.all([stopping, first]);
});
