import { expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { ReactionStore } from '../src/main/reactions/reaction-store';
import { defaultReactionSettings } from '../src/shared/listener-reactions';
it('preserves corrupt/unknown settings and never saves live window identity or publication state', async()=>{
  const directory=await mkdtemp(join(tmpdir(),'casmate-reaction-store-')), path=join(directory,'settings.json'), store=new ReactionStore(path);
  try{
    expect(await store.load()).toEqual(defaultReactionSettings());
    const { autoStartOnPublish: _auto, publishOnStartup: _startup, preview, ...current } = defaultReactionSettings();
    expect(_auto).toBe(false);expect(_startup).toBe(false);
    expect(preview).toEqual({ mode: 'obs', twitchChannel: '', youtubeVideoId: '' });
    const legacy = JSON.stringify({ ...current, schema: 1, target: { title:'game',processName:'game.exe',className:'Game' } });
    await writeFile(path,legacy); const migrated=await store.load(); expect(migrated.schema).toBe(4);expect(migrated.preview).toEqual(preview);expect(migrated.publishOnStartup).toBe(false);expect(migrated.autoStartOnPublish).toBe(false);expect(migrated.target?.title).toBe('game');expect(await readFile(path,'utf8')).toBe(legacy);
    await store.save(migrated);expect(JSON.parse(await readFile(path,'utf8')).schema).toBe(4);
    const version2 = JSON.stringify({ ...current, schema: 2, autoStartOnPublish: true });
    await writeFile(path,version2); const from2=await store.load();expect(from2.autoStartOnPublish).toBe(true);expect(from2.publishOnStartup).toBe(false);expect(await readFile(path,'utf8')).toBe(version2);
    expect(from2.preview).toEqual(preview);
    const version3 = JSON.stringify({ ...current, schema: 3, autoStartOnPublish: true, publishOnStartup: true });
    await writeFile(path,version3);
    expect(await store.load()).toEqual({ ...current, schema: 4, autoStartOnPublish: true, publishOnStartup: true, preview });
    expect(await readFile(path,'utf8')).toBe(version3);
    const configured = { ...defaultReactionSettings(), preview: { mode: 'youtube' as const, twitchChannel: 'a_twitch_channel', youtubeVideoId: 'M7lc1UVf-VE' } };
    await store.save(configured);
    expect(await new ReactionStore(path).load()).toEqual(configured);
    await expect(store.save({ ...configured, preview: { ...configured.preview, twitchChannel: 'https://twitch.tv/foo' } })).rejects.toThrow();
    await expect(store.save({ ...configured, preview: { ...configured.preview, youtubeVideoId: 'invalid' } })).rejects.toThrow();
    await expect(store.save({...defaultReactionSettings(),publishOnStartup:'yes'})).rejects.toThrow();
    const invalid='{"schema":999,"private":"original"}';await writeFile(path,invalid);await expect(store.load()).rejects.toThrow();expect(await readFile(path,'utf8')).toBe(invalid);
    await expect(store.save({...defaultReactionSettings(),target:{title:'game',processName:'game.exe',className:'Game',id:'1',pid:12}})).rejects.toThrow();
    await store.save(defaultReactionSettings());expect(await store.load()).toEqual(defaultReactionSettings());
    expect(await readFile(path,'utf8')).not.toMatch(/pid|online|enabled|image|timer/);
    await store.beginStartupChange();await store.save({...defaultReactionSettings(),publishOnStartup:true});
    const guarded=await readFile(path,'utf8');await expect(new ReactionStore(path).load()).rejects.toThrow();expect(await readFile(path,'utf8')).toBe(guarded);expect(await readFile(`${path}.startup-pending`,'utf8')).toBe('pending\n');
    await store.completeStartupChange();expect((await store.load()).publishOnStartup).toBe(true);
  }finally{expect(resolve(directory).startsWith(resolve(tmpdir())+sep+'casmate-reaction-store-')).toBe(true);await rm(directory,{recursive:true,force:true});}
});
