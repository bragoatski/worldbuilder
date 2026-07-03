'use strict';
// Worldbuilder - the browser UI shell (chunk 10). Rendering, canvas, DOM wiring, and the
// animation loop. The pure simulation core lives in src/sim.js and is imported below; this
// file is the ONLY one that touches document/window/canvas. Never imported headlessly.

// The DOM-free simulation core. Every non-browser symbol this shell uses is imported here; the list
// is exhaustive (eslint no-undef would flag any omission). Live bindings (flora/fauna/tick/W/H/...)
// reflect reassignment inside sim.js, so the render reads current state each frame.
import {
  CFG, DEATH_PARTICLE_LIFE, DIR_DX, DIR_DY, H, POP_HISTORY_LEN, SCENARIOS, SCENARIO_WARMUP_CAP,
  SPECIES_MIN_GEN, SPECIES_MIN_POP, T, TERRAIN_COLORS, TNAME, W, WORLD_CODE_VERSION, _applyPresetCfg,
  _capType, _seed, _seedScenarioLife, activePreset, activeScenario, applyClimate, applyElevationIntensity,
  applySnapshot, applyWorldCode, aridity, baseArid, baseTemp, biomeBoundary, bloomEvent, brushTerrain,
  buildSnapshot, carrion, chronicle, chronicleNote, chronicleStats, clamp, clearScenario, computeAridity,
  deathParticles, decodeWorldCode, droughtEvent, elev, fauna, flora, floraRemnants, generateRivers,
  getSpeciesName, grid, hsv2hex, idx, inb, initWorld, initialScenarioStatus, lakeShapes, landCoverage,
  makeFauna, meteorStrike, peakVolcano, popHistory, reclassTerrain, riverData, riverGenerated, runAssertions,
  seasonPhase, seedFaunaGroup, seedFloraCluster, setActiveScenario, setDeathParticles, setWorldSize, speciesCensus,
  speciesRegistry, step, sunlight, tempField, tick, worldPermalink, worldPostcard,
} from './sim.js';

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
var RIVER_COLOR = '#3aa6e0';
var LAKE_COLOR = '#3aa6e0';         // unified with RIVER_COLOR so lakes + rivers read as one water body
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
  html+='<span class="ig-k">Climate pref</span><span class="ig-v">A'+f.prefArid.toFixed(1)+' T'+f.prefTemp.toFixed(1)+' S'+f.prefSL.toFixed(1)+'</span>';
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
hook('btnReset',function(){running=false;init();buildSliders();applyElevationIntensity();draw();});
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
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&placeMode!=='none')setPlaceMode('none');});
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

canvas.addEventListener('click',function(ev){if(!grid)return;var tile=screenToTile(ev.clientX,ev.clientY);var x=tile.x,y=tile.y;
  if((placeMode==='raise'||placeMode==='lower')&&inb(x,y)){brushTerrain(x,y,placeMode==='raise'?1:-1);draw();return;}
  if(placeMode!=='none'&&inb(x,y)){var ti=idx(x,y);var t=grid[ti];if(t!==T.OCEAN&&t!==T.MOUNTAIN&&t!==T.VOLCANIC){fauna.push(makeFauna(x,y,placeMode,null));draw();}return;}
  lastClick={x:x,y:y};inspectTile(x,y);});
canvas.addEventListener('mousemove',function(ev){
  if(isPanning){
    var dx=ev.clientX-panStartX,dy=ev.clientY-panStartY;
    panX=panStartPX+dx/zoomLevel;panY=panStartPY+dy/zoomLevel;
    applyZoomPan();return;
  }
  updateTooltip(ev);
});
canvas.addEventListener('mouseleave',function(){var t=document.getElementById('tip');if(t)t.style.display='none';});

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
  if(ev.button===2){ev.preventDefault();isPanning=true;panStartX=ev.clientX;panStartY=ev.clientY;panStartPX=panX;panStartPY=panY;canvas.style.cursor='grabbing';}
});
window.addEventListener('mouseup',function(ev){
  if(isPanning){isPanning=false;canvas.style.cursor=placeMode!=='none'?'cell':'crosshair';}
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

// Hotkeys
window.addEventListener('keydown',function(e){
  if(/INPUT|SELECT|TEXTAREA/.test((e.target||{}).tagName||''))return;
  if(e.code==='Space'){e.preventDefault();running=!running;if(running)loop();}
  else if(e.key==='s'||e.key==='S'){e.preventDefault();running=false;step();draw();}
  else if(e.key==='r'||e.key==='R'){e.preventDefault();running=false;init();buildSliders();applyElevationIntensity();draw();}
  else if(e.key==='f'||e.key==='F'){e.preventDefault();running=true;started=false;boot();}
  else if(e.key==='t'||e.key==='T'){e.preventDefault();runTests();}
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
function drawRivers(){
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

// ======================================================================
//  SPECIES NAMING SYSTEM
// ======================================================================
function draw(){
  if(!ctx||!grid||!elev)return;ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
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
  if(overlayMode==='none'||overlayMode==='elev')drawRivers();
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
    if(a.id===followId){ctx.strokeStyle='#3b9eff';ctx.lineWidth=1;var rs=dim+4;var ro=((PIX-rs)/2)|0;ctx.strokeRect(apx+ro+0.5,apy+ro+0.5,rs-1,rs-1);}}}
  // Death particles
  var aliveParticles=[];
  for(var dp=0;dp<deathParticles.length;dp++){var p=deathParticles[dp];var age=tick-p.tick;if(age>=DEATH_PARTICLE_LIFE)continue;aliveParticles.push(p);var alpha=1.0-age/DEATH_PARTICLE_LIFE;var px=p.x*PIX,py=p.y*PIX;ctx.globalAlpha=alpha;
    if(p.type==='kill'){ctx.strokeStyle='#ff3333';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(px+1,py+1);ctx.lineTo(px+PIX-1,py+PIX-1);ctx.moveTo(px+PIX-1,py+1);ctx.lineTo(px+1,py+PIX-1);ctx.stroke();}
    else if(p.type==='starve'){ctx.fillStyle='#888';ctx.beginPath();ctx.arc(px+PIX/2,py+PIX/2,PIX/3,0,Math.PI*2);ctx.fill();}
    else if(p.type==='age'){ctx.fillStyle='#aaa';ctx.fillRect(px+1,py+PIX/2,PIX-2,1);}
  }ctx.globalAlpha=1.0;setDeathParticles(aliveParticles);
  // Carrion (scavenger food): a small dark speck where a corpse lies (only present when scavengers are on).
  if(CFG.ecoRender&&carrion.length){ctx.fillStyle='#5a5048';for(var cq=0;cq<carrion.length;cq++){var cc2=carrion[cq];if(!cc2)continue;var cwv=riverData&&riverData[idx(cc2.x,cc2.y)];if(cwv&&cwv.lake)continue;ctx.fillRect(cc2.x*PIX+((PIX/2)|0),cc2.y*PIX+((PIX/2)|0),1,1);}}
  drawHUD();renderChronicle();renderObjective();renderSpecies();updateFollow();
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
  var html='<h4><span class="tsw" style="background:'+sw+'"></span>'+terr+' ('+x+','+y+')</h4>';
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
  applySnapshot(data);                    // pure state load (validates + reassigns sim state, DOM-free)
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
  try{ if(typeof history!=='undefined'&&history.replaceState) history.replaceState(null,'',url); }catch(e){}
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
  // Find max across all series for scaling
  var maxVal=10;for(var mi=0;mi<hist.flora.length;mi++){if(hist.flora[mi]>maxVal)maxVal=hist.flora[mi];if(hist.herb[mi]*4>maxVal)maxVal=hist.herb[mi]*4;if(hist.carn[mi]*4>maxVal)maxVal=hist.carn[mi]*4;}
  maxVal=maxVal*1.1; // 10% headroom
  var n=hist.flora.length;var xStep=w/Math.max(1,n-1);
  // Grid lines
  gctx.strokeStyle='#1c2636';gctx.lineWidth=1;
  for(var gy=0;gy<4;gy++){var yy=Math.round(h*gy/4)+0.5;gctx.beginPath();gctx.moveTo(0,yy);gctx.lineTo(w,yy);gctx.stroke();}
  // Scale label
  gctx.fillStyle='#4a5568';gctx.font='9px "JetBrains Mono",monospace';gctx.fillText(Math.round(maxVal),2,10);gctx.fillText('0',2,h-2);
  // Draw series
  function drawSeries(data,color,scale){
    gctx.strokeStyle=color;gctx.lineWidth=1.5;gctx.globalAlpha=0.85;gctx.beginPath();
    for(var si=0;si<data.length;si++){var sx=si*xStep;var sy=h-clamp(data[si]*scale/maxVal,0,1)*h;if(si===0)gctx.moveTo(sx,sy);else gctx.lineTo(sx,sy);}
    gctx.stroke();gctx.globalAlpha=1.0;
  }
  drawSeries(hist.flora,'#3fcf6a',1);
  drawSeries(hist.herb,'#5bb8f0',4); // scaled 4x so fauna is visible alongside flora
  drawSeries(hist.carn,'#e85454',4);
  // Scale indicators for fauna
  if(hist.herb.length>0||hist.carn.length>0){gctx.fillStyle='#4a5568';gctx.fillText('fauna ×4',w-52,10);}
}

function drawHUD(){
  var sumA=0,sumS=0,sumE=0,count=0;
  for(var ii=0;ii<W*H;ii++){if(grid[ii]!==T.OCEAN){sumA+=aridity[ii]||0;sumS+=sunlight[ii]||0;sumE+=elev[ii]||0;count++;}}
  var herbCount=0,carnCount=0;for(var fi=0;fi<fauna.length;fi++){if(!fauna[fi])continue;if(fauna[fi].type==='herbivore')herbCount++;else carnCount++;}
  var el;
  el=document.getElementById('hTick');if(el)el.textContent=tick;
  el=document.getElementById('hLand');if(el)el.textContent=(landCoverage()*100).toFixed(1)+'%';
  el=document.getElementById('hElev');if(el)el.textContent=count?(sumE/count).toFixed(1):'—';
  el=document.getElementById('hArid');if(el)el.textContent=count?(sumA/count).toFixed(1):'—';
  el=document.getElementById('hSun');if(el)el.textContent=count?(sumS/count).toFixed(1):'—';
  el=document.getElementById('hFlora');if(el)el.textContent=flora.length;
  el=document.getElementById('hHerb');if(el)el.textContent=herbCount;
  el=document.getElementById('hCarn');if(el)el.textContent=carnCount;
  // Status dot
  var dot=document.getElementById('statusDot');if(dot){dot.className=running?'dot running':'dot paused';}
  // Season
  var sw=document.getElementById('hSeasonWrap'),sEl=document.getElementById('hSeason');
  if(sw&&sEl){if(CFG.seasonalTilt){sw.style.display='';sEl.textContent=Math.round(seasonPhase()*100)+'%';}else{sw.style.display='none';}}
  // Zoom indicator
  var zw=document.getElementById('hZoomWrap'),zEl=document.getElementById('hZoom');
  if(zw&&zEl){if(zoomLevel!==1){zw.style.display='';zEl.textContent=Math.round(zoomLevel*100)+'%';}else{zw.style.display='none';}}
  // Record population history (every 3 ticks to avoid bloat)
  if(tick%3===0){popHistory.flora.push(flora.length);popHistory.herb.push(herbCount);popHistory.carn.push(carnCount);popHistory.ticks.push(tick);if(popHistory.flora.length>POP_HISTORY_LEN){popHistory.flora.shift();popHistory.herb.shift();popHistory.carn.shift();popHistory.ticks.shift();}}
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
  if(_scenWarmTimer){ clearTimeout(_scenWarmTimer); _scenWarmTimer=null; }
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
function init(){
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
      resize();syncUIToConfig();draw();
      return;
    }catch(e){
      var errBox=document.getElementById('err');if(errBox){errBox.style.display='block';errBox.textContent='World link error: '+e.message+' - starting a fresh world.';}
    }
  }
  var seedEl=document.getElementById('seedInput');
  var seedVal=seedEl?seedEl.value.trim():'';
  clearScenario(); // a plain new world (reset / roll seed / map-size / preset change) leaves any scenario
  initWorld(seedVal);placeMode='none';resetZoomPan();
  chronicleNote('terrain','A new world begins.','#8a9a7b');
  var hSeedEl=document.getElementById('hSeed');if(hSeedEl)hSeedEl.textContent=_seed;
  if(seedEl&&!seedVal)seedEl.value='';
  resize();buildSliders();draw();
}
function loop(){try{if(running){step();draw();}}catch(e){var err=document.getElementById('err');if(err){err.style.display='block';err.textContent='Loop error: '+e.message+'\n'+(e.stack||'');}running=false;}var delay=Math.max(10,CFG.tickMsBase*(12/Math.max(1,speed)));if(loopTimer)clearTimeout(loopTimer);loopTimer=setTimeout(loop,delay);}

// ===== Tests =====
function runTests(){
  var tp=document.getElementById('panelTests');if(tp)tp.classList.remove('collapsed');
  var r=runAssertions();var out=r.out,pass=r.pass,fail=r.fail;
  var el=document.getElementById('tests');if(el)el.textContent=out.join('\n')+'\n\n'+pass+' passed, '+fail+' failed';
  var badge=document.getElementById('testsBadge');if(badge){badge.textContent=pass+'✓ '+fail+'✗';badge.style.color=fail?'var(--red)':'var(--green)';badge.style.borderColor=fail?'var(--red-dim)':'var(--green-dim)';badge.style.background=fail?'var(--red-dim)':'var(--green-dim)';}
}

// ===== Boot =====
function boot(){
  try{if(!canvas||!canvas.getContext)throw new Error('Canvas unsupported');if(!ctx)ctx=canvas.getContext('2d');ctx.fillStyle='#00111a';ctx.fillRect(0,0,canvas.width||512,canvas.height||512);ctx.fillStyle='#3b9eff';ctx.font='13px "JetBrains Mono",monospace';ctx.fillText('initializing…',12,22);running=true;if(loopTimer){clearTimeout(loopTimer);loopTimer=null;}if(!started){started=true;init();}draw();loop();}
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
  function introKey(e){if(e.code==='Space'||e.code==='Enter'){e.preventDefault();dismissIntro();window.removeEventListener('keydown',introKey);}}
  window.addEventListener('keydown',introKey);
})();

// Verification handle, active ONLY with ?debug in the URL (inert for normal users). Lets the
// gate-blind river visual verify drive load->rivers->draw from one script call, no file dialog.
if(typeof location!=='undefined'&&/[?&]debug(\b|=)/.test(location.search)){
  window.__wb={importJSON:importJSON,generateRivers:generateRivers,computeAridity:computeAridity,
    reclassTerrain:reclassTerrain,draw:draw,resize:resize,initWorld:initWorld,step:step,landCoverage:landCoverage,
    setPix:function(p){PIX=p;},setView:function(z,px,py){zoomLevel=z;panX=px;panY=py;applyZoomPan();draw();},
    lakeCells:function(){var out=[];if(riverData)for(var i=0;i<riverData.length;i++)if(riverData[i]&&riverData[i].lake)out.push(i);return out;}};
}

// ===== Snapshot / restore (headless A/B: warm the slow terrain once, replay ecology many times) =====
// Captures ALL sim state needed to resume a run: the terrain + climate typed arrays, the
// flora/fauna/remnant lists, world meta, and the scalars. mulberry32's internal counter is not
// externally readable, so the snapshot stores the SEED and restoreState RE-SEEDS sRng/eRng from it
// (exactly as initWorld does). Two restores of one snapshot therefore replay identically - proven by
// the determinism-through-snapshot test. structuredClone gives an independent deep copy (typed arrays
// keep their view type, nested flora/fauna/blob objects are copied), so the snapshot survives reuse.
