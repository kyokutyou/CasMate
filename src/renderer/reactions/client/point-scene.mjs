// The approved compact sample's 736px reference geometry and timeline.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const ease = value => 1 - Math.pow(1 - clamp(value, 0, 1), 3);
const back = value => { const v = clamp(value, 0, 1) - 1; return 1 + 2.7*v*v*v + 1.7*v*v; };
const NS = 'http://www.w3.org/2000/svg';
export function pointSceneFrame(ms, intent, reduced = false) {
  const t = reduced ? Math.min(3300, Math.max(750, ms)) : ms;
  const pulse = intent === 'danger' && !reduced ? Math.exp(-Math.pow((t-430)/130,2)) + Math.exp(-Math.pow((t-880)/150,2)) : 0;
  return {
    fade: 1-ease((ms-2850)/480), intro: reduced ? 1 : Math.max(.01,back(t/420)),
    lift: (1-ease(t/430))*22,
    bounce: reduced ? 0 : Math.sin(clamp((t-120)/430,0,1)*Math.PI)*(intent === 'question' ? -7 : -3),
    tilt: intent === 'danger' && !reduced ? Math.sin(t*.04)*3*Math.exp(-t/160) : 0,
    radius: (intent === 'danger' ? 28 : 25) + 4*pulse, stroke: 2.5+1.2*pulse,
    progress: ease(t/430), waveRadius: (intent === 'danger' ? 28 : 25) + ease(t/650)*36,
    waveOpacity: t < 650 && !reduced ? (1-t/650)*.55 : 0,
    pointer: ease((t-120)/380), travel: ease(t/700),
    sparksOpacity: t < 850 && !reduced ? (1-clamp((t-220)/600,0,1))*.7 : 0,
  };
}
export function pointSceneLayout(width, height, x, y) {
  const bw=110,bh=28,bx=clamp(x-bw/2,12,Math.max(12,width-bw-12));
  const by=clamp(y<110 ? y+43 : y-71,42,Math.max(42,height-bh-38));
  return {x,y,bx,by,bw,bh};
}
export function createPointScene(marker, container, canvasWidth, intent, initialAge, stationary) {
  const svg=document.createElementNS(NS,'svg');svg.classList.add('point-art');svg.setAttribute('aria-hidden','true');
  const make = (name, cls) => { const node=document.createElementNS(NS,name);node.classList.add(cls);svg.append(node);return node; };
  const wave=make('circle','point-wave'),ring=make('circle','point-ring'),pointer=make('path','point-pointer'),sparks=make('path','point-sparks');
  marker.prepend(svg);
  const label=marker.querySelector('.point-label'),body=label.querySelector('.point-label-body'),dot=marker.querySelector('.point-dot');
  const motion=typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : {matches:false};
  let unit=1,layout=null,x=.5,y=.5,raf=0,closed=false;
  const born=performance.now();
  const attrs=(node,values)=>{for(const [key,value] of Object.entries(values))node.setAttribute(key,String(value));};
  const draw = age => {
    if (!layout) return;
    const {x,y,bx,by,bw,bh}=layout,f=pointSceneFrame(stationary?900:age,intent,motion.matches);
    if (stationary) { f.fade=1;f.intro=1;f.lift=0;f.bounce=0;f.tilt=0;f.progress=1;f.pointer=1;f.waveOpacity=0;f.sparksOpacity=0;f.radius=intent==='danger'?28:25;f.stroke=2.5; }
    label.style.opacity=String(f.fade);label.style.transform=`translateY(${f.lift*unit}px) scale(${f.intro})`;
    body.style.transform=`translateY(${f.bounce*unit}px) rotate(${f.tilt}deg)`;
    svg.style.opacity=String(f.fade);
    attrs(ring,{cx:x,cy:y,r:f.radius,'stroke-width':f.stroke,'stroke-dasharray':2*Math.PI*f.radius,'stroke-dashoffset':2*Math.PI*f.radius*(1-f.progress),transform:`rotate(-90 ${x} ${y})`,visibility:f.progress>0?'visible':'hidden'});
    attrs(wave,{cx:x,cy:y,r:f.waveRadius,opacity:f.waveOpacity,'stroke-width':3});
    const r=intent==='danger'?28:25,ex=clamp(x,bx+8,bx+bw-8),ey=y>by+bh/2?by+bh+2:by-2,angle=Math.atan2(y-ey,x-ex);
    const tx=x-Math.cos(angle)*(r+4),ty=y-Math.sin(angle)*(r+4),mx=ex+(tx-ex)*f.pointer,my=ey+(ty-ey)*f.pointer;
    let arrow=`M ${ex} ${ey} Q ${ex+(tx-ex)*.2} ${ey+(ty-ey)*.8} ${mx} ${my}`;
    if(f.pointer>.9){
      const vertex=(a,b)=>`${tx+Math.cos(angle)*a-Math.sin(angle)*b} ${ty+Math.sin(angle)*a+Math.cos(angle)*b}`;
      arrow+=` M ${vertex(-5,-3)} L ${tx} ${ty} L ${vertex(-5,3)}`;
    }
    attrs(pointer,{d:arrow,'stroke-width':1.5});
    let rays='';
    for(let i=0;i<7;i++){
      const a=i*Math.PI*2/7+.3,near=r+10+f.travel*12,far=r+14+f.travel*23;
      rays+=`M ${x+Math.cos(a)*near} ${y+Math.sin(a)*near} L ${x+Math.cos(a)*far} ${y+Math.sin(a)*far} `;
    }
    attrs(sparks,{d:rays,opacity:f.sparksOpacity,'stroke-width':2});
    marker.dataset.elapsed=String(age);
  };
  const resize = () => {
    const rect=container.getBoundingClientRect();unit=rect.width>0 ? rect.width/canvasWidth*1920/736 : 1;
    const width=rect.width/unit || 736,height=rect.height/unit || 414;
    layout=pointSceneLayout(width,height,x*width,y*height);
    attrs(svg,{viewBox:`0 0 ${width} ${height}`});
    Object.assign(label.style,{left:`${layout.bx*unit}px`,top:`${layout.by*unit}px`,width:`${110*unit}px`,height:`${28*unit}px`,fontSize:`${14*unit}px`});
    label.classList.toggle('below',layout.by>layout.y);
    const diameter=(intent==='danger'?56:50)*unit;
    Object.assign(dot.style,{width:`${diameter}px`,height:`${diameter}px`});
    draw(initialAge+performance.now()-born);
  };
  const tick = () => {
    if(closed || !marker.isConnected)return;
    const age=initialAge+performance.now()-born;draw(age);
    if(age<3400)raf=requestAnimationFrame(tick);
  };
  return {
    move(nextX,nextY){x=nextX;y=nextY;resize();},resize,
    start(){if(!stationary&&initialAge<3400)raf=requestAnimationFrame(tick);},
    close(){closed=true;cancelAnimationFrame(raf);},
  };
}
