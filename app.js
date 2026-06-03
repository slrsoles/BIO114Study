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

// typed-answer checker. accepts an array of acceptable answers. Returns {ok, ratio}.
// ok = exact (normalized) OR >= 80% character similarity. Handles "/"-separated alternatives.
function checkTyped(input, acceptList){
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
  return {ok: best>=0.8, ratio: best};
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
function blankProfile(){ return {watch:{}, stats:{answered:0, correct:0, simEasyBest:null, simHardBest:null}}; }
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
  try{ return JSON.parse(lsGet(userKey(name))) || blankProfile(); }catch(e){ return blankProfile(); }
}
function saveProfileLocal(blob, name){
  name=name||getActiveUser(); if(!name) return;
  if(!blob.stats) blob.stats=blankProfile().stats;
  if(!blob.watch) blob.watch={};
  lsSet(userKey(name), JSON.stringify(blob));
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
      saveProfileLocal({watch:data.watch||{}, stats:data.stats||blankProfile().stats}, name);
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
  var b=loadProfile(); var key=difficulty==="hard"?"simHardBest":"simEasyBest";
  if(b.stats[key]==null || pct>b.stats[key]) b.stats[key]=pct;
  saveProfile(b);
}
// record one answer: updates the active profile's watchlist + running stats in a single write.
function recordResult(plant, correct){
  var b=loadProfile(); var w=b.watch||{}; var id=String(plant.id);
  if(correct){
    if(w[id]!==undefined){ w[id].streak=(w[id].streak||0)+1; if(w[id].streak>=3) delete w[id]; }
  } else {
    w[id]={streak:0};
  }
  b.watch=w;
  b.stats.answered=(b.stats.answered||0)+1;
  if(correct) b.stats.correct=(b.stats.correct||0)+1;
  saveProfile(b);
  updateWatchBadge();
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
  // opts:{plant, promptLabel, promptText, promptItalic, photo, desc, accept[], italicInput, correctDisplay, placeholder}
  return {format:"typed", plant:opts.plant, promptLabel:opts.promptLabel, promptText:opts.promptText||null,
    promptItalic:!!opts.promptItalic, photo:opts.photo||null, desc:opts.desc||null,
    accept:opts.accept, italicInput:!!opts.italicInput, correctDisplay:opts.correctDisplay,
    placeholder:opts.placeholder||"Type your answer…"};
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
  if(q.photo) html+=imgTag(q.photo,"qphoto","plant");
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
      var res=checkTyped(input.value, q.accept);
      input.disabled=true;
      finishQuestion(q, res.ok, {typedValue:input.value, ratio:res.ratio, allowOverride:!res.ok});
    };
    el("checkBtn").onclick=submit;
    input.addEventListener("keydown",function(e){ if(e.key==="Enter") submit(); });
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
  fb.innerHTML=head+typedNote+revealHTML(q.plant);
  panel.appendChild(fb);

  if(extra.allowOverride){
    var ov=document.createElement("div");
    ov.className="override";
    ov.innerHTML='<button class="btn btn-sm" id="ovBtn">✓ That was a typo — count it correct</button>';
    fb.appendChild(ov);
    el("ovBtn").onclick=function(){
      quiz.curCorrect=true;
      fb.className="feedback show ok"; fb.innerHTML='<b>✓ Counted correct.</b>'+revealHTML(q.plant);
      el("qScore").textContent="Q "+(quiz.i+1)+" / "+quiz.items.length+" · Score "+(scoreSoFar()+1);
    };
  }
  el("qProg").style.width=((quiz.i+1)/quiz.items.length*100)+"%";
  var nb=el("nextBtn"); nb.classList.remove("hidden");
  nb.textContent=(quiz.i+1>=quiz.items.length)?"See results →":"Next →";
  if(nb.focus) nb.focus();
}

function revealHTML(p){
  var commLine=esc(p.primary_community)+(p.all_communities && p.all_communities!==p.primary_community?' · '+esc(p.all_communities):'');
  return '<div class="reveal">'+
    (p.image_url?imgTag(p.image_url,"","reveal"):"")+
    '<div class="meta"><div class="sci">'+esc(p.scientific_name)+'</div>'+
    '<div>'+esc(p.common_name)+'</div>'+
    '<div class="r">🏞️ '+commLine+'</div>'+
    '<div class="r">🌱 '+esc(p.growth_form||"—")+' · '+esc(p.native_status)+'</div>'+
    '<div class="r">📝 '+esc(p.description)+'</div></div></div>';
}

function scoreSoFar(){
  var s=0; quiz.results.forEach(function(r){ if(r.correct) s++; }); return s;
}

function nextQuestion(){
  // record the resolved result for the question just answered
  var q=quiz.cur;
  quiz.results.push({plant:q.plant, correct:quiz.curCorrect});
  recordResult(q.plant, quiz.curCorrect);
  quiz.i++;
  if(quiz.i>=quiz.items.length){ showResults(); return; }
  renderQuestion();
}

function showResults(){
  var tot=quiz.results.length, correct=scoreSoFar(), pct=Math.round(correct/tot*100);
  if(quiz.simDifficulty) recordSimResult(quiz.simDifficulty, pct);
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

/* ---------------- screens ---------------- */
function go(screen){
  if(screen==="gate") renderGate();
  else if(screen==="home"){ if(!getActiveUser()){ renderGate(); } else renderHome(); }
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
      (s.simHardBest!=null?' · Hard best '+s.simHardBest+'%':'')):'No questions yet — pick a mode below.')+'</span></div>'+
    '<button class="btn btn-ghost btn-sm" id="switchUser">Switch user</button></div>';
  html+='<div class="hero"><div><h2>🧪 Simulate Exam</h2>'+
    '<p>20 questions across all four question types, with fresh plants and answer choices every run.</p></div>'+
    '<div class="actions"><button class="btn btn-easy" id="simEasy">Easy · multiple choice</button>'+
    '<button class="btn btn-hard" id="simHard">Hard · type answers</button></div></div>';

  html+='<div class="section-title">⭐ Watchlist</div>';
  html+='<div class="wl-card"><div class="big">'+wc+'</div><div class="grow"><h3>'+
    (wc?'Plants to review':'Nothing to review yet')+'</h3><p>'+
    (wc?'Miss a plant and it lands here. Get it right 3 times to clear it.':'Plants you miss will show up here automatically.')+
    '</p></div>'+(wc?'<button class="btn btn-accent btn-sm" id="wlPractice">Practice watchlist</button>':'')+
    '<button class="btn btn-ghost btn-sm" id="wlView">View</button></div>';

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
  el("simEasy").onclick=function(){ startSimulate("easy"); };
  el("simHard").onclick=function(){ startSimulate("hard"); };
  el("wlView").onclick=function(){ go("watchlist"); };
  if(el("wlPractice")) el("wlPractice").onclick=function(){ startWatchlistPractice(); };
  el("switchUser").onclick=function(){ go("gate"); };
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

function renderBrowse(){
  var html='<div class="quizbar"><span class="title">📖 All '+PLANTS.length+' cards</span></div>';
  html+='<div class="browse-grid">'+PLANTS.slice().sort(function(a,b){return a.id-b.id;}).map(function(p){
    return '<div class="pcard">'+(p.image_url?imgTag(p.image_url,"",p.common_name):'')+
      '<div class="body"><div class="cn">'+esc(p.common_name)+'</div>'+
      '<div class="sn">'+esc(p.scientific_name)+'</div>'+
      '<span class="cm">'+esc(p.primary_community)+'</span>'+
      '<div class="ns">'+esc(p.growth_form||"")+' · '+esc(p.native_status)+'</div></div></div>';
  }).join("")+'</div>';
  el("screen").innerHTML=html;
}

/* ---------------- wire up ---------------- */
function init(){
  el("foot").innerHTML='Built from the class Quizlet set. Photos for Monterey cypress and bulrush were provided separately; '+
    'other photos load from Quizlet. Typed answers accept ~80% spelling accuracy. Progress is saved per username in this browser.';
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
  updateWatchBadge(); updateUserChip();
  go(getActiveUser()?"home":"gate");
}
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", init);
else init();

/* test/debug hook */
window.APP={
  PLANTS:PLANTS, COMMUNITIES:COMMUNITIES, normalize:normalize, lev:lev, simRatio:simRatio, checkTyped:checkTyped,
  buildMC4:buildMC4, buildTyped4:buildTyped4, mcText:mcText, mcPhoto:mcPhoto, mcCommunity:mcCommunity,
  loadWatch:loadWatch, saveWatch:saveWatch, recordResult:recordResult, watchCount:watchCount, watchPlants:watchPlants,
  byId:byId, startPractice:startPractice, startSimulate:startSimulate, startWatchlistPractice:startWatchlistPractice,
  go:go, getQuiz:function(){return quiz;}, SIM_TYPES:SIM_TYPES, PRACTICE:PRACTICE,
  listUsers:listUsers, createUser:createUser, getActiveUser:getActiveUser, setActiveUser:setActiveUser,
  deleteUser:deleteUser, loadProfile:loadProfile, saveProfile:saveProfile, saveProfileLocal:saveProfileLocal,
  getStats:getStats, signIn:signIn, Cloud:Cloud, schedulePush:schedulePush, recordSimResult:recordSimResult
};
})();
