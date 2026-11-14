import { scaleMarkerLayer } from './pointing.mjs';
import './range.css';

export function placeArea(container, area, shape, canvasWidth=1920, {duration=4000,variant='',clip=null}={}) {
  if (!area || !['ellipse','rectangle'].includes(shape) || ![area.x,area.y,area.width,area.height].every(Number.isFinite) || area.width < .01 || area.height < .01 || area.x < 0 || area.y < 0 || area.x+area.width > 1.000001 || area.y+area.height > 1.000001) return null;
  scaleMarkerLayer(container,canvasWidth);
  if (!variant) {
    const accepted = [...container.querySelectorAll(':scope > .range-marker:not(.range-preview, .range-pending)')];
    while (accepted.length >= 3) accepted.shift().remove();
  }
  const wrapper=document.createElement('div');wrapper.className='range-marker';
  const canvas=document.createElementNS('http://www.w3.org/2000/svg','svg');canvas.classList.add('range-canvas');
  const outline=document.createElementNS('http://www.w3.org/2000/svg',shape==='ellipse'?'ellipse':'rect');outline.classList.add('range-outline');
  if(variant)wrapper.classList.add(variant);
  if(clip)wrapper.style.clipPath=`inset(${clip.y*100}% ${(1-clip.x-clip.width)*100}% ${(1-clip.y-clip.height)*100}% ${clip.x*100}%)`;
  const geometry=shape==='ellipse'?{cx:(area.x+area.width/2)*100,cy:(area.y+area.height/2)*100,rx:area.width*50,ry:area.height*50}:{x:area.x*100,y:area.y*100,width:area.width*100,height:area.height*100};
  for(const [name,value] of Object.entries(geometry))outline.setAttribute(name,value+'%');
  canvas.append(outline);wrapper.append(canvas);container.append(wrapper);
  if(duration>0)setTimeout(()=>wrapper.remove(),duration);
  return wrapper;
}
