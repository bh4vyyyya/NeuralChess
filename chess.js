/* ============================================================
   NEURALCHESS — full chess rules + transparent minimax bot
   ============================================================ */

const FILES='abcdefgh';
const PIECE_UNICODE = {
  wK:'♔',wQ:'♕',wR:'♖',wB:'♗',wN:'♘',wP:'♙',
  bK:'♚',bQ:'♛',bR:'♜',bB:'♝',bN:'♞',bP:'♟'
};
const VALUE = { P:100, N:320, B:330, R:500, Q:900, K:20000 };

// Piece-square tables (white perspective; mirrored for black) — encode positional judgement
const PST = {
P:[0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10,
   5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5,
   5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
N:[-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40,
   -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30,
   -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30,
   -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
B:[-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10,
   -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10,
   -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10,
   -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
R:[0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5,
   -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5,
   -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
Q:[-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10,
   -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5,
   -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
K:[-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
   -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10,
   20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20]
};

function pstValue(type,color,idx){ // idx 0..63, rank0=rank8(top) ... standard array order top-to-bottom
  const table = PST[type];
  const i = color==='w' ? idx : (63-idx);
  return table[i];
}



/* ---------- sound effects (synthesized, no audio files needed) ---------- */
let audioCtx=null;
let soundOn=true;
function ensureAudio(){ if(!audioCtx){ try{ audioCtx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} } return audioCtx; }
function tone(freq,dur,type,gain,delay=0){
  if(!soundOn) return;
  const ctx=ensureAudio(); if(!ctx) return;
  const t0 = ctx.currentTime+delay;
  const osc = ctx.createOscillator(); const g = ctx.createGain();
  osc.type=type||'sine'; osc.frequency.setValueAtTime(freq,t0);
  g.gain.setValueAtTime(0.0001,t0);
  g.gain.exponentialRampToValueAtTime(gain||0.15, t0+0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
  osc.connect(g); g.connect(ctx.destination);
  osc.start(t0); osc.stop(t0+dur+0.02);
}
const sfx = {
  select: ()=> tone(520,0.06,'sine',0.08),
  move:   ()=> { tone(300,0.09,'triangle',0.14); },
  capture:()=> { tone(180,0.05,'square',0.14); tone(140,0.12,'square',0.12,0.04); },
  illegal:()=> { tone(120,0.12,'sawtooth',0.10); },
  check:  ()=> { tone(700,0.09,'sine',0.15); tone(880,0.12,'sine',0.13,0.09); },
  checkmate: ()=> { tone(660,0.14,'sine',0.16); tone(520,0.14,'sine',0.15,0.13); tone(392,0.3,'sine',0.16,0.26); },
  gamestart: ()=> { tone(440,0.08,'sine',0.12); tone(660,0.12,'sine',0.12,0.09); },
};

function announce(msg){
  const el = document.getElementById('announcer');
  el.textContent='';
  setTimeout(()=>{ el.textContent=msg; }, 30);
}
/* ---------- board state ----------
   board is length-64 array, index = rank*8+file, rank0 = 8th rank (top row shown)
   piece = {type:'P/N/B/R/Q/K', color:'w'/'b'}
*/
function initialBoard(){
  const b = new Array(64).fill(null);
  const back = ['R','N','B','Q','K','B','N','R'];
  for(let f=0;f<8;f++){
    b[0*8+f] = {type:back[f], color:'b'};
    b[1*8+f] = {type:'P', color:'b'};
    b[6*8+f] = {type:'P', color:'w'};
    b[7*8+f] = {type:back[f], color:'w'};
  }
  return b;
}

let state = {
  board: initialBoard(),
  turn:'w',
  castling:{wK:true,wQ:true,bK:true,bQ:true},
  ep:null, // en-passant target square idx
  history:[], // for undo: store {board,turn,castling,ep,move}
  captured:{w:[],b:[]}, // pieces captured BY that color
  halfmove:0
};

let humanSide='w';
let selected=null;
let legalForSelected=[];
let gameOver=false;

function idx(r,f){ return r*8+f; }
function rf(i){ return [Math.floor(i/8), i%8]; }
function inb(r,f){ return r>=0&&r<8&&f>=0&&f<8; }
function sqName(i){ const [r,f]=rf(i); return FILES[f]+(8-r); }

function cloneState(s){
  return {
    board: s.board.map(p=>p?{...p}:null),
    turn:s.turn,
    castling:{...s.castling},
    ep:s.ep,
    captured:{w:[...s.captured.w],b:[...s.captured.b]},
    halfmove:s.halfmove
  };
}

/* ---------- move generation ---------- */
const DIRS = {
  B:[[-1,-1],[-1,1],[1,-1],[1,1]],
  R:[[-1,0],[1,0],[0,-1],[0,1]],
  Q:[[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]],
};
const KN = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const KG = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

function genPseudoMoves(s, color){
  const moves=[];
  const b=s.board;
  for(let i=0;i<64;i++){
    const p=b[i]; if(!p||p.color!==color) continue;
    const [r,f]=rf(i);
    if(p.type==='P'){
      const dir = color==='w'?-1:1;
      const startRank = color==='w'?6:1;
      const promoRank = color==='w'?0:7;
      // forward
      if(inb(r+dir,f) && !b[idx(r+dir,f)]){
        addPawnMove(moves,i,idx(r+dir,f),promoRank,r+dir,color,false);
        if(r===startRank && !b[idx(r+2*dir,f)]){
          moves.push({from:i,to:idx(r+2*dir,f),piece:'P',color,flag:'double'});
        }
      }
      // captures
      for(const df of [-1,1]){
        const nr=r+dir, nf=f+df;
        if(!inb(nr,nf)) continue;
        const t=idx(nr,nf);
        if(b[t] && b[t].color!==color){
          addPawnMove(moves,i,t,promoRank,nr,color,true);
        } else if(s.ep===t){
          moves.push({from:i,to:t,piece:'P',color,flag:'ep',capturedIdx: idx(r,nf)});
        }
      }
    } else if(p.type==='N'){
      for(const [dr,df] of KN){
        const nr=r+dr,nf=f+df; if(!inb(nr,nf)) continue;
        const t=idx(nr,nf); const tp=b[t];
        if(!tp||tp.color!==color) moves.push({from:i,to:t,piece:'N',color,capture:!!tp});
      }
    } else if(p.type==='K'){
      for(const [dr,df] of KG){
        const nr=r+dr,nf=f+df; if(!inb(nr,nf)) continue;
        const t=idx(nr,nf); const tp=b[t];
        if(!tp||tp.color!==color) moves.push({from:i,to:t,piece:'K',color,capture:!!tp});
      }
      // castling
      const rank = color==='w'?7:0;
      if(i===idx(rank,4)){
        if(s.castling[color+'K'] && !b[idx(rank,5)] && !b[idx(rank,6)] && b[idx(rank,7)] && b[idx(rank,7)].type==='R'){
          if(!isSquareAttacked(s,idx(rank,4),opp(color)) && !isSquareAttacked(s,idx(rank,5),opp(color)) && !isSquareAttacked(s,idx(rank,6),opp(color)))
            moves.push({from:i,to:idx(rank,6),piece:'K',color,flag:'OO'});
        }
        if(s.castling[color+'Q'] && !b[idx(rank,3)] && !b[idx(rank,2)] && !b[idx(rank,1)] && b[idx(rank,0)] && b[idx(rank,0)].type==='R'){
          if(!isSquareAttacked(s,idx(rank,4),opp(color)) && !isSquareAttacked(s,idx(rank,3),opp(color)) && !isSquareAttacked(s,idx(rank,2),opp(color)))
            moves.push({from:i,to:idx(rank,2),piece:'K',color,flag:'OOO'});
        }
      }
    } else { // sliders B,R,Q
      for(const [dr,df] of DIRS[p.type]){
        let nr=r+dr,nf=f+df;
        while(inb(nr,nf)){
          const t=idx(nr,nf); const tp=b[t];
          if(!tp){ moves.push({from:i,to:t,piece:p.type,color,capture:false}); }
          else { if(tp.color!==color) moves.push({from:i,to:t,piece:p.type,color,capture:true}); break; }
          nr+=dr; nf+=df;
        }
      }
    }
  }
  return moves;
}
function addPawnMove(moves,from,to,promoRank,toRank,color,capture){
  if(toRank===promoRank){
    for(const pr of ['Q','R','B','N']) moves.push({from,to,piece:'P',color,capture,promote:pr});
  } else {
    moves.push({from,to,piece:'P',color,capture});
  }
}
function opp(c){ return c==='w'?'b':'w'; }

function isSquareAttacked(s, sqi, byColor){
  const b=s.board; const [r,f]=rf(sqi);
  // pawns
  const dir = byColor==='w'?1:-1; // attacker pawn moves opposite to find attacker
  for(const df of [-1,1]){
    const nr=r+dir, nf=f+df;
    if(inb(nr,nf)){ const p=b[idx(nr,nf)]; if(p&&p.color===byColor&&p.type==='P') return true; }
  }
  for(const [dr,df] of KN){
    const nr=r+dr,nf=f+df; if(!inb(nr,nf)) continue;
    const p=b[idx(nr,nf)]; if(p&&p.color===byColor&&p.type==='N') return true;
  }
  for(const [dr,df] of KG){
    const nr=r+dr,nf=f+df; if(!inb(nr,nf)) continue;
    const p=b[idx(nr,nf)]; if(p&&p.color===byColor&&p.type==='K') return true;
  }
  for(const [dr,df] of DIRS.B){
    let nr=r+dr,nf=f+df;
    while(inb(nr,nf)){ const p=b[idx(nr,nf)]; if(p){ if(p.color===byColor&&(p.type==='B'||p.type==='Q')) return true; break;} nr+=dr;nf+=df; }
  }
  for(const [dr,df] of DIRS.R){
    let nr=r+dr,nf=f+df;
    while(inb(nr,nf)){ const p=b[idx(nr,nf)]; if(p){ if(p.color===byColor&&(p.type==='R'||p.type==='Q')) return true; break;} nr+=dr;nf+=df; }
  }
  return false;
}

function findKing(s,color){
  for(let i=0;i<64;i++){ const p=s.board[i]; if(p&&p.color===color&&p.type==='K') return i; }
  return -1;
}
function inCheck(s,color){ return isSquareAttacked(s, findKing(s,color), opp(color)); }

function applyMove(s, m){
  const ns = cloneState(s);
  const b = ns.board;
  const moving = b[m.from];
  let capturedPiece = m.capture ? b[m.to] : null;

  if(m.flag==='ep'){
    capturedPiece = b[m.capturedIdx];
    b[m.capturedIdx]=null;
  }
  if(capturedPiece){ ns.captured[moving.color].push(capturedPiece.type); ns.halfmove=0; }
  else if(moving.type==='P') ns.halfmove=0; else ns.halfmove++;

  b[m.to] = m.promote ? {type:m.promote,color:moving.color} : moving;
  b[m.from] = null;

  if(m.flag==='OO'){ const rank=moving.color==='w'?7:0; b[idx(rank,5)]=b[idx(rank,7)]; b[idx(rank,7)]=null; }
  if(m.flag==='OOO'){ const rank=moving.color==='w'?7:0; b[idx(rank,3)]=b[idx(rank,0)]; b[idx(rank,0)]=null; }

  // castling rights
  if(moving.type==='K'){ ns.castling[moving.color+'K']=false; ns.castling[moving.color+'Q']=false; }
  if(moving.type==='R'){
    if(m.from===idx(moving.color==='w'?7:0,0)) ns.castling[moving.color+'Q']=false;
    if(m.from===idx(moving.color==='w'?7:0,7)) ns.castling[moving.color+'K']=false;
  }
  if(m.to===idx(0,0)) ns.castling.bQ=false;
  if(m.to===idx(0,7)) ns.castling.bK=false;
  if(m.to===idx(7,0)) ns.castling.wQ=false;
  if(m.to===idx(7,7)) ns.castling.wK=false;

  ns.ep = m.flag==='double' ? (m.from+m.to)/2 : null;
  ns.turn = opp(s.turn);
  return ns;
}

function legalMoves(s,color){
  const pseudo = genPseudoMoves(s,color);
  const legal=[];
  for(const m of pseudo){
    const ns = applyMove(s,m);
    if(!inCheck(ns,color)) legal.push(m);
  }
  return legal;
}

function gameStatus(s){
  const moves = legalMoves(s,s.turn);
  const chk = inCheck(s,s.turn);
  if(moves.length===0) return chk ? 'checkmate' : 'stalemate';
  if(s.halfmove>=100) return 'draw50';
  return chk ? 'check' : 'ongoing';
}

/* ---------- move notation ---------- */
function moveToSAN(s, m, legalList){
  if(m.flag==='OO') return 'O-O';
  if(m.flag==='OOO') return 'O-O-O';
  const pieceLetter = m.piece==='P' ? '' : m.piece;
  let disamb='';
  if(m.piece!=='P'){
    const sameTarget = legalList.filter(o=>o.piece===m.piece && o.to===m.to && o.from!==m.from);
    if(sameTarget.length){
      const sameFile = sameTarget.some(o=>rf(o.from)[1]===rf(m.from)[1]);
      const sameRank = sameTarget.some(o=>rf(o.from)[0]===rf(m.from)[0]);
      if(!sameFile) disamb = FILES[rf(m.from)[1]];
      else if(!sameRank) disamb = (8-rf(m.from)[0]);
      else disamb = sqName(m.from);
    }
  }
  const cap = (m.capture || m.flag==='ep') ? (m.piece==='P'? FILES[rf(m.from)[1]]+'x' : disamb+'x') : disamb;
  const promo = m.promote ? '='+m.promote : '';
  return pieceLetter + (m.piece==='P'?cap:cap) + sqName(m.to) + promo;
}

/* ---------- evaluation (transparent) ---------- */
function evaluate(s, breakdown){
  let material=0, position=0, mobility=0, kingSafety=0;
  const myMoves = legalMoves(s,'w').length; // for mobility term we always compute from white's raw movegen counts (pseudo is fine for a heuristic, but let's use legal for both if not too slow at leaf... use pseudo for speed)
  let wMob = genPseudoMoves(s,'w').length;
  let bMob = genPseudoMoves(s,'b').length;
  for(let i=0;i<64;i++){
    const p=s.board[i]; if(!p) continue;
    const val = VALUE[p.type];
    const pst = p.type==='K' ? 0 : pstValue(p.type,p.color,i);
    if(p.color==='w'){ material+=val; position+=pst; }
    else { material-=val; position-=pst; }
  }
  mobility = (wMob-bMob)*2;
  const wChk = inCheck(s,'w'), bChk = inCheck(s,'b');
  if(wChk) kingSafety-=50;
  if(bChk) kingSafety+=50;

  const total = material+position+mobility+kingSafety;
  if(breakdown){
    breakdown.material=material; breakdown.position=position;
    breakdown.mobility=mobility; breakdown.kingSafety=kingSafety; breakdown.total=total;
    breakdown.wMob=wMob; breakdown.bMob=bMob;
  }
  return total; // positive = good for White
}

/* ---------- minimax with alpha-beta, instrumented ---------- */
let search = { nodes:0, pruned:0 };

function orderMoves(s,moves){
  // simple MVV-LVA-ish ordering: captures first by captured value desc
  return moves.slice().sort((a,b)=>{
    const av = a.capture ? (VALUE[targetType(s,a)]||0) : (a.promote?VALUE.Q*0.1:0);
    const bv = b.capture ? (VALUE[targetType(s,b)]||0) : (b.promote?VALUE.Q*0.1:0);
    return bv-av;
  });
}
function targetType(s,m){ const p=s.board[m.to]; return p?p.type:'P'; }

const PLY_VISUALIZE_DEPTH = 2; // draw paths for this many plies of recursion beyond the root move
const PLY_COLORS = { 1:'#e0a458', 2:'#6fa8e0', 3:'#b07ee0' };

async function minimax(s, depth, alpha, beta, maximizing, ply, totalDepth){
  search.nodes++;
  const status = quickStatus(s);
  if(depth===0 || status!=='ongoing'){
    if(status==='checkmate') return maximizing ? -99999-depth : 99999+depth;
    if(status==='stalemate'||status==='draw50') return 0;
    return evaluate(s,null);
  }
  const moves = orderMoves(s, legalMoves(s,s.turn));
  const showPaths = ply<=PLY_VISUALIZE_DEPTH;
  let best = maximizing ? -Infinity : Infinity;
  for(const m of moves){
    if(showPaths){
      drawArrow(m, 'ply'+ply);
      pulseNode(m.to);
      const d = speedDelay();
      if(d>0) await new Promise(r=>setTimeout(r, Math.max(4, d/(ply*4))));
    }
    const ns = applyMove(s,m);
    const val = await minimax(ns, depth-1, alpha, beta, !maximizing, ply+1, totalDepth);
    if(maximizing){
      if(val>best) best=val;
      alpha=Math.max(alpha,val);
    } else {
      if(val<best) best=val;
      beta=Math.min(beta,val);
    }
    if(showPaths){
      // fade this ply's arrow once its subtree is fully explored
      const g = overlaySvg.querySelector(`g.arrow[data-to="${m.to}"][data-from="${m.from}"][data-ply="${ply}"]`);
      if(g) g.style.opacity = '0.12';
    }
    if(beta<=alpha){ search.pruned += (moves.length - moves.indexOf(m) - 1); break; }
  }
  return best;
}
// cheap status check without full legalMoves twice where possible
function quickStatus(s){
  const moves = legalMoves(s,s.turn);
  if(moves.length===0) return inCheck(s,s.turn) ? 'checkmate' : 'stalemate';
  if(s.halfmove>=100) return 'draw50';
  return 'ongoing';
}

function speedDelay(){ return parseInt(document.getElementById('speedSlider').value,10); }

async function botThink(s, depth){
  search = {nodes:0, pruned:0};
  const t0 = performance.now();
  const color = s.turn;
  const maximizing = color==='w';
  const moves = orderMoves(s, legalMoves(s,color));
  const results=[];
  let alpha=-Infinity, beta=Infinity;
  logLine(`<span class="tag">▶ Root position:</span> ${color==='w'?'White':'Black'} to move. ${moves.length} legal moves found.`);
  logLine(`<span class="dim">Ordering moves: captures & promotions searched first (MVV-LVA heuristic) to improve alpha-beta cutoffs.</span>`);
  clearOverlay();

  let bestSoFar = null;
  for(const m of moves){
    const ns = applyMove(s,m);
    // visualize: this branch is being explored right now
    drawArrow(m, 'exploring');
    pulseNode(m.to);
    const delay = speedDelay();
    if(delay>0) await new Promise(r=>setTimeout(r,delay));

    const val = await minimax(ns, depth-1, -Infinity, Infinity, !maximizing, 1, depth);
    results.push({m, val});
    const san = moveToSAN(s,m,moves);

    const improves = bestSoFar===null || (maximizing ? val>bestSoFar.val : val<bestSoFar.val);
    if(improves) bestSoFar = {m,val};

    logLine(`  <span class="tag2">${san}</span> → evaluated at <b>${(val/100).toFixed(2)}</b> (searched to depth ${depth})${improves?' <span class="tag">← new best</span>':''}`);
    drawArrow(m, improves ? 'best' : 'done');
  }
  results.sort((a,b)=> maximizing ? b.val-a.val : a.val-b.val);

  const t1 = performance.now();
  const best = results[0];

  // final visualization: fade all, highlight the chosen path
  clearOverlay();
  drawArrow(best.m, 'chosen');

  logLine(`<span class="tag">■ Search complete.</span> Best move: <span class="tag2">${moveToSAN(s,best.m,moves)}</span> with score ${(best.val/100).toFixed(2)}`);
  logLine(`<span class="dim">Explored ${search.nodes} nodes total, pruned ~${search.pruned} branches via alpha-beta, in ${(t1-t0).toFixed(0)}ms.</span>`);
  logLine('---');

  return {results, moves, nodes:search.nodes, pruned:search.pruned, time:t1-t0, s};
}

/* ---------- board overlay: visualize candidate moves / nodes as the bot searches ---------- */
const overlaySvg = document.getElementById('overlay');
function clearOverlay(){ overlaySvg.innerHTML=''; }

function sqCenter(i){
  const [r,f] = rf(i);
  const vr = flipped ? 7-r : r;
  const vf = flipped ? 7-f : f;
  return [vf+0.5, vr+0.5];
}

function drawArrow(m, kind){
  const [x1,y1] = sqCenter(m.from);
  const [x2,y2] = sqCenter(m.to);
  const ns='http://www.w3.org/2000/svg';
  const g = document.createElementNS(ns,'g');
  g.setAttribute('class','arrow');
  g.dataset.to = m.to;
  g.dataset.from = m.from;

  let color, width, opacity, ply=null;
  if(kind==='exploring'){ color='#e0a458'; width=0.06; opacity=0.55; }
  else if(kind==='done'){ color='#8a92a6'; width=0.035; opacity=0.25; }
  else if(kind==='best'){ color='#5ec9a6'; width=0.07; opacity=0.85; }
  else if(kind==='chosen'){ color='#5ec9a6'; width=0.09; opacity=1; }
  else if(kind.startsWith('ply')){
    ply = parseInt(kind.slice(3),10);
    color = PLY_COLORS[ply] || '#8a92a6';
    width = Math.max(0.018, 0.05 - ply*0.012);
    opacity = Math.max(0.18, 0.5 - ply*0.12);
    g.dataset.ply = ply;
  }

  // remove any previous arrow for this exact from->to at the same ply (avoid stacking dupes on repeated visits)
  const selector = ply!==null
    ? `g.arrow[data-to="${m.to}"][data-from="${m.from}"][data-ply="${ply}"]`
    : `g.arrow[data-to="${m.to}"][data-from="${m.from}"]:not([data-ply])`;
  const prev = overlaySvg.querySelector(selector);
  if(prev) prev.remove();

  const line = document.createElementNS(ns,'line');
  line.setAttribute('x1',x1); line.setAttribute('y1',y1);
  line.setAttribute('x2',x2); line.setAttribute('y2',y2);
  line.setAttribute('stroke',color);
  line.setAttribute('stroke-width',width);
  line.setAttribute('stroke-linecap','round');
  line.setAttribute('opacity',opacity);
  g.appendChild(line);

  // arrowhead
  const angle = Math.atan2(y2-y1, x2-x1);
  const hx = x2 - 0.18*Math.cos(angle), hy = y2 - 0.18*Math.sin(angle);
  const a1 = angle + 2.6, a2 = angle - 2.6;
  const p1x = hx + 0.13*Math.cos(a1), p1y = hy + 0.13*Math.sin(a1);
  const p2x = hx + 0.13*Math.cos(a2), p2y = hy + 0.13*Math.sin(a2);
  const head = document.createElementNS(ns,'polygon');
  head.setAttribute('points', `${x2},${y2} ${p1x},${p1y} ${p2x},${p2y}`);
  head.setAttribute('fill',color);
  head.setAttribute('opacity',opacity);
  g.appendChild(head);

  overlaySvg.appendChild(g);
}

function pulseNode(sqi){
  const [x,y] = sqCenter(sqi);
  const ns='http://www.w3.org/2000/svg';
  const c = document.createElementNS(ns,'circle');
  c.setAttribute('cx',x); c.setAttribute('cy',y); c.setAttribute('r','0.05');
  c.setAttribute('class','node-pulse');
  overlaySvg.appendChild(c);
  setTimeout(()=>{ c.remove(); }, 650);
}

/* ---------- UI rendering ---------- */
const boardEl = document.getElementById('board');
boardEl.setAttribute('role','grid');
boardEl.setAttribute('aria-label','Chess board');
let flipped=false;
let focusedIdx = idx(6,4); // start focus near a natural square

function pieceName(p){
  if(!p) return '';
  const names={P:'pawn',N:'knight',B:'bishop',R:'rook',Q:'queen',K:'king'};
  return (p.color==='w'?'White':'Black')+' '+names[p.type];
}

function renderBoard(){
  const prevFocused = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('sq')
    ? parseInt(document.activeElement.dataset.idx,10) : null;
  boardEl.innerHTML='';
  const status = gameStatus(state);
  const kingIdx = (status==='checkmate'||status==='check') ? findKing(state,state.turn) : -1;
  const lastMove = state.history.length ? state.history[state.history.length-1].move : null;

  for(let visR=0; visR<8; visR++){
    for(let visF=0; visF<8; visF++){
      const r = flipped ? 7-visR : visR;
      const f = flipped ? 7-visF : visF;
      const i = idx(r,f);
      const sq = document.createElement('div');
      sq.className = 'sq ' + (((r+f)%2===0)?'light':'dark');
      sq.dataset.idx = i;
      sq.setAttribute('role','gridcell');
      sq.tabIndex = (i===focusedIdx) ? 0 : -1;
      if(visR===7) { const c=document.createElement('div'); c.className='coord f'; c.textContent=FILES[f]; sq.appendChild(c); }
      if(visF===0) { const c=document.createElement('div'); c.className='coord r'; c.textContent=8-r; sq.appendChild(c); }

      const p = state.board[i];
      if(p){ const sp=document.createElement('span'); sp.className='piece '+(p.color==='w'?'white':'black'); sp.textContent=PIECE_UNICODE[p.color+p.type]; sp.setAttribute('aria-hidden','true'); sq.appendChild(sp); }

      const label = sqName(i) + (p ? `, ${pieceName(p)}` : ', empty')
        + (lastMove && (lastMove.from===i||lastMove.to===i) ? ', last move' : '')
        + (i===kingIdx ? ', king in check' : '')
        + (legalForSelected.some(m=>m.to===i) ? ', legal move target' : '');
      sq.setAttribute('aria-label', label);

      if(selected===i) sq.classList.add('selected');
      if(legalForSelected.some(m=>m.to===i)) sq.classList.add(state.board[i]?'capture':'legal');
      if(lastMove && (lastMove.from===i||lastMove.to===i)) sq.classList.add('lastmove');
      if(i===kingIdx) sq.classList.add('check');

      sq.addEventListener('click', ()=>{ focusedIdx=i; onSquareClick(i); });
      sq.addEventListener('keydown', (e)=>onSquareKeydown(e,i));
      sq.addEventListener('focus', ()=>{ focusedIdx=i; });
      boardEl.appendChild(sq);
    }
  }
  renderCaptures();
  renderStatus(status);

  if(prevFocused!==null){
    const el = boardEl.querySelector(`.sq[data-idx="${focusedIdx}"]`);
    if(el && document.activeElement!==el && document.activeElement.closest && document.activeElement.closest('#board')) el.focus();
  }
}

function onSquareKeydown(e, i){
  const [r,f] = rf(i);
  let nr=r, nf=f;
  switch(e.key){
    case 'ArrowUp': nr = flipped ? Math.min(7,r+1) : Math.max(0,r-1); break;
    case 'ArrowDown': nr = flipped ? Math.max(0,r-1) : Math.min(7,r+1); break;
    case 'ArrowLeft': nf = flipped ? Math.min(7,f+1) : Math.max(0,f-1); break;
    case 'ArrowRight': nf = flipped ? Math.max(0,f-1) : Math.min(7,f+1); break;
    case 'Enter': case ' ': e.preventDefault(); focusedIdx=i; onSquareClick(i); return;
    case 'Escape': selected=null; legalForSelected=[]; renderBoard(); return;
    default: return;
  }
  e.preventDefault();
  focusedIdx = idx(nr,nf);
  const el = boardEl.querySelector(`.sq[data-idx="${focusedIdx}"]`);
  if(el) el.focus();
}

function renderCaptures(){
  const cw = document.getElementById('captWhite');
  const cb = document.getElementById('captBlack');
  cw.innerHTML = state.captured.w.map(t=>PIECE_UNICODE['b'+t]).join(' ');
  cb.innerHTML = state.captured.b.map(t=>PIECE_UNICODE['w'+t]).join(' ');
}

function renderStatus(status){
  const el = document.getElementById('statusLine');
  const turnName = state.turn==='w'?'White':'Black';
  if(status==='checkmate'){ el.innerHTML = `<b>Checkmate.</b> ${turnName==='White'?'Black':'White'} wins.`; gameOver=true; return; }
  if(status==='stalemate'){ el.innerHTML = `<b>Stalemate.</b> Draw.`; gameOver=true; return; }
  if(status==='draw50'){ el.innerHTML = `<b>Draw</b> (50-move rule).`; gameOver=true; return; }
  el.innerHTML = `${turnName} to move.` + (status==='check' ? ` <b>Check!</b>` : '');
}

function onSquareClick(i){
  if(gameOver) return;
  if(state.turn!==humanSide) return; // not your turn
  const p = state.board[i];
  if(selected!==null){
    const mv = legalForSelected.find(m=>m.to===i);
    if(mv){
      let chosen = mv;
      const promoMoves = legalForSelected.filter(m=>m.to===i && m.promote);
      if(promoMoves.length>1) chosen = promoMoves.find(m=>m.promote==='Q');
      makeMove(chosen);
      selected=null; legalForSelected=[];
      clearOverlay();
      renderBoard();
      if(!gameOver) setTimeout(triggerBotIfNeeded, 250);
      return;
    }
    if(p && p.color===humanSide){ sfx.select(); selected=i; legalForSelected = legalMoves(state,state.turn).filter(m=>m.from===i); renderBoard(); return; }
    if(p===null && selected!==null){ sfx.illegal(); }
    selected=null; legalForSelected=[]; renderBoard(); return;
  }
  if(p && p.color===humanSide){ sfx.select(); selected=i; legalForSelected = legalMoves(state,state.turn).filter(m=>m.from===i); renderBoard(); }
  else if(p){ sfx.illegal(); }
}

function makeMove(m){
  const beforeMoves = legalMoves(state,state.turn);
  const san = moveToSAN(state,m,beforeMoves);
  const isCapture = !!(m.capture || m.flag==='ep');
  const moverColor = state.turn;
  state.history.push({board:state.board.map(p=>p?{...p}:null), turn:state.turn, castling:{...state.castling}, ep:state.ep, captured:{w:[...state.captured.w],b:[...state.captured.b]}, move:m, san});
  const ns = applyMove(state,m);
  state.board=ns.board; state.turn=ns.turn; state.castling=ns.castling; state.ep=ns.ep; state.captured=ns.captured; state.halfmove=ns.halfmove;

  const st = gameStatus(state);
  if(st==='checkmate'){ sfx.checkmate(); announce(`${moverColor==='w'?'White':'Black'} played ${san}. Checkmate. ${moverColor==='w'?'White':'Black'} wins.`); }
  else if(st==='stalemate'){ sfx.checkmate(); announce(`${moverColor==='w'?'White':'Black'} played ${san}. Stalemate, the game is a draw.`); }
  else if(st==='check'){ sfx.check(); announce(`${moverColor==='w'?'White':'Black'} played ${san}. Check.`); }
  else if(isCapture){ sfx.capture(); announce(`${moverColor==='w'?'White':'Black'} played ${san}, capturing a piece.`); }
  else { sfx.move(); announce(`${moverColor==='w'?'White':'Black'} played ${san}.`); }
}

function undo(){
  if(!state.history.length) return;
  const last = state.history.pop();
  state.board=last.board; state.turn=last.turn; state.castling=last.castling; state.ep=last.ep; state.captured=last.captured;
  gameOver=false; selected=null; legalForSelected=[];
  renderBoard();
}

/* ---------- reasoning panel wiring ---------- */
function logLine(html){
  const box = document.getElementById('logBox');
  box.innerHTML += (box.innerHTML && box.innerHTML!=='Ready. Make a move to begin.' ? '\n' : (box.innerHTML==='Ready. Make a move to begin.'?'':'\n')) ;
  if(box.textContent==='Ready. Make a move to begin.') box.innerHTML='';
  box.innerHTML += html + '\n';
  box.scrollTop = box.scrollHeight;
}
function clearLog(){ document.getElementById('logBox').innerHTML=''; }

function setLive(on){ document.getElementById('liveDot').classList.toggle('live',on); }

function updateMetrics(nodes,pruned,depth,time){
  document.getElementById('mNodes').textContent = nodes.toLocaleString();
  document.getElementById('mPruned').textContent = pruned.toLocaleString();
  document.getElementById('mDepth').textContent = depth;
  document.getElementById('mTime').textContent = time.toFixed(0)+'ms';
}

function updateEvalBar(score){
  // score positive = good for White. Clamp to [-1000,1000] cp for bar width
  const clamped = Math.max(-1000,Math.min(1000,score));
  const pct = 50 + (clamped/1000)*50;
  const fill = document.getElementById('evalFill');
  fill.style.left = score>=0 ? '50%' : pct+'%';
  fill.style.width = Math.abs(pct-50)+'%';
  document.getElementById('evalNum').textContent = (score/100).toFixed(2);
}

function updateFormula(bd){
  document.getElementById('formulaBox').innerHTML =
`<span class="k">score</span> = material + position + mobility + king_safety

material     = Σ(white piece values) − Σ(black piece values)  = <b>${bd.material}</b>
position     = Σ(piece-square table bonuses, white − black)   = <b>${bd.position}</b>
mobility     = (white_legal_moves − black_legal_moves) × 2    = <b>${bd.mobility}</b>
              (white: ${bd.wMob} pseudo-moves, black: ${bd.bMob})
king_safety  = −50 if White in check, +50 if Black in check   = <b>${bd.kingSafety}</b>
─────────────────────────────────────────────
total        = <b>${bd.total}</b>  (${bd.total/100 >=0 ? '+' : ''}${(bd.total/100).toFixed(2)}, positive favors White)`;
}

function updateCandTable(results, moves, boardState, maximizing){
  const body = document.getElementById('candBody');
  body.innerHTML='';
  results.forEach((r,idx2)=>{
    const tr = document.createElement('tr');
    if(idx2===0) tr.classList.add('best');
    const san = moveToSAN(boardState, r.m, moves);
    const noteBits=[];
    if(r.m.capture||r.m.flag==='ep') noteBits.push('<span class="badge cap">capture</span>');
    if(r.m.promote) noteBits.push('<span class="badge cap">promotes→'+r.m.promote+'</span>');
    tr.innerHTML = `<td>${idx2+1}</td><td>${san}</td><td>${(r.val/100).toFixed(2)}</td><td>${noteBits.join('')}</td>`;
    body.appendChild(tr);
  });
}

async function triggerBotIfNeeded(){
  if(gameOver) return;
  if(state.turn===humanSide) return;
  setLive(true);
  clearLog();
  const depth = parseInt(document.getElementById('depthSel').value,10);
  logLine(`<span class="tag">Bot (${state.turn==='w'?'White':'Black'}) begins search at depth ${depth}...</span>`);
  await new Promise(r=>setTimeout(r,30)); // let UI paint
  const t0=performance.now();
  const {results, moves, nodes, pruned, time} = await botThink(state, depth);
  const chosen = results[0].m;

  const bd={};
  evaluate(applyMove(state,chosen), bd);
  updateFormula(bd);
  updateEvalBar(bd.total);
  updateMetrics(nodes,pruned,depth,time);
  updateCandTable(results, moves, state, state.turn==='w');

  makeMove(chosen);
  renderBoard();
  setLive(false);

  if(gameOver) return;
}

/* ---------- controls ---------- */
document.getElementById('newGameBtn').addEventListener('click', ()=>{
  state = { board: initialBoard(), turn:'w', castling:{wK:true,wQ:true,bK:true,bQ:true}, ep:null, history:[], captured:{w:[],b:[]}, halfmove:0 };
  gameOver=false; selected=null; legalForSelected=[];
  humanSide = document.getElementById('sideSel').value;
  flipped = humanSide==='b';
  clearLog();
  clearOverlay();
  document.getElementById('candBody').innerHTML='';
  document.getElementById('formulaBox').textContent='Waiting for first move…';
  updateMetrics(0,0,0,0);
  updateEvalBar(0);
  renderBoard();
  sfx.gamestart();
  announce(`New game started. You are playing ${humanSide==='w'?'White':'Black'}.`);
  if(state.turn!==humanSide) setTimeout(triggerBotIfNeeded,300);
});
document.getElementById('undoBtn').addEventListener('click', ()=>{ undo(); if(state.turn!==humanSide && !gameOver) undo(); });
document.getElementById('flipBtn').addEventListener('click', ()=>{ flipped=!flipped; renderBoard(); });
document.getElementById('sideSel').addEventListener('change', ()=>{ document.getElementById('newGameBtn').click(); });
document.getElementById('speedSlider').addEventListener('input', (e)=>{
  document.getElementById('speedLabel').textContent = e.target.value+'ms/move';
});

renderBoard();

/* ---------- Neural Network Background Animation ---------- */
(function() {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  let width = 0;
  let height = 0;
  let layers = [];
  let signals = [];
  
  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
    initNetwork();
  }
  
  class Node {
    constructor(layerIndex, nodeIndex, countInLayer) {
      this.layerIndex = layerIndex;
      this.nodeIndex = nodeIndex;
      
      const marginX = width * 0.15;
      const layerSpan = width * 0.7;
      this.baseX = marginX + (layerIndex / 3) * layerSpan;
      
      const layerHeight = height * 0.6;
      const marginY = height * 0.2;
      if (countInLayer === 1) {
        this.baseY = height / 2;
      } else {
        this.baseY = marginY + (nodeIndex / (countInLayer - 1)) * layerHeight;
      }
      
      this.x = this.baseX;
      this.y = this.baseY;
      this.angleX = Math.random() * Math.PI * 2;
      this.angleY = Math.random() * Math.PI * 2;
      this.speedX = 0.005 + Math.random() * 0.005;
      this.speedY = 0.005 + Math.random() * 0.005;
      this.ampX = 10 + Math.random() * 20;
      this.ampY = 10 + Math.random() * 20;
      
      this.pulseIntensity = 0;
      this.connections = [];
    }
    
    update(time) {
      this.angleX += this.speedX;
      this.angleY += this.speedY;
      this.x = this.baseX + Math.sin(this.angleX) * this.ampX;
      this.y = this.baseY + Math.cos(this.angleY) * this.ampY;
      
      if (this.pulseIntensity > 0) {
        this.pulseIntensity -= 0.05;
      } else {
        this.pulseIntensity = 0;
      }
    }
    
    draw() {
      ctx.beginPath();
      const r = 3 + this.pulseIntensity * 4;
      ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
      
      if (this.pulseIntensity > 0) {
        ctx.fillStyle = `rgba(16, 185, 129, ${0.4 + this.pulseIntensity * 0.6})`;
        ctx.shadowColor = 'rgba(16, 185, 129, 0.8)';
        ctx.shadowBlur = 10 + this.pulseIntensity * 10;
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.shadowBlur = 0;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
  
  class Signal {
    constructor(fromNode, toNode) {
      this.fromNode = fromNode;
      this.toNode = toNode;
      this.progress = 0;
      this.speed = 0.008 + Math.random() * 0.006;
    }
    
    update() {
      this.progress += this.speed;
      if (this.progress >= 1) {
        this.toNode.pulseIntensity = 1.0;
        const nextLayerIdx = this.toNode.layerIndex + 1;
        if (nextLayerIdx < layers.length) {
          const nextLayer = layers[nextLayerIdx];
          const branches = Math.random() > 0.5 ? 2 : 1;
          for (let i = 0; i < branches; i++) {
            const targetNode = nextLayer[Math.floor(Math.random() * nextLayer.length)];
            signals.push(new Signal(this.toNode, targetNode));
          }
        }
        return false;
      }
      return true;
    }
    
    draw() {
      const x = this.fromNode.x + (this.toNode.x - this.fromNode.x) * this.progress;
      const y = this.fromNode.y + (this.toNode.y - this.fromNode.y) * this.progress;
      
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(16, 185, 129, 0.9)';
      ctx.shadowColor = '#10b981';
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
  
  function initNetwork() {
    layers = [];
    signals = [];
    
    const counts = [5, 7, 6, 3];
    
    for (let l = 0; l < counts.length; l++) {
      const layer = [];
      for (let n = 0; n < counts[l]; n++) {
        layer.push(new Node(l, n, counts[l]));
      }
      layers.push(layer);
    }
    
    for (let l = 0; l < layers.length - 1; l++) {
      const currentLayer = layers[l];
      const nextLayer = layers[l + 1];
      
      for (const node of currentLayer) {
        for (const target of nextLayer) {
          node.connections.push(target);
        }
      }
    }
  }
  
  let lastSignalTime = 0;
  
  function animate(time) {
    ctx.clearRect(0, 0, width, height);
    
    for (const layer of layers) {
      for (const node of layer) {
        node.update(time);
      }
    }
    
    ctx.lineWidth = 0.5;
    for (const layer of layers) {
      for (const node of layer) {
        for (const target of node.connections) {
          ctx.beginPath();
          ctx.moveTo(node.x, node.y);
          ctx.lineTo(target.x, target.y);
          if (node.pulseIntensity > 0) {
            ctx.strokeStyle = `rgba(16, 185, 129, ${0.03 + node.pulseIntensity * 0.15})`;
          } else {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
          }
          ctx.stroke();
        }
      }
    }
    
    signals = signals.filter(sig => {
      const active = sig.update();
      if (active) sig.draw();
      return active;
    });
    
    for (const layer of layers) {
      for (const node of layer) {
        node.draw();
      }
    }
    
    if (time - lastSignalTime > 800) {
      const inputLayer = layers[0];
      const startNode = inputLayer[Math.floor(Math.random() * inputLayer.length)];
      startNode.pulseIntensity = 1.0;
      
      const nextLayer = layers[1];
      const branches = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < branches; i++) {
        const targetNode = nextLayer[Math.floor(Math.random() * nextLayer.length)];
        signals.push(new Signal(startNode, targetNode));
      }
      lastSignalTime = time;
    }
    
    requestAnimationFrame(animate);
  }
  
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(animate);
})();
