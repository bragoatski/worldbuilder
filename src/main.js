'use strict';
// Worldbuilder - the browser UI shell (chunk 10). Rendering, canvas, DOM wiring, and the
// animation loop. The pure simulation core lives in src/sim.js and is imported below; this
// file is the ONLY one that touches document/window/canvas. Never imported headlessly.

// The DOM-free simulation core. Every non-browser symbol this shell uses is imported here; the list
// is exhaustive (eslint no-undef would flag any omission). Live bindings (flora/fauna/tick/W/H/...)
// reflect reassignment inside sim.js, so the render reads current state each frame.
import {
  CFG, H, POP_HISTORY_LEN, SCENARIOS, SCENARIO_WARMUP_CAP,
  SPECIES_MIN_GEN, SPECIES_MIN_POP, T, TERRAIN_COLORS, TNAME, W, WORLD_CODE_VERSION, _applyPresetCfg,
  _capType, _seed, _seedScenarioLife, activePreset, activeScenario, applyClimate, applyElevationIntensity,
  applySnapshot, applyWorldCode, aridity, baseArid, baseTemp, biomeBoundary, bloomEvent, brushTerrain,
  brushTerrainRaw, settleTerrain, brushClimateRaw, settleClimate, godMark, godUndo, godCanUndo,
  emberStrike, addSpring, seedLifeAt, shiftSeaLevel, godCancelMark,
  buildSnapshot, chronicle, chronicleNote, chronicleStats, clamp, clearScenario, computeAridity,
  decodeWorldCode, droughtEvent, elev, fauna, flora, floraRemnants, foodWebCensus, generateRivers,
  getSpeciesName, grid, hsv2hex, idx, inb, initWorld, initialScenarioStatus, landCoverage,
  makeFauna, meteorStrike, peakVolcano, popHistory, reclassTerrain, restoreState, riverData, riverGenerated, runAssertions,
  seasonPhase, seedFaunaGroup, seedFloraCluster, setActiveScenario, setWorldSize, speciesCensus,
  speciesRegistry, step, sunlight, tempField, tick, worldPermalink, worldPostcard,
} from './sim.js';
import * as SIM from './sim.js';   // the live module, for the ?debug handle only (a URL import after a hot reload is a second instance)
import { drawWorld } from './render.js';
import { bootVisit, visitDraw, visitTick, boardAdopted, rootPlaying } from './visit.js';
import { SETTINGS as KETCHEM_SETTINGS } from './ketchem/board.js';
import { drawKetchemGround, drawFog, drawPlayers } from './ketchem/render.js';
import { isRevealed } from './ketchem/fog.js';
import { newPlayer, tryStep, strideStep, interact } from './ketchem/controls.js';
import { initEncounters, initPlayer, encounterTick, targetsNear, throwStone, placeBait, pickPlant, nameCatch, freeName, follow, recall, drainNews, news as pushNews } from './ketchem/encounter.js';
import { initStores, marketTick, storeAt, shopLists, shopText, creatureCard, buy as buyItem, sell as sellItem, box as boxItem, giveSaid, usePotion, almanacLists, almanacText, packSummary, POTIONS } from './ketchem/market.js';
import { storePanel, almanacPanel, closePanel, panelOpen, panelMode } from './ketchem/panel.js';
import { hudTick } from './ketchem/hud.js';
import { ask, asking, closeAsk, askWho, answerAsk } from './ketchem/ask.js';
import { padPressed, padEdges, padKey, padArrowUp, PAD_PICK, START as PAD_START } from './ketchem/pad.js';
import { guestSeated, seatName, seatGuest, unseatGuest } from './ketchem/guest.js';
import { linkAvailable, linkOpen, openLink, closeLink, askRemote, dropQuestions, guestAddress, linkCode as linkCodeNow } from './ketchem/link.js';
import { setRemoteOk } from './ketchem/hud.js';
import { toggleSound } from './ketchem/sound.js';
import { growthTick, catchXP, feedSaid, eventsText, breed as breedPair } from './ketchem/growth.js';
import { drawEncounters } from './ketchem/render.js';
import { buildSave, applySave, exportSave, importSave, putSlot, getSlot, deleteSlot, listSlots, addToRecordCabinet, SAVE_VERSION } from './ketchem/save.js';
import { saveMenu } from './ketchem/menu.js';
import { mirrorSave } from './visit.js';

// ===== Panel collapse =====
window.togglePanel = function(id){
  var el = document.getElementById(id);
  if(el) el.classList.toggle('collapsed');
};

// ===== Error HUD =====
window.onerror = function(msg, src, line, col, err){
  var box=document.getElementById('err');
  if(!box) return false;
  box.style.display='block';
  var text = 'JS Error: '+msg+'\n'+(src||'')+':'+(line||'?')+':'+(col||'?')+'\n'+(err&&err.stack?err.stack:'');
  box.textContent=text;
  return false;
};

// ===== State =====
var started=false, running=true; var PIX=6,speed=18; var overlayMode='none';
if(!Number.isFinite(PIX) || PIX<=0) PIX=6;
var loopTimer=null;
var lastClick=null;
var placeMode = 'none';
function applyPreset(name){ if(_applyPresetCfg(name)) syncUIToConfig(); }
function syncUIToConfig(){
  // Terrain sliders (rebuilt by buildSliders)
  buildSliders(); applyElevationIntensity();
  // Climate panel
  var cIE=document.getElementById('climateIntensity'),cIO=document.getElementById('climateIntensityOut');
  if(cIE){cIE.value=CFG.climateIntensity;if(cIO)cIO.textContent=CFG.climateIntensity.toFixed(2);}
  var cSE=document.getElementById('climateSeasonLen'),cSO=document.getElementById('climateSeasonLenOut');
  if(cSE){cSE.value=CFG.climateSeasonLength;if(cSO)cSO.textContent=CFG.climateSeasonLength;}
  var stEl=document.getElementById('seasonalToggle');if(stEl)stEl.checked=!!CFG.seasonalTilt;
  var anEl=document.getElementById('anomalyToggle');if(anEl)anEl.checked=!!CFG.anomalies;
  var vaEl=document.getElementById('volcanoToggle');if(vaEl)vaEl.checked=!!CFG.volcanoAsh;
  // Ecology panel
  var fcEl=document.getElementById('floraTileCapSlider'),fcOut=document.getElementById('floraTileCapOut');
  if(fcEl){fcEl.value=CFG.floraPerTileMax;if(fcOut)fcOut.textContent=CFG.floraPerTileMax;}
  var fsEl=document.getElementById('floraSpawnSlider'),fsOut=document.getElementById('floraSpawnOut');
  if(fsEl){fsEl.value=CFG.floraSpawnChance;if(fsOut)fsOut.textContent=CFG.floraSpawnChance.toFixed(3);}
  var ftEl=document.getElementById('floraThinSlider'),ftOut=document.getElementById('floraThinOut');
  if(ftEl){ftEl.value=CFG.floraLandThin;if(ftOut)ftOut.textContent=Math.round(CFG.floraLandThin*100)+'%';}
  var fwEl=document.getElementById('floraWaterSlider'),fwOut=document.getElementById('floraWaterOut');
  if(fwEl){fwEl.value=CFG.floraWaterDistPenalty;if(fwOut)fwOut.textContent=CFG.floraWaterDistPenalty.toFixed(2);}
  var fdEl=document.getElementById('floraDesertSlider'),fdOut=document.getElementById('floraDesertOut');
  if(fdEl){fdEl.value=CFG.floraMoisturePenalty;if(fdOut)fdOut.textContent=CFG.floraMoisturePenalty.toFixed(2);}
  var faEl=document.getElementById('faunaSpawnSlider'),faOut=document.getElementById('faunaSpawnOut');
  if(faEl){faEl.value=CFG.faunaSpawnChance;if(faOut)faOut.textContent=CFG.faunaSpawnChance.toFixed(3);}
  var muEl=document.getElementById('mutationSlider'),muOut=document.getElementById('mutationOut');
  if(muEl){muEl.value=CFG.floraMutationChance;if(muOut)muOut.textContent=Math.round(CFG.floraMutationChance*100)+'%';}
  var mbEl=document.getElementById('mutBiasSlider'),mbOut=document.getElementById('mutBiasOut');
  if(mbEl){mbEl.value=CFG.floraMutationBias;if(mbOut)mbOut.textContent=Math.round(CFG.floraMutationBias*100)+'%';}
  // Preset selector
  var psEl=document.getElementById('presetSelect');if(psEl)psEl.value=activePreset;
}

// ===== Canvas helpers =====
var canvas=document.getElementById('c'); var ctx=canvas.getContext('2d');
function resize(){ if(!Number.isFinite(PIX) || PIX<=0) PIX=6; if(W<=0||H<=0){ setWorldSize(96); } canvas.width=W*PIX; canvas.height=H*PIX; applyZoomPan(); }

// ===== Zoom & Pan =====
var zoomLevel=1, panX=0, panY=0;
var ZOOM_MIN=0.5, ZOOM_MAX=6, ZOOM_STEP=0.15;
var isPanning=false, panStartX=0, panStartY=0, panStartPX=0, panStartPY=0;
// Follow-a-creature camera: the id of the fauna the camera is tracking (null = free camera).
var followId=null, FOLLOW_MIN_ZOOM=3;

function applyZoomPan(){
  canvas.style.transform='scale('+zoomLevel+') translate('+panX+'px,'+panY+'px)';
}
function resetZoomPan(){
  zoomLevel=1;panX=0;panY=0;applyZoomPan();
  var zEl=document.getElementById('hZoom');if(zEl)zEl.textContent='100%';
}
function screenToTile(clientX,clientY){
  var r=canvas.getBoundingClientRect();
  var x=((clientX-r.left)/r.width*canvas.width/PIX)|0;
  var y=((clientY-r.top)/r.height*canvas.height/PIX)|0;
  return {x:x,y:y};
}

// ===== Follow-a-creature camera (the lineage lens) =====
// Track one creature by id: keep the camera centered on it each frame and feed a live readout into
// the Lineage panel. Pure UI/observation - no sim state is touched, so it is balance-safe.
function findFauna(id){if(id==null)return null;for(var i=0;i<fauna.length;i++){if(fauna[i]&&fauna[i].id===id)return fauna[i];}return null;}
// Center the camera on a tile. With transform-origin:center, the visible center sits at pan=0, so
// panning by (canvasCenter - tileCenter) puts the tile at the viewport center (zoom-independent).
function centerOnTile(tx,ty){panX=canvas.width/2-(tx+0.5)*PIX;panY=canvas.height/2-(ty+0.5)*PIX;applyZoomPan();}
function startFollow(id){
  followId=id;
  if(zoomLevel<FOLLOW_MIN_ZOOM){zoomLevel=FOLLOW_MIN_ZOOM;var zEl=document.getElementById('hZoom');if(zEl)zEl.textContent=Math.round(zoomLevel*100)+'%';var zw=document.getElementById('hZoomWrap');if(zw)zw.style.display='';}
  var lp=document.getElementById('panelLineage');if(lp){lp.classList.remove('collapsed');if(lp.scrollIntoView)lp.scrollIntoView({block:'nearest'});}
  updateFollow();
}
function stopFollow(){followId=null;renderLineagePanel();}
function updateFollow(){
  if(followId==null) return;
  var f=findFauna(followId);
  if(!f){followId=null;renderLineagePanel(null,true);return;} // the followed creature died
  centerOnTile(f.x,f.y);
  renderLineagePanel(f);
}
function _sizeWord(s){return s>=1.7?'giant':s>=1.3?'large':s<=0.75?'small':'average';}
function renderLineagePanel(f,died){
  var el=document.getElementById('lineagePanel'); if(!el) return;
  if(died){ el.innerHTML='<div class="lin-empty">The creature you were following has died. Follow another to keep watching the world evolve.</div>'; return; }
  if(!f){ el.innerHTML='<div class="lin-empty">Click a creature in the Inspector, then press Follow to track it and watch its lineage evolve.</div>'; return; }
  var icon=f.type==='herbivore'?'🐇':(f.type==='scavenger'?'🦅':(f.type==='apex'?'🦁':(f.type==='omnivore'?'🐗':'🐺')));
  var sName=getSpeciesName(f,f.type);
  var sw=hsv2hex(f.hue,f.sat,f.val);
  var sz=f.size||1;
  // Lineage stats: scan living kin that share this lineage root.
  var kin=0,topGen=0; for(var i=0;i<fauna.length;i++){var o=fauna[i];if(o&&o.lineageId===f.lineageId){kin++;if(o.gen>topGen)topGen=o.gen;}}
  var html='<div class="lin-head"><span class="insp-swatch" style="background:'+sw+'"></span><span class="tname">'+icon+' '+_capType(f.type)+(f.vivid?' ✨':'')+'</span><button class="lin-stop" id="lineageStop">Stop</button></div>';
  if(sName) html+='<div class="species-name">'+sName+'</div>';
  html+='<div class="insp-grid">';
  html+='<span class="ig-k">Size</span><span class="ig-v">'+sz.toFixed(2)+'× ('+_sizeWord(sz)+')</span>';
  html+='<span class="ig-k">Generation</span><span class="ig-v">'+f.gen+'</span>';
  html+='<span class="ig-k">Energy</span><span class="ig-v">'+f.energy.toFixed(0)+'/'+f.maxEnergy+'</span>';
  html+='<span class="ig-k">Age</span><span class="ig-v">'+f.age+'/'+Math.round(f.maxAge)+'</span>';
  html+='<span class="ig-k">Position</span><span class="ig-v">('+f.x+', '+f.y+')</span>';
  html+='<span class="ig-k">Climate pref</span><span class="ig-v">A'+f.prefArid.toFixed(1)+' T'+f.prefTemp.toFixed(1)+' S'+f.prefSL.toFixed(1)+(f.prefElev!==undefined?' E'+f.prefElev.toFixed(1):'')+'</span>';
  html+='</div><hr class="insp-divider"><div class="insp-sub">Lineage</div>';
  html+='<div class="insp-grid"><span class="ig-k">Living kin</span><span class="ig-v">'+kin+'</span><span class="ig-k">Lineage top gen</span><span class="ig-v">'+topGen+'</span></div>';
  el.innerHTML=html;
}

// ===== Climate System =====
function hook(id,fn,ev){var el=document.getElementById(id);if(el)el.addEventListener(ev||'click',fn);}
hook('btnStart',function(){running=true;if(!started)boot();});
hook('btnForceStart',function(){running=true;started=false;boot();});
hook('btnPause',function(){running=false;});
hook('btnStep',function(){running=false;step();draw();});
hook('btnReset',function(){
  var viewer=document.body.classList.contains('mode-viewer');
  running=false;init();buildSliders();applyElevationIntensity();draw();
  // In Viewer, Reset must keep RUNNING. The rebuild starts as empty ocean and GROWS, so pausing here
  // hands a visitor a frozen blank map; the boot path auto-runs for exactly this reason. Developer
  // mode keeps its deliberate pause-on-reset. loop() clears its own pending timer, so this cannot
  // start a second chain.
  if(viewer){running=true;loop();}
});
hook('btnSpawnFlora',function(){seedFloraCluster(15);draw();});
hook('btnSpawnHerb',function(){seedFaunaGroup('herbivore',8);draw();});
hook('btnSpawnCarn',function(){seedFaunaGroup('carnivore',4);draw();});
hook('btnSpawnScav',function(){seedFaunaGroup('scavenger',4);draw();});
hook('btnSpawnApex',function(){seedFaunaGroup('apex',3);draw();});
hook('btnSpawnOmni',function(){seedFaunaGroup('omnivore',3);draw();});
hook('btnRivers',function(){generateRivers();computeAridity();applyClimate();reclassTerrain();draw();});
// Scenarios (chunk 5): Start plays the selected scenario; the empty "Sandbox" option rolls a plain world.
hook('btnStartScenario',function(){var sel=document.getElementById('scenarioSelect');var id=sel?sel.value:'';if(id)startScenario(id);else{running=false;init();buildSliders();draw();}});
// Placement / brush mode (fauna placement + the god-power land brush share the click machinery)
var PLACE_BTN_IDS={herbivore:'btnPlaceHerb',carnivore:'btnPlaceCarn',raise:'btnBrushRaise',lower:'btnBrushLower'};
var PLACE_LABELS={herbivore:'Click tile to place herbivore',carnivore:'Click tile to place carnivore',raise:'Click the map to RAISE land',lower:'Click the map to LOWER land'};
function setPlaceMode(mode){
  placeMode=(placeMode===mode)?'none':mode;
  // The canvas checks handTool BEFORE placeMode, so an armed Hand tool would swallow every click meant
  // for a deck power. Exclusivity has to run both ways or the old deck buttons quietly stop working.
  if(placeMode!=='none'&&handTool!=='none')setHandTool(handTool);
  for(var m in PLACE_BTN_IDS){var el=document.getElementById(PLACE_BTN_IDS[m]);if(el)el.classList.toggle('place-active',placeMode===m);}
  var banner=document.getElementById('placeBanner');
  if(banner){banner.classList.toggle('show',placeMode!=='none');banner.textContent=placeMode==='none'?'':(PLACE_LABELS[placeMode]||('Click tile to place '+placeMode));}
  canvas.style.cursor=placeMode!=='none'?'cell':'crosshair';
}
hook('btnPlaceHerb',function(){setPlaceMode('herbivore');});
hook('btnPlaceCarn',function(){setPlaceMode('carnivore');});
// God powers (chunk 3): the land brush is a click mode; the three events fire once per press.
hook('btnBrushRaise',function(){setPlaceMode('raise');});
hook('btnBrushLower',function(){setPlaceMode('lower');});
hook('btnMeteor',function(){meteorStrike();draw();});
hook('btnDrought',function(){droughtEvent();draw();});
hook('btnBloom',function(){bloomEvent();draw();});
document.addEventListener('keydown',function(e){if(e.key!=='Escape')return;
  if(placeMode!=='none')setPlaceMode('none');
  if(handTool!=='none')setHandTool(handTool);});
hook('btnRunTests',function(){runTests();});
hook('btnExport',exportPNG);
hook('btnExportJSON',exportJSON);
hook('btnImportJSON',function(){
  var input=document.createElement('input');input.type='file';input.accept='.json';
  input.onchange=function(e){var file=e.target.files[0];if(!file)return;var reader=new FileReader();reader.onload=function(ev){try{importJSON(JSON.parse(ev.target.result));}catch(err){var errBox=document.getElementById('err');if(errBox){errBox.style.display='block';errBox.textContent='Import error: '+err.message;}}};reader.readAsText(file);};
  input.click();
});
hook('btnCopyLink',copyWorldLink);   // shareable worlds (chunk 4): copy a ?w= permalink to this world
hook('btnPostcard',copyPostcard);    // copy a Chronicle-driven postcard (world stats + recent history + link)
var speedEl=document.getElementById('speed');if(speedEl)speedEl.addEventListener('input',function(e){speed=+e.target.value;});
var mapSizeEl=document.getElementById('mapSize');if(mapSizeEl)mapSizeEl.addEventListener('change',function(e){setWorldSize(+e.target.value);init();buildSliders();draw();});
var pixEl=document.getElementById('pix');if(pixEl)pixEl.addEventListener('change',function(e){PIX=+e.target.value;resize();draw();});
// Preset selector
var presetEl=document.getElementById('presetSelect');if(presetEl)presetEl.addEventListener('change',function(e){applyPreset(e.target.value);init();draw();});
// Seed input + dice
var seedInputEl=document.getElementById('seedInput');
hook('btnRollSeed',function(){if(seedInputEl)seedInputEl.value='';init();draw();});
// Click-to-copy seed
(function(){var hSeed=document.getElementById('hSeed');if(hSeed)hSeed.addEventListener('click',function(){if(navigator.clipboard)navigator.clipboard.writeText(String(_seed));hSeed.textContent='copied!';setTimeout(function(){hSeed.textContent=_seed;},800);});})();

// ===== View mode (Viewer / Developer) =====
// Viewer is the clean, world-forward default; Developer reveals the full cockpit (dev-only deck
// segments + panels), toggled by a body class so no DOM is restructured or removed.
function setViewMode(mode){
  document.body.classList.toggle('mode-viewer',mode==='viewer');
  document.body.classList.toggle('mode-dev',mode==='dev');
  var toggleEl=document.getElementById('modeToggle');
  if(toggleEl) toggleEl.textContent=mode==='viewer'?'⚙ Developer':'◉ Viewer';
  try{ localStorage.setItem('wb-mode',mode); }catch{}
  fitCanvas();
}
// Size the world to the space it has: fill the near-full-screen Viewer, restore the Px control in Developer.
function fitCanvas(){
  if(W>0 && H>0){
    if(document.body.classList.contains('mode-viewer')){
      // Robust sizing off the window (not a wrapper measured mid-reflow): biggest tile that fits.
      var deck=document.querySelector('.deck-primary');
      var deckH=deck?deck.offsetHeight:52;
      var availH=window.innerHeight-deckH-16;
      // Under 700px the rail becomes a horizontal bar UNDER the map (narrow-screen media query),
      // so the map has to give back that height or overflow:hidden clips the rail off-screen.
      if(window.innerWidth<=700) availH-=56;
      // The Laws drawer gives the sidebar its 380px column back (see .layout in index.html); sizing the
      // map for the full window would push its right edge under the panel, where overflow:hidden eats it.
      var sideW=document.body.classList.contains('laws-open')?380:0;
      var availW=window.innerWidth-16-sideW;
      var p=Math.floor(Math.min(availW,availH)/Math.max(W,H));
      // Floor of 2, not 6: a 6px floor is larger than a phone can fit (96 tiles x 6px = 576px on a
      // 390px screen), so the old floor pushed the map off the side of small screens entirely.
      PIX=Math.max(2,Math.min(18,p>0?p:2));
    }else{
      var pe=document.getElementById('pix');
      PIX=pe?(parseInt(pe.value)||6):6;
    }
  }
  resize();
  if(started) draw();
}
window.addEventListener('resize',function(){ if(document.body.classList.contains('mode-viewer')) fitCanvas(); });
(function(){
  var saved='viewer';
  try{ if(localStorage.getItem('wb-mode')==='dev') saved='dev'; }catch{}
  setViewMode(saved);
})();
hook('modeToggle',function(){setViewMode(document.body.classList.contains('mode-viewer')?'dev':'viewer');});

// Overlay selector (segmented buttons)
(function(){
  var bar=document.getElementById('overlayBar'); if(!bar) return;
  bar.addEventListener('click',function(e){
    var btn=e.target.closest('.ov-btn'); if(!btn) return;
    bar.querySelectorAll('.ov-btn').forEach(function(b){b.classList.remove('active');});
    btn.classList.add('active');
    overlayMode=btn.getAttribute('data-ov');
    draw();
  });
})();

// Follow-a-creature wiring (delegated, bound once so the per-frame innerHTML rewrites don't leak listeners).
(function(){
  var insp=document.getElementById('inspector');
  if(insp)insp.addEventListener('click',function(e){var b=e.target&&e.target.closest?e.target.closest('.follow-btn'):null;if(!b)return;var fid=parseInt(b.getAttribute('data-fid'));if(!isNaN(fid))startFollow(fid);});
  var lin=document.getElementById('panelLineage');
  if(lin)lin.addEventListener('click',function(e){if(e.target&&e.target.id==='lineageStop')stopFollow();});
  renderLineagePanel(); // show the idle hint at boot
})();

// ===== The Hand: on-map god tools =====
// Brushes the player drags across the world. Three things make it work:
//  1) SPEED. The raw brush does the field edit alone; the settle (which reclassifies biomes, and for terrain
//     also rebuilds climate) runs on a throttle mid-stroke and once at the end, so dragging stays responsive.
//  2) ONE STROKE = ONE ACT. godMark() is taken at mousedown, so undo rewinds the whole drag rather than one
//     sample, and the Chronicle gets a single summary line instead of one per pixel of mouse travel.
//  3) EVERY POWER IS A PAIR. Alt inverts the brush - raise/sink, rain/parch, warm/chill - so the rail carries
//     six verbs in three buttons without hiding any of them behind a menu.
// Balance-safe by construction: none of this runs inside step().
var TOOLS={
  earth: { kind:'brush', btn:'handEarth', title:'Shape land', hint:'<kbd>Drag</kbd> raise &nbsp; <kbd>Alt</kbd> sink',
           min:0.15, max:4,   step:0.05, strength:1.3,  ring:['r-earth','r-sink'] },
  moist: { kind:'brush', btn:'handMoist', title:'Rain',       hint:'<kbd>Drag</kbd> rain &nbsp; <kbd>Alt</kbd> parch',
           min:0.05, max:1.2, step:0.05, strength:0.35, ring:['r-rain','r-parch'] },
  temp:  { kind:'brush', btn:'handTemp',  title:'Warmth',     hint:'<kbd>Drag</kbd> warm &nbsp; <kbd>Alt</kbd> chill',
           min:0.05, max:1.2, step:0.05, strength:0.35, ring:['r-warm','r-chill'] },
  // Click powers: one press, one act. They carry a fixed ring radius because their reach is not the
  // player's to choose - it is the power's own (a meteor blast, a spring's basin, a seeding).
  ember: { kind:'click', btn:'handEmber',  title:'Ember',     hint:'<kbd>Click</kbd> high ground for a volcano,<br>lower for a meteor',
           radius:4, ring:['r-warm','r-warm'] },
  spring:{ kind:'click', btn:'handSpring', title:'Spring',    hint:'<kbd>Click</kbd> high ground to open<br>a headwater',
           radius:1, ring:['r-rain','r-rain'] },
  seed:  { kind:'click', btn:'handSeed',   title:'Seed life', hint:'<kbd>Click</kbd> ground. It reads the tile<br>and seeds what fits',
           radius:3, ring:['r-earth','r-earth'] }
};
var handTool='none';                  // 'none' | 'earth' | 'moist' | 'temp'
var brushSize=4;                      // shared across tools: one hand, one reach
var _stroking=false,_strokeTool='none',_lastSX=-1,_lastSY=-1,_lastSettle=0,_suppressClick=false;
var _strokeRose=false,_strokeSank=false,_strokeUp=false,_strokeDown=false;
var HAND_SETTLE_MS=90;

function refreshUndoBtn(){var b=document.getElementById('handUndo');if(b)b.disabled=!godCanUndo();}
// Each power keeps its OWN strength (a 1.3 elevation shove and a 0.35 climate nudge are not the same
// quantity), so the slider re-scales to the active tool rather than pretending one range fits all.
function _syncFlyout(){
  var t=TOOLS[handTool];if(!t)return;
  var ti=document.getElementById('flyTitle');if(ti)ti.textContent=t.title;
  var hi=document.getElementById('handHint');if(hi)hi.innerHTML=t.hint;
  var brush=(t.kind==='brush');
  var rs=document.getElementById('rowSize'),rt=document.getElementById('rowStr');
  if(rs)rs.style.display=brush?'':'none';                 // a meteor has no 'size' the player sets
  if(rt)rt.style.display=brush?'':'none';
  if(!brush)return;
  var st=document.getElementById('brushStrSlider'),so=document.getElementById('brushStrOut');
  if(st){st.min=t.min;st.max=t.max;st.step=t.step;st.value=t.strength;}
  if(so)so.textContent=t.strength.toFixed(2);
}
function setHandTool(tool){
  handTool=(handTool===tool)?'none':tool;
  if(handTool!=='none'&&placeMode!=='none')setPlaceMode('none');   // the two input modes never fight
  var rail=document.getElementById('handRail');if(rail)rail.classList.toggle('open',handTool!=='none');
  for(var k in TOOLS){var b=document.getElementById(TOOLS[k].btn);if(b)b.classList.toggle('active',handTool===k);}
  // Hide the ring on ANY switch: it carries the old tool's colour and radius until the next mousemove
  // redraws it, which reads as the wrong power being armed.
  var ring=document.getElementById('brushRing');if(ring)ring.style.display='none';
  if(handTool!=='none')_syncFlyout();
  canvas.style.cursor=handTool!=='none'?'none':(placeMode!=='none'?'cell':'crosshair');
}
function setBrushSize(n){
  brushSize=Math.max(1,Math.min(14,n|0));
  var sz=document.getElementById('brushSizeSlider'),szo=document.getElementById('brushSizeOut');
  if(sz)sz.value=brushSize;if(szo)szo.textContent=brushSize;
}
// The ring is a DOM overlay positioned in .canvas-wrap space and sized from the LIVE canvas rect, so it stays
// honest under zoom and pan (the canvas element itself is CSS-transformed by applyZoomPan). It snaps to the
// tile centre because that, not the raw cursor pixel, is what the brush actually acts on. Its colour states
// which of the pair is armed, so Alt is visible before you commit rather than after.
function updateBrushRing(ev){
  var ring=document.getElementById('brushRing');if(!ring)return;
  var wrap=canvas.parentElement;if(!wrap)return;
  var cr=canvas.getBoundingClientRect(),wr=wrap.getBoundingClientRect();
  if(!cr.width||!canvas.width)return;
  var t=screenToTile(ev.clientX,ev.clientY),scale=cr.width/canvas.width;
  var tool=TOOLS[handTool];
  var reach=(tool&&tool.kind==='click')?tool.radius:brushSize;
  var d=(reach+0.5)*2*PIX*scale;
  ring.className='brush-ring'+(tool?' '+tool.ring[ev.altKey?1:0]:'');
  ring.style.display='block';
  ring.style.width=d+'px';ring.style.height=d+'px';
  ring.style.left=(cr.left-wr.left+(t.x+0.5)*PIX*scale)+'px';
  ring.style.top=(cr.top-wr.top+(t.y+0.5)*PIX*scale)+'px';
}
function _dab(tx,ty,dir){
  var t=TOOLS[_strokeTool];if(!t)return;
  if(_strokeTool==='earth'){
    var r=brushTerrainRaw(tx,ty,dir,brushSize,t.strength);
    if(r.rose)_strokeRose=true;
    if(r.sank)_strokeSank=true;
  }else{
    var c=brushClimateRaw(tx,ty,dir,brushSize,t.strength,_strokeTool==='temp'?'temp':'moist');
    if(c.touched){ if(dir>0)_strokeUp=true;else _strokeDown=true; }   // no touch, no Chronicle line
  }
}
// Climate strokes settle far cheaper than terrain ones: the base fields are untouched, so only the live
// fields and the biome pass need redoing.
function _settle(){ if(_strokeTool==='earth')settleTerrain(); else settleClimate(); }
// One press, one act. Marked for undo exactly like a stroke, so a misfired meteor is one click back.
function handClickPower(ev){
  if(!grid)return;
  var t=screenToTile(ev.clientX,ev.clientY);if(!inb(t.x,t.y))return;
  var prevMark=godMark();
  var did=false;
  if(handTool==='ember')      did=!!emberStrike(t.x,t.y);
  else if(handTool==='spring')did=addSpring(t.x,t.y);
  else if(handTool==='seed')  did=!!seedLifeAt(t.x,t.y);
  // Nothing happened (ocean, mountain, a tile that already has a spring): put back the mark this press
  // displaced, so a misclick cannot cost the player the undo for their last real act.
  if(!did)godCancelMark(prevMark);
  _suppressClick=true;                          // a power press must not also inspect the tile
  draw();refreshUndoBtn();
}
function handStrokeStart(ev){
  if(!grid)return;
  var t=screenToTile(ev.clientX,ev.clientY);if(!inb(t.x,t.y))return;
  godMark();                                    // one mark per stroke -> undo rewinds the entire drag
  _stroking=true;_strokeTool=handTool;   // bind the stroke to the tool it began with
  _strokeRose=false;_strokeSank=false;_strokeUp=false;_strokeDown=false;
  _lastSX=t.x;_lastSY=t.y;_lastSettle=0;
  _dab(t.x,t.y,ev.altKey?-1:1);
  _settle();draw();refreshUndoBtn();
}
function handStrokeMove(ev){
  var t=screenToTile(ev.clientX,ev.clientY),dir=ev.altKey?-1:1;
  var dx=t.x-_lastSX,dy=t.y-_lastSY,n=Math.max(Math.abs(dx),Math.abs(dy));
  updateBrushRing(ev);
  if(n===0)return;                              // paint-style: travel applies the brush, holding still does not
  for(var k=1;k<=n;k++)_dab(_lastSX+Math.round(dx*k/n),_lastSY+Math.round(dy*k/n),dir);
  _lastSX=t.x;_lastSY=t.y;
  var now=(window.performance&&performance.now)?performance.now():0;
  if(now-_lastSettle>=HAND_SETTLE_MS){_settle();draw();_lastSettle=now;}
}
function handStrokeEnd(){
  if(!_stroking)return;
  var tool=_strokeTool;
  _stroking=false;_strokeTool='none';_suppressClick=true;_lastSX=-1;_lastSY=-1;
  _settle();draw();
  if(tool==='earth'){
    if(_strokeRose&&_strokeSank)chronicleNote('god','A shaping hand reworked the coastline.','#8a9a7b');
    else if(_strokeRose)chronicleNote('god','New land rose from the sea by a shaping hand.','#8a9a7b');
    else if(_strokeSank)chronicleNote('god','Land sank beneath the waves.','#3aa6e0');
  }else if(tool==='moist'){
    if(_strokeUp&&!_strokeDown)chronicleNote('god','Rain swept in, and the ground drank deep.','#58a8ff');
    else if(_strokeDown&&!_strokeUp)chronicleNote('god','The water was drawn out of the ground.','#e8a838');
    else if(_strokeUp)chronicleNote('god','The pattern of the rains was rewritten.','#58a8ff');
  }else if(tool==='temp'){
    if(_strokeUp&&!_strokeDown)chronicleNote('god','A warmth settled over the land.','#e86048');
    else if(_strokeDown&&!_strokeUp)chronicleNote('god','A deep cold crept across the land.','#48ced0');
    else if(_strokeUp)chronicleNote('god','The temper of the air was rewritten.','#48ced0');
  }
  refreshUndoBtn();
}
function doGodUndo(){ if(godUndo())draw(); refreshUndoBtn(); }   // refresh either way: a Reset clears the mark

// The Hand: rail buttons + the brush flyout. Registered here, AFTER the state above is assigned - `var` hoists
// the declaration but not the value, and this block reads those values immediately.
hook('handEarth',function(){setHandTool('earth');});
hook('handMoist',function(){setHandTool('moist');});
hook('handTemp', function(){setHandTool('temp');});
hook('handEmber', function(){setHandTool('ember');});
hook('handSpring',function(){setHandTool('spring');});
hook('handSeed',  function(){setHandTool('seed');});
// The sea is a world-scale act, not a pointer tool: it fires from the rail and is undoable like the rest.
function seaLevel(dir){ if(!grid)return; godMark(); shiftSeaLevel(dir); draw(); refreshUndoBtn(); }
hook('handSeaUp',  function(){seaLevel(1);});
hook('handSeaDown',function(){seaLevel(-1);});
// The laws of the world: the SAME sliders the cockpit has, made reachable from Viewer. Nothing is copied.
hook('handLaws',function(){
  var open=document.body.classList.toggle('laws-open');
  var b=document.getElementById('handLaws');if(b)b.classList.toggle('active',open);
  if(document.body.classList.contains('mode-viewer'))fitCanvas();   // the map lost/gained the sidebar's width
  draw();
});
hook('handUndo',doGodUndo);
(function(){
  var sz=document.getElementById('brushSizeSlider'),szo=document.getElementById('brushSizeOut');
  if(sz&&szo){sz.value=brushSize;szo.textContent=brushSize;sz.addEventListener('input',function(e){brushSize=parseInt(e.target.value,10);szo.textContent=brushSize;});}
  var st=document.getElementById('brushStrSlider'),sto=document.getElementById('brushStrOut');
  if(st&&sto){st.addEventListener('input',function(e){var t=TOOLS[handTool];var v=parseFloat(e.target.value);if(t)t.strength=v;sto.textContent=v.toFixed(2);});}
})();

canvas.addEventListener('click',function(ev){if(!grid)return;
  if(_suppressClick){_suppressClick=false;return;}var tile=screenToTile(ev.clientX,ev.clientY);var x=tile.x,y=tile.y;
  if((placeMode==='raise'||placeMode==='lower')&&inb(x,y)){brushTerrain(x,y,placeMode==='raise'?1:-1);draw();return;}
  if(placeMode!=='none'&&inb(x,y)){var ti=idx(x,y);var t=grid[ti];if(t!==T.OCEAN&&t!==T.MOUNTAIN&&t!==T.VOLCANIC){fauna.push(makeFauna(x,y,placeMode,null));draw();}return;}
  lastClick={x:x,y:y};inspectTile(x,y);});
canvas.addEventListener('mousemove',function(ev){
  if(isPanning){
    var dx=ev.clientX-panStartX,dy=ev.clientY-panStartY;
    panX=panStartPX+dx/zoomLevel;panY=panStartPY+dy/zoomLevel;
    applyZoomPan();return;
  }
  if(_stroking){handStrokeMove(ev);return;}
  if(handTool!=='none'){updateBrushRing(ev);}
  updateTooltip(ev);
});
canvas.addEventListener('mouseleave',function(){var t=document.getElementById('tip');if(t)t.style.display='none';
  var ring=document.getElementById('brushRing');if(ring&&!_stroking)ring.style.display='none';});

// Zoom: mouse wheel
canvas.addEventListener('wheel',function(ev){
  ev.preventDefault();
  var oldZ=zoomLevel;
  if(ev.deltaY<0)zoomLevel=Math.min(ZOOM_MAX,zoomLevel*(1+ZOOM_STEP));
  else zoomLevel=Math.max(ZOOM_MIN,zoomLevel*(1-ZOOM_STEP));
  // Zoom toward cursor position
  var r=canvas.getBoundingClientRect();
  var cx=(ev.clientX-r.left)/r.width-0.5;
  var cy=(ev.clientY-r.top)/r.height-0.5;
  var scaleDelta=zoomLevel/oldZ;
  panX=panX-(cx*canvas.width*(scaleDelta-1))/zoomLevel;
  panY=panY-(cy*canvas.height*(scaleDelta-1))/zoomLevel;
  applyZoomPan();
  var zEl=document.getElementById('hZoom');if(zEl)zEl.textContent=Math.round(zoomLevel*100)+'%';
},{passive:false});

// Pan: right-click drag
canvas.addEventListener('mousedown',function(ev){
  _suppressClick=false;   // never let a stale suppress-flag from a drag released off-canvas eat a click
  if(ev.button===0&&handTool!=='none'){
    ev.preventDefault();
    var tl=TOOLS[handTool];
    if(tl&&tl.kind==='click')handClickPower(ev); else handStrokeStart(ev);
    return;
  }
  if(ev.button===2){ev.preventDefault();isPanning=true;panStartX=ev.clientX;panStartY=ev.clientY;panStartPX=panX;panStartPY=panY;canvas.style.cursor='grabbing';}
});
window.addEventListener('mouseup',function(ev){
  if(_stroking&&ev.button===0)handStrokeEnd();
  if(isPanning){isPanning=false;canvas.style.cursor=handTool!=='none'?'none':(placeMode!=='none'?'cell':'crosshair');}
});
canvas.addEventListener('contextmenu',function(ev){ev.preventDefault();});

// Double-click: reset zoom/pan
canvas.addEventListener('dblclick',function(ev){
  if(zoomLevel!==1||panX!==0||panY!==0){ev.preventDefault();ev.stopPropagation();resetZoomPan();}
});

// Climate hooks
var seasonalToggleEl=document.getElementById('seasonalToggle');if(seasonalToggleEl)seasonalToggleEl.addEventListener('change',function(e){CFG.seasonalTilt=e.target.checked;});
var anomalyToggleEl=document.getElementById('anomalyToggle');if(anomalyToggleEl)anomalyToggleEl.addEventListener('change',function(e){CFG.anomalies=e.target.checked;});
var volcanoToggleEl=document.getElementById('volcanoToggle');if(volcanoToggleEl)volcanoToggleEl.addEventListener('change',function(e){CFG.volcanoAsh=e.target.checked;});
var climateIntensityEl=document.getElementById('climateIntensity'),climateIntensityOutEl=document.getElementById('climateIntensityOut');
if(climateIntensityEl&&climateIntensityOutEl){climateIntensityEl.value=CFG.climateIntensity;climateIntensityOutEl.textContent=CFG.climateIntensity.toFixed(2);climateIntensityEl.addEventListener('input',function(e){CFG.climateIntensity=parseFloat(e.target.value);climateIntensityOutEl.textContent=CFG.climateIntensity.toFixed(2);});}
var climateSeasonLenEl=document.getElementById('climateSeasonLen'),climateSeasonLenOutEl=document.getElementById('climateSeasonLenOut');
if(climateSeasonLenEl&&climateSeasonLenOutEl){climateSeasonLenEl.value=CFG.climateSeasonLength;climateSeasonLenOutEl.textContent=CFG.climateSeasonLength;climateSeasonLenEl.addEventListener('input',function(e){CFG.climateSeasonLength=parseInt(e.target.value);climateSeasonLenOutEl.textContent=CFG.climateSeasonLength;});}

// Ecology hooks
(function(){
  var ecoEl=document.getElementById('ecoToggle');if(ecoEl)ecoEl.addEventListener('change',function(e){CFG.ecoActive=e.target.checked;});
  var ecoREl=document.getElementById('ecoRenderToggle');if(ecoREl)ecoREl.addEventListener('change',function(e){CFG.ecoRender=e.target.checked;draw();});
  var fcEl=document.getElementById('floraTileCapSlider'),fcOut=document.getElementById('floraTileCapOut');
  if(fcEl&&fcOut){fcEl.value=CFG.floraPerTileMax;fcOut.textContent=CFG.floraPerTileMax;fcEl.addEventListener('input',function(e){CFG.floraPerTileMax=parseInt(e.target.value);fcOut.textContent=CFG.floraPerTileMax;});}
  var fsEl=document.getElementById('floraSpawnSlider'),fsOut=document.getElementById('floraSpawnOut');
  if(fsEl&&fsOut){fsEl.value=CFG.floraSpawnChance;fsOut.textContent=CFG.floraSpawnChance.toFixed(3);fsEl.addEventListener('input',function(e){CFG.floraSpawnChance=parseFloat(e.target.value);fsOut.textContent=CFG.floraSpawnChance.toFixed(3);});}
  var ftEl=document.getElementById('floraThinSlider'),ftOut=document.getElementById('floraThinOut');
  if(ftEl&&ftOut){ftEl.value=CFG.floraLandThin;ftOut.textContent=Math.round(CFG.floraLandThin*100)+'%';ftEl.addEventListener('input',function(e){CFG.floraLandThin=parseFloat(e.target.value);ftOut.textContent=Math.round(CFG.floraLandThin*100)+'%';draw();});}
  var fwEl=document.getElementById('floraWaterSlider'),fwOut=document.getElementById('floraWaterOut');
  if(fwEl&&fwOut){fwEl.value=CFG.floraWaterDistPenalty;fwOut.textContent=CFG.floraWaterDistPenalty.toFixed(2);fwEl.addEventListener('input',function(e){CFG.floraWaterDistPenalty=parseFloat(e.target.value);fwOut.textContent=CFG.floraWaterDistPenalty.toFixed(2);draw();});}
  var fdEl=document.getElementById('floraDesertSlider'),fdOut=document.getElementById('floraDesertOut');
  if(fdEl&&fdOut){fdEl.value=CFG.floraMoisturePenalty;fdOut.textContent=CFG.floraMoisturePenalty.toFixed(2);fdEl.addEventListener('input',function(e){CFG.floraMoisturePenalty=parseFloat(e.target.value);fdOut.textContent=CFG.floraMoisturePenalty.toFixed(2);draw();});}
  var faEl=document.getElementById('faunaSpawnSlider'),faOut=document.getElementById('faunaSpawnOut');
  if(faEl&&faOut){faEl.value=CFG.faunaSpawnChance;faOut.textContent=CFG.faunaSpawnChance.toFixed(3);faEl.addEventListener('input',function(e){CFG.faunaSpawnChance=parseFloat(e.target.value);faOut.textContent=CFG.faunaSpawnChance.toFixed(3);});}
  var muEl=document.getElementById('mutationSlider'),muOut=document.getElementById('mutationOut');
  if(muEl&&muOut){muEl.value=CFG.floraMutationChance;muOut.textContent=Math.round(CFG.floraMutationChance*100)+'%';muEl.addEventListener('input',function(e){var v=parseFloat(e.target.value);CFG.floraMutationChance=v;CFG.faunaMutationChance=v;muOut.textContent=Math.round(v*100)+'%';});}
  var mbEl=document.getElementById('mutBiasSlider'),mbOut=document.getElementById('mutBiasOut');
  if(mbEl&&mbOut){mbEl.value=CFG.floraMutationBias;mbOut.textContent=Math.round(CFG.floraMutationBias*100)+'%';mbEl.addEventListener('input',function(e){CFG.floraMutationBias=parseFloat(e.target.value);mbOut.textContent=Math.round(CFG.floraMutationBias*100)+'%';});}
})();

// Legend tooltips
(function(){
  var ltip=document.getElementById('legendTip');if(!ltip)return;
  var grid=document.querySelector('.legend-grid');if(!grid)return;
  grid.addEventListener('mouseover',function(ev){
    var li=ev.target.closest('.li[data-ltip]');if(!li)return;
    var raw=li.getAttribute('data-ltip');if(!raw)return;
    var parts=raw.split('|');var desc=parts[0]||'';var vars=parts[1]||'';
    var swatch=li.querySelector('.lsw');var swStyle=swatch?swatch.getAttribute('style'):'';
    var name=li.textContent.trim();
    var html='<div class="lt-title"><span class="lt-swatch" style="'+swStyle+'"></span>'+name+'</div>';
    html+='<p class="lt-desc">'+desc+'</p>';
    if(vars)html+='<p class="lt-vars">'+vars+'</p>';
    ltip.innerHTML=html;
    var r=li.getBoundingClientRect();var tw=ltip.offsetWidth||200;
    var left=r.left-tw-10;if(left<8)left=r.right+10;
    var top=r.top;if(top+ltip.offsetHeight>window.innerHeight-8)top=window.innerHeight-ltip.offsetHeight-8;
    ltip.style.left=left+'px';ltip.style.top=top+'px';ltip.style.display='block';
  });
  grid.addEventListener('mouseout',function(ev){
    var li=ev.target.closest('.li[data-ltip]');if(!li)return;
    ltip.style.display='none';
  });
})();

// Deck tooltips: styled like the map/legend tooltips (replaces the native title= hints on the dashboard).
// data-tip="Title|Description", optional data-tipk="Hotkey". Delegated on both decks, positioned BELOW the
// hovered control (the deck sits at the top of the screen), clamped to the viewport.
(function(){
  var tip=document.getElementById('deckTip');if(!tip)return;
  // The tool rail carries data-tip too, but it lives in .canvas-wrap and is NOT a .deck - bind it
  // explicitly or its ten tooltips never fire, which is what happened from the rail shipping until
  // 2026-08-21. Verified: hovering a rail button left #deckTip display:none while a deck button showed it.
  var decks=document.querySelectorAll('.deck, .hand-rail');if(!decks.length)return;
  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function show(el){
    var raw=el.getAttribute('data-tip');if(!raw)return;
    var parts=raw.split('|'),title=parts[0]||'',desc=parts[1]||'',key=el.getAttribute('data-tipk');
    var html='<div class="dt-title"><span>'+esc(title)+'</span>'+(key?'<span class="dt-key">'+esc(key)+'</span>':'')+'</div>';
    if(desc)html+='<p class="dt-desc">'+esc(desc)+'</p>';
    tip.innerHTML=html;tip.style.display='block';
    var r=el.getBoundingClientRect(),tw=tip.offsetWidth||180,th=tip.offsetHeight,left,top;
    if(el.closest('.hand-rail')){
      // The rail is a vertical strip on the left edge; a tip BELOW it would cover the next button.
      left=r.right+10; top=r.top+r.height/2-th/2;
      if(left+tw>window.innerWidth-8)left=r.left-tw-10;   // mirror to the left if it would overflow
    }else{
      left=r.left+r.width/2-tw/2;                          // the decks sit at the top: tip goes below
      top=r.bottom+8; if(top+th>window.innerHeight-8)top=r.top-th-8;
    }
    if(left<8)left=8; if(left+tw>window.innerWidth-8)left=window.innerWidth-tw-8;
    if(top<8)top=8;   if(top+th>window.innerHeight-8)top=window.innerHeight-th-8;
    tip.style.left=left+'px';tip.style.top=top+'px';
  }
  function hide(){tip.style.display='none';}
  decks.forEach(function(deck){
    deck.addEventListener('mouseover',function(e){var el=e.target.closest('[data-tip]');if(el&&deck.contains(el))show(el);});
    deck.addEventListener('mouseout',function(e){var el=e.target.closest('[data-tip]');if(!el)return;if(!el.contains(e.relatedTarget))hide();});
  });
})();

// Hotkeys
window.addEventListener('keydown',function(e){
  if((e.target||{}).id==='kAskIn')return;   // keys typed into the question bar are the bar's (Enter answers, Esc declines), F5 and F9 included
  var tag=(e.target||{}).tagName||'';
  if(/INPUT|SELECT|TEXTAREA/.test(tag)){if(K&&(e.key==='F5'||e.key==='F9'||((tag==='SELECT'||(e.target||{}).type==='range')&&e.key!=='Tab'&&!/^(Shift|Control|Alt|Meta)$/.test(e.key)))){e.target.blur();ketchemKey(e);}return;}   // F5 must never reload an unsaved game because a slider had focus; on a board a focused select or slider gives the keys back to the game
  if(K){if(guestKey(e))return;if(ketchemKey(e))return;if(e.ctrlKey||e.metaKey||e.altKey)return;}   // a board is up: the keys are Kevin's character's, and a browser chord (Ctrl+R, Ctrl+F) is the browser's, never the page's reset
  if(e.code==='Space'){e.preventDefault();running=!running;if(running)loop();}
  else if(e.key==='s'||e.key==='S'){e.preventDefault();running=false;step();draw();}
  else if(e.key==='r'||e.key==='R'){e.preventDefault();running=false;init();buildSliders();applyElevationIntensity();draw();}
  else if(e.key==='f'||e.key==='F'){e.preventDefault();running=true;started=false;boot();}
  else if((e.key==='z'||e.key==='Z')&&(e.ctrlKey||e.metaKey)){e.preventDefault();if(!_stroking)doGodUndo();}
  else if(e.key==='t'||e.key==='T'){e.preventDefault();runTests();}
  else if(e.key==='1'){e.preventDefault();setHandTool('earth');}
  else if(e.key==='2'){e.preventDefault();setHandTool('moist');}
  else if(e.key==='3'){e.preventDefault();setHandTool('temp');}
  else if(e.key==='4'){e.preventDefault();setHandTool('ember');}
  else if(e.key==='5'){e.preventDefault();setHandTool('spring');}
  else if(e.key==='6'){e.preventDefault();setHandTool('seed');}
  else if(e.key==='e'||e.key==='E'){e.preventDefault();setHandTool('earth');}   // alias, kept from slice 1
  else if(e.key==='['){e.preventDefault();setBrushSize(brushSize-1);}
  else if(e.key===']'){e.preventDefault();setBrushSize(brushSize+1);}
});

// ===== Sliders =====
var SLIDER_SCHEMA=[
  {key:'volcanoChancePerTile',min:0,max:0.0005,step:0.00001,label:'Volcano Chance'},
  {key:'coastalSpreadBase',min:0,max:0.01,step:0.0001,label:'Coastal Spread'},
  {key:'erosionChanceBase',min:0,max:0.01,step:0.0001,label:'Erosion Rate'},
  {key:'maxLandCap',min:0.2,max:0.9,step:0.01,label:'Max Land Cap'},
  {key:'elevationIntensity',min:0.5,max:1.5,step:0.05,label:'Elevation Intensity'},
  // River Density: inverted (drag right = denser = lower threshold) and regen='rivers' (re-runs generateRivers live).
  {key:'riverAccumThreshold',min:3,max:40,step:1,label:'River Density',invert:true,regen:true}
];
function decimalsForStep(step){var s=String(step);var dot=s.indexOf('.');return dot>=0?(s.length-dot-1):0;}
function buildSliders(){
  var host=document.getElementById('sliders');if(!host)return;host.innerHTML='';
  SLIDER_SCHEMA.forEach(function(s){
    var row=document.createElement('div');row.className='p-row';
    var lab=document.createElement('label');lab.textContent=s.label;
    var input=document.createElement('input');input.type='range';input.min=s.min;input.max=s.max;input.step=s.step;input.value=s.invert?(s.min+s.max-CFG[s.key]):CFG[s.key];
    var out=document.createElement('span');out.className='val';
    function fmt(v){return Number(v).toFixed(decimalsForStep(s.step));}
    out.textContent=fmt(CFG[s.key]);
    input.addEventListener('input',function(e){var raw=parseFloat(e.target.value);var val=s.invert?(s.min+s.max-raw):raw;CFG[s.key]=val;out.textContent=fmt(val);if(s.key==='elevationIntensity')applyElevationIntensity();if(s.regen&&riverGenerated){generateRivers();computeAridity();applyClimate();reclassTerrain();}draw();});
    row.appendChild(lab);row.appendChild(input);row.appendChild(out);host.appendChild(row);
  });
}
// ======================================================================
//  SPECIES NAMING SYSTEM
// ======================================================================
function draw(){
  if(!ctx||!grid||!elev)return;
  drawWorld(ctx,PIX,{overlayMode:overlayMode,followId:followId,ground:K?_kGround:null,top:K?_kTop:null});
  if(K){kevinCamera();drawEncounters(ctx,PIX,K);drawPlayers(ctx,PIX,K);}   // tags, rings, baits and animations, then the characters, over the fog
  visitDraw(ctx,PIX);   // Root's body, sight and named places; no-op unless Root is here
  hudTick(K);           // the HUD bar and the party rows (DOM); hidden without a board
  if(_kProgress)drawBoardProgress();
  drawHUD();renderChronicle();renderObjective();renderSpecies();renderFoodWeb();updateFollow();
}

// ===== Ketch'em: the board (step 3, 2026-10-24) =====
// K is the board (src/ketchem/board.js): stores, signposts, landmarks, starts and the shared fog. It is built in a
// Worker on a copy of the sim and arrives as a snapshot; while it builds, the page shows a progress line on the canvas.
// Reached for now through ?ketchem=<setting>[&kseed=N][&ksize=96]; the launch card entry is step 4.
var K=null,_kWorker=null,_kProgress=null;
// Anything that regenerates the world under a board takes the board down first (a scenario, a JSON load; init() does its own).
function leaveBoard(){if(!K&&!_kProgress)return;abandonBuild();K=null;document.body.classList.remove('ketchem');closePanel();closeAsk();hudTick(null);}
function _kGround(c,p){drawKetchemGround(c,p,K);}
function _kTop(c,p){drawFog(c,p,K);}
function getKetchemParam(){
  if(typeof location==='undefined'||!location.search)return null;
  var m=/[?&]ketchem=(\w+)/.exec(location.search);if(!m)return null;
  var seedM=/[?&]kseed=(\d+)/.exec(location.search),sizeM=/[?&]ksize=(\d+)/.exec(location.search);
  return {setting:m[1],seed:seedM?+seedM[1]:undefined,size:sizeM?+sizeM[1]:96};
}
var _pendingKetchem=getKetchemParam();
// Kevin's character on the keys (mechanics 22.1): WASD or arrows, two keys for a diagonal, Shift for a whole stride,
// E reads what he stands on, V swaps the camera between him and Root. With a board up these keys are the game's and
// the Hand's hotkeys are off; R, F, T and Ctrl+Z stay the page's.
var _kPressed={},_kCamAt=null;
var KEYDIR={w:[0,-1],a:[-1,0],s:[0,1],d:[1,0],arrowup:[0,-1],arrowleft:[-1,0],arrowdown:[0,1],arrowright:[1,0]};
// After Kevin moves: the store panel closes off its tile; stepping onto a store autosaves a named game (18.2).
var _kOnStore=false;
function kevinMoved(){
  var on=!!storeAt(K,K.kevin);
  if(!on&&panelOpen()&&_kPanelOwner===K.kevin)closePanel();
  if(on&&!_kOnStore&&K.slot)saveGame();
  _kOnStore=on;
}
function kevinSay(text){var p=K&&K.kevin;if(!p)return;p.msg=text;p.msgUntil=Date.now()+4000;}
function kevinCamera(){
  if(!K||zoomLevel<=1)return;
  var t=(K.cam==='root'&&K.root)?K.root:K.kevin;if(!t)return;
  var at=t.x+','+t.y;if(at===_kCamAt)return;_kCamAt=at;centerOnTile(t.x,t.y);
}
function ketchemKey(e){
  var p=K.kevin;if(!p)return false;
  if(e.ctrlKey||e.metaKey||e.altKey)return false;   // browser and page chords (copy, undo, reload) stay theirs
  var k=String(e.key||'').toLowerCase();
  if(e.repeat&&(k==='tab'||k===' '||e.code==='Space'||k==='f'||k==='n'||k==='b'||k==='p'||k==='g'||k==='m'||k==='c'||k==='e'||k==='i'||k==='o'||k==='t')){e.preventDefault();return true;}   // an act is one press, never an auto-repeat
  if(_kPotion){   // P then a digit: the Nth potion in the pack; a thrown or creature potion wants the target
    e.preventDefault();_kPotion=false;
    if(/^[1-9]$/.test(k)){var names=Object.keys(packSummary(p).potions);var pn=names[+k-1];if(!pn){kevinSay('no potion '+k);draw();return true;}
      var tgt=p.target?fauna.find(function(a){return a&&a.id===p.target;}):null;
      if(pn==='Musk'){ask('Musk for which type? herbivore, carnivore, omnivore, scavenger, apex','herbivore').then(function(t){if(t===null||!K)return;kevinSay(usePotion(K,K.kevin,'Musk',t).text);draw();});return true;}
      if(POTIONS[pn]&&POTIONS[pn].kind==='creature'){   // Tonic and the shards: which party creature?
        if(!p.party.length){kevinSay(pn+' wants a party creature');draw();return true;}
        ask(pn+' on which party creature? '+p.party.map(function(c){return c.name||c.type;}).join(', '),p.party[0].name||p.party[0].type).then(function(w){if(w===null||!K)return;var c=K.kevin.party.find(function(x){return (x.name||x.type).toLowerCase()===w.toLowerCase();});kevinSay(c?usePotion(K,K.kevin,pn,c).text:'no "'+w+'" in the party');draw();});return true;}
      var rp=usePotion(K,p,pn,tgt);kevinSay(rp.text);}
    else kevinSay('potion: cancelled');
    draw();return true;
  }
  if(_kBait){   // B then a kind, then a direction (22.2)
    e.preventDefault();
    if(k==='escape'){_kBait=null;kevinSay('bait: cancelled');draw();return true;}
    if(!_kBait.kind){var kind={p:'plant',s:'scatter',m:'meat',t:'stake'}[k];if(kind){_kBait.kind=kind;kevinSay('bait '+kind+': which way? (WASD, or E for here with a plant)');}draw();return true;}
    var dirName=KEYDIR[k]?dirOf(KEYDIR[k]):(k==='e'?'':null);
    if(dirName!==null){var rb=placeBait(K,p,_kBait.kind,dirName,null);kevinSay(rb.text);_kBait=null;}
    draw();return true;
  }
  if(KEYDIR[k]){
    e.preventDefault();
    if(e.repeat)return true;                  // the loop repeats a held key; the OS repeat would double it
    _kPressed[k]=tick;                        // when it was pressed: the loop repeats it only from the next tick
    var dx=0,dy=0;for(var q in KEYDIR){if(_kPressed[q]!==undefined){dx+=KEYDIR[q][0];dy+=KEYDIR[q][1];}}
    dx=Math.sign(dx);dy=Math.sign(dy);if(!dx&&!dy)return true;
    if(e.shiftKey){strideStep(K,p,dx,dy);}
    else{var r=tryStep(K,p,dx,dy);if(!r.ok&&r.why!=='winded')kevinSay(r.why);}
    kevinMoved();draw();return true;
  }
  if(k==='e'){e.preventDefault();if(storeAt(K,p)){openStore();return true;}var pk=pickPlant(K,p);kevinSay(pk.ok?pk.text:interact(K,p).text);draw();return true;}
  if(k==='c'){e.preventDefault();if(storeAt(K,p))openStore('box');else kevinSay('the cabinet is at a store');draw();return true;}
  if(k==='p'){e.preventDefault();var ps=packSummary(p);var pl=Object.keys(ps.potions);if(!pl.length){kevinSay('no potions in the pack');draw();return true;}_kPotion=true;kevinSay('potion: '+pl.map(function(n,i){return (i+1)+' '+n+' x'+ps.potions[n];}).join(', '));draw();return true;}
  if(k==='i'){e.preventDefault();var pi=packSummary(p);kevinSay('pack '+pi.used+'/'+pi.cap+': '+pi.plants+' plants'+(Object.keys(pi.potions).length?', '+Object.entries(pi.potions).map(function(x){return x[0]+' x'+x[1];}).join(', '):'')+(pi.gear.length?'; worn: '+pi.gear.join(', '):''));draw();return true;}
  if(k==='m'){e.preventDefault();if(panelOpen())closePanel();else{_kPanelOwner=K.kevin;almanacPanel(almanacLists(K,p));}return true;}
  if(k==='g'){e.preventDefault();ask(giveQ(seatName(K)),'coins 10').then(function(gw){if(gw===null||!K)return;kevinSay(giveSaid(K,K.kevin,gw).text);draw();});return true;}
  if(k==='o'){e.preventDefault();kevinSay('sound '+(toggleSound()?'on':'off'));draw();return true;}
  if(k==='v'){e.preventDefault();K.cam=(K.cam==='root')?'kevin':'root';_kCamAt=null;draw();return true;}
  if(k==='tab'){e.preventDefault();kevinCycleTarget();draw();return true;}
  if(k===' '||e.code==='Space'){e.preventDefault();kevinThrow();draw();return true;}
  if(k==='1'||k==='2'||k==='3'){e.preventDefault();p.stone=['Amber','Geode','Obsidian'][+k-1];kevinSay(p.stone+' in hand ('+p.stones[['amber','geode','obsidian'][+k-1]]+')');draw();return true;}
  if(k==='b'){e.preventDefault();_kBait={kind:null};kevinSay('bait: P plant, S scatter, M meat, T stake');draw();return true;}
  if(k==='f'){e.preventDefault();var rf=p.follower?recall(K,p):follow(K,p,null);kevinSay(rf.text);draw();return true;}
  if(k==='n'){e.preventDefault();kevinName();draw();return true;}
  if(k==='t'){e.preventDefault();ask(FEED_Q,(p.party[0]&&(p.party[0].name||p.party[0].type))||'').then(function(fw){if(fw===null||!K)return;kevinSay(feedSaid(K,K.kevin,fw).text);draw();});return true;}
  if(k==='f5'){e.preventDefault();saveGame();return true;}
  if(k==='f9'){e.preventDefault();_kMenu().toggle();return true;}
  if(k==='escape'||k==='enter'||k==='t'||/^f\d+$/.test(k))return false;   // R is NOT let through: it would reset the world under both players (the Reset button still does)
  e.preventDefault();return true;   // Space, 1-6, [ ], E, R: the Hand is off on a board
}
// Acting (22.2): Tab cycles the target among creatures within 2 tiles, a click picks one, Space throws the stone in
// hand at it, 1 / 2 / 3 pick the stone, B then P / S / M / T then a direction baits, F lets the follower out or
// recalls it, N names the last catch, E picks the plant underfoot (else reads what is there).
var _kBait=null,_kPotion=false;
// The give and feed questions, the same for Kevin (G, T) and the guest (H, U).
function giveQ(to){return 'Give '+to+' what? coins N, Amber N, a potion name, plant, or a party creature name';}
var FEED_Q='Feed which party creature, and what? "Goat" feeds it the first plant in the pack; "Wolf, Snack" feeds Wolf the party creature Snack';
// The store (E or C on a store tile): BUY / SELL / BOX; entering autosaves (18.2).
var _kPanelOwner=null;   // whose store panel is open: Kevin's moves close only his, the guest's only theirs
function openStore(tab,who){
  var p=who||K.kevin;if(!storeAt(K,p))return;var say=p===K.kevin?kevinSay:guestSay;_kPanelOwner=p;
  storePanel({lists:function(){var s=storeAt(K,p);if(!s){closePanel();return {store:'',wallet:p.wallet,buy:[],sell:[],plants:[],box:[],party:[],pen:[],fee:function(){return 0;}};}return shopLists(K,p,s);},buy:function(item,qty){var r=buyItem(K,p,item,qty);say(r.text);return r;},sell:function(name){var r=sellItem(K,p,name);say(r.text);return r;},
    sellPlants:function(){var r=sellItem(K,p,'plants');say(r.text);return r;},box:function(name,take){var r=boxItem(K,p,name,take);say(r.text);return r;},breed:function(a,b){var r=breedPair(K,p,a,b);say(r.text);return r;},send:p===K.kevin?sendCreature:null,onChange:draw},tab||'buy');   // the saves are Kevin's: only he sends
  draw();
}
// Trading between saves (mechanics 24): a cabinet creature goes to another saved game's cabinet. Everything that can
// refuse is checked before anything changes (this game has a name, the creature is still in the cabinet and has its
// name, the other save is readable and of this version, the copy can be made). Then the two IndexedDB writes run back
// to back, this game without the creature first, so no copy survives in two places; the relay mirrors after both.
// A failed second write puts the creature back and saves this game again before saying so.
var _kSending=false;
function sendCreature(id){
  if(!K||_kSending)return;var K0=K,c=K.cabinet.find(function(x){return x.id===id;});if(!c)return;var nm=c.name||c.type;
  if(!K.slot){kevinSay('save this game first (F5), then send');draw();return;}   // naming it mid-send could pick the other save's name
  if(K.kevin.naming===c.id||(K.kevin.namingQueue||[]).indexOf(c.id)>=0){kevinSay('name "'+nm+'" first (N), then send it');draw();return;}
  _kSending=true;
  var stillHere=function(){return K===K0&&K.cabinet.indexOf(c)>=0;};
  listSlots().then(function(slots){
    var others=slots.map(function(m){return m.slot;}).filter(function(s){return s!==K0.slot;});
    if(!others.length){kevinSay('no other saved game to send "'+nm+'" to (F9 lists them)');draw();return;}
    return ask('Send "'+nm+'" to which saved game? '+others.join(', '),others[0]).then(function(to){
      if(to===null)return;var slot=others.find(function(s){return s.toLowerCase()===to.toLowerCase();});
      if(!slot){kevinSay('no saved game called "'+to+'"');draw();return;}
      return getSlot(slot).then(function(data){
        if(!stillHere()){kevinSay('not sent: "'+nm+'" left the cabinet while you chose');draw();return;}
        if(!data)throw new Error('the save "'+slot+'" is gone');
        if(data.version!==SAVE_VERSION)throw new Error('the save "'+slot+'" is from another version of the game');
        var sent=addToRecordCabinet(data,c,K0.slot);   // throws on a damaged record: nothing has changed yet
        K.cabinet=K.cabinet.filter(function(x){return x!==c;});
        var mine=buildSave(K,K.slot);
        return putSlot(mine).then(function(){
          return putSlot(data).catch(function(e){   // the other save refused: back it comes, and this game is saved with it
            K0.cabinet.push(c);return putSlot(buildSave(K0,K0.slot)).then(function(){throw e;},function(e2){throw new Error(e.message+'; and this game could not be saved again ('+e2.message+'), so F5 now');});
          });
        },function(e){K0.cabinet.push(c);throw e;}).then(function(){
          mirrorSave(mine);mirrorSave(data);   // best effort, after both writes (18.1)
          kevinSay('"'+nm+'" went to the cabinet of "'+slot+'"'+(sent.name!==c.name?' as "'+sent.name+'" (that name was taken there)':''));
          if(K===K0&&panelOpen())openStore('box');draw();
        });
      });
    });
  }).catch(function(e){showErr('Send failed: '+e.message);draw();}).finally(function(){_kSending=false;});
}
function dirOf(d){return (d[1]<0?'N':d[1]>0?'S':'')+(d[0]<0?'W':d[0]>0?'E':'');}
// Acting for either seat: p is K.kevin or the guest in K.root; say is that player's bubble.
function cycleTargetFor(p,say){
  var list=targetsNear(K,p,2);if(!list.length){p.target=null;say('nothing within 2 tiles');return;}
  var i=list.findIndex(function(f){return f.id===p.target;});p.target=list[(i+1)%list.length].id;
}
function throwFor(p,say,hint){
  var f=p.target?fauna.find(function(a){return a&&a.id===p.target;}):null;
  if(f&&Math.max(Math.abs(f.x-p.x),Math.abs(f.y-p.y))>1)f=null;   // the target has moved off: the nearest adjacent creature instead
  if(!f){var near=targetsNear(K,p,1);if(near.length){f=near[0];p.target=f.id;}}
  if(!f){say('no target: '+hint);return;}
  var r=throwStone(K,p,f,p.stone);var ev=r.caught?catchXP(K,p,r.creature,r.level):[];say(r.text+eventsText(ev));if(r.caught){p.target=null;}
}
function nameFor(p,say,key,offer){   // offer: a name to start from (a pad cannot type)
  var K0=K;
  if(!p.naming&&p.namingSpecies){askFor(p,(p===K.kevin?'':(p.display||'Guest')+': ')+'your creature evolved into a new species. Name the species','').then(function(sn){if(sn===null||K!==K0)return;say(nameCatch(K,p,sn).text);draw();});return;}
  if(!p.naming){say('nothing to name');return;}
  var c=p.party.concat(K.cabinet).find(function(x){return x.id===p.naming;}),nid=p.naming;
  askFor(p,(p===K.kevin?'':(p.display||'Guest')+': ')+'name your '+(c?c.type:'catch')+(p.namingQueue&&p.namingQueue.length?' ('+(p.namingQueue.length+1)+' waiting)':'')+'; after a comma, a nickname for its species',offer||'').then(function(name){if(name===null||K!==K0)return;if(p.naming!==nid){say('that one left your hands before you named it; '+key+' names the next');draw();return;}var parts=name.split(',');say(nameCatch(K,p,parts[0],parts[1]&&parts[1].trim()).text);draw();});
}
function kevinCycleTarget(){cycleTargetFor(K.kevin,kevinSay);}
function kevinThrow(){throwFor(K.kevin,kevinSay,'Tab or click a creature within 2 tiles');}
function kevinName(){nameFor(K.kevin,kevinSay,'N');}

// ===== The guest in the second seat (mechanics 25): the arrows and the keys on the right of the keyboard =====
// arrows move (held keys repeat), . next target, / throw, [ ] the stone, ' name, ; pick / read / the store,
// , follow or recall, L then a digit a potion or a shard, K the pack, J bait (a digit for the kind, then an arrow or ;
// for here), H give to Kevin, U feed, Y the Almanac. Kevin keeps WASD and his letters.
var GKEYDIR={arrowup:[0,-1],arrowleft:[-1,0],arrowdown:[0,1],arrowright:[1,0]};
var _gPressed={},_gPotion=false,_gBait=null,_gAlmanac=false,_guestCarry=null;   // _gBait: { kind, at } while J waits for a kind and a tile; _gAlmanac: a remote guest's Almanac text is on   // _guestCarry: the seated guest's name, so a new board or a load seats them again
function guestSay(text){var g=K&&K.root;if(!g)return;g.msg=text;g.msgUntil=Date.now()+4000;}
function guestMoved(){var g=K.root;if(!storeAt(K,g)&&panelOpen()&&_kPanelOwner===g){closePanel();_kPanelOwner=null;}}
function guestHeld(){
  if(!guestSeated(K))return;var dx=0,dy=0;
  for(var q in GKEYDIR){if(_gPressed[q]!==undefined&&tick>_gPressed[q]+1){dx+=GKEYDIR[q][0];dy+=GKEYDIR[q][1];}}
  dx=Math.sign(dx);dy=Math.sign(dy);if(dx||dy){tryStep(K,K.root,dx,dy);guestMoved();}
}
var STONES3=['Amber','Geode','Obsidian'];
// A question for a player: Kevin's and a guest at this keyboard use the bar; a guest on another screen gets it there.
function askFor(p,q,init){return p&&p.remote?askRemote(q,init):ask(q,init,p&&p.human?'guest':null);}
function guestKey(e,fromLink){
  if(!K||!guestSeated(K))return false;
  if(K.root.remote&&!fromLink)return false;   // a guest on another screen: this keyboard's arrows are Kevin's again
  if(e.ctrlKey||e.metaKey||e.altKey)return false;
  var k=String(e.key||'').toLowerCase(),g=K.root;
  if(_gPotion&&(tick-_gPotion>60||tick<_gPotion)){_gPotion=false;guestSay('potion: cancelled');}   // expired: the press acts as itself, never as a choice
  if(_gPotion){
    if(/^[1-9]$/.test(k)){e.preventDefault();_gPotion=false;var names=Object.keys(packSummary(g).potions),pn=names[+k-1];
      if(!pn){guestSay('no potion '+k);draw();return true;}
      if(POTIONS[pn]&&POTIONS[pn].kind==='creature'){if(!g.party.length){guestSay(pn+' wants a party creature');draw();return true;}
        var K0=K;askFor(g,(g.display||'Guest')+': '+pn+' on which party creature? '+g.party.map(function(c){return c.name||c.type;}).join(', '),g.party[0].name||g.party[0].type).then(function(w){if(w===null||K!==K0||K.root!==g||!guestSeated(K))return;var c=K.root.party.find(function(x){return (x.name||x.type).toLowerCase()===w.toLowerCase();});guestSay(c?usePotion(K,K.root,pn,c).text:'no "'+w+'" in the party');draw();});return true;}
      if(pn==='Musk'){var K1=K;askFor(g,(g.display||'Guest')+': Musk for which type? herbivore, carnivore, omnivore, scavenger, apex','herbivore').then(function(t){if(t===null||K!==K1||K.root!==g||!guestSeated(K))return;guestSay(usePotion(K,K.root,'Musk',t).text);draw();});return true;}
      var tgt=g.target?fauna.find(function(a){return a&&a.id===g.target;}):null;guestSay(usePotion(K,g,pn,tgt).text);draw();return true;}
  }
  if(_gBait){   // J, then 1-4 the kind, then an arrow for the tile or ; for here; Kevin's keys pass through, and a pause cancels it
    if(tick-_gBait.at>60||tick<_gBait.at){_gBait=null;guestSay('bait: cancelled');}
    else if(!_gBait.kind){var bk={'1':'plant','2':'scatter','3':'meat','4':'stake'}[k];
      if(bk){e.preventDefault();_gBait.kind=bk;_gBait.at=tick||1;guestSay('bait '+bk+': which way? '+(e.pad?'(the d-pad, or Y for here with a plant)':'(an arrow, or ; for here with a plant)'));draw();return true;}}
    else{var bd=GKEYDIR[k]?dirOf(GKEYDIR[k]):(k===';'?'':null);
      if(bd!==null){e.preventDefault();var bkind=_gBait.kind;_gBait=null;guestSay(placeBait(K,g,bkind,bd,null).text);draw();return true;}}
  }
  if(GKEYDIR[k]){
    e.preventDefault();if(e.repeat)return true;_gPressed[k]=tick;
    var dx=0,dy=0;for(var q in GKEYDIR){if(_gPressed[q]!==undefined){dx+=GKEYDIR[q][0];dy+=GKEYDIR[q][1];}}
    dx=Math.sign(dx);dy=Math.sign(dy);if(!dx&&!dy)return true;
    var r=tryStep(K,g,dx,dy);if(!r.ok&&r.why!=='winded')guestSay(r.why);guestMoved();draw();return true;
  }
  var acts={
    '.':function(){cycleTargetFor(g,guestSay);},
    '/':function(){throwFor(g,guestSay,'. picks a creature within 2 tiles');},
    '[':function(){g.stone=STONES3[(STONES3.indexOf(g.stone)+2)%3];guestSay(g.stone+' in hand ('+g.stones[g.stone.toLowerCase()]+')');},
    ']':function(){g.stone=STONES3[(STONES3.indexOf(g.stone)+1)%3];guestSay(g.stone+' in hand ('+g.stones[g.stone.toLowerCase()]+')');},
    "'":function(){var nc=e.pad&&g.naming?g.party.concat(K.cabinet).find(function(x){return x.id===g.naming;}):null;nameFor(g,guestSay,"'",nc?freeName(K,nc.type.charAt(0).toUpperCase()+nc.type.slice(1)):'');},
    ';':function(){if(storeAt(K,g)){if(g.remote){guestSay('the store: type buy, sell, box or take below');return;}openStore('buy',g);return;}var pk=pickPlant(K,g);guestSay(pk.ok?pk.text:interact(K,g).text);},
    ',':function(){guestSay((g.follower?recall(K,g):follow(K,g,null)).text);},
    'l':function(){var ps=packSummary(g),pl=Object.keys(ps.potions);if(!pl.length){guestSay('no potions in the pack');return;}_gPotion=tick||1;_gBait=null;guestSay('potion: '+pl.map(function(n,i){return (e.pad?(PAD_PICK[i]||''):(i+1))+' '+n+' x'+ps.potions[n];}).filter(function(x,i){return !e.pad||i<PAD_PICK.length;}).join(', ')+(e.pad&&pl.length>PAD_PICK.length?' (the rest: L and a digit on the keyboard)':''));},
    'k':function(){var pi=packSummary(g);guestSay('pack '+pi.used+'/'+pi.cap+': '+pi.plants+' plants'+(Object.keys(pi.potions).length?', '+Object.entries(pi.potions).map(function(x){return x[0]+' x'+x[1];}).join(', '):'')+(pi.gear.length?'; worn: '+pi.gear.join(', '):''));},
    'j':function(){_gPotion=false;_gBait={kind:null,at:tick||1};guestSay(e.pad?'bait: A plant, B scatter, X meat, Y stake':'bait: 1 plant, 2 scatter, 3 meat, 4 stake');},
    'h':function(){var K0=K;askFor(g,(g.display||'Guest')+': '+giveQ('Kevin'),'coins 10').then(function(w){if(w===null||K!==K0||K.root!==g||!guestSeated(K))return;guestSay(giveSaid(K,K.root,w).text);draw();});},
    'u':function(){if(!g.party.length){guestSay('nobody in the party to feed');return;}var K0=K;askFor(g,(g.display||'Guest')+': '+FEED_Q,g.party[0].name||g.party[0].type).then(function(w){if(w===null||K!==K0||K.root!==g||!guestSeated(K))return;guestSay(feedSaid(K,K.root,w).text);draw();});},
    'y':function(){
      if(g.remote){_gAlmanac=!_gAlmanac;guestSay(_gAlmanac?'the Almanac is below the picture (Y hides it)':'the Almanac is hidden');return;}   // their page has no panel: the text rides in the state
      if(panelOpen()&&_kPanelOwner!==g){guestSay('Kevin has a panel open; Esc closes it');return;}
      if(panelMode()==='almanac'){closePanel();_kPanelOwner=null;return;}
      _kPanelOwner=g;almanacPanel(almanacLists(K,g));}
  };
  var act=Object.prototype.hasOwnProperty.call(acts,k)?acts[k]:null;   // a key such as __proto__ from a guest's page is not an action
  if(act){e.preventDefault();if(e.repeat)return true;act();draw();return true;}
  return false;
}
// The guest button in the HUD: sit down (refused while Root plays) or get up.
function toggleGuest(remote,fromPad){
  if(!K)return;
  if(guestSeated(K)){var gp=K.root,r=unseatGuest(K);_gPressed={};_gPotion=false;_gBait=null;_gAlmanac=false;_guestCarry=null;_guestRemote=false;if(_kPanelOwner===gp&&panelOpen()){closePanel();_kPanelOwner=null;}if(linkOpen())closeLink();kevinSay(r.text);draw();return;}
  ask('Who joins'+(remote?' from another screen':'')+'? A name for the second player'+(fromPad?' (A on the pad for "Guest")':''),'Guest',fromPad?'guest':null).then(function(n){
    if(n===null||!K)return;var r=seatGuest(K,rootPlaying(),n);
    if(!r.ok){kevinSay(r.text);draw();return;}
    _guestCarry=K.root.display;_guestRemote=!!remote;
    if(!remote){guestSay(r.text);draw();return;}
    openLink(linkHooks).then(function(code){if(!guestSeated(K))return;K.root.remote=code;var a=guestAddress();kevinSay(K.root.display+' joins from another screen: open '+a+(/\/\/127\.0\.0\.1:/.test(a)?' (this machine only; another device needs the link opened to it)':'')+', code '+code);draw();})
      .catch(function(e){unseatGuest(K);_guestCarry=null;_guestRemote=false;kevinSay('the guest link is not running (npm run guest-link): '+e.message);draw();});
  });
}
document.addEventListener('click',function(e){var b=e.target&&e.target.closest&&e.target.closest('.kh-guest');if(b){e.preventDefault();toggleGuest(b.dataset.remote==='1');}});

// ===== A gamepad for the guest (mechanics 25.1): every button is a guest key, handed to guestKey =====
// Polled while a pad is connected (the browser shows a pad only after a press on it). Start with nobody seated asks
// for a guest; a guest on another screen plays on their own screen, so this pad does nothing for them.
var _padPrev=new Set(),_padTimer=null,_padIndex=-1;
function firstPad(){var ps=navigator.getGamepads?navigator.getGamepads():[];for(var i=0;i<ps.length;i++)if(ps[i]&&ps[i].connected!==false)return ps[i];return null;}
function padTick(){
  var gp=firstPad(),idx=gp?gp.index:-1;
  if(idx!==_padIndex){var had=_padPrev,first=_padIndex<0;_padIndex=idx;_padPrev=new Set();had.forEach(function(b){var ak=padArrowUp(b);if(ak)delete _gPressed[ak];});   // another pad (or none): let go of the old one
    if(!first){_padPrev=padPressed(gp);return;}}   // a second pad taking over starts from what it holds; the first pad's opening press (the one that made the browser show it) still counts
  var now=padPressed(gp,_padPrev),ed=padEdges(_padPrev,now);_padPrev=now;
  if(!gp&&_padTimer){clearInterval(_padTimer);_padTimer=null;}
  if(!K)return;
  for(var u=0;u<ed.ups.length;u++){var ak=padArrowUp(ed.ups[u]);if(ak)delete _gPressed[ak];}   // a released d-pad lets the held move go
  for(var d=0;d<ed.downs.length;d++)padDown(ed.downs[d]);
}
function padDown(i){
  if(!guestSeated(K)){if(i===PAD_START&&!asking())toggleGuest(false,true);else if(askWho()==='guest'){var a=padKey(i,{asking:true});if(a)answerAsk(a==='ok');}return;}
  if(K.root.remote)return;
  var live=function(at){return at&&tick>=at&&tick-at<=60;};   // the same 60-tick window guestKey keeps
  var k=padKey(i,{asking:askWho()==='guest',picking:!!(live(_gPotion)||(_gBait&&!_gBait.kind&&live(_gBait.at)))});
  if(!k)return;
  if(k==='ok'||k==='cancel'){answerAsk(k==='ok');return;}
  guestKey({key:k,repeat:false,pad:true,preventDefault:function(){}},false);draw();
}
window.addEventListener('gamepadconnected',function(){if(!_padTimer)_padTimer=setInterval(padTick,50);});

// ===== The guest link (mechanics 26): what a guest on another screen sees, and what their input does =====
var _guestRemote=false,_linkFrame=null;
function guestFrame(){   // their corner of the world: 33 x 33 tiles around them, from the drawn canvas (fog and all)
  if(!guestSeated(K))return null;var g=K.root,R=16,side=2*R+1;
  if(!_linkFrame)_linkFrame=document.createElement('canvas');var c=_linkFrame;c.width=c.height=400;var x=c.getContext('2d');
  x.fillStyle='#000';x.fillRect(0,0,400,400);x.imageSmoothingEnabled=false;
  x.drawImage(canvas,(g.x-R)*PIX,(g.y-R)*PIX,side*PIX,side*PIX,0,0,400,400);
  return c.toDataURL('image/jpeg',0.7);
}
function guestState(){
  if(!guestSeated(K))return {name:null};var g=K.root,ps=packSummary(g);
  return {name:g.display,wallet:g.wallet,stones:g.stones,stone:g.stone,pack:ps.used+'/'+ps.cap,party:g.party.map(function(c){var k=creatureCard(c);return k.name+' L'+k.level+' '+k.elemental+' '+k.type;}),
    msg:g.msg&&g.msgUntil>Date.now()?g.msg:'',shop:storeAt(K,g)?shopText(K,g):'',almanac:_gAlmanac?almanacText(K,g):''};
}
function guestCommand(text){   // from another screen: give X [n] and feed X[, Y] anywhere; buy X [n], sell X, box X, take X, breed X, Y at a store
  var g=K.root,m=/^(buy|sell|box|take|breed|give|feed)\s+(.+)$/i.exec(String(text||'').trim());
  if(!m){guestSay('give coins 5, feed Moss, feed Wolf, Moss; at a store: buy Geode 2, sell Moss, sell plant 2, box Moss, take Moss, breed Moss, Fern');return;}
  var v=m[1].toLowerCase(),rest=m[2].trim(),r;
  if(v==='give'){guestSay(giveSaid(K,g,rest).text);return;}
  if(v==='feed'){guestSay(feedSaid(K,g,rest).text);return;}
  if(!storeAt(K,g)){guestSay('that is done at a store');return;}
  if(v==='buy'){var q=/^(.+?)\s+(\d+)$/.exec(rest);r=buyItem(K,g,q?q[1]:rest,q?+q[2]:1);}   // only buy takes a number: "sell plant 2" and a creature named "Blob 2" keep theirs
  else if(v==='sell')r=sellItem(K,g,rest);
  else if(v==='breed'){var pr=rest.indexOf(',')>=0?rest.split(','):rest.split(/\s+/);if(pr.length!==2){guestSay('breed two: breed Moss, Fern');return;}r=breedPair(K,g,pr[0].trim(),pr[1].trim());}
  else r=boxItem(K,g,rest,v==='take');
  guestSay(r.text);
}
var linkHooks={frame:guestFrame,state:guestState,
  input:function(ev){if(!guestSeated(K)||!K.root.remote)return;
    if(ev.t==='down')guestKey({key:ev.key,repeat:false,preventDefault:function(){}},true);
    else if(ev.t==='up')delete _gPressed[String(ev.key||'').toLowerCase()];
    else if(ev.t==='cmd')guestCommand(ev.text);
    draw();},
  idle:function(){_gPressed={};}};
// Is a link server running? Asked when a board arrives and every few seconds while one is up (a local fetch).
var _remoteOk=false;
function probeLink(){if(!K)return;linkAvailable().then(function(ok){if(ok!==_remoteOk){_remoteOk=ok;setRemoteOk(ok);draw();}});}
setInterval(probeLink,30000);   // and on every board: a quiet check, not a poll
canvas.addEventListener('click',function(ev){
  if(!K||!K.kevin||ev.shiftKey)return;
  var t=screenToTile(ev.clientX,ev.clientY);if(!inb(t.x,t.y))return;
  var f=targetsNear(K,K.kevin,2).find(function(a){return a.x===t.x&&a.y===t.y;});
  if(f){K.kevin.target=f.id;draw();}
});
window.addEventListener('keyup',function(e){var k=String(e.key||'').toLowerCase();delete _kPressed[k];delete _gPressed[k];});
window.addEventListener('blur',function(){_kPressed={};_gPressed={};});
// F9 outside a board too: load a saved game onto a plain page.
window.addEventListener('keydown',function(e){if(!K&&e.key==='F9'&&!/INPUT|SELECT|TEXTAREA/.test((e.target||{}).tagName||'')){e.preventDefault();_kMenu().toggle();}});

// ===== Ketch'em: saves (step 5, mechanics 18) =====
// F5 saves the game to its slot (named at the first save, default the seed) in IndexedDB, then mirrors it to the
// relay; F9 opens the menu (load / delete / export / import). Autosave every 2,000 ticks and on leaving the page.
var AUTOSAVE_TICKS=2000,_kAutoAt=0,_kMenuEl=null;
function _kMenu(){
  if(!_kMenuEl)_kMenuEl=saveMenu({slots:listSlots,load:loadGame,del:function(slot){if(K&&K.slot===slot)K.slot=null;return deleteSlot(slot);},saveNow:saveGame,hasGame:function(){return !!K;},
    exportNow:function(){if(!K)return;var json=exportSave(buildSave(K,K.slot));var blob=new Blob([json],{type:'application/json'});var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download='ketchem_'+(K.slot||K.seed)+'.json';document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);},
    importFile:function(file){var r=new FileReader();r.onload=function(){try{adoptBoard(importSave(String(r.result)));kevinSay('imported '+(K.slot||''));}catch(e){showErr('Import failed: '+e.message);}};r.readAsText(file);}});
  return _kMenuEl;
}
function showErr(text){var eb=document.getElementById('err');if(eb){eb.style.display='block';eb.textContent=text;}}
// A slot name as both the page and the relay accept it (relay: ^[\w][\w -]{0,63}$): word characters, spaces and dashes, starting with a word character.
function slotName(raw){return String(raw||'').replace(/[^\w -]/g,'').replace(/^[^\w]+/,'').trim().slice(0,64);}
// Save: build in memory, write IndexedDB, then mirror; a failed mirror never fails the save (18.1).
var _kSaving=false;
function saveGame(){
  if(!K||_kSaving)return Promise.resolve(false);
  if(!K.slot){var K0=K;return ask('Name this game',String(K.seed)).then(function(name){if(name===null||K!==K0)return false;if(!K.slot)K.slot=slotName(name)||String(K.seed);return saveGame();});}
  _kSaving=true;_kAutoAt=tick;   // the autosave clock advances now, so a slow or failed write is never retried every tick
  var data=buildSave(K,K.slot);
  return putSlot(data).then(function(){return mirrorSave(data);}).then(function(mirrored){kevinSay('saved "'+K.slot+'"'+(mirrored?'':', not mirrored'));draw();return true;})
    .catch(function(e){showErr('Save failed: '+e.message);return false;}).finally(function(){_kSaving=false;});
}
function loadGame(slot){
  return getSlot(slot).then(function(data){if(!data)throw new Error('no save "'+slot+'"');adoptBoard(applySave(data));kevinSay('loaded "'+slot+'"');draw();})
    .catch(function(e){showErr('Load failed: '+e.message);});
}
// A board arriving from the Worker or from a save becomes the page's game.
function adoptBoard(board){
  abandonBuild();followId=null;godCancelMark(null);
  K=board;if(!K.kevin)K.kevin=newPlayer(K.starts[0].x,K.starts[0].y);initPlayer(K.kevin,'kevin');initEncounters(K);initStores(K);closePanel();if(K.tick0===undefined)K.tick0=tick;if(!K.cam)K.cam='kevin';_kCamAt=null;_kPressed={};_gPressed={};_gPotion=false;_gBait=null;_gAlmanac=false;_kBait=null;_kPotion=false;_kOnStore=false;_kAutoAt=tick;
  setHandTool('none');document.body.classList.add('ketchem');
  placeMode='none';resetZoomPan();resize();syncUIToConfig();buildSliders();
  speed=18;var spK=document.getElementById('speed');if(spK)spK.value=18;
  var hSeedK=document.getElementById('hSeed');if(hSeedK)hSeedK.textContent=_seed;
  closeAsk();boardAdopted(K);   // Root, if it is playing, stands in the new board at once
  if(guestSeated(K))_guestCarry=K.root.display;
  else if(_guestCarry&&!rootPlaying()){var rs=seatGuest(K,false,_guestCarry);if(rs.ok)guestSay(rs.text);}   // the guest is still at the keyboard (or their screen): they sit down in the new board or the loaded game
  dropQuestions();   // questions about the old board end with it
  if(_guestRemote&&linkOpen()){   // the guest on the other screen stays the one playing the seat
    if(guestSeated(K)&&K.root.display!==_guestCarry){unseatGuest(K);seatGuest(K,false,_guestCarry);}
    if(guestSeated(K))K.root.remote=linkCodeNow();else{closeLink();_guestRemote=false;}   // Root holds the seat in this board: the link closes
  }
  probeLink();
  running=!_kHold;draw();refreshUndoBtn();
}
var _kHold=false;   // debug only (window.__wb.ketchem.pause): a held world lets a rehearsal compare a save with its load exactly
function kevinAutosave(){if(K&&K.slot&&tick-_kAutoAt>=AUTOSAVE_TICKS)saveGame();}
window.addEventListener('beforeunload',function(){if(K&&K.slot){try{putSlot(buildSave(K,K.slot));}catch(e){/* best effort */}}});
var _kOnDone=null;   // the callback of the build in flight, told false if the build is abandoned
function abandonBuild(){if(_kWorker){_kWorker.terminate();_kWorker=null;}_kProgress=null;var cb=_kOnDone;_kOnDone=null;if(cb)cb(false);}
function startKetchem(setting,seed,size,onDone){
  if(!KETCHEM_SETTINGS[setting]){var eb0=document.getElementById('err');if(eb0){eb0.style.display='block';eb0.textContent='Unknown Ketch\'em board setting: '+setting;}if(onDone)onDone(false);return;}
  abandonBuild();_kOnDone=onDone||null;
  K=null;running=false;followId=null;document.body.classList.remove('ketchem');closeAsk();
  clearScenario();if(_scenWarmTimer){clearTimeout(_scenWarmTimer);_scenWarmTimer=null;}   // a scenario warm-up must not seed life into the arriving board
  _kProgress={phase:'land',land:0,target:1,setting:setting};draw();
  _kWorker=new Worker(new URL('./ketchem/board.worker.js',import.meta.url),{type:'module'});
  _kWorker.onmessage=function(e){
    var m=e.data;
    if(m.type==='progress'){_kProgress=m;draw();return;}
    if(m.type==='error'){var eb=document.getElementById('err');if(eb){eb.style.display='block';eb.textContent='Board build failed: '+m.message;}abandonBuild();draw();return;}
    if(m.type!=='done')return;
    _kWorker.terminate();_kWorker=null;_kProgress=null;var done=_kOnDone;_kOnDone=null;
    Object.assign(CFG,m.cfg);          // the setting's genesis knobs, the frozen land cap, ecology on
    restoreState(m.snap);
    var board=m.board;board.kevin=newPlayer(board.starts[0].x,board.starts[0].y);board.root=null;board.cam='kevin';board.tick0=tick;
    adoptBoard(board);   // the Hand goes off, the page syncs, the game runs at the normal rate
    chronicleNote('terrain','A Ketch\'em board: '+KETCHEM_SETTINGS[K.setting].label+'. Two stores stand at the starts: '+K.starts.map(function(st){return K.stores[st.store].name;}).join(' and ')+'; two more are out there.','#8a9a7b');
    if(done)done(true);
  };
  _kWorker.onerror=function(ev){var eb=document.getElementById('err');if(eb){eb.style.display='block';eb.textContent='Board worker error: '+(ev&&ev.message||'unknown');}abandonBuild();};
  _kWorker.postMessage({setting:setting,seed:seed,size:size});
}
function drawBoardProgress(){
  var p=_kProgress,cw=canvas.width,ch=canvas.height;var label=KETCHEM_SETTINGS[p.setting]?KETCHEM_SETTINGS[p.setting].label:p.setting;
  var frac=0,text='';
  if(p.phase==='land'){frac=p.target?Math.min(1,p.land/p.target):0;text='Raising the '+label+': land '+Math.round(p.land*100)+'% of '+Math.round(p.target*100)+'%';}
  else if(p.phase==='life'){frac=p.of?p.tick/p.of:0;text='Life settling: '+p.tick+' / '+p.of+' ticks';}
  else if(p.phase==='roads'){frac=1;text='Laying roads and stores';}
  else if(p.phase==='reroll'){frac=0;text='Re-rolling the board ('+p.why+')';}
  var bw=Math.max(120,(cw*0.5)|0),bh=10,bx=((cw-bw)/2)|0,by=((ch/2)|0)+8;
  ctx.fillStyle='rgba(0,17,26,0.72)';ctx.fillRect(0,0,cw,ch);
  ctx.fillStyle='#e6edf3';ctx.font='13px "JetBrains Mono",monospace';ctx.textAlign='center';ctx.fillText(text,cw/2,by-10);ctx.textAlign='left';
  ctx.fillStyle='#223';ctx.fillRect(bx,by,bw,bh);ctx.fillStyle='#3b9eff';ctx.fillRect(bx,by,(bw*frac)|0,bh);
}

// ===== Inspector =====
function inspectTile(x,y){
  if(!inb(x,y))return;var i=idx(x,y);var ins=document.getElementById('inspector');if(!ins)return;
  var isPeak=(grid[i]===T.MOUNTAIN&&peakVolcano&&peakVolcano[i]);
  var label=isPeak?'Volcano':TNAME[grid[i]];
  var sw=isPeak?TERRAIN_COLORS[T.VOLCANIC]:(TERRAIN_COLORS[grid[i]]||'#333');
  var html='<div class="insp-tile-header"><span class="insp-swatch" style="background:'+sw+'"></span><span class="tname">'+label+'</span><span class="tcoord">('+x+', '+y+')</span></div>';
  html+='<div class="insp-grid"><span class="ig-k">Elevation</span><span class="ig-v">'+(elev[i]||0).toFixed(2)+'</span>';
  html+='<span class="ig-k">Aridity</span><span class="ig-v">'+(aridity[i]||0).toFixed(2)+'</span>';
  html+='<span class="ig-k">Temperature</span><span class="ig-v">'+(tempField[i]||0).toFixed(2)+'</span>';
  html+='<span class="ig-k">Sunlight</span><span class="ig-v">'+(sunlight[i]||0).toFixed(2)+'</span>';
  html+='<span class="ig-k">Ecotone</span><span class="ig-v">'+(biomeBoundary&&biomeBoundary[i]?'Yes':'No')+'</span>';
  if(riverData&&riverData[i]){var rd=riverData[i];var rLabel=rd.lake?'Lake':(rd.sourcePool?'Source':'River');html+='<span class="ig-k">Water</span><span class="ig-v">'+rLabel+' (vol:'+rd.volume+')</span>';}
  html+='</div>';
  var tileFlora=flora.filter(function(f){return f&&f.x===x&&f.y===y;});
  if(tileFlora.length){
    html+='<hr class="insp-divider"><div class="insp-sub">🌿 Flora × '+tileFlora.length+' / '+CFG.floraPerTileMax+'</div>';
    for(var fi=0;fi<Math.min(tileFlora.length,3);fi++){var f=tileFlora[fi];var fName=getSpeciesName(f,'flora');var fNameHtml=fName?'<div class="species-name">'+fName+'</div>':'';html+='<div class="insp-entity"><b>'+f.shape+'</b> gen:'+f.gen+' hp:'+f.health.toFixed(2)+' age:'+f.age+'/'+Math.round(f.maxAge)+fNameHtml+'<br>pref A:'+f.prefArid.toFixed(1)+' T:'+f.prefTemp.toFixed(1)+' S:'+f.prefSL.toFixed(1)+' tol:'+f.tolerance.toFixed(1)+'</div>';}
    if(tileFlora.length>3)html+='<div style="font-size:10px;color:var(--fg-faint);margin-top:2px;">+'+(tileFlora.length-3)+' more</div>';
  }
  var tileFauna=fauna.filter(function(a){return a&&a.x===x&&a.y===y;});
  if(tileFauna.length){
    html+='<hr class="insp-divider"><div class="insp-sub">🦌 Fauna × '+tileFauna.length+'</div>';
    for(var ai=0;ai<Math.min(tileFauna.length,3);ai++){var a=tileFauna[ai];var icon=a.type==='herbivore'?'🐇':(a.type==='scavenger'?'🦅':'🐺');var vTag=a.vivid?' ✨vivid':'';var sName=getSpeciesName(a,a.type);var nameHtml=sName?'<div class="species-name">'+sName+'</div>':'';html+='<div class="insp-entity"><b>'+icon+' '+a.type+vTag+'</b> gen:'+a.gen+' E:'+a.energy.toFixed(0)+'/'+a.maxEnergy+' <button class="follow-btn" data-fid="'+a.id+'">Follow</button>'+nameHtml+'<br>size:'+(a.size||1).toFixed(2)+'× age:'+a.age+'/'+Math.round(a.maxAge)+' pref A:'+a.prefArid.toFixed(1)+' T:'+a.prefTemp.toFixed(1)+' S:'+a.prefSL.toFixed(1)+'</div>';}
    if(tileFauna.length>3)html+='<div style="font-size:10px;color:var(--fg-faint);margin-top:2px;">+'+(tileFauna.length-3)+' more</div>';
  }
  ins.innerHTML=html;
}

function pct01(v){return Math.round(clamp(v,0,10)*10);}
function updateTooltip(ev){
  if(!grid)return;
  var t=document.getElementById('tip');if(!t)return;var tile=screenToTile(ev.clientX,ev.clientY);var x=tile.x,y=tile.y;if(!inb(x,y)){t.style.display='none';return;}var i=idx(x,y);
  var isPeak=(grid[i]===T.MOUNTAIN&&peakVolcano&&peakVolcano[i]);var terr=isPeak?'Volcano':TNAME[grid[i]];var sw=isPeak?TERRAIN_COLORS[T.VOLCANIC]:(TERRAIN_COLORS[grid[i]]||'#333');
  if(K&&K.fog&&!isRevealed(K.fog,i)){t.innerHTML='<h4>Unexplored ('+x+','+y+')</h4>';t.style.left=(ev.clientX+14)+'px';t.style.top=(ev.clientY+14)+'px';t.style.display='block';return;}
  var html='<h4><span class="tsw" style="background:'+sw+'"></span>'+terr+' ('+x+','+y+')</h4>';
  if(K){   // Ketch'em: what stands here (14.5, 14.6)
    for(var ks=0;ks<K.stores.length;ks++){if(K.stores[ks].x===x&&K.stores[ks].y===y)html+='<div class="kv">Store <span>'+K.stores[ks].name+'</span></div>';}
    for(var kp=0;kp<K.signposts.length;kp++){if(K.signposts[kp].x===x&&K.signposts[kp].y===y)html+='<div class="kv">Signpost <span>'+(K.signposts[kp].text||'no stores this way')+'</span></div>';}
    for(var kl=0;kl<K.landmarks.length;kl++){if(K.landmarks[kl].x===x&&K.landmarks[kl].y===y)html+='<div class="kv">Landmark <span>'+K.landmarks[kl].name+'</span></div>';}
  }
  html+='<div class="kv">Elevation <span>'+(elev[i]||0).toFixed(1)+'</span></div><div class="bar"><i style="width:'+pct01(elev[i])+'%"></i></div>';
  html+='<div class="kv">Aridity <span>'+(aridity[i]||0).toFixed(1)+'</span></div><div class="bar"><i style="width:'+pct01(aridity[i])+'%"></i></div>';
  html+='<div class="kv">Temp <span>'+(tempField[i]||0).toFixed(1)+'</span></div><div class="bar"><i style="width:'+pct01(tempField[i])+'%"></i></div>';
  html+='<div class="kv">Sun <span>'+(sunlight[i]||0).toFixed(1)+'</span></div><div class="bar"><i style="width:'+pct01(sunlight[i])+'%"></i></div>';
  if(riverData&&riverData[i]){var rdT=riverData[i];var rLbl=rdT.lake?'💧 Lake':(rdT.sourcePool?'💧 Source':'💧 River');html+='<div class="kv">'+rLbl+' <span>vol:'+rdT.volume+(rdT.estuary?' (estuary)':'')+'</span></div>';}
  if((CFG.seasonalTilt||CFG.anomalies||CFG.volcanoAsh)&&baseTemp){var dT=(tempField[i]||0)-(baseTemp[i]||0),dA=(aridity[i]||0)-(baseArid[i]||0);html+='<hr class="tsep"><div class="kv">climate ΔT/ΔA <span>'+(dT>=0?'+':'')+dT.toFixed(2)+' / '+(dA>=0?'+':'')+dA.toFixed(2)+'</span></div><div class="kv">Season <span>'+Math.round(seasonPhase()*100)+'%</span></div>';}
  var tF=[],tA2=[];for(var fi=0;fi<flora.length;fi++){if(flora[fi]&&flora[fi].x===x&&flora[fi].y===y)tF.push(flora[fi]);}for(var ai=0;ai<fauna.length;ai++){if(fauna[ai]&&fauna[ai].x===x&&fauna[ai].y===y)tA2.push(fauna[ai]);}
  if(tF.length||tA2.length){html+='<hr class="tsep">';if(tF.length){var avgH=0;for(var fj=0;fj<tF.length;fj++)avgH+=tF[fj].health;avgH/=tF.length;var mG=0;for(var fk=0;fk<tF.length;fk++)if(tF[fk].gen>mG)mG=tF[fk].gen;html+='<div class="kv">🌿 ×'+tF.length+'/'+CFG.floraPerTileMax+' <span>hp:'+avgH.toFixed(2)+' gen≤'+mG+'</span></div>';if(mG>=5){var topF=null;for(var tf2=0;tf2<tF.length;tf2++){if(!topF||tF[tf2].gen>topF.gen)topF=tF[tf2];}if(topF){var tfName=getSpeciesName(topF,'flora');if(tfName)html+='<div class="kv" style="font-style:italic;color:#38c8b0;">'+tfName+'</div>';}}var remC=0;for(var rr=0;rr<floraRemnants.length;rr++){if(floraRemnants[rr].x===x&&floraRemnants[rr].y===y)remC++;}if(remC)html+='<div class="kv">🌱 regrowing <span>×'+remC+'</span></div>';}
  for(var aj=0;aj<Math.min(tA2.length,2);aj++){var fa=tA2[aj];var faName=getSpeciesName(fa,fa.type);var faLabel=faName?('<i>'+faName+'</i>'):(fa.type==='herbivore'?'🐇':(fa.type==='scavenger'?'🦅':(fa.type==='apex'?'🦁':(fa.type==='omnivore'?'🐗':'🐺'))));html+='<div class="kv">'+faLabel+(fa.vivid?' ✨':'')+' <span>E:'+fa.energy.toFixed(0)+'/'+fa.maxEnergy+' g:'+fa.gen+'</span></div>';}}
  t.innerHTML=html;var pad=14;var left=ev.clientX+pad,top=ev.clientY+pad;var vw=window.innerWidth,vh=window.innerHeight;var bb=t.getBoundingClientRect();if(left+bb.width>vw-8)left=ev.clientX-bb.width-pad;if(top+bb.height>vh-8)top=ev.clientY-bb.height-pad;t.style.left=left+'px';t.style.top=top+'px';t.style.display='block';
}

// ===== QoL =====
function exportPNG(){try{var url=canvas.toDataURL('image/png');var a=document.createElement('a');a.href=url;a.download='worldbuilder_'+W+'x'+H+'_tick'+tick+'.png';document.body.appendChild(a);a.click();document.body.removeChild(a);}catch(e){var err=document.getElementById('err');if(err){err.style.display='block';err.textContent='Export error: '+e.message;}}}
// Pure serializer (the 'wb-eco-1' load format). Split out of exportJSON so headless tooling can
// produce a loadable world snapshot without the DOM download path.
function exportJSON(){try{var snapshot=buildSnapshot();var json=JSON.stringify(snapshot,null,2);var blob=new Blob([json],{type:'application/json'});var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download='worldbuilder_'+W+'x'+H+'_tick'+tick+'.json';document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);}catch(e){var err=document.getElementById('err');if(err){err.style.display='block';err.textContent='Export error: '+e.message;}}}
function importJSON(data){try{
  applySnapshot(data);                    // a bad file throws here, before the board is touched
  leaveBoard();                    // pure state load (validates + reassigns sim state, DOM-free)
  followId=null;                          // the loaded world has its own ids; drop any follow from the prior world
  resize();
  var hSeedEl=document.getElementById('hSeed');if(hSeedEl)hSeedEl.textContent=_seed;
  var seedInp=document.getElementById('seedInput');if(seedInp)seedInp.value=_seed;
  var psEl=document.getElementById('presetSelect');if(psEl)psEl.value=activePreset;
  buildSliders();
  var cIE=document.getElementById('climateIntensity'),cIO=document.getElementById('climateIntensityOut');if(cIE&&cIO){cIE.value=CFG.climateIntensity;cIO.textContent=CFG.climateIntensity.toFixed(2);}
  var cSE=document.getElementById('climateSeasonLen'),cSO=document.getElementById('climateSeasonLenOut');if(cSE&&cSO){cSE.value=CFG.climateSeasonLength;cSO.textContent=CFG.climateSeasonLength;}
  draw();
}catch(e){var err=document.getElementById('err');if(err){err.style.display='block';err.textContent='Import error: '+e.message;}}}

// ===== Shareable worlds (chunk 4, thread 3) =====
// A world is fully determined at GENESIS by its seed + config: terrain + ecology are deterministic from
// the seeded RNG streams, and the WORLD meta is re-derived from the seed by pickWorldMeta. So a compact
// "world code" of { seed, preset (UI label only), cfg-diff-from-default } reproduces the same world when
// replayed - far smaller than the baked snapshot the JSON download ships, so it fits in a ?w= URL param.
// A shared world is thus a link. Balance-safe: this only reads/writes CFG + re-inits (like the preset
// selector), never touching step().
function getWorldCodeParam(){ if(typeof location==='undefined'||!location.search) return null; var m=/[?&]w=([^&]+)/.exec(location.search); return m?decodeURIComponent(m[1]):null; }
// Full permalink to the current world.
function _flashBtn(btn,msg,restore){ if(!btn)return; if(btn._flashT)clearTimeout(btn._flashT); btn.textContent=msg; btn._flashT=setTimeout(function(){btn.textContent=restore;},1100); }
// DOM: copy the permalink to the clipboard, and reflect it in the address bar so a manual bookmark works
// too. Mirrors the seed-copy affordance already on the HUD.
function copyWorldLink(){
  var url=worldPermalink(), btn=document.getElementById('btnCopyLink');
  try{ if(typeof history!=='undefined'&&history.replaceState) history.replaceState(null,'',url); }catch{}
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function(){_flashBtn(btn,'link copied','Copy Link');},function(){_flashBtn(btn,'copy failed','Copy Link');});
    else window.prompt('Copy this world link:',url);
  }catch(e){ try{window.prompt('Copy this world link:',url);}catch(e2){} }
}
// A Chronicle-driven postcard: a short shareable blurb of the world + a couple of its story beats + the
// link. Pure text (chronicleStats + the recent feed), ASCII, no exclamation marks.
function copyPostcard(){
  var text=worldPostcard(), btn=document.getElementById('btnPostcard');
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function(){_flashBtn(btn,'postcard copied','Postcard');},function(){_flashBtn(btn,'copy failed','Postcard');});
    else window.prompt('Copy this postcard:',text);
  }catch(e){ try{window.prompt('Copy this postcard:',text);}catch(e2){} }
}

// ===== HUD =====
// Population graph drawing
function drawPopGraph(){
  var gc=document.getElementById('popGraph');if(!gc)return;var gctx=gc.getContext('2d');if(!gctx)return;
  var w=gc.width,h=gc.height;gctx.fillStyle='#080b10';gctx.fillRect(0,0,w,h);
  var hist=popHistory;if(!hist.flora.length)return;
  var scavH=hist.scav||[],apexH=hist.apex||[],omniH=hist.omni||[]; // may be absent on old snapshots
  // Find max across all series for scaling
  var maxVal=10;for(var mi=0;mi<hist.flora.length;mi++){if(hist.flora[mi]>maxVal)maxVal=hist.flora[mi];if(hist.herb[mi]*4>maxVal)maxVal=hist.herb[mi]*4;if(hist.carn[mi]*4>maxVal)maxVal=hist.carn[mi]*4;if((scavH[mi]||0)*4>maxVal)maxVal=(scavH[mi]||0)*4;if((apexH[mi]||0)*4>maxVal)maxVal=(apexH[mi]||0)*4;if((omniH[mi]||0)*4>maxVal)maxVal=(omniH[mi]||0)*4;}
  maxVal=maxVal*1.1; // 10% headroom
  var n=hist.flora.length;var xStep=w/Math.max(1,n-1);
  // Grid lines
  gctx.strokeStyle='#1c2636';gctx.lineWidth=1;
  for(var gy=0;gy<4;gy++){var yy=Math.round(h*gy/4)+0.5;gctx.beginPath();gctx.moveTo(0,yy);gctx.lineTo(w,yy);gctx.stroke();}
  // Scale label
  gctx.fillStyle='#4a5568';gctx.font='9px "JetBrains Mono",monospace';gctx.fillText(Math.round(maxVal),2,10);gctx.fillText('0',2,h-2);
  // Draw series
  function drawSeries(data,color,scale,lw,alpha){
    gctx.strokeStyle=color;gctx.lineWidth=lw||1.5;gctx.globalAlpha=(alpha===undefined?0.85:alpha);gctx.beginPath();
    for(var si=0;si<data.length;si++){var sx=si*xStep;var sy=h-clamp(data[si]*scale/maxVal,0,1)*h;if(si===0)gctx.moveTo(sx,sy);else gctx.lineTo(sx,sy);}
    gctx.stroke();gctx.globalAlpha=1.0;
  }
  // The three minor trophic tiers (scav/apex/omni) are rare + rescue-sustained, so draw them thinner and
  // dimmer beneath the core flora/herb/carn story to keep the predator-prey cycle the readable foreground.
  drawSeries(scavH,'#818753',4,1.0,0.5);
  drawSeries(apexH,'#823841',4,1.0,0.5);
  drawSeries(omniH,'#7b4c87',4,1.0,0.5);
  drawSeries(hist.flora,'#3fcf6a',1);
  drawSeries(hist.herb,'#e6dcbc',4); // scaled 4x so fauna is visible alongside flora; colors match the map markers + legend
  drawSeries(hist.carn,'#6c7687',4);
  // Scale indicators for fauna
  if(hist.herb.length>0||hist.carn.length>0){gctx.fillStyle='#4a5568';gctx.fillText('fauna ×4',w-52,10);}
}

function drawHUD(){
  var sumA=0,sumS=0,sumE=0,count=0;
  for(var ii=0;ii<W*H;ii++){if(grid[ii]!==T.OCEAN){sumA+=aridity[ii]||0;sumS+=sunlight[ii]||0;sumE+=elev[ii]||0;count++;}}
  // Count all five fauna tiers separately. (Before the trophic expansion this was a herbivore/else split,
  // which silently folded scavengers+apex+omnivores into the carnivore readout - the count is now honest.)
  var herbCount=0,carnCount=0,scavCount=0,apexCount=0,omniCount=0;
  for(var fi=0;fi<fauna.length;fi++){var ff=fauna[fi];if(!ff)continue;var ft=ff.type;
    if(ft==='herbivore')herbCount++;else if(ft==='scavenger')scavCount++;else if(ft==='apex')apexCount++;else if(ft==='omnivore')omniCount++;else carnCount++;}
  var el;
  el=document.getElementById('hTick');if(el)el.textContent=tick;
  el=document.getElementById('hLand');if(el)el.textContent=(landCoverage()*100).toFixed(1)+'%';
  el=document.getElementById('hElev');if(el)el.textContent=count?(sumE/count).toFixed(1):'—';
  el=document.getElementById('hArid');if(el)el.textContent=count?(sumA/count).toFixed(1):'—';
  el=document.getElementById('hSun');if(el)el.textContent=count?(sumS/count).toFixed(1):'—';
  el=document.getElementById('hFlora');if(el)el.textContent=flora.length;
  el=document.getElementById('hHerb');if(el)el.textContent=herbCount;
  el=document.getElementById('hCarn');if(el)el.textContent=carnCount;
  el=document.getElementById('hScav');if(el)el.textContent=scavCount;
  el=document.getElementById('hApex');if(el)el.textContent=apexCount;
  el=document.getElementById('hOmni');if(el)el.textContent=omniCount;
  // Status dot
  var dot=document.getElementById('statusDot');if(dot){dot.className=running?'dot running':'dot paused';}
  // Season: name the phase of the trapezoid wave (warm plateau .15-.35, cold plateau .65-.85, ramps between)
  var sw=document.getElementById('hSeasonWrap'),sEl=document.getElementById('hSeason');
  if(sw&&sEl){if(CFG.seasonalTilt){sw.style.display='';var ph=seasonPhase();
    sEl.textContent=(ph>=0.15&&ph<0.35)?'Summer':(ph>=0.35&&ph<0.65)?'Autumn':(ph>=0.65&&ph<0.85)?'Winter':'Spring';}
  else{sw.style.display='none';}}
  // Zoom indicator
  var zw=document.getElementById('hZoomWrap'),zEl=document.getElementById('hZoom');
  if(zw&&zEl){if(zoomLevel!==1){zw.style.display='';zEl.textContent=Math.round(zoomLevel*100)+'%';}else{zw.style.display='none';}}
  // Record population history (every 3 ticks to avoid bloat)
  if(tick%3===0){
    // Old imported snapshots may lack the trophic-tier arrays; init them so a load never crashes the graph.
    if(!popHistory.scav)popHistory.scav=[];if(!popHistory.apex)popHistory.apex=[];if(!popHistory.omni)popHistory.omni=[];
    popHistory.flora.push(flora.length);popHistory.herb.push(herbCount);popHistory.carn.push(carnCount);
    popHistory.scav.push(scavCount);popHistory.apex.push(apexCount);popHistory.omni.push(omniCount);popHistory.ticks.push(tick);
    if(popHistory.flora.length>POP_HISTORY_LEN){popHistory.flora.shift();popHistory.herb.shift();popHistory.carn.shift();popHistory.scav.shift();popHistory.apex.shift();popHistory.omni.shift();popHistory.ticks.shift();}}
  drawPopGraph();
}

// ===== Chronicle: the world's memory =====
// A pure, headless-safe event log. chronicleSample() runs at the END of step() on a fixed cadence:
// it derives a snapshot of populations/lineages and emits typed events by comparing to the previous
// sample and to all-time records (round-number milestone ladders, so the feed reads as a story and
// does not spam on every +1). NO DOM and NO RNG here (Worker-safe + deterministic, so two identical
// seeds produce an identical chronicle). renderChronicle() is the only DOM-touching part (draw path).
function renderChronicle(){
  var feed=document.getElementById('chronicleFeed'); if(!feed) return;
  var evs=chronicle.events;
  if(!evs.length){ feed.innerHTML='<div class="chron-empty">No history yet. Press play and let the world unfold.</div>'; }
  else { var html='',lo=Math.max(0,evs.length-60);
    for(var i=evs.length-1;i>=lo;i--){ var e=evs[i];
      html+='<div class="chron-row"><span class="chron-dot" style="background:'+e.color+'"></span><span class="chron-text">'+e.text+'</span><span class="chron-tick">'+e.tick+'</span></div>'; }
    feed.innerHTML=html; }
  var rec=document.getElementById('chronicleRecords');
  if(rec){ var r=chronicle.records; var topGen=Math.max(r.herbGenRung,r.carnGenRung);
    rec.innerHTML='<span>Events <b>'+chronicle.events.length+'</b></span><span>Peak herb <b>'+r.peakHerb+'</b></span><span>Peak carn <b>'+r.peakCarn+'</b></span><span>Top gen <b>'+topGen+'</b></span><span>Oldest <b>'+r.oldestAge+'</b></span><span>Biggest <b>'+(r.peakSize?r.peakSize.toFixed(2)+'×':'--')+'</b></span>'; }
  var badge=document.getElementById('chronicleBadge'); if(badge) badge.textContent=String(chronicle.events.length);
}

// ======================================================================
//  SPECIATION (chunk 6, pillar C): lineage drift -> named, diverging species
// ======================================================================
// A "species" is a cluster of living fauna sharing a genome SIGNATURE - the SAME (tier, hue, climate-pref)
// buckets that generateSpeciesName already keys its binomial on, so one signature is 1:1 with one name. As
// drift (mutateFaunaChild shifting hue / prefArid / prefTemp) carries a lineage's descendants into a new
// bucket, a new signature appears among the living -> a species has DIVERGED. This is PURE OBSERVATION over
// the existing genome: speciesSample() reads fauna, updates the registry, and narrates births/extinctions
// into the Chronicle, drawing NO eRng and mutating no fauna/flora -> the measured ecology loop is
// byte-identical (same proof shape as chronicleSample; the harness runs it and the numbers are unchanged).
// Reproductive isolation (mate choice) is a SEPARATE, behavior-touching, harness-gated experiment - by
// design NOT here (roadmap: "tracking + naming first; reproductive isolation as a separate experiment").
function renderSpecies(){
  var body=document.getElementById('speciesBody'); if(!body) return;
  var census=speciesCensus();
  var shown=census.filter(function(c){return c.maxGen>=SPECIES_MIN_GEN&&c.pop>=SPECIES_MIN_POP;});
  if(!shown.length){ body.innerHTML='<div class="chron-empty">No distinct species yet. Lineages must diverge and mature.</div>'; }
  else{ var html='';
    for(var i=0;i<shown.length;i++){var c=shown[i];var icon=c.type==='herbivore'?'🐇':(c.type==='scavenger'?'🦅':(c.type==='apex'?'🦁':(c.type==='omnivore'?'🐗':'🐺')));
      html+='<div class="sp-row"><span class="sp-icon">'+icon+'</span><span class="species-name sp-name">'+c.name+'</span>'
        +'<span class="sp-stat">×'+c.pop+'</span><span class="sp-stat">g'+c.maxGen+'</span>'
        +(c.maxSize>=1.3?'<span class="sp-stat">'+c.maxSize.toFixed(1)+'×</span>':'')
        +(c.vivid?'<span class="sp-vivid">✨</span>':'')+'</div>';
    }
    body.innerHTML=html;
  }
  var recEl=document.getElementById('speciesRecords');
  if(recEl){ var extinct=0;for(var ek in speciesRegistry.byKey)if(speciesRegistry.byKey[ek].extinct)extinct++;
    recEl.innerHTML='<span>Living <b>'+shown.length+'</b></span><span>Emerged <b>'+speciesRegistry.everCount+'</b></span><span>Extinct <b>'+extinct+'</b></span>'; }
  var badge=document.getElementById('speciesBadge'); if(badge) badge.textContent=String(shown.length);
}

// ===== Living Food Web: a canvas node-link diagram of the 5-tier trophic structure =====
// Pure OBSERVER render (like drawPopGraph / renderSpecies): reads foodWebCensus() and draws each tier as a
// node sized by population, each feeding relationship as an arrow whose thickness/opacity tracks the RECENT
// feeding flux (deltas the sim samples every 10 ticks). So the food web the docs describe becomes something
// you watch: a carnivore boom swells its node, the apex crops it, the omnivore re-crowds the base. Gate-blind
// DOM; the foodWebCensus core it reads is gate-tested.
var FOOD_WEB_NODES = {
  flora:    {x:0.30,y:0.86,color:'#3fcf6a',label:'Flora'},
  carrion:  {x:0.76,y:0.86,color:'#6b5545',label:'Carrion'},
  herbivore:{x:0.35,y:0.60,color:'#e6dcbc',label:'Herbivore'},
  carnivore:{x:0.17,y:0.33,color:'#6c7687',label:'Carnivore'},
  omnivore: {x:0.55,y:0.45,color:'#7b4c87',label:'Omnivore'},
  scavenger:{x:0.84,y:0.57,color:'#818753',label:'Scavenger'},
  apex:     {x:0.36,y:0.11,color:'#823841',label:'Apex'}
};
// Contrast-aware label color: dark text on a light node, light text on a dark node (perceived luminance).
function _fwText(hex){var n=parseInt(hex.slice(1),16),r=(n>>16)&255,g=(n>>8)&255,b=n&255;return (0.299*r+0.587*g+0.114*b)>140?'#10141c':'#eef2f7';}
function renderFoodWeb(){
  var gc=document.getElementById('foodWebCanvas'); if(!gc) return; var ctx=gc.getContext('2d'); if(!ctx) return;
  var w=gc.width,h=gc.height; ctx.clearRect(0,0,w,h); ctx.fillStyle='#080b10'; ctx.fillRect(0,0,w,h);
  var cen=foodWebCensus(), tiers=cen.tiers, flux=cen.flux;
  function px(id){var nd=FOOD_WEB_NODES[id];return {x:nd.x*w,y:nd.y*h};}
  function rad(id){var pop=tiers[id]?tiers[id].pop:0;return clamp(6+Math.sqrt(pop)*1.3,6,Math.min(26,h*0.14));}
  // Edges first (behind the nodes). Thickness + opacity from the recent flux; a faint dashed line when idle so
  // the topology stays legible even with no feeding this window. Arrow points eater -> prey ("X eats Y").
  for(var e=0;e<cen.edges.length;e++){var ed=cen.edges[e];var a=px(ed.from),b=px(ed.to);var fv=flux[ed.key]||0;
    var lw=clamp(0.6+Math.sqrt(fv)*0.9,0.6,7), op=fv>0?clamp(0.35+fv*0.04,0.35,0.92):0.14;
    var ra=rad(ed.from),rb=rad(ed.to),dx=b.x-a.x,dy=b.y-a.y,len=Math.max(1,Math.sqrt(dx*dx+dy*dy)),ux=dx/len,uy=dy/len;
    var ax=a.x+ux*ra,ay=a.y+uy*ra,bx=b.x-ux*(rb+5),by=b.y-uy*(rb+5);
    ctx.strokeStyle=FOOD_WEB_NODES[ed.from].color; ctx.globalAlpha=op; ctx.lineWidth=lw;
    ctx.setLineDash(fv>0?[]:[3,3]); ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(bx,by); ctx.stroke(); ctx.setLineDash([]);
    var ah=5+lw; ctx.globalAlpha=Math.max(op,0.4); ctx.fillStyle=FOOD_WEB_NODES[ed.from].color;
    ctx.beginPath(); ctx.moveTo(bx,by); ctx.lineTo(bx-ux*ah-uy*ah*0.5,by-uy*ah+ux*ah*0.5); ctx.lineTo(bx-ux*ah+uy*ah*0.5,by-uy*ah-ux*ah*0.5); ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha=1;
  var order=['flora','carrion','herbivore','carnivore','omnivore','scavenger','apex'];
  for(var n=0;n<order.length;n++){var id=order[n],p=px(id),r=rad(id),nd=FOOD_WEB_NODES[id],pop=tiers[id]?tiers[id].pop:0;
    ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.fillStyle=nd.color; ctx.fill();
    ctx.lineWidth=1; ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.stroke();
    ctx.fillStyle=_fwText(nd.color); ctx.font='bold '+(r>=12?11:9)+'px "JetBrains Mono",monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(String(pop),p.x,p.y);
    ctx.fillStyle='#7c8798'; ctx.font='9px "JetBrains Mono",monospace'; ctx.textBaseline='top';
    ctx.fillText(nd.label,p.x,p.y+r+2);
  }
  ctx.textAlign='left'; ctx.textBaseline='alphabetic';
  var badge=document.getElementById('foodWebBadge');
  if(badge){ var live=tiers.herbivore.pop+tiers.carnivore.pop+tiers.scavenger.pop+tiers.apex.pop+tiers.omnivore.pop; badge.textContent=String(live); }
}

// ===== God powers (chunk 3, pillar D): deliberate interventions with Chronicle-logged consequence =====
// PURE sim-core mutations (no DOM); the button/click hooks below call these then draw(). NONE run inside
// step(), so they sit OUTSIDE the measured ecology loop -> the harness balance is byte-identical (they are
// never called in the harness/tests, so the eRng stream there is untouched). Each logs a 'god' event so a
// deliberate act reads distinctly in the Chronicle from the world's own natural milestones. Downstream
// consequences (a drought that starves the herds, a bloom that lets them boom) are then narrated for free
// by the existing chronicleSample crash/arrival detectors over the following ticks.
function _objTierRow(name,cur,req){ if(req==null) return ''; var ok=cur>=req; return '<div class="obj-tier'+(ok?' met':'')+'"><span>'+name+'</span><span>'+cur+' / '+req+'</span></div>'; }
function renderObjective(){
  var body=document.getElementById('objectiveBody'); if(!body) return;
  var badge=document.getElementById('objectiveBadge');
  if(!activeScenario){
    body.innerHTML='<div class="obj-empty">No scenario active. Pick one from the Scenario deck to play toward a goal.</div>';
    if(badge) badge.style.display='none';
    return;
  }
  var def=activeScenario.def, st=activeScenario.status, o=def.objective;
  if(st.phase==='preparing'){
    body.innerHTML='<div class="obj-title">'+def.label+'</div><div class="obj-desc">'+o.desc+'</div>'
      +'<div class="obj-state" style="color:var(--accent)">Preparing world</div>'
      +'<div class="obj-bar"><i style="width:'+Math.round((st.progress||0)*100)+'%;background:var(--accent)"></i></div>'
      +'<div class="obj-timer">Terrain is forming - life will take root shortly.</div>';
    if(badge){ badge.style.display=''; badge.textContent='Preparing'; }
    return;
  }
  var stateLbl=st.state==='won'?'Complete':st.state==='lost'?'Failed':(st.phase==='holding'?'Holding':st.phase==='establishing'?'Establishing':'In progress');
  var stateColor=st.state==='won'?'var(--green)':st.state==='lost'?'var(--red)':'var(--accent)';
  var pct=Math.round((st.progress||0)*100);
  var s=chronicleStats();
  var target=o.goal==='establish'?o.need:(st.phase==='holding'?o.floor:o.establish);
  var html='<div class="obj-title">'+def.label+'</div><div class="obj-desc">'+o.desc+'</div>';
  html+='<div class="obj-state" style="color:'+stateColor+'">'+stateLbl+'</div>';
  html+='<div class="obj-bar"><i style="width:'+pct+'%;background:'+stateColor+'"></i></div>';
  html+='<div class="obj-tiers">'+_objTierRow('Flora',s.flora,target.flora)+_objTierRow('Herbivores',s.herb,target.herb)+_objTierRow('Carnivores',s.carn,target.carn)+'</div>';
  if(o.goal==='endure'&&st.phase==='holding'&&st.state==='active') html+='<div class="obj-timer">Held '+(tick-st.establishedTick)+' / '+o.duration+' ticks</div>';
  body.innerHTML=html;
  if(badge){ badge.style.display=''; badge.textContent=stateLbl; }
}
// DOM wrapper: start a scenario from the deck. Reaches the SAME deterministic world as the sync
// applyScenarioDef (same initWorld(seed) -> step-to-target -> seed life), but warms the terrain
// ASYNCHRONOUSLY in small chunks so the tab never freezes and the world visibly forms (a mini genesis).
var _scenWarmTimer=null;
function startScenario(id){
  var def=SCENARIOS[id]; if(!def) return;
  leaveBoard();
  if(_scenWarmTimer){ clearTimeout(_scenWarmTimer); _scenWarmTimer=null; }
  followId=null; // this launch path bypasses init(); initWorld below re-issues ids from 1, so drop any stale follow
  running=false;
  _applyPresetCfg(def.preset);
  initWorld(def.seed);placeMode='none';resetZoomPan();
  // A 'preparing' placeholder so the Objective panel shows warmup progress (armed for real once life is seeded).
  setActiveScenario({ def:def, startTick:0, status:{state:'active',phase:'preparing',establishedTick:null,progress:0} });
  var seedElP=document.getElementById('seedInput'); if(seedElP) seedElP.value=_seed;
  var hSeedElP=document.getElementById('hSeed'); if(hSeedElP) hSeedElP.textContent=_seed;
  resize(); syncUIToConfig();
  var op=document.getElementById('panelObjective'); if(op) op.classList.remove('collapsed');
  var target=def.warmupLand||0.01;
  function warmChunk(){
    _scenWarmTimer=null;
    for(var n=0;n<40 && tick<SCENARIO_WARMUP_CAP && landCoverage()<target;n++) step();
    if(activeScenario) activeScenario.status.progress=clamp(landCoverage()/target,0,1);
    draw();
    if(tick<SCENARIO_WARMUP_CAP && landCoverage()<target){ _scenWarmTimer=setTimeout(warmChunk,0); return; }
    _seedScenarioLife(def);                                   // land is ready -> seed the initial life
    activeScenario.startTick=tick; activeScenario.status=initialScenarioStatus(def);
    chronicleNote('scenario','Scenario begun - '+def.label+': '+def.objective.desc,'#8fd0ff');
    running=true; draw();                                     // hand off to the normal loop, which now plays
  }
  warmChunk();
}

// ===== Init & loop =====
var _pendingWorldCode = getWorldCodeParam();

// ===== Default world: a random good seed grown from genesis into a continent =====
// The default opens from tick-0 OCEAN and grows into a full continent as it runs, at full speed, so a
// visitor WATCHES the world form. A random seed from the vetted set + cranked land growth (matching
// scripts/hero-scan.mjs) reliably builds a big, lush landmass instead of the slow stock default.
var HERO_SEEDS = [3,7,9,12,23,42,55,64,88,111,144,256,314,512,808];
var _heroBootPending = true;
function _applyContinentCfg(){
  // Pangaea base + full coastal fill toward a big landmass. Terrain dials ONLY - the tuned ecology
  // rates are untouched, so ecosystem balance is unaffected.
  _applyPresetCfg('pangaea');
  CFG.maxLandCap = 0.87;
  CFG.coastalSpreadBase = 0.02;
  CFG.volcanoChancePerTile = 0.0002;
}

function init(){
  // Hero rotation may fire only on the genuine first boot; capture and disarm before anything else so
  // that a later Reset / roll / preset change always builds a fresh cold world instead.
  var _heroBoot = _heroBootPending; _heroBootPending = false;
  // Cancel any in-flight scenario warmup: init() is the shared rebuild path (reset / roll-seed / map-size /
  // preset / sandbox / 'r'), and an orphaned _scenWarmTimer would keep step()-ing + seeding scenario life into
  // the fresh world, then throw on the now-null activeScenario. startScenario clears it on re-entry; init must too.
  if(_scenWarmTimer){ clearTimeout(_scenWarmTimer); _scenWarmTimer=null; }
  // A rebuilt world re-issues fauna ids from 1, so a stale followId would re-attach the camera to an unrelated
  // creature (or spuriously report "the creature you were following has died"). Drop the follow on any rebuild.
  followId=null;
  // With Root playing Ketch'em, a rebuilt world gets a new board of the same setting, so Root is never left standing
  // in a world with no game (adversarial run 2026-10-25); without Root, Reset leaves the game for the plain world.
  var _kRebuild=((K||_kProgress)&&rootPlaying())?{setting:K?K.setting:_kProgress.setting,size:K?(K.size||W):W}:null;   // a board in flight counts: a second Reset mid-build still leaves Root a board
  K=null;abandonBuild();closeAsk();   // a rebuilt world has no board; a build in flight is abandoned (its caller is told)
  if(_kRebuild)setTimeout(function(){if(!K&&!_kProgress)startKetchem(_kRebuild.setting,undefined,_kRebuild.size);},0);
  if(typeof document!=='undefined')document.body.classList.remove('ketchem');
  if(_pendingWorldCode){
    var wc=_pendingWorldCode; _pendingWorldCode=null;
    try{
      var decoded=decodeWorldCode(wc);
      // A scenario permalink: route through the async startScenario so the boot stays responsive and the
      // world visibly forms (it re-arms the same objective + reaches the same deterministic world).
      if(decoded&&typeof decoded==='object'&&decoded.v===WORLD_CODE_VERSION&&decoded.scen&&SCENARIOS[decoded.scen]){
        startScenario(decoded.scen); return;
      }
      applyWorldCode(decoded);placeMode='none';resetZoomPan(); // resets CFG, layers the diff, restores the preset, re-inits from the seed
      chronicleNote('terrain','A shared world is restored.','#8a9a7b');
      var seedElP=document.getElementById('seedInput');if(seedElP)seedElP.value=_seed;
      var hSeedElP=document.getElementById('hSeed');if(hSeedElP)hSeedElP.textContent=_seed;
      resize();syncUIToConfig();draw();refreshUndoBtn();   // after the rebuild, which is what clears the mark
      return;
    }catch(e){
      var errBox=document.getElementById('err');if(errBox){errBox.style.display='block';errBox.textContent='World link error: '+e.message+' - starting a fresh world.';}
      _heroBoot=false; // a broken ?w= link falls back to a fresh cold world (as the banner says), never a hero
    }
  }
  var seedEl=document.getElementById('seedInput');
  var seedVal=seedEl?seedEl.value.trim():'';
  if(_heroBoot && !seedVal){
    // The default world: a random vetted seed grown from tick-0 OCEAN into a continent, at full speed,
    // so the visitor watches it form (rather than opening on a finished, mid-simulation world).
    clearScenario();
    _applyContinentCfg();
    initWorld(HERO_SEEDS[(Math.random()*HERO_SEEDS.length)|0]);
    placeMode='none';resetZoomPan();
    chronicleNote('terrain','A new world begins.','#8a9a7b');
    var hSeedElH=document.getElementById('hSeed');if(hSeedElH)hSeedElH.textContent=_seed;
    var seedInpH=document.getElementById('seedInput');if(seedInpH)seedInpH.value='';
    var psH=document.getElementById('presetSelect');if(psH)psH.value=activePreset;
    running=true; speed=60;                 // watch it form at full speed
    var spH=document.getElementById('speed');if(spH)spH.value=60;
    resize();buildSliders();draw();refreshUndoBtn();
    fitCanvas();                            // size the world to fill the near-full-screen viewer
    return;
  }
  clearScenario(); // a plain new world (reset / roll seed / map-size / preset change) leaves any scenario
  initWorld(seedVal);placeMode='none';resetZoomPan();
  chronicleNote('terrain','A new world begins.','#8a9a7b');
  var hSeedEl=document.getElementById('hSeed');if(hSeedEl)hSeedEl.textContent=_seed;
  if(seedEl&&!seedVal)seedEl.value='';
  resize();buildSliders();draw();refreshUndoBtn();
}
// A held direction key moves Kevin every tick within the stride budget, independent of the OS key-repeat delay.
function kevinHeld(){
  if(!K||!K.kevin)return;var dx=0,dy=0;
  for(var q in KEYDIR){if(_kPressed[q]!==undefined&&tick>_kPressed[q]+1){dx+=KEYDIR[q][0];dy+=KEYDIR[q][1];}}   // a tap moves once (the keydown); a hold repeats from the second tick
  dx=Math.sign(dx);dy=Math.sign(dy);if(dx||dy){tryStep(K,K.kevin,dx,dy);kevinMoved();}
}
function kevinNews(){if(!K)return;var n=drainNews(K,'kevin');if(n.length)kevinSay(n[n.length-1]);}
function growthNews(){var ev=growthTick(K);for(var i=0;i<ev.length;i++){var e=ev[i],owner=(K.kevin&&K.kevin.party.indexOf(e.creature)>=0)?'kevin':((K.root&&K.root.id)||'root');var line=(e.creature.name||e.creature.type)+(e.kind==='grow'?' reaches growth level '+e.level:' EVOLVED from '+e.from+' into '+e.to+(e.named?'':(owner==='kevin'?': name the species (N)':guestSeated(K)?": name the species (')":': name the species (name)')));if(owner==='kevin')kevinSay(line);else pushNews(K,owner,line);}}
function loop(){try{if(running){step();if(K){encounterTick(K);marketTick(K);growthNews();kevinNews();if(K.kevin.moved){K.kevin.moved=false;_kCamAt=null;}if(guestSeated(K)){var gn=drainNews(K,K.root.id);if(gn.length)guestSay(gn[gn.length-1]);if(K.root.moved){K.root.moved=false;guestMoved();}}}visitTick();kevinHeld();guestHeld();kevinAutosave();draw();}}catch(e){var err=document.getElementById('err');if(err){err.style.display='block';err.textContent='Loop error: '+e.message+'\n'+(e.stack||'');}running=false;}var delay=Math.max(10,CFG.tickMsBase*(12/Math.max(1,speed)));if(loopTimer)clearTimeout(loopTimer);loopTimer=setTimeout(loop,delay);}

// ===== Tests =====
function runTests(){
  var tp=document.getElementById('panelTests');if(tp)tp.classList.remove('collapsed');
  var r=runAssertions();var out=r.out,pass=r.pass,fail=r.fail;
  var el=document.getElementById('tests');if(el)el.textContent=out.join('\n')+'\n\n'+pass+' passed, '+fail+' failed';
  var badge=document.getElementById('testsBadge');if(badge){badge.textContent=pass+'✓ '+fail+'✗';badge.style.color=fail?'var(--red)':'var(--green)';badge.style.borderColor=fail?'var(--red-dim)':'var(--green-dim)';badge.style.background=fail?'var(--red-dim)':'var(--green-dim)';}
}

// ===== Boot =====
function boot(){
  try{if(!canvas||!canvas.getContext)throw new Error('Canvas unsupported');if(!ctx)ctx=canvas.getContext('2d');ctx.fillStyle='#00111a';ctx.fillRect(0,0,canvas.width||512,canvas.height||512);ctx.fillStyle='#3b9eff';ctx.font='13px "JetBrains Mono",monospace';ctx.fillText('initializing…',12,22);running=true;if(loopTimer){clearTimeout(loopTimer);loopTimer=null;}if(!started){started=true;init();
      if(_pendingKetchem){var kp=_pendingKetchem;_pendingKetchem=null;startKetchem(kp.setting,kp.seed,kp.size);}}   // ?ketchem= boot: build a board over the fresh world
    draw();loop();}
  catch(e){var err=document.getElementById('err');if(err){err.style.display='block';err.textContent='Boot error: '+e.message+'\n'+(e.stack||'');}console.error(e);}
}
function dismissIntro(){
  var overlay=document.getElementById('introOverlay');
  if(!overlay)return;
  overlay.classList.add('dismissing');
  setTimeout(function(){overlay.style.display='none';boot();},600);
}
(function(){
  var startBtn=document.getElementById('introStart');
  if(startBtn)startBtn.addEventListener('click',dismissIntro);
  // Keyboard shortcut: Space or Enter to start
  // Inert once the intro is gone (dismissed by click or key), or it would eat Space/Enter page-wide.
  function introKey(e){var ov=document.getElementById('introOverlay');if(!ov||ov.classList.contains('dismissing')){window.removeEventListener('keydown',introKey);return;}
    if(e.code==='Space'||e.code==='Enter'){e.preventDefault();dismissIntro();window.removeEventListener('keydown',introKey);}}
  window.addEventListener('keydown',introKey);
})();

// Root's visit: on a locally served page with the relay running, a "Call Root" toggle joins the top bar.
// Inert on the public site and when no relay answers; the game is unchanged until Root is called in.
bootVisit({draw:draw,screenToTile:screenToTile,canvas:canvas,getSpeed:function(){return speed;},
  setSpeed:function(s){speed=s;var sp=document.getElementById('speed');if(sp)sp.value=s;},
  onGodMark:refreshUndoBtn,     // Root's shaping is one act in the Hand's undo, so the button must wake for it
  ketchem:{board:function(){return K;},building:function(){return !!_kProgress;},start:function(setting,seed,cb){startKetchem(setting,seed,96,cb);}}});   // the game mode builds a board first

// Verification handle, active ONLY with ?debug in the URL (inert for normal users). Lets the
// gate-blind river visual verify drive load->rivers->draw from one script call, no file dialog.
if(typeof location!=='undefined'&&/[?&]debug(\b|=)/.test(location.search)){
  window.__wb={sim:SIM,importJSON:importJSON,generateRivers:generateRivers,computeAridity:computeAridity,
    reclassTerrain:reclassTerrain,draw:draw,resize:resize,initWorld:initWorld,step:step,landCoverage:landCoverage,
    setPix:function(p){PIX=p;},setView:function(z,px,py){zoomLevel=z;panX=px;panY=py;applyZoomPan();draw();},
    lakeCells:function(){var out=[];if(riverData)for(var i=0;i<riverData.length;i++)if(riverData[i]&&riverData[i].lake)out.push(i);return out;},
    // Ketch'em step 3: build a board from the console, read it back, lift the fog for a screenshot.
    ketchem:{start:startKetchem,board:function(){return K;},building:function(){return !!_kProgress;},fogOff:function(){if(K&&K.fog){K.fog.fill(255);draw();}},
      step:function(dx,dy){if(!K||!K.kevin)return null;var r=tryStep(K,K.kevin,dx,dy);draw();return r;},interact:function(){return K&&K.kevin?interact(K,K.kevin):null;},
      // saves (step 5): the record as the page would write it, a save without the prompt, a load by slot or from a record
      saveJSON:function(){return K?exportSave(buildSave(K,K.slot||String(K.seed))):null;},save:function(slot){if(K){K.slot=slot||K.slot||String(K.seed);}return saveGame();},
      load:loadGame,loadData:function(data){adoptBoard(applySave(data));},guest:function(on,name){if(!K)return null;var r=on?seatGuest(K,rootPlaying(),name):unseatGuest(K);if(!on){_guestCarry=null;_guestRemote=false;_gPotion=false;_gBait=null;_gAlmanac=false;if(linkOpen())closeLink();}draw();return r;},slots:listSlots,pause:function(on){_kHold=!!on;running=!_kHold;if(running)loop();}}};
}

// ===== Snapshot / restore (headless A/B: warm the slow terrain once, replay ecology many times) =====
// Captures ALL sim state needed to resume a run: the terrain + climate typed arrays, the
// flora/fauna/remnant lists, world meta, and the scalars. mulberry32's internal counter is not
// externally readable, so the snapshot stores the SEED and restoreState RE-SEEDS sRng/eRng from it
// (exactly as initWorld does). Two restores of one snapshot therefore replay identically - proven by
// the determinism-through-snapshot test. structuredClone gives an independent deep copy (typed arrays
// keep their view type, nested flora/fauna/blob objects are copied), so the snapshot survives reuse.
