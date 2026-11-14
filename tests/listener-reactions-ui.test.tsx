// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import QRCode from 'qrcode';
import { ListenerReactionsPanel } from '../src/renderer/components/ListenerReactionsPanel';
import { defaultReactionSettings, type ReactionManagementSnapshot, type ReactionPreviewSettings, type ReactionSettings } from '../src/shared/listener-reactions';
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('shows initial OBS waiting and allows stopping without an image or selected target',async()=>{
  const f=fixture();
  f.data.publication={status:'online',url:'https://example.srv.us/',message:''};
  f.data.desktop={enabled:false,showing:false,preparing:true,message:'OBS接続待ちです。接続後に対象と範囲を確認してPC表示を開始します。'};
  render(<ListenerReactionsPanel {...f}/>);
  expect(await screen.findByText(f.data.desktop.message)).toBeVisible();
  const stop=screen.getByRole('button',{name:'PC表示を停止'});
  expect(stop).toBeEnabled();fireEvent.click(stop);
  await waitFor(()=>expect(f.request).toHaveBeenCalledWith('stop',undefined));
  expect(await screen.findByText('停止中')).toBeVisible();
});
it('stores a YouTube handle and keeps it visible after saving', async () => {
  vi.useFakeTimers(); const f=fixture(); render(<ListenerReactionsPanel {...f}/>);
  await act(()=>vi.advanceTimersByTimeAsync(0));
  fireEvent.change(screen.getByLabelText('リスナーページの映像'),{target:{value:'youtube'}});
  fireEvent.change(screen.getByLabelText('YouTube Liveの配信URL'),{target:{value:'https://www.youtube.com/@pecayellow'}});
  await act(()=>vi.advanceTimersByTimeAsync(500));
  expect(f.data.settings.preview).toEqual({mode:'youtube',twitchChannel:'',youtubeVideoId:'',youtubeTarget:'@pecayellow'});
  expect(screen.getByLabelText('YouTube Liveの配信URL')).toHaveValue('@pecayellow');
  fireEvent.change(screen.getByLabelText('YouTube Liveの配信URL'),{target:{value:'invalid'}});
  fireEvent.change(screen.getByLabelText('リスナーページの映像'),{target:{value:'twitch'}});
  await act(()=>vi.advanceTimersByTimeAsync(500));
  expect(f.data.settings.preview.youtubeTarget).toBe('@pecayellow');
});
function fixture() {
  const data:ReactionManagementSnapshot={instance:'fixture',revision:1,available:true,error:null,settings:defaultReactionSettings(),windows:[],selectedId:'',frame:null,publication:{status:'off',url:null,message:''},desktop:{enabled:false,showing:false,message:''},generation:0};
  const request=vi.fn(async(action?:string,body?:unknown)=>{if(action==='settings'){data.settings=body as ReactionSettings;data.revision++;}if(action==='preview-settings'){data.settings.preview=body as ReactionPreviewSettings;data.revision++;}if(action==='auto-start'){data.settings.autoStartOnPublish=(body as {enabled:boolean}).enabled;data.revision++;}if(action==='startup-publication'){data.settings.publishOnStartup=(body as {enabled:boolean}).enabled;data.revision++;}if(action==='stop'){data.desktop={enabled:false,showing:false,message:''};data.revision++;}return structuredClone(data);});
  return {data,request,image:vi.fn(async()=>new Blob()),onNotice:vi.fn(),onRegisterSource:vi.fn()};
}
it('saves the chosen live preview after 500 ms and remembers the other provider', async () => {
  vi.useFakeTimers();
  const f = fixture();
  render(<ListenerReactionsPanel {...f}/>);
  await act(() => vi.advanceTimersByTimeAsync(0));
  const mode = screen.getByLabelText('リスナーページの映像');
  expect(mode).toHaveValue('obs');
  fireEvent.change(mode, { target: { value: 'twitch' } });
  expect(screen.getByText('ライブ動画と、場所の指定に使うOBS静止画を公開し、リアクションを受け付けます。')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Twitchチャンネル名'), { target: { value: 'Example_Streamer' } });
  await act(() => vi.advanceTimersByTimeAsync(499));
  expect(f.request.mock.calls.every(([action]) => action === undefined)).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(f.request).toHaveBeenCalledWith('preview-settings', { mode: 'twitch', twitchChannel: 'example_streamer', youtubeVideoId: '' });
  fireEvent.change(mode, { target: { value: 'youtube' } });
  fireEvent.change(screen.getByLabelText('YouTube Liveの配信URL'), { target: { value: 'https://youtu.be/abcdefghijk?si=tracking' } });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(f.request).toHaveBeenCalledWith('preview-settings', { mode: 'youtube', twitchChannel: 'example_streamer', youtubeVideoId: 'abcdefghijk' });
  expect(f.request.mock.calls.some(([action]) => action === 'edit' || action === 'settings')).toBe(false);
  expect(f.onNotice).toHaveBeenLastCalledWith('設定を保存しました。', 'success');
});
it('keeps invalid and failed preview edits in place until the broadcaster corrects or retries them', async () => {
  vi.useFakeTimers();
  const f = fixture(), normal = f.request.getMockImplementation()!;
  f.request.mockImplementation((action, body) => action === 'preview-settings' ? Promise.reject(new Error('映像の保存に失敗しました。')) : normal(action, body));
  render(<ListenerReactionsPanel {...f}/>);
  await act(() => vi.advanceTimersByTimeAsync(0));
  fireEvent.change(screen.getByLabelText('リスナーページの映像'), { target: { value: 'youtube' } });
  const input = screen.getByLabelText('YouTube Liveの配信URL');
  input.focus();
  fireEvent.change(input, { target: { value: 'https://youtube.com.example.com/watch?v=abcdefghijk' } });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(f.request.mock.calls.some(([action]) => action === 'preview-settings')).toBe(false);
  expect(screen.getByRole('button', { name: 'リスナーページを公開' })).toHaveAttribute('aria-disabled', 'true');

  const validUrl = 'https://www.youtube.com/live/abcdefghijk';
  fireEvent.change(input, { target: { value: validUrl } });
  await act(() => vi.advanceTimersByTimeAsync(1500));
  expect(screen.getByText('映像の保存に失敗しました。')).toBeVisible();
  expect(input).toHaveValue(validUrl);
  expect(input).toHaveFocus();
  expect(f.data.settings.preview.mode).toBe('obs');
  expect(f.request.mock.calls.filter(([action]) => action === 'preview-settings')).toHaveLength(1);

  f.request.mockImplementation(normal);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '映像設定を再保存' })));
  expect(f.data.settings.preview).toEqual({ mode: 'youtube', twitchChannel: '', youtubeVideoId: 'abcdefghijk' });
  expect(input).toHaveFocus();
  expect(screen.queryByText('映像の保存に失敗しました。')).toBeNull();
  expect(screen.getByRole('button', { name: 'リスナーページを公開' })).not.toHaveAttribute('aria-disabled', 'true');
});
it('keeps the latest preview edit when a previous in-flight save fails', async () => {
  vi.useFakeTimers();
  const f = fixture(), normal = f.request.getMockImplementation()!;
  let rejectSave!: (reason: Error) => void;
  const firstSave = new Promise<ReactionManagementSnapshot>((_, reject) => { rejectSave = reject; });
  f.request.mockImplementation((action, body) => action === 'preview-settings' && (body as ReactionPreviewSettings).mode === 'twitch' ? firstSave : normal(action, body));
  render(<ListenerReactionsPanel {...f}/>);
  await act(() => vi.advanceTimersByTimeAsync(0));
  const mode = screen.getByLabelText('リスナーページの映像');
  fireEvent.change(mode, { target: { value: 'twitch' } });
  fireEvent.change(screen.getByLabelText('Twitchチャンネル名'), { target: { value: 'test_channel' } });
  await act(() => vi.advanceTimersByTimeAsync(500));
  fireEvent.change(mode, { target: { value: 'youtube' } });
  const input = screen.getByLabelText('YouTube Liveの配信URL');
  fireEvent.change(input, { target: { value: 'abcdefghijk' } });
  await act(async () => rejectSave(new Error('古い映像設定の保存に失敗しました。')));
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(f.data.settings.preview).toEqual({ mode: 'youtube', twitchChannel: 'test_channel', youtubeVideoId: 'abcdefghijk' });
  expect(screen.queryByText('古い映像設定の保存に失敗しました。')).toBeNull();
  expect(mode).toHaveValue('youtube');
});
it('uses the confirmed named URL for sharing and falls back at its deadline', async () => {
  const f = fixture();
  const target = 'https://aaaaaaaaaaaaaaaaaaaaaaaaaa.srv.us/';
  const named = 'https://kyokutyou.com/live/yofukashi';
  f.data.publication = { status: 'online', url: target, message: '' };
  f.data.namedShare = { revision: 0, enrolled: false, name: null, url: null, expiresAt: 0, message: '' };
  f.request.mockImplementation(async (action?: string) => {
    if (action === 'share-claim') f.data.namedShare = { revision: 1, enrolled: true, name: 'yofukashi', url: named, expiresAt: Date.now() + 800, message: '' };
    return structuredClone(f.data);
  });
  const qr = vi.spyOn(QRCode, 'toDataURL').mockResolvedValue('data:image/png;base64,a' as never);
  render(<ListenerReactionsPanel {...f}/>);
  fireEvent.click(await screen.findByText('名前付きリンク（テスト）'));
  fireEvent.change(screen.getByLabelText('リンクの名前'), { target: { value: 'yofukashi' } });
  const invite = 'a'.repeat(64);
  fireEvent.change(screen.getByLabelText('テスト利用者用の招待コード'), { target: { value: invite } });
  fireEvent.click(screen.getByRole('button', { name: '名前付きリンクを発行' }));
  expect(f.request).toHaveBeenCalledWith('share-claim', { name: 'yofukashi', invite });
  expect(await screen.findByRole('link', { name: named })).toHaveAttribute('href', named);
  await waitFor(() => expect(qr).toHaveBeenCalledWith(named, expect.anything()));
  expect(await screen.findByRole('link', { name: target }, { timeout: 2000 })).toHaveAttribute('href', target);
});
it('lists monitor targets distinctly and disables window-only controls',async()=>{
 const f=fixture();const monitor={id:'display:one',pid:0,title:'device-one',processName:'@display',className:'@display',label:'モニター DISPLAY1 · 1920×1080',displayName:'DISPLAY1',x:0,y:0,width:1920,height:1080,minimized:false};f.data.windows=[monitor];f.data.settings.target={title:monitor.title,processName:'@display',className:'@display'};f.data.selectedId=monitor.id;
 render(<ListenerReactionsPanel {...f}/>);await waitFor(()=>expect(screen.getByRole('option',{name:monitor.label})).toBeInTheDocument());expect(screen.getByLabelText('表示先')).toHaveValue(monitor.id);expect(screen.getByLabelText('ウィンドウ余白 左（px）')).toBeDisabled();expect(screen.getByLabelText('対象ウィンドウが前面のときだけ表示')).toBeDisabled();
});
function readyAutoStartFixture() {
  vi.stubGlobal('URL',class extends URL{static createObjectURL(){return 'blob:test';}static revokeObjectURL(){}});
  vi.stubGlobal('Image',class{src='';async decode(){}});
  const f=fixture();f.data.settings.target={title:'game',processName:'game.exe',className:'Game'};f.data.selectedId='1';
  f.data.windows=[{...f.data.settings.target,id:'1',pid:123,x:0,y:0,width:640,height:360,minimized:false}];
  f.data.frame={id:'frame',capturedAt:Date.now(),validForMs:12000,width:640,height:360,canvasWidth:1920,canvasHeight:1080,generation:0,url:'/frame.jpg?id=frame'};
  return f;
}
it('blocks range edits until the initial management instance is known', async () => {
  vi.useFakeTimers();
  const f = readyAutoStartFixture();
  let finish!: (snapshot: ReactionManagementSnapshot) => void;
  f.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<ListenerReactionsPanel {...f}/>);
  fireEvent.click(screen.getByText('数値で調整・表示条件'));
  const reset = screen.getByRole('button', { name:'画像全体に戻す' });
  const width = screen.getByLabelText('幅（%）');
  fireEvent.click(reset);
  fireEvent.change(width, { target:{ value:'85' } });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(f.request.mock.calls).toHaveLength(1);
  expect(reset).toHaveAttribute('aria-disabled', 'true');
  expect(width).toBeDisabled();
  expect(screen.getByLabelText('ウィンドウ余白 左（px）')).toBeDisabled();
  expect(screen.getByLabelText('対象ウィンドウが前面のときだけ表示')).toBeDisabled();
  await act(async () => { finish(structuredClone(f.data)); });
  expect(reset).not.toHaveAttribute('aria-disabled', 'true');
  expect(width).toBeEnabled();
  fireEvent.click(reset);
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(f.request).toHaveBeenCalledWith('edit', undefined, undefined, f.data.instance);
});
it('keeps the saved target selected when its unique window title changes',async()=>{
  vi.useFakeTimers();
  const f=readyAutoStartFixture();
  f.data.windows.push({...f.data.windows[0],id:'2',title:'other',className:'Other'});
  render(<ListenerReactionsPanel {...f}/>);
  await act(()=>vi.advanceTimersByTimeAsync(0));
  const select=screen.getByLabelText('表示先');
  expect(select).toHaveValue('1');
  f.data.windows[0].title='game — new title'; f.data.revision++;
  await act(()=>vi.advanceTimersByTimeAsync(500));
  expect(select).toHaveValue('1');
  fireEvent.click(screen.getByText('数値で調整・表示条件'));
  fireEvent.change(screen.getByLabelText('幅（%）'),{target:{value:'90'}});
  expect(select).toHaveValue('1');
  fireEvent.change(select,{target:{value:'2'}});
  expect(select).toHaveValue('2');
  await act(()=>vi.advanceTimersByTimeAsync(0));
});
it('shows the configured target as unresolved when the saved hint has ambiguous exact matches',async()=>{
  const f=readyAutoStartFixture();
  f.data.windows.push({...f.data.windows[0],id:'2',pid:456});
  f.data.selectedId='';
  render(<ListenerReactionsPanel {...f}/>);
  await screen.findByAltText('範囲を指定するOBS映像の静止画');
  const selected=screen.getByRole('option',{selected:true,name:'game（確認待ち）'});
  expect(selected).toBeDisabled();
  expect(screen.getByRole('option',{name:'OBSから自動選択（公開時）'})).not.toBeDisabled();
});
it('keeps a manual target distinct from automatic selection during loading and temporary disappearance',async()=>{
  vi.useFakeTimers();
  const f=readyAutoStartFixture();
  const windows=f.data.windows;
  render(<ListenerReactionsPanel {...f}/>);
  const select=screen.getByLabelText('表示先');
  expect(select).toBeDisabled();
  expect(screen.getByRole('option',{selected:true,name:'表示先を確認しています…'})).toBeInTheDocument();
  await act(()=>vi.advanceTimersByTimeAsync(0));
  expect(select).toHaveValue('1');
  f.data.windows=[]; f.data.selectedId=''; f.data.revision++;
  await act(()=>vi.advanceTimersByTimeAsync(500));
  expect(screen.getByRole('option',{selected:true,name:'game（確認待ち）'})).toBeDisabled();
  f.data.windows=windows; f.data.selectedId='1'; f.data.revision++;
  await act(()=>vi.advanceTimersByTimeAsync(500));
  expect(select).toHaveValue('1');
  expect(f.request.mock.calls.every(([action])=>action===undefined)).toBe(true);

  f.data.windows=[]; f.data.selectedId=''; f.data.revision++;
  await act(()=>vi.advanceTimersByTimeAsync(500));
  fireEvent.change(select,{target:{value:''}});
  await act(()=>vi.advanceTimersByTimeAsync(500));
  expect(f.request).toHaveBeenCalledWith('settings',expect.objectContaining({target:null}),undefined,'fixture');
  expect(screen.getByRole('option',{selected:true,name:'OBSから自動選択（公開時）'})).toBeInTheDocument();
});
it('reconfirms the displayed preview deadline from a faster poll of the same image',async()=>{
  vi.useFakeTimers();
  const f=readyAutoStartFixture();
  f.data.frame!.validForMs=1000;
  f.request.mockImplementationOnce(async()=>{
    await new Promise(resolve=>setTimeout(resolve,300));
    return structuredClone(f.data);
  });
  render(<ListenerReactionsPanel {...f}/>);
  await act(()=>vi.advanceTimersByTimeAsync(300));
  const preview=screen.getByAltText('範囲を指定するOBS映像の静止画');
  f.data.frame!.validForMs=500; f.data.revision++;
  await act(()=>vi.advanceTimersByTimeAsync(500));
  f.request.mockRejectedValue(new Error('metadata failure'));
  await act(()=>vi.advanceTimersByTimeAsync(499));
  expect(screen.getByAltText('範囲を指定するOBS映像の静止画')).toBe(preview);
  expect(f.image).toHaveBeenCalledTimes(1);
  await act(()=>vi.advanceTimersByTimeAsync(1));
  expect(screen.queryByAltText('範囲を指定するOBS映像の静止画')).toBeNull();
});
it('discards the displayed preview when its metadata confirms zero remaining validity',async()=>{
  vi.useFakeTimers();
  const f=readyAutoStartFixture();
  f.data.frame!.validForMs=900;
  render(<ListenerReactionsPanel {...f}/>);
  await act(()=>vi.advanceTimersByTimeAsync(0));
  expect(screen.getByAltText('範囲を指定するOBS映像の静止画')).toBeVisible();
  f.data.frame!.validForMs=0; f.data.revision++;
  await act(()=>vi.advanceTimersByTimeAsync(500));
  expect(screen.queryByAltText('範囲を指定するOBS映像の静止画')).toBeNull();
  expect(f.image).toHaveBeenCalledTimes(1);
});
it.each(['metadata', 'JPEG', 'decode'])('updates the management preview when a candidate expires during %s', async stage => {
  vi.useFakeTimers();
  const f = readyAutoStartFixture(), normal = f.request.getMockImplementation()!;
  const image = vi.fn(async (id: string) => id === 'expired' && stage === 'JPEG' ? new Promise<Blob>(() => {}) : new Blob());
  let requests = 0, decodes = 0;
  vi.stubGlobal('Image', class {
    src = '';
    async decode() { if (++decodes === 2 && stage === 'decode') await new Promise<void>(() => {}); }
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:initial').mockReturnValue('blob:updated');
  f.data.frame!.validForMs = 1500;
  f.request.mockImplementation(async (action, body) => {
    const snapshot = await normal(action, body);
    if (++requests === 2) {
      if (stage === 'metadata') await new Promise(resolve => setTimeout(resolve, 200));
      return { ...snapshot, revision:2, frame:{ ...snapshot.frame!, id:'expired', validForMs:150 } };
    }
    return requests === 1 ? snapshot : { ...snapshot, revision:3, frame:{ ...snapshot.frame!, id:'fresh' } };
  });
  render(<ListenerReactionsPanel {...f} image={image}/>);
  await act(() => vi.advanceTimersByTimeAsync(900));
  const preview = screen.getByAltText('範囲を指定するOBS映像の静止画');
  expect(preview).toHaveAttribute('src', 'blob:initial');
  await act(() => vi.advanceTimersByTimeAsync(350));
  expect(screen.getByAltText('範囲を指定するOBS映像の静止画')).toBe(preview);
  expect(preview).toHaveAttribute('src', 'blob:updated');
  expect(image.mock.calls.map(([id]) => id)).toEqual(stage === 'metadata' ? ['frame', 'fresh'] : ['frame', 'expired', 'fresh']);
});
it('keeps a restarted management preview when a pre-restart action completes late', async () => {
  vi.useFakeTimers();
  const f = readyAutoStartFixture(), normal = f.request.getMockImplementation()!;
  f.data.desktop = { enabled:true, showing:true, message:'' };
  let finish!: (snapshot: ReactionManagementSnapshot) => void;
  let reads = 0;
  f.request.mockImplementation((action, body) => action === 'stop'
    ? new Promise(resolve => { finish = resolve; })
    : ++reads <= 2 ? normal(action, body) : new Promise(() => {}));
  vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:before').mockReturnValue('blob:after');
  const retired = { ...structuredClone(f.data), revision:100, frame:null };
  render(<ListenerReactionsPanel {...f}/>);
  await act(() => vi.advanceTimersByTimeAsync(0));
  fireEvent.click(screen.getByRole('button', { name:'PC表示を停止' }));
  expect(finish).toBeTypeOf('function');
  f.data.instance = 'restarted';
  f.data.frame = { ...f.data.frame!, id:'after' };
  await act(() => vi.advanceTimersByTimeAsync(500));
  const preview = screen.getByAltText('範囲を指定するOBS映像の静止画');
  expect(preview).toHaveAttribute('src', 'blob:after');
  await act(async () => { finish(retired); });
  expect(screen.getByAltText('範囲を指定するOBS映像の静止画')).toBe(preview);
  expect(reads).toBe(2);
  expect(f.onNotice).not.toHaveBeenCalledWith('操作を反映しました。', 'success');
});
it.each([
  ['preview-settings', 'Twitchチャンネル名', 'new_channel'],
  ['settings', '幅（%）', '85'],
] as const)('keeps the %s draft when only the pre-restart app saved it', async (actionName, label, value) => {
  vi.useFakeTimers();
  const f = readyAutoStartFixture(), normal = f.request.getMockImplementation()!;
  f.data.settings.preview.mode = 'twitch';
  let finish!: (snapshot: ReactionManagementSnapshot) => void;
  f.request.mockImplementation((action, body) => action === actionName
    ? new Promise(resolve => { finish = resolve; })
    : normal(action, body));
  render(<ListenerReactionsPanel {...f}/>);
  await act(() => vi.advanceTimersByTimeAsync(0));
  fireEvent.click(screen.getByText('数値で調整・表示条件'));
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target:{ value } });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(finish).toBeTypeOf('function');
  const retired = { ...structuredClone(f.data), revision:100 };
  f.data.instance = 'restarted';
  await act(() => vi.advanceTimersByTimeAsync(500));
  await act(async () => { finish(retired); });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(input).toHaveValue(actionName === 'settings' ? Number(value) : value);
  expect(f.onNotice).not.toHaveBeenCalledWith('設定を保存しました。', 'success');
});
it.each(['already prepared', 'pending preparation', 'edit reaches the new app', 'superseded preparation'])('requires explicit resave after restart with %s', async stage => {
  vi.useFakeTimers();
  const f = readyAutoStartFixture(), normal = f.request.getMockImplementation()!;
  if (stage === 'superseded preparation') f.data.desktop = { enabled:true, showing:true, message:'' };
  let finish!: (snapshot: ReactionManagementSnapshot) => void;
  f.request.mockImplementation((action, body) => action === 'edit' && stage !== 'already prepared'
    ? new Promise(resolve => { finish = resolve; })
    : normal(action, body));
  render(<ListenerReactionsPanel {...f}/>);
  await act(() => vi.advanceTimersByTimeAsync(250));
  fireEvent.click(screen.getByText('数値で調整・表示条件'));
  const width = screen.getByLabelText('幅（%）');
  fireEvent.change(width, { target:{ value:stage === 'superseded preparation' ? '80' : '85' } });
  await act(() => vi.advanceTimersByTimeAsync(stage === 'pending preparation' ? 500 : 0));
  if (stage === 'superseded preparation') {
    fireEvent.change(width, { target:{ value:'85' } });
    fireEvent.click(screen.getByRole('button', { name:'PC表示を停止' }));
    await act(() => vi.advanceTimersByTimeAsync(0));
  }
  const retired = { ...structuredClone(f.data), revision:100 };
  f.data.instance = 'restarted';
  if (stage === 'edit reaches the new app') await act(async () => { finish(structuredClone(f.data)); });
  await act(() => vi.advanceTimersByTimeAsync(500));
  if (stage === 'pending preparation' || stage === 'superseded preparation') await act(async () => { finish(retired); });
  expect(f.request.mock.calls.some(([action]) => action === 'settings')).toBe(false);
  expect(width).toHaveValue(85);
  expect(f.onNotice).not.toHaveBeenCalledWith('設定を保存しました。', 'success');

  f.request.mockImplementation(normal);
  fireEvent.click(screen.getByRole('button', { name:'設定を再保存' }));
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(f.request).toHaveBeenCalledWith('edit', undefined, undefined, 'restarted');
  expect(f.request).toHaveBeenCalledWith('settings', expect.anything(), undefined, 'restarted');
  expect(f.data.settings.region.width).toBe(.85);
  expect(f.onNotice).toHaveBeenCalledWith('設定を保存しました。', 'success');
});
it.each([[0, 503, true], [1, 503, false], [0, 410, false]] as const)('keeps only a valid management preview after a failed JPEG update (generation %d, status %d)',async(generation,status,retain)=>{
 vi.useFakeTimers();
 const f=readyAutoStartFixture();
 f.data.frame!.validForMs=900;
 render(<ListenerReactionsPanel {...f}/>);
 await act(()=>vi.advanceTimersByTimeAsync(0));
 expect(screen.getByAltText('範囲を指定するOBS映像の静止画')).toBeVisible();
 f.data.frame={...f.data.frame!,id:'next',generation};f.data.generation=generation;f.data.revision++;
 f.image.mockRejectedValue(Object.assign(new Error('JPEG failure'),{status}));
 await act(()=>vi.advanceTimersByTimeAsync(500));
 expect(!!screen.queryByAltText('範囲を指定するOBS映像の静止画')).toBe(retain);
 await act(()=>vi.advanceTimersByTimeAsync(400));
 expect(screen.queryByAltText('範囲を指定するOBS映像の静止画')).toBeNull();
});

it.each([[undefined, true], [429, true], [503, true], [403, false]] as const)('retains only a valid management preview during a metadata failure (%s)',async(status,retain)=>{
 vi.useFakeTimers();
 const f=readyAutoStartFixture();
 f.data.frame!.validForMs=900;
 render(<ListenerReactionsPanel {...f}/>);
 await act(()=>vi.advanceTimersByTimeAsync(0));
 expect(screen.getByAltText('範囲を指定するOBS映像の静止画')).toBeVisible();
 f.request.mockRejectedValue(Object.assign(new Error('metadata failure'),{status}));
 await act(()=>vi.advanceTimersByTimeAsync(500));
 expect(!!screen.queryByAltText('範囲を指定するOBS映像の静止画')).toBe(retain);
 await act(()=>vi.advanceTimersByTimeAsync(400));
 expect(screen.queryByAltText('範囲を指定するOBS映像の静止画')).toBeNull();
});

it('keeps the management preview proportions while waiting for the next image',async()=>{
 vi.useFakeTimers();
 const f=readyAutoStartFixture();
 f.data.frame={...f.data.frame!,canvasWidth:1080,canvasHeight:1920};
 const {container}=render(<ListenerReactionsPanel {...f}/>);
 const viewport=container.querySelector<HTMLElement>('.reaction-preview-viewport')!;
 await act(()=>vi.advanceTimersByTimeAsync(0));
 expect(viewport.style.aspectRatio.replaceAll(' ','')).toBe('1080/1920');
 f.data.frame=null;f.data.generation++;f.data.revision++;
 await act(()=>vi.advanceTimersByTimeAsync(500));
 expect(screen.queryByAltText('範囲を指定するOBS映像の静止画')).toBeNull();
 expect(viewport.style.aspectRatio.replaceAll(' ','')).toBe('1080/1920');
});

it('previews a manual range during dragging and saves only the released range',async()=>{
  vi.stubGlobal('PointerEvent',MouseEvent);
  const f=readyAutoStartFixture();render(<ListenerReactionsPanel {...f}/>);
  const image=await screen.findByAltText('範囲を指定するOBS映像の静止画'),preview=image.parentElement!;
  Object.defineProperty(preview,'setPointerCapture',{value:vi.fn()});
  vi.spyOn(preview,'getBoundingClientRect').mockReturnValue({left:100,top:50,width:400,height:200} as DOMRect);
  const border=preview.querySelector('.reaction-range-border')!;
  vi.useFakeTimers();fireEvent.pointerDown(preview,{clientX:180,clientY:90,button:0});
  fireEvent.pointerMove(preview,{clientX:380,clientY:210});
  expectRange(border,{left:20,top:20,width:50,height:60});
  await act(()=>vi.advanceTimersByTimeAsync(600));expect(f.request.mock.calls.filter(([action])=>action==='settings')).toHaveLength(0);
  fireEvent.pointerUp(preview,{clientX:340,clientY:190});
  expectRange(border,{left:20,top:20,width:40,height:50});
  await act(()=>vi.advanceTimersByTimeAsync(500));
  expect(f.data.settings.region.x).toBeCloseTo(.2);expect(f.data.settings.region.y).toBeCloseTo(.2);expect(f.data.settings.region.width).toBeCloseTo(.4);expect(f.data.settings.region.height).toBeCloseTo(.5);
});
function expectRange(border:Element,region:{left:number;top:number;width:number;height:number}) {
  for(const key of ['left','top','width','height'] as const)expect(parseFloat((border as HTMLElement).style[key])).toBeCloseTo(region[key]);
}
it('pans the enlarged preview without editing and saves a drag in image coordinates', async () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  const f = readyAutoStartFixture();
  render(<ListenerReactionsPanel {...f}/>);
  const preview = (await screen.findByAltText('範囲を指定するOBS映像の静止画')).parentElement!;
  expect(screen.queryByText('OBS映像プレビュー')).not.toBeInTheDocument();
  expect(screen.getByText('OBSの出力映像を静止画で公開し、リアクションを受け付けます。')).toBeVisible();
  const viewport = preview.parentElement!;
  const expand = screen.getByRole('button', { name: 'プレビューを拡大' });
  expect(expand).toHaveAttribute('aria-expanded', 'false');
  Object.defineProperty(preview, 'setPointerCapture', { value: vi.fn() });
  Object.defineProperty(preview, 'offsetWidth', { value: 400 });
  Object.defineProperty(preview, 'offsetHeight', { value: 200 });
  vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({ left: -60, top: -30, width: 400, height: 200 } as DOMRect);
  fireEvent.click(expand);
  expect(expand).toHaveAttribute('aria-expanded', 'true');
  fireEvent.change(screen.getByLabelText('倍率'), { target: { value: '100' } });
  expect(screen.getByRole('button', { name: '画像を移動' })).not.toHaveAttribute('aria-disabled', 'true');
  fireEvent.change(screen.getByLabelText('倍率'), { target: { value: '200' } });
  expect(preview).toHaveStyle({ width: '200%' });
  fireEvent.click(screen.getByRole('button', { name: '画像を移動' }));
  const before = viewport.scrollLeft;
  fireEvent.pointerDown(preview, { clientX: 100, clientY: 50, button: 0 });
  fireEvent.pointerMove(preview, { clientX: 50, clientY: 20 });
  fireEvent.pointerUp(preview, { clientX: 50, clientY: 20 });
  expect(viewport.scrollLeft).toBe(before + 50);
  expect(f.request.mock.calls.some(([action]) => action === 'edit' || action === 'settings')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '範囲指定に戻る' }));
  vi.useFakeTimers();
  fireEvent.pointerDown(preview, { clientX: 20, clientY: 10, button: 0 });
  fireEvent.pointerUp(preview, { clientX: 180, clientY: 110 });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(f.data.settings.region).toMatchObject({ x: .2, y: .2 });
  expect(f.data.settings.region.height).toBeCloseTo(.5);
  expect(f.data.settings.region.width).toBeCloseTo(.4);
  expect(f.onNotice).toHaveBeenCalledWith('設定を保存しました。', 'success');
  fireEvent.click(expand);
  expect(expand).toHaveAttribute('aria-expanded', 'false');
  expectRange(preview.querySelector('.reaction-range-border')!, { left: 20, top: 20, width: 40, height: 50 });
});
it('enables sharing only for a verified publication and keeps the link element during reconnection', async () => {
  const f = fixture(), normal = f.request.getMockImplementation()!;
  const url = 'https://sample.srv.us/';
  vi.spyOn(QRCode, 'toDataURL').mockImplementation(() => Promise.reject(new Error('QR unavailable')));
  f.request.mockImplementation(async (action, body) => {
    if (action === 'publish') {
      f.data.publication = { status: 'online', url, message: '' };
      f.data.revision++;
    }
    return normal(action, body);
  });
  render(<ListenerReactionsPanel {...f}/>);
  const publish = screen.getByRole('button', { name: 'リスナーページを公開' });
  const copy = screen.getByRole('button', { name: 'リンクをコピー' });
  expect(copy).toHaveAttribute('aria-disabled', 'true');
  await waitFor(() => expect(publish).not.toHaveAttribute('aria-disabled', 'true'));
  await act(async () => { fireEvent.click(publish); });
  expect(copy).not.toHaveAttribute('aria-disabled', 'true');
  const link = screen.getByRole('link', { name: url });
  expect(link).toHaveAttribute('href', url);
  expect(await screen.findByText('QRコードを作成できません。共有リンクを使ってください。')).toBeInTheDocument();
  link.focus();
  f.data.publication = { status: 'reconnecting', url, message: '再接続中' };
  f.data.revision++;
  await waitFor(() => expect(copy).toHaveAttribute('aria-disabled', 'true'));
  expect(link).not.toHaveAttribute('href');
  expect(document.activeElement).toBe(link);
});
it('waits for editing suspension before saving and never uses an explicit stop for edits',async()=>{
  const f=readyAutoStartFixture(),normal=f.request.getMockImplementation()!;let release!:(data:ReactionManagementSnapshot)=>void;
  f.request.mockImplementation((action,body)=>action==='edit'?new Promise(resolve=>{release=resolve;}):normal(action,body));
  render(<ListenerReactionsPanel {...f}/>);await screen.findByAltText('範囲を指定するOBS映像の静止画');vi.useFakeTimers();
  fireEvent.change(screen.getByLabelText('ウィンドウ余白 左（px）'),{target:{value:'12'}});await act(()=>vi.advanceTimersByTimeAsync(500));
  expect(f.request).toHaveBeenCalledWith('edit',undefined,undefined,'fixture');expect(f.request.mock.calls.some(([a])=>a==='settings'||a==='stop')).toBe(false);
  await act(async()=>{release(structuredClone(f.data));});expect(f.data.settings.insets.left).toBe(12);
});
it('places confirmation next to the preview and starts only through the explicit confirmation action',async()=>{
  const f=readyAutoStartFixture();f.data.desktop={enabled:false,showing:false,resume:'confirmation',message:'OBS画面が変わりました。範囲を確認してください。'};
  render(<ListenerReactionsPanel {...f}/>);const preview=(await screen.findByAltText('範囲を指定するOBS映像の静止画')).parentElement!;
  const button=screen.getByRole('button',{name:'範囲を確認して再開'});expect(preview.parentElement!.nextElementSibling).toContainElement(button);expect(button.closest('.reaction-resume-panel')).toHaveAttribute('data-state','confirmation');
  expect(f.request.mock.calls.some(([a])=>a==='start')).toBe(false);button.focus();await act(async()=>{fireEvent.click(button);});
  expect(f.request).toHaveBeenCalledWith('start',undefined);expect(document.activeElement).toBe(button);
});
it.each([
  ['確認待ち', '赤枠を確認してください。', { enabled:false, showing:false, resume:'confirmation', message:'赤枠を確認してください。' }],
  ['一時停止中', '表示先のウィンドウやモニターを確認してください。', { enabled:true, showing:false, message:'' }],
] as const)('keeps %s guidance steady while the preview JPEG is unavailable',async(label,reason,desktop)=>{
  vi.useFakeTimers();
  const f=readyAutoStartFixture();
  f.data.desktop=desktop;
  f.image.mockRejectedValueOnce(Object.assign(new Error('JPEG failure'),{status:503}));
  render(<ListenerReactionsPanel {...f}/>);
  await act(()=>vi.advanceTimersByTimeAsync(0));
  const status=screen.getByText(label).closest('[role=status]')!;
  expect(status.textContent).toBe(label+reason);
  expect(screen.queryByAltText('範囲を指定するOBS映像の静止画')).toBeNull();

  await act(()=>vi.advanceTimersByTimeAsync(500));
  expect(status.textContent).toBe(label+reason);
  expect(screen.getByAltText('範囲を指定するOBS映像の静止画')).toBeVisible();

  f.data.frame=null;
  f.data.revision++;
  await act(()=>vi.advanceTimersByTimeAsync(500));
  expect(status).toHaveTextContent('OBSの最新画像を待っています。');
  expect(screen.queryByAltText('範囲を指定するOBS映像の静止画')).toBeNull();
});
it('uses the same control to stop an in-flight start and ignores a stale success', async () => {
  const f = readyAutoStartFixture(), normal = f.request.getMockImplementation()!;
  f.data.desktop.operationToken = 'fixture:0';
  let finish: ((snapshot: ReactionManagementSnapshot) => void) | undefined;
  f.request.mockImplementation((action, body) => action === 'start'
    ? new Promise(resolve => { finish = resolve; })
    : normal(action, body));
  render(<ListenerReactionsPanel {...f}/>);
  await screen.findByAltText('範囲を指定するOBS映像の静止画');
  const control = screen.getByRole('button', { name: 'PC表示を開始' });
  control.focus();
  fireEvent.click(control);
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(f.request).toHaveBeenCalledWith('start', { operationToken:'fixture:0' });
  expect(screen.getByRole('button', { name: 'PC表示を停止' })).toBe(control);
  expect(screen.getByText('準備中')).toBeVisible();
  await act(async () => { fireEvent.click(control); });
  expect(screen.getByRole('button', { name: 'PC表示を開始' })).toBe(control);
  expect(document.activeElement).toBe(control);
  await act(async () => { finish?.({ ...f.data, revision:f.data.revision + 1, desktop:{ enabled:true, showing:true, message:'' } }); });
  expect(screen.getByText('停止中')).toBeVisible();
  expect(f.request).toHaveBeenCalledWith('stop', undefined);
});
it('distinguishes visible and temporarily hidden PC display while keeping the stop control', async () => {
  const f = readyAutoStartFixture();
  f.data.desktop = { enabled:true, showing:true, message:'対象が前面のとき表示します。' };
  render(<ListenerReactionsPanel {...f}/>);
  const visible = await screen.findByText('表示中');
  expect(visible.closest('.reaction-resume-panel')).toHaveAttribute('data-state', 'showing');
  const control = screen.getByRole('button', { name: 'PC表示を停止' });
  f.data.desktop.showing = false;
  await waitFor(() => expect(screen.getByText('一時停止中')).toBeVisible());
  expect(screen.getByRole('button', { name: 'PC表示を停止' })).toBe(control);
});
it('shows scene waiting in the PC status and allows stopping without a new preview image', async () => {
  const f = fixture();
  const message = '次のシーンで範囲を再判定します。';
  f.data.desktop = { enabled:false, showing:false, resume:'scene', message };
  render(<ListenerReactionsPanel {...f}/>);
  const label = await screen.findByText('再判定待ち');
  expect(label.closest('[role=status]')).toHaveTextContent(message);
  expect(label.closest('[role=status]')).not.toHaveTextContent('OBSの最新画像を待っています。');
  const stop = screen.getByRole('button', { name:'PC表示を停止' });
  stop.focus();
  await act(async () => { fireEvent.click(stop); });
  expect(f.request).toHaveBeenCalledWith('stop', undefined);
  expect(screen.getByRole('button', { name:'PC表示を開始' })).toBe(stop);
});
it('dispatches the PC display test on click and reports it through the common notice', async () => {
  const f = readyAutoStartFixture();
  f.data.desktop = { enabled:true, showing:true, message:'' };
  render(<ListenerReactionsPanel {...f}/>);
  const button = screen.getByRole('button', { name:'テスト表示' });
  await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled', 'true'));
  button.focus();
  fireEvent.click(button);
  expect(f.request).toHaveBeenCalledWith('test', undefined);
  await waitFor(() => expect(f.onNotice).toHaveBeenCalledWith('テスト演出を送信しました。', 'success'));
  expect(document.activeElement).toBe(button);
});
it('does not dispatch a PC display test while stopping', async () => {
  const f = readyAutoStartFixture(), normal = f.request.getMockImplementation()!;
  f.data.desktop = { enabled:true, showing:true, message:'' };
  let finish: (() => void) | undefined;
  f.request.mockImplementation((action, body) => action === 'stop'
    ? new Promise(resolve => { finish = () => { void normal(action, body).then(resolve); }; })
    : normal(action, body));
  render(<ListenerReactionsPanel {...f}/>);
  const stop = await screen.findByRole('button', { name:'PC表示を停止' });
  const test = screen.getByRole('button', { name:'テスト表示' });
  fireEvent.click(stop);
  expect(test).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(test);
  expect(f.request.mock.calls.some(([action]) => action === 'test')).toBe(false);
  await act(async () => { finish?.(); });
});
it('keeps an earlier start intent from using a newer polling token after waiting for an edit', async () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  const f = readyAutoStartFixture(), normal = f.request.getMockImplementation()!;
  f.data.desktop.operationToken = 'fixture:0';
  let finishEdit: ((snapshot: ReactionManagementSnapshot) => void) | undefined;
  f.request.mockImplementation((action, body) => action === 'edit'
    ? new Promise(resolve => { finishEdit = resolve; })
    : normal(action, body));
  render(<ListenerReactionsPanel {...f}/>);
  const preview = (await screen.findByAltText('範囲を指定するOBS映像の静止画')).parentElement!;
  Object.defineProperty(preview, 'setPointerCapture', { value: vi.fn() });
  vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({ left:0, top:0, width:400, height:200 } as DOMRect);
  fireEvent.pointerDown(preview, { button:0, clientX:20, clientY:20 });
  fireEvent.pointerCancel(preview);
  await waitFor(() => expect(finishEdit).toBeTypeOf('function'));
  fireEvent.click(screen.getByRole('button', { name:'PC表示を開始' }));
  const editSnapshot = { ...f.data, revision:2, desktop:{ ...f.data.desktop, operationToken:'fixture:1' } };
  const previousReads = f.request.mock.calls.filter(([name]) => name === undefined).length;
  f.data.revision = 3;
  f.data.desktop.operationToken = 'fixture:2';
  await waitFor(() => expect(f.request.mock.calls.filter(([name]) => name === undefined).length).toBeGreaterThan(previousReads));
  await act(async () => { finishEdit?.(editSnapshot); });
  expect(f.request).toHaveBeenCalledWith('start', { operationToken:'fixture:1' });
});
it('orders editing requests before the latest save and discards an earlier failure',async()=>{
  const f=readyAutoStartFixture(),normal=f.request.getMockImplementation()!;let fail!:(reason:Error)=>void,first=true;
  f.request.mockImplementation((action,body)=>{if(action==='edit'&&first){first=false;return new Promise((_resolve,reject)=>{fail=reject;});}return normal(action,body);});
  render(<ListenerReactionsPanel {...f}/>);await screen.findByAltText('範囲を指定するOBS映像の静止画');vi.useFakeTimers();
  fireEvent.change(screen.getByLabelText('ウィンドウ余白 左（px）'),{target:{value:'12'}});
  await act(async()=>{});
  fireEvent.change(screen.getByLabelText('ウィンドウ余白 左（px）'),{target:{value:'20'}});await act(()=>vi.advanceTimersByTimeAsync(500));
  expect(f.request.mock.calls.filter(([a])=>a==='edit')).toHaveLength(1);expect(f.request.mock.calls.some(([a])=>a==='settings')).toBe(false);
  await act(async()=>{fail(new Error('古い編集の失敗'));});await act(()=>vi.advanceTimersByTimeAsync(500));expect(f.data.settings.insets.left).toBe(20);
  expect(screen.queryByText('古い編集の失敗')).toBeNull();expect(screen.getByRole('button',{name:'設定を再保存'})).toHaveAttribute('aria-disabled','true');
});
it('keeps saving the latest edit when an older in-flight settings save fails',async()=>{
  const f=readyAutoStartFixture(),normal=f.request.getMockImplementation()!;let fail!:(reason:Error)=>void,first=true;
  f.request.mockImplementation((action,body)=>{if(action==='settings'&&first){first=false;return new Promise((_resolve,reject)=>{fail=reject;});}return normal(action,body);});
  render(<ListenerReactionsPanel {...f}/>);await screen.findByAltText('範囲を指定するOBS映像の静止画');vi.useFakeTimers();
  fireEvent.change(screen.getByLabelText('ウィンドウ余白 左（px）'),{target:{value:'12'}});await act(()=>vi.advanceTimersByTimeAsync(500));
  fireEvent.change(screen.getByLabelText('ウィンドウ余白 左（px）'),{target:{value:'20'}});await act(async()=>{fail(new Error('古い保存の失敗'));});
  await act(()=>vi.advanceTimersByTimeAsync(500));expect(f.data.settings.insets.left).toBe(20);expect(screen.queryByText('古い保存の失敗')).toBeNull();
});
it('resumes the unchanged range on cancelled drag without saving a preview',async()=>{
  vi.stubGlobal('PointerEvent',MouseEvent);const f=readyAutoStartFixture();
  const normal=f.request.getMockImplementation()!;
  f.request.mockImplementation(async(action,body)=>{
    const snapshot=await normal(action,body);
    if(action==='edit')snapshot.desktop={...snapshot.desktop,resume:'editing',editToken:'fixture:1'};
    return snapshot;
  });
  render(<ListenerReactionsPanel {...f}/>);
  const preview=(await screen.findByAltText('範囲を指定するOBS映像の静止画')).parentElement!;
  Object.defineProperty(preview,'setPointerCapture',{value:vi.fn()});vi.spyOn(preview,'getBoundingClientRect').mockReturnValue({left:0,top:0,width:400,height:200} as DOMRect);
  await act(async()=>{fireEvent.pointerDown(preview,{clientX:100,clientY:50,button:0});fireEvent.pointerMove(preview,{clientX:200,clientY:100});fireEvent.pointerCancel(preview);});
  expect(f.request).toHaveBeenCalledWith('edit-cancel',{editToken:'fixture:1'});expect(f.request.mock.calls.some(([a])=>a==='settings'||a==='stop'||a==='start')).toBe(false);
});
it.each(['pointerCancel','lostPointerCapture','background','generation'] as const)('discards a dragged preview on %s without saving it',async(reason)=>{
  vi.stubGlobal('PointerEvent',MouseEvent);let hidden=false;vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
  const f=readyAutoStartFixture();if(reason==='generation') f.data.desktop.preparing=true;render(<ListenerReactionsPanel {...f}/>);
  const preview=(await screen.findByAltText('範囲を指定するOBS映像の静止画')).parentElement!,border=preview.querySelector('.reaction-range-border')!;
  Object.defineProperty(preview,'setPointerCapture',{value:vi.fn()});vi.spyOn(preview,'getBoundingClientRect').mockReturnValue({left:0,top:0,width:400,height:200} as DOMRect);
  vi.useFakeTimers();fireEvent.pointerDown(preview,{clientX:300,clientY:150,button:0});fireEvent.pointerMove(preview,{clientX:-10,clientY:20});
  expectRange(border,{left:0,top:10,width:75,height:65});
  if(reason==='background'){hidden=true;fireEvent(document,new Event('visibilitychange'));}
  else if(reason==='generation'){f.data.generation++;f.data.revision++;await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'PC表示を停止'}));});}
  else fireEvent[reason](preview);
  expectRange(border,{left:0,top:0,width:100,height:100});fireEvent.pointerUp(preview,{clientX:200,clientY:100});
  await act(()=>vi.advanceTimersByTimeAsync(600));expect(f.request.mock.calls.filter(([action])=>action==='settings')).toHaveLength(0);
});
it('saves startup publication without publishing immediately or changing focus',async()=>{
  const f=fixture();render(<ListenerReactionsPanel {...f}/>);const checkbox=screen.getByLabelText('起動時に公開する');await waitFor(()=>expect(checkbox).not.toHaveAttribute('aria-disabled','true'));checkbox.focus();
  await act(async()=>{fireEvent.click(checkbox);});expect(checkbox).toBeChecked();expect(document.activeElement).toBe(checkbox);expect(f.request).toHaveBeenCalledWith('startup-publication',{enabled:true});expect(f.request.mock.calls.some(([action])=>action==='publish')).toBe(false);
  await act(async()=>{fireEvent.click(checkbox);});expect(checkbox).not.toBeChecked();expect(document.activeElement).toBe(checkbox);
});
it('retains startup preference on save failure and never starts publication just by opening the page',async()=>{
  const f=fixture();f.data.settings.publishOnStartup=true;const normal=f.request.getMockImplementation()!;f.request.mockImplementation((action,body)=>action==='startup-publication'?Promise.reject(new Error('起動設定の保存失敗')):normal(action,body));render(<ListenerReactionsPanel {...f}/>);
  const checkbox=screen.getByLabelText('起動時に公開する');await waitFor(()=>expect(checkbox).toBeChecked());expect(f.request.mock.calls.some(([action])=>action==='publish')).toBe(false);checkbox.focus();await act(async()=>{fireEvent.click(checkbox);});expect(checkbox).toBeChecked();expect(document.activeElement).toBe(checkbox);expect(screen.getByText('起動設定の保存失敗')).toBeInTheDocument();
});
it('merges a completed startup preference into an in-progress range edit before autosaving',async()=>{
  const f=fixture(),normal=f.request.getMockImplementation()!;let finish!:()=>void;
  f.request.mockImplementation((action,body)=>action==='startup-publication'?new Promise(resolve=>{finish=()=>{f.data.settings.publishOnStartup=true;f.data.revision++;resolve(structuredClone(f.data));};}):normal(action,body));
  render(<ListenerReactionsPanel {...f}/>);await waitFor(()=>expect(screen.getByLabelText('起動時に公開する')).not.toHaveAttribute('aria-disabled','true'));fireEvent.click(screen.getByLabelText('起動時に公開する'));await waitFor(()=>expect(finish).toBeTypeOf('function'));vi.useFakeTimers();
  fireEvent.change(screen.getByLabelText('ウィンドウ余白 左（px）'),{target:{value:'12'}});await act(async()=>{finish();});await act(()=>vi.advanceTimersByTimeAsync(500));
  expect(f.data.settings.publishOnStartup).toBe(true);expect(f.data.settings.insets.left).toBe(12);expect(screen.getByLabelText('起動時に公開する')).toBeChecked();
});
it('allows automatic target selection without a preview, and publishes through a single management action',async()=>{
  const empty=fixture(), first=render(<ListenerReactionsPanel {...empty}/>);await waitFor(()=>expect(empty.request).toHaveBeenCalled());
  const blocked=screen.getByLabelText('公開時にPC表示も開始する');await waitFor(()=>expect(blocked).not.toHaveAttribute('aria-disabled','true'));await act(async()=>{fireEvent.click(blocked);});expect(empty.request).toHaveBeenCalledWith('auto-start',{enabled:true});first.unmount();
  const f=readyAutoStartFixture();render(<ListenerReactionsPanel {...f}/>);await waitFor(()=>expect(screen.getByAltText('範囲を指定するOBS映像の静止画')).toBeInTheDocument());
  const checkbox=screen.getByLabelText('公開時にPC表示も開始する');checkbox.focus();await act(async()=>{fireEvent.click(checkbox);});expect(checkbox).toBeChecked();expect(document.activeElement).toBe(checkbox);
  expect(f.request).toHaveBeenCalledWith('auto-start',{enabled:true});await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'リスナーページを公開'}));});
  expect(f.request).toHaveBeenCalledWith('publish',undefined);expect(f.request.mock.calls.some(([action])=>action==='start')).toBe(false);
});
it('keeps failed automatic opt-in off and retains the control focus',async()=>{
  const f=readyAutoStartFixture(),normal=f.request.getMockImplementation()!;f.request.mockImplementation((action,body)=>action==='auto-start'?Promise.reject(new Error('設定を保存できません。')):normal(action,body));
  render(<ListenerReactionsPanel {...f}/>);await waitFor(()=>expect(screen.getByAltText('範囲を指定するOBS映像の静止画')).toBeInTheDocument());const checkbox=screen.getByLabelText('公開時にPC表示も開始する');checkbox.focus();await act(async()=>{fireEvent.click(checkbox);});
  expect(checkbox).not.toBeChecked();expect(document.activeElement).toBe(checkbox);expect(screen.getByText('設定を保存できません。')).toBeInTheDocument();
});
it('autosaves after 500ms while retaining action focus and supports immediate stop',async()=>{
  const f=fixture();f.data.desktop.preparing=true;render(<ListenerReactionsPanel {...f}/>);await waitFor(()=>expect(f.request).toHaveBeenCalled());vi.useFakeTimers();
  fireEvent.change(screen.getByLabelText('ウィンドウ余白 左（px）'),{target:{value:'12'}});await act(()=>vi.advanceTimersByTimeAsync(499));expect(f.request.mock.calls.filter(([action])=>action==='settings')).toHaveLength(0);
  await act(()=>vi.advanceTimersByTimeAsync(1));expect(f.data.settings.insets.left).toBe(12);
  const stop=screen.getByRole('button',{name:'PC表示を停止'});stop.focus();await act(async()=>{fireEvent.click(stop);});expect(document.activeElement).toBe(stop);expect(f.request).toHaveBeenCalledWith('stop',undefined);
  expect(screen.queryByText('テスト用ウィンドウを開く')).toBeNull();
});
it('retains failed settings without retry loops and provides explicit resave',async()=>{
  const f=fixture(),normal=f.request.getMockImplementation()!;f.request.mockImplementation(async(action,body)=>{if(action==='settings')throw new Error('保存エラー');return normal(action,body);});render(<ListenerReactionsPanel {...f}/>);await waitFor(()=>expect(f.request).toHaveBeenCalled());vi.useFakeTimers();
  fireEvent.change(screen.getByLabelText('ウィンドウ余白 上（px）'),{target:{value:'18'}});await act(()=>vi.advanceTimersByTimeAsync(500));await act(()=>vi.advanceTimersByTimeAsync(3000));expect(f.request.mock.calls.filter(([action])=>action==='settings')).toHaveLength(1);expect(screen.getByLabelText('ウィンドウ余白 上（px）')).toHaveValue(18);
  f.request.mockImplementation(normal);await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'設定を再保存'}));});expect(f.data.settings.insets.top).toBe(18);
});
it('does not request images while the page is hidden and fetches on return',async()=>{
  let hidden=true;vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);const f=fixture();render(<ListenerReactionsPanel {...f}/>);expect(f.request).not.toHaveBeenCalled();hidden=false;fireEvent(document,new Event('visibilitychange'));await waitFor(()=>expect(f.request).toHaveBeenCalledTimes(1));hidden=true;fireEvent(document,new Event('visibilitychange'));vi.useFakeTimers();await act(()=>vi.advanceTimersByTimeAsync(3000));expect(f.request).toHaveBeenCalledTimes(1);
});
it('restarts after background cancellation even when an old state request ignores abort',async()=>{
  let hidden=false;vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
  const f=fixture();let finish!:(value:ReactionManagementSnapshot)=>void;
  f.request.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));render(<ListenerReactionsPanel {...f}/>);
  await waitFor(()=>expect(f.request).toHaveBeenCalledTimes(1));const old=structuredClone(f.data);
  f.data.settings.insets.top=22;hidden=true;fireEvent(document,new Event('visibilitychange'));hidden=false;fireEvent(document,new Event('visibilitychange'));
  await waitFor(()=>expect(f.request).toHaveBeenCalledTimes(2));await waitFor(()=>expect(screen.getByLabelText('ウィンドウ余白 上（px）')).toHaveValue(22));
  await act(async()=>{finish(old);});expect(screen.getByLabelText('ウィンドウ余白 上（px）')).toHaveValue(22);
});
it('starts the new preview while an old image decode is still pending after an operation',async()=>{
  const decodes:Array<()=>void>=[];
  let blobs=0;
  vi.stubGlobal('URL',class extends URL{static createObjectURL(){return `blob:preview-${++blobs}`;}static revokeObjectURL(){}});
  vi.stubGlobal('Image',class{src='';decode(){return new Promise<void>(resolve=>decodes.push(resolve));}});
  const f=fixture();f.data.desktop.preparing=true;f.data.frame={id:'old',capturedAt:Date.now(),validForMs:12000,width:640,height:360,canvasWidth:1920,canvasHeight:1080,generation:0,url:'/frame.jpg?id=old'};
  render(<ListenerReactionsPanel {...f}/>);await waitFor(()=>expect(decodes).toHaveLength(1));
  f.data.generation=1;f.data.revision++;f.data.frame={...f.data.frame,id:'new',generation:1};
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'PC表示を停止'}));});
  expect(f.image).toHaveBeenCalledTimes(2);
  expect(f.image).toHaveBeenNthCalledWith(2,'new',expect.any(AbortSignal));
  expect(decodes).toHaveLength(2);
  await act(async()=>{decodes[1]();});
  const preview=screen.getByAltText('範囲を指定するOBS映像の静止画');
  expect(preview).toHaveAttribute('src','blob:preview-2');
  await act(async()=>{decodes[0]();});
  expect(preview).toHaveAttribute('src','blob:preview-2');
});
it('ignores a cancelled detection response after manual edits and continues autosaving',async()=>{
  vi.stubGlobal('URL',class extends URL{static createObjectURL(){return 'blob:test';}static revokeObjectURL(){}});
  vi.stubGlobal('Image',class{src='';async decode(){}});
  const f=fixture(), normal=f.request.getMockImplementation()!;let fail!:(error:Error)=>void;
  f.data.settings.target={title:'game',processName:'game.exe',className:'Game'};f.data.selectedId='1';
  f.data.windows=[{...f.data.settings.target,id:'1',pid:123,x:0,y:0,width:640,height:360,minimized:false}];
  f.data.frame={id:'frame',capturedAt:Date.now(),validForMs:12000,width:640,height:360,canvasWidth:1920,canvasHeight:1080,generation:0,url:'/frame.jpg?id=frame'};
  f.request.mockImplementation((action,body)=>action==='detect'?new Promise((_resolve,reject)=>{fail=reject;}):normal(action,body));
  render(<ListenerReactionsPanel {...f}/>);await waitFor(()=>expect(screen.getByAltText('範囲を指定するOBS映像の静止画')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button',{name:'自動で合わせる'}));await waitFor(()=>expect(fail).toBeTypeOf('function'));vi.useFakeTimers();
  fireEvent.change(screen.getByLabelText('ウィンドウ余白 左（px）'),{target:{value:'12'}});await act(async()=>{fail(new Error('取消済みの判定結果'));});
  await act(()=>vi.advanceTimersByTimeAsync(500));expect(f.data.settings.insets.left).toBe(12);expect(screen.queryByText('取消済みの判定結果')).toBeNull();
});
