'use strict';
// Worldbuilder - the world renderer, DOM-free. Draws the current sim state into ANY 2D context
// (a page canvas, an OffscreenCanvas in a worker) at PIX pixels per tile. Extracted from main.js
// on 2026-09-07 so the world can be rendered somewhere other than this page (the ops orrery
// runs it in a worker and wraps the frames onto a screen in its sky). main.js's draw() is now a
// thin wrapper: drawWorld() then its own HUD/panels. Everything here reads sim.js live bindings.
import {
  CFG, DEATH_PARTICLE_LIFE, DIR_DX, DIR_DY, H, T, TERRAIN_COLORS, W,
  aridity, baseArid, baseTemp, carrion, clamp, deathParticles, elev, fauna, flora, grid, hsv2hex, idx,
  lakeShapes, peakVolcano, riverData, riverGenerated, setDeathParticles, sunlight, tempField, tick,
} from './sim.js';

export var RIVER_COLOR = '#3aa6e0';
export var LAKE_COLOR = '#3aa6e0';         // unified with RIVER_COLOR so lakes + rivers read as one water body

export function drawRivers(ctx, PIX){
  if(!riverData||!riverGenerated)return;

  // Lakes: one smooth closed curve per lake (drawn under the river lines) through its stored per-angle
  // radii, so the shore is curved and (for ~1/3) a distinctive shape rather than a circle.
  for(var lk=0;lk<lakeShapes.length;lk++){
    var L=lakeShapes[lk];var radii=L.radii;var npts=radii.length;
    var lcx=L.cx*PIX,lcy=L.cy*PIX;
    var pa=function(k){var kk=((k%npts)+npts)%npts;var ang=kk/npts*Math.PI*2,rr=radii[kk]*PIX;return[lcx+Math.cos(ang)*rr,lcy+Math.sin(ang)*rr];};
    ctx.fillStyle=LAKE_COLOR;ctx.beginPath();
    var p0=pa(0),pl=pa(npts-1);ctx.moveTo((p0[0]+pl[0])/2,(p0[1]+pl[1])/2);
    for(var a2=0;a2<npts;a2++){var cur=pa(a2),nx=pa(a2+1);ctx.quadraticCurveTo(cur[0],cur[1],(cur[0]+nx[0])/2,(cur[1]+nx[1])/2);}
    ctx.closePath();ctx.fill();
  }

  for(var y=0;y<H;y++)for(var x=0;x<W;x++){
    var i=idx(x,y);var rd=riverData[i];if(!rd)continue;
    var px=x*PIX,py=y*PIX;var mid=PIX/2;

    // River line (never drawn inside a lake - lakes render as the smooth blob only; the inflow/outflow
    // rivers draw on the adjacent land cells, so the river emerges from the lake's edge).
    if(rd.exitDir>=0&&!rd.lake){
      var ex,ey;
      if(rd.entryDir>=0){ex=px+mid+DIR_DX[rd.entryDir]*mid;ey=py+mid+DIR_DY[rd.entryDir]*mid;}
      else{ex=px+mid;ey=py+mid;}
      var lineW=Math.max(1.2,Math.min(PIX*0.85,0.8+rd.volume*0.5));
      ctx.strokeStyle=RIVER_COLOR;ctx.lineWidth=lineW;
      if(rd.estuary){
        // At the coast: stop the river INSIDE its own land cell with a flat (butt) cap and a straight
        // final segment pulled back past the stroke half-width, so no blue ever bleeds over the sea.
        var reachE=Math.max(0,mid-lineW*0.6);
        ctx.lineCap='butt';
        ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(px+mid+DIR_DX[rd.exitDir]*reachE,py+mid+DIR_DY[rd.exitDir]*reachE);ctx.stroke();
      }else{
        var ox=px+mid+DIR_DX[rd.exitDir]*mid,oy=py+mid+DIR_DY[rd.exitDir]*mid;
        var cpx=px+mid+rd.curveOffset*PIX,cpy=py+mid+(rd.curveOffset*0.6)*PIX;
        ctx.lineCap='round';
        ctx.beginPath();ctx.moveTo(ex,ey);ctx.quadraticCurveTo(cpx,cpy,ox,oy);ctx.stroke();
      }
    }
  }
}

// opts: { overlayMode: 'none' | 'elev' | 'clim-ar' | 'clim-te' | 'clim-su' | 'climate' | 'water',
//         followId: the fauna id to ring, or null }
export function drawWorld(ctx, PIX, opts){
  if(!ctx||!grid||!elev)return;
  var overlayMode=(opts&&opts.overlayMode)||'none';var followId=opts?opts.followId:null;
  var canvas=ctx.canvas;
  ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
  for(var y=0;y<H;y++)for(var x=0;x<W;x++){
    var i=idx(x,y);var terr=grid[i];var isPeak=(terr===T.MOUNTAIN&&peakVolcano&&peakVolcano[i]);var col=isPeak?TERRAIN_COLORS[T.VOLCANIC]:(TERRAIN_COLORS[terr]||'#222');
    if(overlayMode==='elev'){var v=clamp((elev[i]||0)/10,0,1);col='rgb('+Math.floor(177+(75-177)*v)+','+Math.floor(151+(30-151)*v)+','+Math.floor(122+(15-122)*v)+')';}
    else if(overlayMode==='clim-ar'){var va=clamp((aridity[i]||0)/10,0,1);col='rgb('+Math.floor(255*va)+','+Math.floor(31+(255-31)*va)+','+Math.floor(63+(255-63)*va)+')';}
    else if(overlayMode==='clim-te'){var Tt=tempField[i]||0;var r5,g5,b5;if(Tt<=5){var kk=Math.max(0,Math.min(1,(Tt-1)/4));r5=Math.floor(128*kk);g5=0;b5=Math.floor(255+(128-255)*kk);}else{var k2=Math.max(0,Math.min(1,(Tt-5)/5));r5=Math.floor(128+(255-128)*k2);g5=0;b5=Math.floor(128-128*k2);}col='rgb('+r5+','+g5+','+b5+')';}
    else if(overlayMode==='clim-su'){var vs=(sunlight[i]||0)/10;col='rgb('+Math.floor(255*vs)+','+Math.floor(180*vs)+','+Math.floor(60*(1-vs)+10)+')';}
    else if(overlayMode==='climate'){if(!baseTemp||!baseArid){col='rgb(80,60,100)';ctx.fillStyle=col;ctx.fillRect(x*PIX,y*PIX,PIX,PIX);continue;}var dT=(tempField[i]||0)-(baseTemp[i]||0);var dA2=(aridity[i]||0)-(baseArid[i]||0);var tN=Math.max(0,Math.min(1,(dT+1.5)/3.0));var ll2=20+tN*60;var aN=Math.max(0,Math.min(1,(dA2+0.9)/1.8));var ss2=20+aN*60;var hh2=270,sF=ss2/100,lF=ll2/100;var cC=(1-Math.abs(2*lF-1))*sF;var xC=cC*(1-Math.abs(((hh2/60)%2)-1));var mM=lF-cC/2;col='rgb('+Math.floor((xC+mM)*255)+','+Math.floor(mM*255)+','+Math.floor((cC+mM)*255)+')';}
    else if(overlayMode==='water'){
      if(terr===T.OCEAN){col='#0a2a3f';}
      else{
        var hasRiv=riverData&&riverData[i];
        if(hasRiv&&riverData[i].lake){/* lake is the smooth blob in drawRivers; keep terrain under the shore margin */}
        else if(hasRiv&&riverData[i].sourcePool){col='#1a8ab0';}
        else if(hasRiv){var rv=Math.min(1,riverData[i].volume/9);col='rgb('+Math.round(20+25*rv)+','+Math.round(90+35*rv)+','+Math.round(140+30*rv)+')';}
        else{col='#151d28';}
      }
    }
    ctx.fillStyle=col;ctx.fillRect(x*PIX,y*PIX,PIX,PIX);}
  // River render
  if(overlayMode==='none'||overlayMode==='elev')drawRivers(ctx,PIX);
  // Flora render
  if(CFG.ecoRender){for(var fi=0;fi<flora.length;fi++){var f=flora[fi];if(!f)continue;var fw=riverData&&riverData[idx(f.x,f.y)];if(fw&&fw.lake)continue;var brightness=0.4+0.6*f.health;var fCol=hsv2hex(f.hue,f.sat*(0.3+0.7*f.health),f.val*brightness);ctx.fillStyle=fCol;var px=f.x*PIX,py=f.y*PIX;var sz=Math.max(1,PIX<6?1:2);var off=((PIX-sz)/2)|0;
    if(f.shape==='dot'){ctx.fillRect(px+off,py+off,sz,sz);}else if(f.shape==='plus'){ctx.fillRect(px+off,py+off-1,sz,1);ctx.fillRect(px+off-1,py+off,1,sz);ctx.fillRect(px+off,py+off,sz,sz);ctx.fillRect(px+off+sz,py+off,1,sz);ctx.fillRect(px+off,py+off+sz,sz,1);}else if(f.shape==='x'){ctx.fillRect(px+off-1,py+off-1,1,1);ctx.fillRect(px+off+sz,py+off-1,1,1);ctx.fillRect(px+off,py+off,sz,sz);ctx.fillRect(px+off-1,py+off+sz,1,1);ctx.fillRect(px+off+sz,py+off+sz,1,1);}else if(f.shape==='ring'){ctx.fillRect(px+off,py+off-1,sz,1);ctx.fillRect(px+off-1,py+off,1,sz);ctx.fillRect(px+off+sz,py+off,1,sz);ctx.fillRect(px+off,py+off+sz,sz,1);}else if(f.shape==='diamond'){ctx.fillRect(px+off,py+off-1,sz,1);ctx.fillRect(px+off-1,py+off,sz+2,sz);ctx.fillRect(px+off,py+off+sz,sz,1);}else{ctx.fillRect(px+off,py+off,sz,sz);}}}
  // Fauna render
  if(CFG.ecoRender){for(var ai=0;ai<fauna.length;ai++){var a=fauna[ai];if(!a)continue;var aw=riverData&&riverData[idx(a.x,a.y)];if(aw&&aw.lake)continue;var isH=(a.type==='herbivore');var aBright=0.4+0.6*(a.energy/a.maxEnergy);var faunaCol=hsv2hex(a.hue,a.sat,a.val*aBright);var apx=a.x*PIX,apy=a.y*PIX;
    // Heritable SIZE gene -> rendered marker dimension. This is the visible part of evolution; cosmetic only.
    var dim=clamp(Math.round(Math.min(4,PIX-1)*(a.size||1)),2,Math.round(PIX*2.2));var doff=((PIX-dim)/2)|0;
    // Vivid glow: bright halo behind vivid fauna (scaled with the creature)
    if(a.vivid){ctx.fillStyle=hsv2hex(a.hue,Math.min(1,a.sat*1.3),Math.min(1,a.val*1.2));var gsz=dim+2;var goff=((PIX-gsz)/2)|0;ctx.fillRect(apx+goff,apy+goff,gsz,gsz);}
    ctx.fillStyle=faunaCol;
    if(isH){ctx.fillRect(apx+doff,apy+doff,dim,dim);}
    else if(a.type==='scavenger'){ // hollow square outline - distinct from the solid herbivore + the carnivore cross
      ctx.fillRect(apx+doff,apy+doff,dim,1);ctx.fillRect(apx+doff,apy+doff+dim-1,dim,1);ctx.fillRect(apx+doff,apy+doff,1,dim);ctx.fillRect(apx+doff+dim-1,apy+doff,1,dim);}
    else if(a.type==='apex'){ // solid diamond - the apex predator, distinct from square / hollow-square / cross
      for(var dr=0;dr<dim;dr++){var half=Math.min(dr,dim-1-dr);var dw=half*2+1;ctx.fillRect(apx+doff+(((dim-dw)/2)|0),apy+doff+dr,dw,1);}}
    else if(a.type==='omnivore'){ // upward solid triangle (wide base) - the generalist, distinct from the other four
      for(var tr=0;tr<dim;tr++){var tw=tr+1;if(tw>dim)tw=dim;ctx.fillRect(apx+doff+(((dim-tw)/2)|0),apy+doff+tr,tw,1);}}
    else{var mid=(dim/2)|0;ctx.fillRect(apx+doff+mid,apy+doff,1,1);ctx.fillRect(apx+doff,apy+doff+mid,dim,1);ctx.fillRect(apx+doff+mid,apy+doff+dim-1,1,1);if(dim>=3)ctx.fillRect(apx+doff+mid-1,apy+doff+1,3,1);}
    // Follow highlight: an accent ring around the creature the camera is tracking.
    if(followId!=null&&a.id===followId){ctx.strokeStyle='#3b9eff';ctx.lineWidth=1;var rs=dim+4;var ro=((PIX-rs)/2)|0;ctx.strokeRect(apx+ro+0.5,apy+ro+0.5,rs-1,rs-1);}}}
  // Death particles
  var aliveParticles=[];
  for(var dp=0;dp<deathParticles.length;dp++){var p=deathParticles[dp];var age=tick-p.tick;if(age>=DEATH_PARTICLE_LIFE)continue;aliveParticles.push(p);var alpha=1.0-age/DEATH_PARTICLE_LIFE;var ppx=p.x*PIX,ppy=p.y*PIX;ctx.globalAlpha=alpha;
    if(p.type==='kill'){ctx.strokeStyle='#ff3333';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(ppx+1,ppy+1);ctx.lineTo(ppx+PIX-1,ppy+PIX-1);ctx.moveTo(ppx+PIX-1,ppy+1);ctx.lineTo(ppx+1,ppy+PIX-1);ctx.stroke();}
    else if(p.type==='starve'){ctx.fillStyle='#888';ctx.beginPath();ctx.arc(ppx+PIX/2,ppy+PIX/2,PIX/3,0,Math.PI*2);ctx.fill();}
    else if(p.type==='age'){ctx.fillStyle='#aaa';ctx.fillRect(ppx+1,ppy+PIX/2,PIX-2,1);}
  }ctx.globalAlpha=1.0;setDeathParticles(aliveParticles);
  // Carrion (scavenger food): a small dark speck where a corpse lies (only present when scavengers are on).
  if(CFG.ecoRender&&carrion.length){ctx.fillStyle='#5a5048';for(var cq=0;cq<carrion.length;cq++){var cc2=carrion[cq];if(!cc2)continue;var cwv=riverData&&riverData[idx(cc2.x,cc2.y)];if(cwv&&cwv.lake)continue;ctx.fillRect(cc2.x*PIX+((PIX/2)|0),cc2.y*PIX+((PIX/2)|0),1,1);}}
}
