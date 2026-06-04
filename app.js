/* BIO 114 — California Plants Study Guide
   Vanilla JS single-page study app. Data comes from data.js (window.PLANTS). */
(function(){
"use strict";

var PLANTS = (window.PLANTS || []).slice();
PLANTS.forEach(function(p){ p.communities = (p.all_communities||p.primary_community||"").split(";").map(function(s){return s.trim();}).filter(Boolean); });
var COMMUNITIES = uniq(PLANTS.map(function(p){return p.primary_community;}).filter(Boolean));

/* ---------------- utilities ---------------- */
function uniq(a){ return a.filter(function(v,i){return a.indexOf(v)===i;}); }
function shuffle(a){ a=a.slice(); for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=a[i];a[i]=a[j];a[j]=t;} return a; }
function sampleDistinct(values,n,exclude){
  exclude=exclude||[];
  var pool=uniq(values).filter(function(v){return exclude.indexOf(v)===-1;});
  return shuffle(pool).slice(0,n);
}
function esc(s){ return (s==null?"":String(s)).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function el(id){ return document.getElementById(id); }
// Canonical username handle (MUST match cleanName() in api/progress.js).
function cleanName(s){ return String(s==null?"":s).trim().replace(/\s+/g,"_").replace(/[^A-Za-z0-9_]/g,"").slice(0,24); }

function normalize(s){
  return (s==null?"":String(s)).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g,"")
    .replace(/\(.*?\)/g," ").replace(/[^a-z0-9\s\/]/g," ")
    .replace(/\bspp\b/g," ").replace(/\s+/g," ").trim();
}
function lev(a,b){
  var m=a.length,n=b.length; if(!m)return n; if(!n)return m;
  var prev=[],cur=[],i,j;
  for(j=0;j<=n;j++)prev[j]=j;
  for(i=1;i<=m;i++){ cur[0]=i;
    for(j=1;j<=n;j++){ var c=a.charCodeAt(i-1)===b.charCodeAt(j-1)?0:1;
      cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+c); }
    var tmp=prev; prev=cur; cur=tmp;
  }
  return prev[n];
}
function simRatio(a,b){ if(!a&&!b)return 1; var mx=Math.max(a.length,b.length,1); return 1-(lev(a,b)/mx); }

// typed-answer checker. accepts an array of acceptable answers + an optional pass threshold
// (default 0.80). ok = exact (normalized) OR >= threshold character similarity.
// Handles "/"-separated alternatives. Returns {ok, ratio}.
function checkTyped(input, acceptList, threshold){
  if(typeof threshold!=="number") threshold=0.8;
  var ni=normalize(input);
  if(!ni) return {ok:false, ratio:0};
  var best=0;
  for(var k=0;k<acceptList.length;k++){
    var ans=acceptList[k]||"";
    var variants={};
    ans.split("/").forEach(function(x){ var q=normalize(x); if(q)variants[q]=1; });
    variants[normalize(ans.replace(/\//g," "))]=1;
    for(var v in variants){
      if(!v) continue;
      if(ni===v) return {ok:true, ratio:1};
      var r=simRatio(ni,v);
      if(r>best)best=r;
    }
  }
  return {ok: best>=threshold, ratio: best};
}

/* ---------------- user profiles + persistent progress ----------------
   Progress is namespaced per username so multiple students can share one device.
   Storage (localStorage):
     bio114_users   -> ["alice","bob"]            (index of profiles)
     bio114_active  -> "alice"                    (current profile)
     bio114_u_alice -> {watch:{}, stats:{...}}    (that profile's data)
   The per-user blob maps 1:1 to a key/value row, so a cloud KV backend can sync it later. */
var USERS_KEY="bio114_users", ACTIVE_KEY="bio114_active", UPREFIX="bio114_u_";
function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
function listUsers(){ try{ return JSON.parse(lsGet(USERS_KEY))||[]; }catch(e){ return []; } }
function getActiveUser(){ return lsGet(ACTIVE_KEY); }
function setActiveUser(name){ lsSet(ACTIVE_KEY, name); updateUserChip(); updateWatchBadge(); }
function blankProfile(){
  return { watch:{},
    stats:{answered:0, correct:0, simEasyBest:null, simHardBest:null, simPracticalBest:null},
    plants:{},      // per-plant mastery: id -> {seen,correct,wrong,last,lastTs}
    sessions:[],    // completed quizzes (newest first): {ts,kind,total,correct,pct}
    log:[] };       // rolling answer history (newest first): {ts,id,type,correct}
}
// Ensure a loaded blob has every field (migrates older {watch,stats}-only profiles).
function normalizeProfile(b){
  b = (b && typeof b==="object") ? b : {};
  if(!b.watch || typeof b.watch!=="object") b.watch={};
  if(!b.stats || typeof b.stats!=="object") b.stats={};
  if(typeof b.stats.answered!=="number") b.stats.answered=0;
  if(typeof b.stats.correct!=="number") b.stats.correct=0;
  if(b.stats.simEasyBest===undefined) b.stats.simEasyBest=null;
  if(b.stats.simHardBest===undefined) b.stats.simHardBest=null;
  if(b.stats.simPracticalBest===undefined) b.stats.simPracticalBest=null;
  if(!b.plants || typeof b.plants!=="object") b.plants={};
  if(!Array.isArray(b.sessions)) b.sessions=[];
  if(!Array.isArray(b.log)) b.log=[];
  return b;
}
function userKey(name){ return UPREFIX + encodeURIComponent(name); }
function createUser(name){
  name=cleanName(name); if(!name) return null;
  var users=listUsers();
  if(users.map(function(u){return u.toLowerCase();}).indexOf(name.toLowerCase())===-1){
    users.push(name); lsSet(USERS_KEY, JSON.stringify(users));
    lsSet(userKey(name), JSON.stringify(blankProfile()));
  } else {
    // reuse exact stored casing
    name=users[users.map(function(u){return u.toLowerCase();}).indexOf(name.toLowerCase())];
  }
  setActiveUser(name);
  return name;
}
function loadProfile(name){
  name=name||getActiveUser(); if(!name) return blankProfile();
  try{ return normalizeProfile(JSON.parse(lsGet(userKey(name)))); }catch(e){ return blankProfile(); }
}
function saveProfileLocal(blob, name){
  name=name||getActiveUser(); if(!name) return;
  lsSet(userKey(name), JSON.stringify(normalizeProfile(blob)));
}
// save locally AND (debounced) push to the cloud database
function saveProfile(blob, name){
  name=name||getActiveUser();
  saveProfileLocal(blob, name);
  schedulePush(name);
}
function deleteUser(name){
  var users=listUsers().filter(function(u){return u!==name;});
  lsSet(USERS_KEY, JSON.stringify(users));
  try{ localStorage.removeItem(userKey(name)); }catch(e){}
  if(getActiveUser()===name){ lsSet(ACTIVE_KEY, ""); }
}

/* ---------- cloud sync (optional shared database via /api/progress) ----------
   Works only when deployed with a Redis/KV backend configured. Falls back silently
   to local-only when the API or fetch is unavailable (e.g. opened as a local file). */
var API="/api/progress";
var cloudUserCache=[];
function hasFetch(){ return typeof fetch==="function"; }
var Cloud={
  list:function(cb){
    if(!hasFetch()){ cb([]); return; }
    fetch(API+"?list=1").then(function(r){ return r.ok?r.json():null; })
      .then(function(j){ cb((j&&j.users)||[]); }).catch(function(){ cb([]); });
  },
  pull:function(name,cb){
    if(!hasFetch()){ cb(null); return; }
    fetch(API+"?user="+encodeURIComponent(name)).then(function(r){ return r.ok?r.json():null; })
      .then(function(j){ cb(j?j.data:null); }).catch(function(){ cb(null); });
  },
  push:function(name,blob){
    if(!hasFetch()) return;
    try{
      fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({user:name,data:blob})}).catch(function(){});
    }catch(e){}
  }
};
var _pushTimer=null;
function schedulePush(name){
  name=name||getActiveUser(); if(!name) return;
  if(_pushTimer) clearTimeout(_pushTimer);
  _pushTimer=setTimeout(function(){ Cloud.push(name, loadProfile(name)); }, 800);
}
// sign in: ensure local index, set active, then pull cloud copy (cloud wins on load), then render.
function signIn(name){
  name=cleanName(name); if(!name){ var inp=el("newUser"); if(inp)inp.focus(); return; }
  var users=listUsers();
  if(users.map(function(u){return u.toLowerCase();}).indexOf(name.toLowerCase())===-1){
    users.push(name); lsSet(USERS_KEY, JSON.stringify(users));
    if(!lsGet(userKey(name))) lsSet(userKey(name), JSON.stringify(blankProfile()));
  }
  setActiveUser(name);
  Cloud.pull(name, function(data){
    if(data && typeof data==="object"){
      // cloud is the source of truth on sign-in: load the FULL saved profile (watch + stats + history)
      saveProfileLocal(normalizeProfile(data), name);
    } else {
      Cloud.push(name, loadProfile(name)); // register new user in the cloud
    }
    updateWatchBadge();
    renderHome(); if(window.scrollTo) window.scrollTo(0,0);
  });
}

function loadWatch(){ return loadProfile().watch || {}; }
function saveWatch(w){ var b=loadProfile(); b.watch=w; saveProfile(b); }
function watchCount(){ return Object.keys(loadWatch()).length; }
function watchPlants(){
  var w=loadWatch();
  return Object.keys(w).map(function(id){ return byId(parseInt(id,10)); }).filter(Boolean);
}
function getStats(){ return loadProfile().stats || blankProfile().stats; }
function recordSimResult(difficulty, pct){
  var b=loadProfile();
  var key = difficulty==="hard" ? "simHardBest"
          : difficulty==="practical" ? "simPracticalBest"
          : "simEasyBest";
  if(b.stats[key]==null || pct>b.stats[key]) b.stats[key]=pct;
  saveProfile(b);
}
// record one answer: updates watchlist + stats + per-plant mastery + answer log in one write.
function recordResult(plant, correct, type){
  var b=loadProfile(); var w=b.watch; var id=String(plant.id);
  // watchlist: wrong adds (streak 0); correct on a watched plant +1; 3 clears it
  if(correct){
    if(w[id]!==undefined){ w[id].streak=(w[id].streak||0)+1; if(w[id].streak>=3) delete w[id]; }
  } else {
    w[id]={streak:0};
  }
  // overall stats
  b.stats.answered++; if(correct) b.stats.correct++;
  // per-plant mastery
  var ps=b.plants[id]||{seen:0,correct:0,wrong:0,last:null,lastTs:0};
  ps.seen++; if(correct) ps.correct++; else ps.wrong++;
  ps.last=correct?"correct":"wrong"; ps.lastTs=Date.now();
  b.plants[id]=ps;
  // rolling answer history (newest first, capped)
  b.log.unshift({ts:Date.now(), id:plant.id, type:type||null, correct:!!correct});
  if(b.log.length>150) b.log.length=150;
  saveProfile(b);
  updateWatchBadge();
}
// record a finished quiz into the history (newest first, capped)
function pushSession(rec){
  var b=loadProfile(); b.sessions.unshift(rec); if(b.sessions.length>50) b.sessions.length=50; saveProfile(b);
}
function byId(id){ for(var i=0;i<PLANTS.length;i++) if(PLANTS[i].id===id) return PLANTS[i]; return null; }
function updateWatchBadge(){
  var b=el("watchBadge"); if(!b) return;
  var c=watchCount(); b.textContent=c; b.classList.toggle("zero", c===0);
}
function updateUserChip(){
  var chip=el("userChip"); if(!chip) return;
  var u=getActiveUser();
  if(u){ chip.textContent="👤 "+u; chip.classList.remove("hidden"); }
  else { chip.classList.add("hidden"); }
}

/* ---------------- question builders ----------------
   Every builder RE-RANDOMIZES distractors and shuffles option order on each call,
   so the 4 options differ run to run. */
function imgTag(src, cls, alt){
  return '<img class="'+(cls||"")+'" referrerpolicy="no-referrer" loading="lazy" src="'+esc(src)+'" alt="'+esc(alt||"")+'">';
}
// small photo-source caption (e.g. "📷 Calflora")
function photoCredit(p){ return p && p.photo_credit ? '📷 Photo: '+esc(p.photo_credit) : ''; }
function creditTag(p, cls){ return p && p.photo_credit ? '<div class="credit '+(cls||"")+'">'+photoCredit(p)+'</div>' : ''; }

function mcText(opts){
  // opts: {plant, promptLabel, promptText, promptItalic, answerField, italicOptions, photo, promptSub, distractValues}
  var correct=opts.plant[opts.answerField];
  var distract=sampleDistinct(opts.distractValues, 3, [correct]);
  var options=shuffle([{value:correct,correct:true}].concat(distract.map(function(v){return {value:v,correct:false};})));
  return {format:"mc", optionKind:"text", italicOptions:!!opts.italicOptions,
    plant:opts.plant, promptLabel:opts.promptLabel, promptText:opts.promptText, promptItalic:!!opts.promptItalic,
    promptSub:opts.promptSub||null, photo:opts.photo||null, options:options, correctDisplay:correct};
}
function mcPhoto(opts){
  // opts: {plant, promptLabel, promptText, promptSub}
  var used={}; used[opts.plant.image_url]=1; var others=[];
  var pool=shuffle(PLANTS);
  for(var i=0;i<pool.length && others.length<3;i++){
    var x=pool[i];
    if(x.image_url && !used[x.image_url]){ used[x.image_url]=1; others.push(x); }
  }
  var options=shuffle([{img:opts.plant.image_url,correct:true}].concat(others.map(function(o){return {img:o.image_url,correct:false};})));
  return {format:"mc", optionKind:"photo", plant:opts.plant,
    promptLabel:opts.promptLabel, promptText:opts.promptText, promptItalic:true, promptSub:opts.promptSub||null,
    photo:null, options:options, correctDisplay:null};
}
function mcCommunity(opts){
  var correct=opts.plant.primary_community;
  var distract=sampleDistinct(COMMUNITIES, 3, [correct]);
  var options=shuffle([{value:correct,correct:true}].concat(distract.map(function(v){return {value:v,correct:false};})));
  return {format:"mc", optionKind:"text", plant:opts.plant,
    promptLabel:"Which plant community does this live in?", promptText:null, promptItalic:false,
    promptSub:opts.plant.scientific_name+" · "+opts.plant.common_name, photo:opts.plant.image_url,
    options:options, correctDisplay:correct};
}
function typed(opts){
  // opts:{plant, promptLabel, promptText, promptItalic, photo, desc, accept[], italicInput,
  //       correctDisplay, placeholder, threshold, hint}
  return {format:"typed", plant:opts.plant, promptLabel:opts.promptLabel, promptText:opts.promptText||null,
    promptItalic:!!opts.promptItalic, photo:opts.photo||null, desc:opts.desc||null,
    accept:opts.accept, italicInput:!!opts.italicInput, correctDisplay:opts.correctDisplay,
    placeholder:opts.placeholder||"Type your answer…",
    threshold:(typeof opts.threshold==="number"?opts.threshold:undefined),
    hint:opts.hint||null, look:opts.look||null};
}

// the 4 simulate question "types" -> a question object for a given format ("mc"/"typed")
function buildTyped4(plant, type){
  if(type==="sci2common")
    return typed({plant:plant, promptLabel:"Scientific name — type the COMMON name", promptText:plant.scientific_name,
      promptItalic:true, accept:[plant.common_name], correctDisplay:plant.common_name, placeholder:"common name…"});
  if(type==="common2sci")
    return typed({plant:plant, promptLabel:"Common name — type the SCIENTIFIC name", promptText:plant.common_name,
      accept:[plant.scientific_name], italicInput:true, correctDisplay:plant.scientific_name, placeholder:"Genus species…"});
  if(type==="names2photo")
    return typed({plant:plant, promptLabel:"Name this plant (common OR scientific name)", photo:plant.image_url,
      accept:[plant.common_name, plant.scientific_name], correctDisplay:plant.common_name+" / "+plant.scientific_name,
      placeholder:"common or scientific name…"});
  // photo2comm
  return typed({plant:plant, promptLabel:"Type the PLANT COMMUNITY this lives in", photo:plant.image_url,
    accept:plant.communities.length?plant.communities:[plant.primary_community],
    correctDisplay:plant.primary_community, placeholder:"plant community…"});
}
function buildMC4(plant, type){
  if(type==="sci2common")
    return mcText({plant:plant, promptLabel:"Scientific name → choose the common name", promptText:plant.scientific_name,
      promptItalic:true, answerField:"common_name", distractValues:PLANTS.map(function(p){return p.common_name;})});
  if(type==="common2sci")
    return mcText({plant:plant, promptLabel:"Common name → choose the scientific name", promptText:plant.common_name,
      answerField:"scientific_name", italicOptions:true, distractValues:PLANTS.map(function(p){return p.scientific_name;})});
  if(type==="names2photo")
    return mcPhoto({plant:plant, promptLabel:"Choose the matching photo", promptText:plant.scientific_name, promptSub:plant.common_name});
  return mcCommunity({plant:plant});
}

/* ---------------- quiz session engine ---------------- */
var quiz=null;

function startSession(cfg){
  // cfg:{title, items:[{plant,type,builder?}], builder(plant,type)->q, difficultyLabel}
  quiz={ title:cfg.title, sub:cfg.sub||"", items:cfg.items, i:0, results:[], answered:false, cur:null };
  go("quiz");
  renderQuestion();
}

// build the question object for the current item (re-randomized each time it is shown)
function currentQuestion(){
  var it=quiz.items[quiz.i];
  return it.build(it.plant, it.type);
}

function renderQuestion(){
  quiz.answered=false;
  var q=currentQuestion(); quiz.cur=q;
  var total=quiz.items.length;
  el("qProg").style.width=(quiz.i/total*100)+"%";
  el("qScore").textContent="Q "+(quiz.i+1)+" / "+total+" · Score "+scoreSoFar();
  var html="";
  if(q.promptLabel) html+='<div class="prompt-label">'+esc(q.promptLabel)+'</div>';
  if(q.photo){ html+=imgTag(q.photo,"qphoto","plant"); html+=creditTag(q.plant); }
  if(q.promptText) html+='<p class="prompt'+(q.promptItalic?' sci':'')+'">'+esc(q.promptText)+'</p>';
  if(q.promptSub) html+='<p class="prompt-sub">'+esc(q.promptSub)+'</p>';
  if(q.desc) html+='<div class="desc">🪴 '+esc(q.desc)+'</div>';

  if(q.format==="mc"){
    html+='<div class="opts'+(q.optionKind==="text"?" text":"")+'" id="opts"></div>';
    el("qPanel").innerHTML=html;
    var box=el("opts");
    q.options.forEach(function(o){
      var b=document.createElement("button");
      if(q.optionKind==="photo"){ b.className="opt photo"; b.innerHTML=imgTag(o.img,"","option"); }
      else { b.className="opt"+(q.italicOptions?" sci":""); b.textContent=o.value; }
      b.onclick=function(){ answerMC(o.correct, b, box, q); };
      box.appendChild(b);
    });
    if(q.optionKind==="photo") sizePhotoOptions(box);
  } else { // typed
    html+='<div class="typearea"><input id="typed" class="'+(q.italicInput?"sci":"")+'" autocomplete="off" '+
      'autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="'+esc(q.placeholder)+'">'+
      '<button class="btn btn-primary" id="checkBtn">Check</button></div>';
    el("qPanel").innerHTML=html;
    var input=el("typed");
    if(input.focus) input.focus();
    var submit=function(){
      if(quiz.answered) return;
      var res=checkTyped(input.value, q.accept, q.threshold);
      input.readOnly=true;  // keep it focused (not disabled) so Enter still reaches this handler
      finishQuestion(q, res.ok, {typedValue:input.value, ratio:res.ratio, allowOverride:!res.ok});
    };
    el("checkBtn").onclick=submit;
    // Enter on the focused input handles BOTH actions: 1st Enter = submit, 2nd Enter = next.
    // Because focus never jumps to the Next button, Enter can't accidentally skip the question.
    input.addEventListener("keydown",function(e){
      if(e.key!=="Enter") return;
      e.preventDefault();
      if(!quiz.answered) submit();
      else nextQuestion();
    });
  }
  el("nextBtn").classList.add("hidden");
}

// Measure the 4 option photos once loaded; make every option box adopt the LARGEST
// image's proportions so all boxes match and each photo shows in full (no cropping).
function sizePhotoOptions(box){
  var imgs=[].slice.call(box.querySelectorAll("img"));
  if(!imgs.length) return;
  var loaded=0, dims=[];
  function finalize(){
    var best=null;
    dims.forEach(function(d){ if(d.w&&d.h && (!best || d.w*d.h>best.w*best.h)) best=d; });
    if(best) box.style.setProperty("--opt-ar", best.w+" / "+best.h);
  }
  imgs.forEach(function(im){
    function rec(){ dims.push({w:im.naturalWidth, h:im.naturalHeight}); if(++loaded===imgs.length) finalize(); }
    if(im.complete && im.naturalWidth){ rec(); }
    else { im.addEventListener("load", rec); im.addEventListener("error", function(){ if(++loaded===imgs.length) finalize(); }); }
  });
}

function answerMC(isCorrect, btn, box, q){
  if(quiz.answered) return;
  var kids=[].slice.call(box.children);
  kids.forEach(function(c){ c.disabled=true; });
  if(isCorrect){ btn.classList.add("correct"); }
  else {
    btn.classList.add("wrong");
    // mark the correct option
    q.options.forEach(function(o,idx){
      if(o.correct) kids[idx].classList.add("correct");
    });
  }
  finishQuestion(q, isCorrect, {});
}

// study box shown after EVERY answer (correct or wrong), in every quiz:
// the easy-to-spot key feature + the scientific-name root hint.
function learnBoxHTML(p){
  var h=p.hints||{};
  if(!h.look && !h.sci) return "";
  return '<div class="hintbox">'+
    (h.look ? '👁 <b>Key feature:</b> '+esc(h.look) : '')+
    (h.look && h.sci ? '<br>' : '')+
    (h.sci ? '💡 <b>Roots:</b> '+esc(h.sci) : '')+
    '</div>';
}

function finishQuestion(q, correct, extra){
  extra=extra||{};
  quiz.answered=true;
  quiz.curCorrect=correct;
  var panel=el("qPanel");
  var fb=document.createElement("div");
  fb.className="feedback show "+(correct?"ok":"no");
  fb.id="fb";
  var head=correct?"<b>✓ Correct!</b>":"<b>✗ Not quite.</b>";
  var typedNote="";
  if(extra.typedValue!==undefined){
    typedNote=' You typed: <b>'+esc(extra.typedValue||"(blank)")+'</b>'+
      (extra.ratio!=null?' <span class="muted">('+Math.round(extra.ratio*100)+'% match)</span>':'');
  }
  var learn=learnBoxHTML(q.plant);
  fb.innerHTML=head+typedNote+learn+revealHTML(q.plant);
  panel.appendChild(fb);

  if(extra.allowOverride){
    var ov=document.createElement("div");
    ov.className="override";
    ov.innerHTML='<button class="btn btn-sm" id="ovBtn">✓ That was a typo — count it correct</button>';
    fb.appendChild(ov);
    el("ovBtn").onclick=function(){
      quiz.curCorrect=true;
      fb.className="feedback show ok"; fb.innerHTML='<b>✓ Counted correct.</b>'+learn+revealHTML(q.plant);
      el("qScore").textContent="Q "+(quiz.i+1)+" / "+quiz.items.length+" · Score "+(scoreSoFar()+1);
      var ti=el("typed"); if(ti && ti.focus) ti.focus();  // keep Enter-to-advance working after override
    };
  }
  el("qProg").style.width=((quiz.i+1)/quiz.items.length*100)+"%";
  var nb=el("nextBtn"); nb.classList.remove("hidden");
  nb.textContent=(quiz.i+1>=quiz.items.length)?"See results →":"Next →";
  // For MC, focus Next for keyboard flow. For TYPED, leave focus on the input so its Enter
  // handler manages "next" (focusing the button here is what caused Enter to skip questions).
  if(q.format==="mc") setTimeout(function(){ if(nb && nb.focus) nb.focus(); }, 0);
}

function revealHTML(p){
  var commLine=esc(p.primary_community)+(p.all_communities && p.all_communities!==p.primary_community?' · '+esc(p.all_communities):'');
  return '<div class="reveal">'+
    (p.image_url?imgTag(p.image_url,"","reveal"):"")+
    '<div class="meta"><div class="sci">'+esc(p.scientific_name)+'</div>'+
    '<div>'+esc(p.common_name)+'</div>'+
    '<div class="r">🏞️ '+commLine+'</div>'+
    '<div class="r">🌱 '+esc(p.growth_form||"—")+' · '+esc(p.native_status)+'</div>'+
    '<div class="r">📝 '+esc(p.description)+'</div>'+
    (p.photo_credit?'<div class="r">'+photoCredit(p)+'</div>':'')+'</div></div>';
}

function scoreSoFar(){
  var s=0; quiz.results.forEach(function(r){ if(r.correct) s++; }); return s;
}

function nextQuestion(){
  // record the resolved result for the question just answered
  var q=quiz.cur;
  var item=quiz.items[quiz.i];
  quiz.results.push({plant:q.plant, correct:quiz.curCorrect});
  recordResult(q.plant, quiz.curCorrect, item?item.type:null);
  quiz.i++;
  if(quiz.i>=quiz.items.length){ showResults(); return; }
  renderQuestion();
}

function showResults(){
  var tot=quiz.results.length, correct=scoreSoFar(), pct=Math.round(correct/tot*100);
  if(quiz.simDifficulty) recordSimResult(quiz.simDifficulty, pct);
  pushSession({ts:Date.now(), kind:quiz.title||"Quiz", total:tot, correct:correct, pct:pct});
  var missed=quiz.results.filter(function(r){return !r.correct;}).map(function(r){return r.plant;});
  var msg = pct>=90?"Excellent — you know these cold. 🌟":
            pct>=75?"Solid work. Review the misses and you're set.":
            pct>=50?"Getting there — focus on the missed ones below.":
            "Keep going — repetition is the trick. 🌱";
  var html='<div class="quizbar"><span class="title">'+esc(quiz.title)+' · Results</span></div>';
  html+='<div class="panel"><div class="result-head"><div class="pct">'+pct+'%</div>'+
        '<div class="msg">'+esc(msg)+'</div></div>'+
        '<div class="summary-line">'+correct+' of '+tot+' correct · '+watchCount()+' plant(s) on your watchlist</div>';
  if(missed.length===0){
    html+='<div class="missed"><h4>No misses — perfect round! 🎉</h4></div>';
  } else {
    html+='<div class="missed"><h4>Review ('+missed.length+')</h4>'+missed.map(function(p){
      return '<div class="item">'+(p.image_url?imgTag(p.image_url,"","")
        :'<div style="width:54px;height:54px;border-radius:8px;background:var(--green-l)"></div>')+
        '<div><span class="sci">'+esc(p.scientific_name)+'</span> — '+esc(p.common_name)+'<br>'+
        '<span class="muted">'+esc(p.primary_community)+' · '+esc(p.growth_form||"")+'</span></div></div>';
    }).join("")+'</div>';
  }
  html+='<div class="nav"><button class="btn btn-ghost" id="toHome">⌂ Home</button>'+
        '<button class="btn btn-accent" id="retry">↻ Try again</button></div></div>';
  el("screen").innerHTML=html;
  el("toHome").onclick=function(){ go("home"); };
  el("retry").onclick=quiz.retry || function(){ go("home"); };
  window.scrollTo(0,0);
}

/* ---------------- session starters ---------------- */
var SHELL='<div class="quizbar"><span class="title" id="qTitle"></span>'+
  '<div class="progress"><i id="qProg"></i></div><span class="score" id="qScore"></span></div>'+
  '<div class="panel" id="qPanel"></div>'+
  '<div class="nav"><button class="btn btn-ghost" id="quitBtn">← Quit</button>'+
  '<button class="btn btn-primary hidden" id="nextBtn">Next →</button></div>';

function mountQuizShell(title){
  el("screen").innerHTML=SHELL;
  el("qTitle").textContent=title;
  el("quitBtn").onclick=function(){ go("home"); };
  el("nextBtn").onclick=nextQuestion;
}

var PRACTICE={
  sci2common:{n:1,title:"Scientific → Common",build:function(p){return buildMC4(p,"sci2common");},pool:function(){return PLANTS;}},
  common2sci:{n:2,title:"Common → Scientific",build:function(p){return buildMC4(p,"common2sci");},pool:function(){return PLANTS;}},
  names2photo:{n:3,title:"Names → Photo",build:function(p){return buildMC4(p,"names2photo");},pool:function(){return PLANTS;}},
  typeCommon:{n:4,title:"Photo → Type Common",pool:function(){return PLANTS;},
    build:function(p){return typed({plant:p,promptLabel:"Type the COMMON name",photo:p.image_url,desc:p.description,
      accept:[p.common_name],correctDisplay:p.common_name,placeholder:"common name…"});}},
  typeSci:{n:5,title:"Photo → Type Scientific",pool:function(){return PLANTS;},
    build:function(p){return typed({plant:p,promptLabel:"Type the SCIENTIFIC name",photo:p.image_url,desc:p.description,
      accept:[p.scientific_name],italicInput:true,correctDisplay:p.scientific_name,placeholder:"Genus species…"});}},
  photo2comm:{n:6,title:"Photo → Plant Community",build:function(p){return buildMC4(p,"photo2comm");},pool:function(){return PLANTS;}}
};

function startPractice(modeId){
  var m=PRACTICE[modeId];
  var len=el("roundLen")?el("roundLen").value:"all";
  var pool=shuffle(m.pool());
  if(len!=="all") pool=pool.slice(0, Math.min(parseInt(len,10), pool.length));
  var items=pool.map(function(p){ return {plant:p, type:modeId, build:m.build}; });
  mountQuizShell(m.n+". "+m.title);
  quiz=null;
  startSession({title:m.title, items:items});
  quiz.retry=function(){ startPractice(modeId); };
}

var SIM_TYPES=["sci2common","common2sci","names2photo","photo2comm"];
function startSimulate(difficulty){
  var hard=(difficulty==="hard");
  var pool=shuffle(PLANTS).slice(0, Math.min(20, PLANTS.length));
  var items=pool.map(function(p){
    var type=SIM_TYPES[Math.floor(Math.random()*SIM_TYPES.length)];
    return {plant:p, type:type, build: hard
      ? function(pl,t){ return buildTyped4(pl,t); }
      : function(pl,t){ return buildMC4(pl,t); } };
  });
  mountQuizShell("Simulate Exam · "+(hard?"Hard (typed)":"Easy (multiple choice)"));
  quiz=null;
  startSession({title:"Simulate Exam — "+(hard?"Hard":"Easy"), items:items});
  quiz.simDifficulty=difficulty;
  quiz.retry=function(){ startSimulate(difficulty); };
}

/* Lab Practical (v2): mirrors the real bench exam — a specimen photo is always shown,
   and you type ONE thing about it (common name, scientific name, or habitat/community). */
var LAB_TYPES=["labCommon","labSci","labHabitat"];
var LAB_THRESHOLD=0.85;   // strict-ish, but lenient enough to count plurals/near-spellings (e.g. "sand verbena" vs "sand verbenas")
function buildLab(plant, type){
  var h=plant.hints||{};
  if(type==="labCommon")
    return typed({plant:plant, promptLabel:"Specimen — type the COMMON name", photo:plant.image_url,
      accept:[plant.common_name], correctDisplay:plant.common_name, placeholder:"common name…",
      threshold:LAB_THRESHOLD, hint:h.common, look:h.look});
  if(type==="labSci")
    return typed({plant:plant, promptLabel:"Specimen — type the SCIENTIFIC name", photo:plant.image_url,
      italicInput:true, accept:[plant.scientific_name], correctDisplay:plant.scientific_name, placeholder:"Genus species…",
      threshold:LAB_THRESHOLD, hint:h.sci, look:h.look});
  // labHabitat
  return typed({plant:plant, promptLabel:"Specimen — type the HABITAT / plant community", photo:plant.image_url,
    accept:(plant.communities && plant.communities.length)?plant.communities:[plant.primary_community],
    correctDisplay:plant.primary_community, placeholder:"plant community…",
    threshold:LAB_THRESHOLD, hint:h.habitat, look:h.look});
}
function startLabPractical(){
  var pool=shuffle(PLANTS).slice(0, Math.min(20, PLANTS.length));
  var items=pool.map(function(p){
    var t=LAB_TYPES[Math.floor(Math.random()*LAB_TYPES.length)];
    return {plant:p, type:t, build:buildLab};
  });
  mountQuizShell("Lab Practical (v2)");
  quiz=null;
  startSession({title:"Lab Practical (v2)", items:items});
  quiz.simDifficulty="practical";
  quiz.retry=function(){ startLabPractical(); };
}

function startWatchlistPractice(){
  var plants=watchPlants();
  if(!plants.length){ go("watchlist"); return; }
  var items=shuffle(plants).map(function(p){
    var type=SIM_TYPES[Math.floor(Math.random()*SIM_TYPES.length)];
    return {plant:p, type:type, build:function(pl,t){ return buildMC4(pl,t); }};
  });
  mountQuizShell("Watchlist Practice ("+plants.length+")");
  quiz=null;
  startSession({title:"Watchlist Practice", items:items});
  quiz.retry=function(){ startWatchlistPractice(); };
}

/* ---------------- notecards (classic flip cards) ---------------- */
var nc=null;
var NC_DECKS={
  names:{ title:"Common ⟷ Scientific",
    front:function(p){ return '<div class="fc-label">Common name</div><div class="fc-main">'+esc(p.common_name)+'</div>'; },
    back:function(p){ return '<div class="fc-label">Scientific name</div><div class="fc-main sci">'+esc(p.scientific_name)+'</div>'; } },
  desc:{ title:"Names ⟷ Description",
    front:function(p){ return '<div class="fc-label">Name this plant</div>'+
      '<div class="fc-main sci">'+esc(p.scientific_name)+'</div><div class="fc-sub">'+esc(p.common_name)+'</div>'; },
    back:function(p){ return ncDescHTML(p); } }
};
function ncDescHTML(p){
  var n=p.notes;
  var body;
  if(n){
    body='<p><b>Habit:</b> '+esc(n.habit)+'</p>'+
         '<p><b>Community:</b> '+esc(n.community)+'</p>'+
         '<p><b>ID:</b> '+esc(n.id)+'</p>'+
         (n.role?'<p><b>Role:</b> '+esc(n.role)+'</p>':'');
  } else {
    body='<p>'+esc(p.description)+'</p>';
  }
  return '<div class="fc-label">Description</div>'+
    (p.image_url?imgTag(p.image_url,"fc-photo",""):"")+
    (p.photo_credit?'<div class="credit">'+photoCredit(p)+'</div>':"")+
    '<div class="fc-desc">'+body+'</div>';
}
function startNotecards(deck){
  if(!NC_DECKS[deck]) deck="names";
  nc={deck:deck, items:shuffle(PLANTS), i:0, flipped:false};
  renderNotecards();
}
function renderNotecards(){
  var d=NC_DECKS[nc.deck];
  el("screen").innerHTML=
    '<div class="quizbar"><span class="title">🃏 Notecards · '+esc(d.title)+'</span>'+
    '<span class="score" id="ncCount"></span></div>'+
    '<div class="flashcard" id="flash"><div class="fc-content" id="fcContent"></div>'+
    '<div class="fc-hint">tap card to flip · ← → to move</div></div>'+
    '<div class="nav nc-nav">'+
      '<button class="btn btn-ghost" id="ncHome">⌂ Home</button>'+
      '<div class="nc-mid"><button class="btn btn-ghost btn-sm" id="ncPrev">← Prev</button>'+
      '<button class="btn btn-primary btn-sm" id="ncFlip">Flip</button>'+
      '<button class="btn btn-ghost btn-sm" id="ncNext">Next →</button></div>'+
      '<button class="btn btn-ghost btn-sm" id="ncShuffle">🔀 Shuffle</button></div>';
  el("flash").onclick=ncFlip;
  el("ncFlip").onclick=function(e){ e.stopPropagation(); ncFlip(); };
  el("ncPrev").onclick=function(e){ e.stopPropagation(); ncStep(-1); };
  el("ncNext").onclick=function(e){ e.stopPropagation(); ncStep(1); };
  el("ncShuffle").onclick=function(e){ e.stopPropagation(); nc.items=shuffle(nc.items); nc.i=0; nc.flipped=false; ncShow(); };
  el("ncHome").onclick=function(){ go("home"); };
  ncShow();
}
function ncShow(){
  var d=NC_DECKS[nc.deck], p=nc.items[nc.i];
  var content=el("fcContent"); if(!content) return;
  content.innerHTML=nc.flipped ? d.back(p) : d.front(p);
  var card=el("flash");
  card.classList.toggle("is-back", nc.flipped);
  // brief flip animation
  card.classList.remove("fc-anim"); void card.offsetWidth; card.classList.add("fc-anim");
  el("ncCount").textContent=(nc.i+1)+" / "+nc.items.length;
}
function ncFlip(){ nc.flipped=!nc.flipped; ncShow(); }
function ncStep(dir){ nc.i=(nc.i+dir+nc.items.length)%nc.items.length; nc.flipped=false; ncShow(); }

/* ---------------- screens ---------------- */
function go(screen){
  if(screen==="gate") renderGate();
  else if(screen==="home"){ if(!getActiveUser()){ renderGate(); } else renderHome(); }
  else if(screen==="progress"){ if(!getActiveUser()){ renderGate(); } else renderProgress(); }
  else if(screen==="browse") renderBrowse();
  else if(screen==="watchlist") renderWatchlist();
  else if(screen==="quiz"){ /* shell already mounted by starter */ }
  updateWatchBadge(); updateUserChip();
  window.scrollTo(0,0);
}

function renderGate(){
  var users=uniq(listUsers().concat(cloudUserCache));
  var html='<div class="gate"><div class="gate-card">'+
    '<div class="gate-icon">🌿</div><h2>Who\'s studying?</h2>'+
    '<p class="muted">Pick your name to load your saved watchlist and progress, or add a new one.</p>';
  if(users.length){
    html+='<div class="user-list">'+users.map(function(u){
      return '<button class="user-pick" data-user="'+esc(u)+'">👤 '+esc(u)+'</button>';
    }).join("")+'</div><div class="gate-or">or add a new student</div>';
  }
  html+='<div class="gate-new"><input id="newUser" maxlength="24" autocomplete="off" placeholder="Enter a name…">'+
    '<button class="btn btn-primary" id="gateGo">Start studying →</button></div>';
  html+='</div></div>';
  el("screen").innerHTML=html;
  document.querySelectorAll(".user-pick").forEach(function(b){
    b.onclick=function(){ signIn(b.getAttribute("data-user")); };
  });
  var input=el("newUser"); if(input && input.focus) input.focus();
  var start=function(){ signIn(input.value); };
  el("gateGo").onclick=start;
  input.addEventListener("keydown",function(e){ if(e.key==="Enter") start(); });
  // refresh the list of users from the shared database, re-render if new names appear
  Cloud.list(function(cu){
    cloudUserCache=cu||[];
    var merged=uniq(listUsers().concat(cloudUserCache));
    if(merged.length!==users.length) renderGate();
  });
}

function renderHome(){
  var wc=watchCount();
  var s=getStats();
  var acc=s.answered?Math.round(s.correct/s.answered*100):0;
  var html='';
  html+='<div class="greet"><div><span class="hi">Hi, '+esc(getActiveUser()||"there")+' 👋</span>'+
    '<span class="stat-sub">'+(s.answered?(s.answered+' answered · '+acc+'% accuracy'+
      (s.simEasyBest!=null?' · Easy best '+s.simEasyBest+'%':'')+
      (s.simHardBest!=null?' · Hard best '+s.simHardBest+'%':'')+
      (s.simPracticalBest!=null?' · Practical best '+s.simPracticalBest+'%':'')):'No questions yet — pick a mode below.')+'</span></div>'+
    '<div class="greet-actions"><button class="btn btn-ghost btn-sm" id="viewProg">📈 Progress</button>'+
    '<button class="btn btn-ghost btn-sm" id="switchUser">Switch user</button></div></div>';
  html+='<div class="hero"><div><h2>🧪 Simulate Exam</h2>'+
    '<p>20 questions, fresh plants and choices every run. <b>Lab Practical (v2)</b> mirrors the bench exam: '+
    'a specimen photo, type what it is.</p></div>'+
    '<div class="actions">'+
    '<button class="btn btn-lab" id="simLab">🔬 Lab Practical (v2)</button>'+
    '<button class="btn btn-easy" id="simEasy">Easy · multiple choice</button>'+
    '<button class="btn btn-hard" id="simHard">Hard · type answers</button></div></div>';

  html+='<div class="section-title">⭐ Watchlist</div>';
  html+='<div class="wl-card"><div class="big">'+wc+'</div><div class="grow"><h3>'+
    (wc?'Plants to review':'Nothing to review yet')+'</h3><p>'+
    (wc?'Miss a plant and it lands here. Get it right 3 times to clear it.':'Plants you miss will show up here automatically.')+
    '</p></div>'+(wc?'<button class="btn btn-accent btn-sm" id="wlPractice">Practice watchlist</button>':'')+
    '<button class="btn btn-ghost btn-sm" id="wlView">View</button></div>';

  html+='<div class="section-title">🃏 Notecards</div>';
  html+='<div class="card-grid">'+
    '<button class="mode" id="ncNames"><span class="num">🃏</span><h3>Common ⟷ Scientific</h3>'+
    '<p>Classic flip cards: common name on the front, scientific name on the back.</p>'+
    '<span class="tag">Flip cards</span></button>'+
    '<button class="mode" id="ncDesc"><span class="num">🃏</span><h3>Names ⟷ Description</h3>'+
    '<p>Both names on the front; the full field-guide description (habit, community, ID, role) on the back.</p>'+
    '<span class="tag">Flip cards</span></button></div>';

  html+='<div class="section-title">📚 Practice by type</div>';
  html+='<div class="row-controls"><label class="muted">Questions per round:</label>'+
    '<select id="roundLen"><option value="10">10</option><option value="20">20</option>'+
    '<option value="all" selected>All 41</option></select></div>';
  html+='<div class="card-grid" id="modeGrid"></div>';
  el("screen").innerHTML=html;

  var grid=el("modeGrid");
  Object.keys(PRACTICE).forEach(function(id){
    var m=PRACTICE[id];
    var typedMode=(id==="typeCommon"||id==="typeSci");
    var b=document.createElement("button");
    b.className="mode";
    b.innerHTML='<span class="num">'+m.n+'</span><h3>'+esc(m.title)+'</h3>'+
      '<p>'+esc(modeDesc(id))+'</p><span class="tag'+(typedMode?' typed':'')+'">'+(typedMode?'Typed':'Multiple choice')+'</span>';
    b.onclick=function(){ startPractice(id); };
    grid.appendChild(b);
  });
  el("simLab").onclick=function(){ startLabPractical(); };
  el("simEasy").onclick=function(){ startSimulate("easy"); };
  el("simHard").onclick=function(){ startSimulate("hard"); };
  el("wlView").onclick=function(){ go("watchlist"); };
  if(el("wlPractice")) el("wlPractice").onclick=function(){ startWatchlistPractice(); };
  el("switchUser").onclick=function(){ go("gate"); };
  el("viewProg").onclick=function(){ go("progress"); };
  el("ncNames").onclick=function(){ startNotecards("names"); };
  el("ncDesc").onclick=function(){ startNotecards("desc"); };
}
function modeDesc(id){
  return {
    sci2common:"See the scientific name, pick the common name.",
    common2sci:"See the common name, pick the scientific name.",
    names2photo:"Given both names, choose the matching photo.",
    typeCommon:"See photo + description, type the common name.",
    typeSci:"See photo + description, type the scientific name.",
    photo2comm:"See the photo, choose its plant community."
  }[id]||"";
}

function renderWatchlist(){
  var plants=watchPlants(); var w=loadWatch();
  var html='<div class="quizbar"><span class="title">⭐ Watchlist</span>'+
    (plants.length?'<button class="btn btn-accent btn-sm" id="wlPractice2">Practice these</button>':'')+'</div>';
  if(!plants.length){
    html+='<div class="empty"><div class="big">🌱</div><p>Your watchlist is empty.<br>'+
      'Miss a plant in any quiz and it will appear here until you answer it correctly 3 times.</p>'+
      '<button class="btn btn-primary" id="wlGoHome">Start a quiz</button></div>';
    el("screen").innerHTML=html;
    el("wlGoHome").onclick=function(){ go("home"); };
    return;
  }
  html+='<p class="muted" style="margin:4px 0 0">Answer each correctly 3 times to clear it. Wrong answers reset its progress.</p>';
  html+='<div class="wl-list">'+plants.map(function(p){
    var streak=(w[String(p.id)]&&w[String(p.id)].streak)||0;
    var pips=''; for(var k=0;k<3;k++) pips+='<span class="pip'+(k<streak?' on':'')+'"></span>';
    return '<div class="wl-item">'+(p.image_url?imgTag(p.image_url,"",""):'')+
      '<div class="grow"><div class="cn">'+esc(p.common_name)+'</div>'+
      '<div class="sn">'+esc(p.scientific_name)+'</div>'+
      '<div class="wl-prog">'+pips+'<span class="lbl">'+streak+'/3 correct</span></div></div></div>';
  }).join("")+'</div>';
  html+='<div class="nav"><button class="btn btn-ghost" id="wlHome">⌂ Home</button>'+
        '<button class="btn btn-ghost btn-sm" id="wlClear">Clear watchlist</button></div>';
  el("screen").innerHTML=html;
  el("wlHome").onclick=function(){ go("home"); };
  if(el("wlPractice2")) el("wlPractice2").onclick=function(){ startWatchlistPractice(); };
  el("wlClear").onclick=function(){ if(confirm("Clear the entire watchlist?")){ saveWatch({}); renderWatchlist(); updateWatchBadge(); } };
}

function fmtWhen(ts){
  try{ return new Date(ts).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}); }
  catch(e){ return ""; }
}
function statCard(big,label){
  return '<div class="stat-card"><div class="sc-big">'+esc(String(big))+'</div><div class="sc-lbl">'+esc(label)+'</div></div>';
}
function renderProgress(){
  var prof=loadProfile(); var s=prof.stats;
  var acc=s.answered?Math.round(s.correct/s.answered*100):0;
  var w=loadWatch();
  var rows=Object.keys(prof.plants).map(function(id){
    var ps=prof.plants[id]; var p=byId(parseInt(id,10)); if(!p||!ps.seen) return null;
    return {p:p, ps:ps, acc:ps.correct/ps.seen, onWatch:w[id]!==undefined};
  }).filter(Boolean);
  var seenCount=rows.length;
  var mastered=rows.filter(function(r){return r.ps.seen>=2 && r.acc>=0.9 && !r.onWatch;}).length;
  var needs=rows.filter(function(r){return r.onWatch || r.acc<0.7 || r.ps.last==="wrong";})
                .sort(function(x,y){return x.acc-y.acc || y.ps.wrong-x.ps.wrong;});

  var html='<div class="quizbar"><span class="title">📈 '+esc(getActiveUser()||"Your")+'’s progress</span>'+
    '<button class="btn btn-ghost btn-sm" id="progHome">⌂ Home</button></div>';

  if(!s.answered){
    html+='<div class="empty"><div class="big">📊</div><p>No history yet. Answer some questions and your accuracy, '+
      'per-plant mastery, and session history will appear here — saved to your account and synced across devices.</p>'+
      '<button class="btn btn-primary" id="progStart">Start a quiz</button></div>';
    el("screen").innerHTML=html;
    el("progHome").onclick=function(){ go("home"); };
    el("progStart").onclick=function(){ go("home"); };
    return;
  }

  html+='<div class="prog-cards">'+
    statCard(s.answered,"questions answered")+
    statCard(acc+"%","overall accuracy")+
    statCard(seenCount+"/"+PLANTS.length,"plants seen")+
    statCard(mastered,"mastered")+
    statCard(watchCount(),"on watchlist")+
    statCard(s.simPracticalBest==null?"—":s.simPracticalBest+"%","lab practical best")+
    statCard(s.simEasyBest==null?"—":s.simEasyBest+"%","sim easy best")+
    statCard(s.simHardBest==null?"—":s.simHardBest+"%","sim hard best")+
    '</div>';

  html+='<div class="section-title">🔎 Needs work ('+needs.length+')</div>';
  if(!needs.length){
    html+='<p class="muted">Nothing flagged right now'+(mastered?' — '+mastered+' plant(s) look mastered. 🌟':'.')+'</p>';
  } else {
    html+='<div class="prog-list">'+needs.slice(0,24).map(function(r){
      var pct=Math.round(r.acc*100);
      return '<div class="prog-row">'+(r.p.image_url?imgTag(r.p.image_url,"",""):'')+
        '<div class="grow"><div class="cn">'+esc(r.p.common_name)+(r.onWatch?' <span class="wl-tag">★ watchlist</span>':'')+'</div>'+
        '<div class="sn">'+esc(r.p.scientific_name)+'</div>'+
        '<div class="bar"><i style="width:'+pct+'%"></i></div></div>'+
        '<div class="acc">'+r.ps.correct+'/'+r.ps.seen+'<span>'+pct+'%</span></div></div>';
    }).join("")+'</div>';
  }

  html+='<div class="section-title">🗓️ Recent sessions</div>';
  if(!prof.sessions.length){ html+='<p class="muted">No completed sessions yet.</p>'; }
  else {
    html+='<div class="sess-list">'+prof.sessions.slice(0,10).map(function(se){
      return '<div class="sess-row"><div class="grow"><b>'+esc(se.kind)+'</b><span class="muted"> · '+fmtWhen(se.ts)+'</span></div>'+
        '<div class="sess-score">'+se.correct+'/'+se.total+' <span>'+se.pct+'%</span></div></div>';
    }).join("")+'</div>';
  }

  html+='<div class="nav"><button class="btn btn-ghost" id="progHome2">⌂ Home</button>'+
        (watchCount()?'<button class="btn btn-accent" id="progWl">Practice watchlist</button>':'')+'</div>';
  el("screen").innerHTML=html;
  el("progHome").onclick=function(){ go("home"); };
  el("progHome2").onclick=function(){ go("home"); };
  if(el("progWl")) el("progWl").onclick=function(){ startWatchlistPractice(); };
}

function renderBrowse(){
  var html='<div class="quizbar"><span class="title">📖 All '+PLANTS.length+' cards</span></div>';
  html+='<div class="browse-grid">'+PLANTS.slice().sort(function(a,b){return a.id-b.id;}).map(function(p){
    return '<div class="pcard">'+(p.image_url?imgTag(p.image_url,"",p.common_name):'')+
      '<div class="body"><div class="cn">'+esc(p.common_name)+'</div>'+
      '<div class="sn">'+esc(p.scientific_name)+'</div>'+
      '<span class="cm">'+esc(p.primary_community)+'</span>'+
      '<div class="ns">'+esc(p.growth_form||"")+' · '+esc(p.native_status)+'</div>'+
      (p.photo_credit?'<div class="ns">'+photoCredit(p)+'</div>':'')+'</div></div>';
  }).join("")+'</div>';
  el("screen").innerHTML=html;
}

/* ---------------- wire up ---------------- */
function init(){
  el("foot").innerHTML='Built from the class Quizlet set; plant descriptions from the BIO 114 Field Trip Plant Notebook. '+
    'Most plant photos are sourced from <a href="https://www.calflora.org" target="_blank" rel="noopener">Calflora</a>; '+
    'a few load from Quizlet. Typed answers accept ~80% spelling accuracy. Progress is saved to your username.';
  // inject a user chip into the nav (click to switch user)
  var nav=document.querySelector(".topnav");
  if(nav && !el("userChip")){
    var chip=document.createElement("button");
    chip.className="navbtn hidden"; chip.id="userChip";
    chip.onclick=function(){ go("gate"); };
    nav.insertBefore(chip, nav.firstChild);
  }
  document.querySelectorAll(".navbtn").forEach(function(b){
    if(b.id==="userChip") return;
    b.onclick=function(){ if(!getActiveUser()){ go("gate"); return; } go(b.getAttribute("data-go")); };
  });
  el("brandHome").onclick=function(e){ e.preventDefault(); go(getActiveUser()?"home":"gate"); };
  // keyboard shortcuts for notecards (only when the flip card is on screen)
  document.addEventListener("keydown", function(e){
    if(!el("flash")) return;
    if(e.key===" "||e.key==="Enter"){ e.preventDefault(); ncFlip(); }
    else if(e.key==="ArrowRight") ncStep(1);
    else if(e.key==="ArrowLeft") ncStep(-1);
  });
  // password gate (per-IP, validated server-side) runs before the app is usable
  passwordGate(startApp);
}
function startApp(){
  updateWatchBadge(); updateUserChip();
  go(getActiveUser()?"home":"gate");
}

/* ---------- password gate ---------- */
function passwordGate(onPass){
  if(typeof fetch!=="function"){ onPass(); return; }   // e.g. opened as a local file: don't lock out
  fetch("/api/gate?check=1").then(function(r){ return r.ok?r.json():null; }).then(function(j){
    if(!j || !j.enabled || j.authorized){ onPass(); }   // gate off, or this IP already authorized
    else showPasswordPage(onPass);
  }).catch(function(){ onPass(); });                     // API unreachable -> fail open (don't brick the app)
}
function showPasswordPage(onPass){
  var ov=document.createElement("div");
  ov.id="gateOverlay";
  ov.innerHTML=
    '<div class="gate-pw-card">'+
      '<div class="leaf">🌿</div>'+
      '<h2>BIO 114 — Plant Study</h2>'+
      '<p>This study site is password-protected.</p>'+
      '<div class="gate-pw-row">'+
        '<input id="gatePw" type="password" autocomplete="off" autocapitalize="off" '+
        'autocorrect="off" spellcheck="false" placeholder="Enter password">'+
        '<button class="btn btn-primary" id="gateBtn">Enter</button>'+
      '</div>'+
      '<div class="gate-err" id="gateErr"></div>'+
      '<div class="gate-foot">Access is remembered for this network.</div>'+
    '</div>';
  document.body.appendChild(ov);
  var pw=el("gatePw"); if(pw && pw.focus) pw.focus();
  var submit=function(){
    var val=(pw.value||"");
    if(!val) return;
    var btn=el("gateBtn"); btn.disabled=true; el("gateErr").textContent="";
    fetch("/api/gate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:val})})
      .then(function(r){ return r.json().then(function(j){ return {ok:r.ok, j:j}; }); })
      .then(function(res){
        if(res.ok && res.j && res.j.authorized){ if(ov.parentNode) ov.parentNode.removeChild(ov); onPass(); }
        else { el("gateErr").textContent="Incorrect password — try again."; btn.disabled=false; pw.focus(); pw.select(); }
      })
      .catch(function(){ el("gateErr").textContent="Network error — try again."; btn.disabled=false; });
  };
  el("gateBtn").onclick=submit;
  pw.addEventListener("keydown",function(e){ if(e.key==="Enter"){ e.preventDefault(); submit(); } });
}
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", init);
else init();

/* test/debug hook */
window.APP={
  PLANTS:PLANTS, COMMUNITIES:COMMUNITIES, normalize:normalize, lev:lev, simRatio:simRatio, checkTyped:checkTyped,
  buildMC4:buildMC4, buildTyped4:buildTyped4, mcText:mcText, mcPhoto:mcPhoto, mcCommunity:mcCommunity,
  loadWatch:loadWatch, saveWatch:saveWatch, recordResult:recordResult, watchCount:watchCount, watchPlants:watchPlants,
  byId:byId, startPractice:startPractice, startSimulate:startSimulate, startLabPractical:startLabPractical,
  startWatchlistPractice:startWatchlistPractice, LAB_TYPES:LAB_TYPES,
  go:go, getQuiz:function(){return quiz;}, SIM_TYPES:SIM_TYPES, PRACTICE:PRACTICE,
  listUsers:listUsers, createUser:createUser, getActiveUser:getActiveUser, setActiveUser:setActiveUser,
  deleteUser:deleteUser, loadProfile:loadProfile, saveProfile:saveProfile, saveProfileLocal:saveProfileLocal,
  getStats:getStats, signIn:signIn, Cloud:Cloud, schedulePush:schedulePush, recordSimResult:recordSimResult,
  normalizeProfile:normalizeProfile, pushSession:pushSession, renderProgress:renderProgress,
  startNotecards:startNotecards, ncFlip:ncFlip, ncStep:ncStep, getNc:function(){return nc;}, NC_DECKS:NC_DECKS
};
})();
