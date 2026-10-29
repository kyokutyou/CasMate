import { ipcRenderer } from 'electron';

const playChannel = 'casmate:speech-player:play';
const stopChannel = 'casmate:speech-player:stop';
const resultChannel = 'casmate:speech-player:result';

let audio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
let generation = 0;

function stop(): void {
  generation += 1;
  if (audio) {
    audio.pause();
    audio.src = '';
  }
  audio = null;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
}

ipcRenderer.on(stopChannel, stop);
ipcRenderer.on(playChannel, (_event, value: { id?: number; wav?: Uint8Array }) => {
  stop();
  if (typeof value.id !== 'number' || !(value.wav instanceof Uint8Array)) return;
  const currentGeneration = generation;
  const id = value.id;
  objectUrl = URL.createObjectURL(new Blob([Uint8Array.from(value.wav).buffer], { type: 'audio/wav' }));
  audio = new Audio(objectUrl);
  let completed = false;
  const finish = (ok: boolean) => {
    if (completed || currentGeneration !== generation) return;
    completed = true;
    stop();
    ipcRenderer.send(resultChannel, { id, ok });
  };
  audio.onended = () => finish(true);
  audio.onerror = () => finish(false);
  void audio.play().catch(() => finish(false));
});
