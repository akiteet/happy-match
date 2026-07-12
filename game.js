(() => {
  "use strict";

  // ==================== 配置 ====================
  const COLS = 8;
  const ROWS = 8;
  const TYPES = 6;
  const EMOJIS = ["🐰", "🐻", "🐼", "🐸", "🐯", "🐱"];
  const NAMES = ["兔子", "熊", "熊猫", "青蛙", "老虎", "猫"];
  const BOARD = 512;
  const CELL = BOARD / COLS;
  const SWAP_MS = 140;
  const CLEAR_MS = 160;
  const FALL_MS = 220;

  const LEVELS = [
    { name: "第 1 关", moves: 30, goal: { type: "score", target: 500 }, ice: [[3, 3, 1], [3, 4, 1], [4, 3, 1], [4, 4, 1]] },
    { name: "第 2 关", moves: 25, goal: { type: "color", color: 2, target: 25 }, ice: [[2, 2, 1], [5, 5, 1]] },
    {
      name: "第 3 关",
      moves: 22,
      goal: { type: "ice", target: 0 }, // 运行时按冰层总数
      ice: Array.from({ length: 8 }, (_, i) => [i, i, i % 2 ? 1 : 2]),
    },
    {
      name: "第 4 关",
      moves: 24,
      goal: { type: "score", target: 800 },
      vines: [[1, 1, 2], [1, 2, 2], [2, 1, 2], [2, 2, 2]],
      cages: [[4, 3], [4, 4]],
    },
    {
      name: "第 5 关",
      moves: 20,
      goal: { type: "color", color: 0, target: 28 },
      ice: [[0, 0, 2], [0, 7, 2], [7, 0, 2], [7, 7, 2]],
      vines: [[3, 3, 2], [3, 4, 2]],
    },
  ];

  // ==================== DOM ====================
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  function fitCanvas() {
    // 逻辑坐标固定 BOARD，避免双重缩放导致糊
    const maxCss = Math.min(BOARD, window.innerWidth - 32, (window.innerHeight || 800) - 200);
    const css = Math.max(300, Math.floor(maxCss));
    canvas.style.width = css + "px";
    canvas.style.height = css + "px";
    canvas.width = Math.round(BOARD * dpr);
    canvas.height = Math.round(BOARD * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // emoji 清晰：适度平滑即可
    ctx.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
  }
  fitCanvas();
  window.addEventListener("resize", fitCanvas);

  const $ = (id) => document.getElementById(id);
  const el = {
    score: $("score"),
    combo: $("combo"),
    level: $("level-num"),
    moves: $("moves"),
    goalText: $("goal-text"),
    goalFill: $("goal-fill"),
    goalProg: $("goal-prog"),
    goalIcon: $("goal-icon"),
    starsSlot: $("stars-slot"),
    soundBtn: $("sound-btn"),
    musicBtn: $("music-btn"),
    fxBtn: $("fx-btn"),
    restart: $("restart"),
    hintBtn: $("hint-btn"),
    hintLeft: $("hint-left"),
    overlay: $("overlay"),
    overlayTitle: $("overlay-title"),
    overlayMsg: $("overlay-msg"),
    overlayBtn: $("overlay-btn"),
    resultStars: $("result-stars"),
    startOverlay: $("start-overlay"),
    startLevel: $("start-level"),
    startIcon: $("start-icon"),
    startDesc: $("start-desc"),
    startMoves: $("start-moves"),
    startBtn: $("start-btn"),
    comboBanner: $("combo-banner"),
  };

  // ==================== 状态 ====================
  let grid = [];
  let pos = [];
  let levelIndex = 0;
  let score = 0;
  let combo = 0;
  let movesLeft = 0;
  let movesMax = 0;
  let colorCleared = 0;
  let iceTotal = 0;
  let selected = null;
  let state = "idle"; // idle | busy | overlay
  let soundOn = true;
  let audioCtx = null;
  let hintsLeft = 3;
  let hintPair = null;
  let anim = null; // { kind, t0, dur, from, to, mask, done }

  // ==================== 工具 ====================
  const center = (r, c) => ({ x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 });
  const inBound = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  const adj = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
  const key = (r, c) => r + "," + c;
  const randColor = () => Math.floor(Math.random() * TYPES);
  const ease = (t) => 1 - (1 - t) * (1 - t);

  function emptyCell() {
    return { color: -1, special: null, ice: 0, cage: false, vine: 0 };
  }
  function piece(color, special) {
    return { color, special: special || null, ice: 0, cage: false, vine: 0 };
  }
  function clonePiece(p) {
    return { color: p.color, special: p.special, ice: 0, cage: !!p.cage, vine: 0 };
  }

  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  }

  function beep(freq, dur, vol) {
    if (!soundOn) return;
    ensureAudio();
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.04, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(t0);
    o.stop(t0 + dur);
  }

  function sfx(name, n) {
    if (name === "swap") beep(400, 0.05, 0.03);
    else if (name === "bad") beep(180, 0.08, 0.025);
    else if (name === "clear") beep(520 + (n || 0) * 30, 0.07, 0.035);
    else if (name === "special") beep(360, 0.1, 0.03);
    else if (name === "win") {
      [523, 659, 784].forEach((f, i) => setTimeout(() => beep(f, 0.1, 0.03), i * 90));
    } else if (name === "lose") beep(160, 0.2, 0.03);
  }

  // ==================== 棋盘 ====================
  function makeBoard(level) {
    grid = [];
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let c = 0; c < COLS; c++) {
        let color;
        do {
          color = randColor();
        } while (
          (c >= 2 && row[c - 1].color === color && row[c - 2].color === color) ||
          (r >= 2 && grid[r - 1][c].color === color && grid[r - 2][c].color === color)
        );
        row.push(piece(color));
      }
      grid.push(row);
    }

    (level.vines || []).forEach(([r, c, hp]) => {
      if (!inBound(r, c)) return;
      grid[r][c] = emptyCell();
      grid[r][c].vine = hp || 2;
    });
    (level.ice || []).forEach(([r, c, hp]) => {
      if (!inBound(r, c) || grid[r][c].vine) return;
      if (grid[r][c].color < 0) grid[r][c] = piece(randColor());
      grid[r][c].ice = hp || 1;
    });
    (level.cages || []).forEach(([r, c]) => {
      if (!inBound(r, c) || grid[r][c].vine) return;
      if (grid[r][c].color < 0) grid[r][c] = piece(randColor());
      grid[r][c].cage = true;
    });

    // 清掉开局三连
    for (let g = 0; g < 40 && findMatches().size; g++) {
      findMatches().forEach(({ r, c }) => {
        if (!grid[r][c].vine) grid[r][c].color = randColor();
      });
    }

    pos = [];
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let c = 0; c < COLS; c++) row.push(center(r, c));
      pos.push(row);
    }

    iceTotal = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) iceTotal += grid[r][c].ice || 0;
  }

  // ==================== 匹配 ====================
  function findMatches() {
    const m = new Map();
    for (let r = 0; r < ROWS; r++) {
      let c = 0;
      while (c < COLS) {
        const cell = grid[r][c];
        if (cell.color < 0 || cell.vine) {
          c++;
          continue;
        }
        let run = 1;
        while (c + run < COLS && !grid[r][c + run].vine && grid[r][c + run].color === cell.color) run++;
        if (run >= 3) for (let k = 0; k < run; k++) m.set(key(r, c + k), { r, c: c + k });
        c += run;
      }
    }
    for (let c = 0; c < COLS; c++) {
      let r = 0;
      while (r < ROWS) {
        const cell = grid[r][c];
        if (cell.color < 0 || cell.vine) {
          r++;
          continue;
        }
        let run = 1;
        while (r + run < ROWS && !grid[r + run][c].vine && grid[r + run][c].color === cell.color) run++;
        if (run >= 3) for (let k = 0; k < run; k++) m.set(key(r + k, c), { r: r + k, c });
        r += run;
      }
    }
    return m;
  }

  function analyzeSpecial(matched, focus) {
    if (!matched.size) return null;
    let best = null;
    let bestScore = -1;
    matched.forEach(({ r, c }) => {
      const color = grid[r][c].color;
      if (color < 0) return;
      let h = 1;
      for (let x = c - 1; x >= 0 && matched.has(key(r, x)) && grid[r][x].color === color; x--) h++;
      for (let x = c + 1; x < COLS && matched.has(key(r, x)) && grid[r][x].color === color; x++) h++;
      let v = 1;
      for (let y = r - 1; y >= 0 && matched.has(key(y, c)) && grid[y][c].color === color; y--) v++;
      for (let y = r + 1; y < ROWS && matched.has(key(y, c)) && grid[y][c].color === color; y++) v++;
      let type = null;
      let pri = -1;
      if (h >= 5 || v >= 5) {
        type = "bird";
        pri = 3;
      } else if (h >= 3 && v >= 3) {
        type = "bomb";
        pri = 2;
      } else if (h >= 4) {
        type = "row";
        pri = 1;
      } else if (v >= 4) {
        type = "col";
        pri = 1;
      }
      if (!type) return;
      let sc = pri * 10;
      if (focus && focus.r === r && focus.c === c) sc += 5;
      if (sc > bestScore) {
        bestScore = sc;
        best = { r, c, type, color: type === "bird" ? -1 : color };
      }
    });
    return best;
  }

  function expandSpecials(toClear, seeds) {
    const q = [...seeds];
    const seen = new Set(seeds);
    while (q.length) {
      const k = q.shift();
      const [r, c] = k.split(",").map(Number);
      const cell = grid[r][c];
      if (!cell || !cell.special) continue;
      const type = cell.special;
      toClear.set(k, { r, c });

      const add = (rr, cc) => {
        if (!inBound(rr, cc)) return;
        if (grid[rr][cc].vine) {
          toClear.set(key(rr, cc), { r: rr, c: cc, vineHit: true });
          return;
        }
        const kk = key(rr, cc);
        toClear.set(kk, { r: rr, c: cc });
        if (grid[rr][cc].special && !seen.has(kk)) {
          seen.add(kk);
          q.push(kk);
        }
      };

      if (type === "row") for (let cc = 0; cc < COLS; cc++) add(r, cc);
      else if (type === "col") for (let rr = 0; rr < ROWS; rr++) add(rr, c);
      else if (type === "bomb") {
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) add(r + dr, c + dc);
      } else if (type === "bird") {
        let color = cell.color;
        if (color < 0) {
          // 取场上一种颜色
          outer: for (let rr = 0; rr < ROWS; rr++)
            for (let cc = 0; cc < COLS; cc++)
              if (grid[rr][cc].color >= 0) {
                color = grid[rr][cc].color;
                break outer;
              }
          if (color < 0) color = 0;
        }
        for (let rr = 0; rr < ROWS; rr++)
          for (let cc = 0; cc < COLS; cc++) if (grid[rr][cc].color === color) add(rr, cc);
      }
    }
  }

  function hasMove() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!canSelect(r, c)) continue;
        for (const [dr, dc] of [
          [0, 1],
          [1, 0],
        ]) {
          const r2 = r + dr;
          const c2 = c + dc;
          if (!inBound(r2, c2) || !canSelect(r2, c2)) continue;
          const a = grid[r][c];
          const b = grid[r2][c2];
          if (a.special || b.special) return true;
          grid[r][c] = b;
          grid[r2][c2] = a;
          const ok = findMatches().size > 0;
          grid[r][c] = a;
          grid[r2][c2] = b;
          if (ok) return true;
        }
      }
    }
    return false;
  }

  function findHint() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!canSelect(r, c)) continue;
        for (const [dr, dc] of [
          [0, 1],
          [1, 0],
        ]) {
          const r2 = r + dr;
          const c2 = c + dc;
          if (!inBound(r2, c2) || !canSelect(r2, c2)) continue;
          const a = grid[r][c];
          const b = grid[r2][c2];
          if (a.special || b.special) return { a: { r, c }, b: { r: r2, c: c2 } };
          grid[r][c] = b;
          grid[r2][c2] = a;
          const ok = findMatches().size > 0;
          grid[r][c] = a;
          grid[r2][c2] = b;
          if (ok) return { a: { r, c }, b: { r: r2, c: c2 } };
        }
      }
    }
    return null;
  }

  // ==================== 关卡 / HUD ====================
  function loadLevel(idx) {
    levelIndex = Math.max(0, Math.min(idx, LEVELS.length - 1));
    const level = LEVELS[levelIndex];
    score = 0;
    combo = 0;
    colorCleared = 0;
    movesLeft = level.moves;
    movesMax = level.moves;
    selected = null;
    hintsLeft = 3;
    hintPair = null;
    anim = null;
    state = "idle";
    hideOverlay();
    if (el.startOverlay) el.startOverlay.classList.add("hidden");
    makeBoard(level);
    if (level.goal.type === "ice") level.goal.target = iceTotal || 1;
    updateHUD();
  }

  function iceLeft() {
    let n = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) n += grid[r][c].ice || 0;
    return n;
  }

  function goalProgress() {
    const g = LEVELS[levelIndex].goal;
    if (g.type === "score") return { done: Math.min(score, g.target), target: g.target, text: "达到 " + g.target + " 分", icon: "⭐" };
    if (g.type === "color")
      return {
        done: Math.min(colorCleared, g.target),
        target: g.target,
        text: "消除 " + g.target + " 个" + NAMES[g.color],
        icon: EMOJIS[g.color],
      };
    const left = iceLeft();
    const target = iceTotal || g.target || 1;
    return { done: Math.max(0, target - left), target, text: "清除全部冰块", icon: "❄️" };
  }

  function updateHUD() {
    const gp = goalProgress();
    el.score.textContent = score;
    el.combo.textContent = combo > 1 ? "连锁 x" + combo : "";
    el.level.textContent = levelIndex + 1;
    el.moves.textContent = movesLeft;
    el.moves.classList.toggle("warn", movesLeft > 0 && movesLeft <= 5);
    el.goalText.textContent = gp.text;
    el.goalIcon.textContent = gp.icon;
    el.goalProg.textContent = gp.done + "/" + gp.target;
    el.goalFill.style.width = (gp.target ? Math.min(100, (gp.done / gp.target) * 100) : 0) + "%";
    if (el.hintLeft) el.hintLeft.textContent = hintsLeft;
  }

  function goalMet() {
    const gp = goalProgress();
    return gp.done >= gp.target;
  }

  function showOverlay(title, msg, btn) {
    state = "overlay";
    el.overlayTitle.textContent = title;
    el.overlayMsg.textContent = msg;
    el.overlayBtn.textContent = btn;
    if (el.resultStars) el.resultStars.textContent = title.indexOf("过") >= 0 || title.indexOf("通") >= 0 ? "★★★" : "☆☆☆";
    el.overlay.classList.remove("hidden");
  }
  function hideOverlay() {
    el.overlay.classList.add("hidden");
  }

  function checkEnd() {
    if (goalMet()) {
      sfx("win");
      const last = levelIndex >= LEVELS.length - 1;
      showOverlay(last ? "全部通关！" : "过关！", "得分 " + score + " · 剩余 " + movesLeft + " 步", last ? "再玩一遍" : "下一关");
      return true;
    }
    if (movesLeft <= 0) {
      sfx("lose");
      showOverlay("失败", "步数用尽了", "再试一次");
      return true;
    }
    return false;
  }

  // ==================== 核心：交换 / 消除 / 下落 ====================
  function canSelect(r, c) {
    const cell = grid[r][c];
    if (!cell || cell.vine || cell.cage) return false;
    return cell.color >= 0 || !!cell.special;
  }

  function trySwap(a, b) {
    if (state !== "idle") return;
    if (!adj(a, b)) return;
    if (!canSelect(a.r, a.c) || !canSelect(b.r, b.c)) {
      sfx("bad");
      return;
    }
    selected = null;
    hintPair = null;
    state = "busy";
    sfx("swap");

    const from = pos.map((row) => row.map((p) => ({ x: p.x, y: p.y })));
    const to = pos.map((row) => row.map((p) => ({ x: p.x, y: p.y })));
    to[a.r][a.c] = center(b.r, b.c);
    to[b.r][b.c] = center(a.r, a.c);

    anim = {
      kind: "swap",
      t0: performance.now(),
      dur: SWAP_MS,
      from,
      to,
      done: () => finishSwap(a, b),
    };
  }

  function finishSwap(a, b) {
    // 交换数据
    const t = grid[a.r][a.c];
    grid[a.r][a.c] = grid[b.r][b.c];
    grid[b.r][b.c] = t;
    pos[a.r][a.c] = center(a.r, a.c);
    pos[b.r][b.c] = center(b.r, b.c);

    const ca = grid[a.r][a.c];
    const cb = grid[b.r][b.c];
    let matched = null;
    let focus = a;
    let skipSpawn = false;

    // 魔力鸟 / 双 special / 单 special
    if (ca.special === "bird" || cb.special === "bird") {
      matched = birdClear(a, b);
      focus = ca.special === "bird" ? a : b;
      skipSpawn = true;
    } else if (ca.special && cb.special) {
      matched = new Map([
        [key(a.r, a.c), a],
        [key(b.r, b.c), b],
      ]);
      // 简化：双 special 都激活
      skipSpawn = true;
    } else if (ca.special || cb.special) {
      matched = findMatches();
      if (matched.size) {
        if (ca.special) matched.set(key(a.r, a.c), a);
        if (cb.special) matched.set(key(b.r, b.c), b);
        focus = ca.special ? a : b;
      } else {
        // 无三连：激活 special
        const sp = ca.special ? a : b;
        matched = new Map([[key(sp.r, sp.c), sp]]);
        focus = sp;
        skipSpawn = true;
      }
    } else {
      matched = findMatches();
    }

    if (!matched || !matched.size) {
      // 换回
      sfx("bad");
      const t2 = grid[a.r][a.c];
      grid[a.r][a.c] = grid[b.r][b.c];
      grid[b.r][b.c] = t2;
      pos[a.r][a.c] = center(b.r, b.c);
      pos[b.r][b.c] = center(a.r, a.c);
      const to = [];
      for (let r = 0; r < ROWS; r++) {
        const row = [];
        for (let c = 0; c < COLS; c++) row.push(center(r, c));
        to.push(row);
      }
      anim = {
        kind: "swap",
        t0: performance.now(),
        dur: SWAP_MS,
        from: pos.map((row) => row.map((p) => ({ x: p.x, y: p.y }))),
        to,
        done: () => {
          resetPos();
          goIdle();
        },
      };
      return;
    }

    movesLeft = Math.max(0, movesLeft - 1);
    combo = 0;
    beginClear(matched, focus, skipSpawn);
  }

  function birdClear(a, b) {
    const ca = grid[a.r][a.c];
    const bird = ca.special === "bird" ? a : b;
    const other = ca.special === "bird" ? b : a;
    const otherCell = grid[other.r][other.c];
    const map = new Map();
    map.set(key(bird.r, bird.c), bird);
    map.set(key(other.r, other.c), other);

    if (otherCell.special === "bird") {
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) if (!grid[r][c].vine) map.set(key(r, c), { r, c });
      return map;
    }

    let color = otherCell.color;
    if (color < 0) color = 0;
    grid[bird.r][bird.c].color = color; // 供 expand 使用
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) if (grid[r][c].color === color) map.set(key(r, c), { r, c });
    return map;
  }

  function beginClear(matched, focus, skipSpawn) {
    combo += 1;
    const toClear = new Map(matched);
    const spawn = skipSpawn ? null : analyzeSpecial(matched, focus);

    // 激活已有 special
    const seeds = [];
    toClear.forEach(({ r, c }, k) => {
      if (spawn && spawn.r === r && spawn.c === c) return;
      if (grid[r][c].special) seeds.push(k);
    });
    if (seeds.length) {
      expandSpecials(toClear, seeds);
      sfx("special");
    }
    if (spawn) toClear.delete(key(spawn.r, spawn.c));

    // 计分
    let n = 0;
    const g = LEVELS[levelIndex].goal;
    toClear.forEach((info) => {
      if (info.vineHit) return;
      const cell = grid[info.r][info.c];
      if (!cell || cell.vine) return;
      if (cell.color >= 0) {
        n++;
        if (g.type === "color" && cell.color === g.color) colorCleared++;
      }
    });
    score += n * 10 * combo;
    sfx("clear", combo);
    updateHUD();

    const mask = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    toClear.forEach((info) => {
      if (info.vineHit || grid[info.r][info.c].vine) return;
      mask[info.r][info.c] = true;
    });

    anim = {
      kind: "clear",
      t0: performance.now(),
      dur: CLEAR_MS,
      mask,
      done: () => applyClear(toClear, spawn),
    };
  }

  function applyClear(toClear, spawn) {
    // 冰绑定坐标
    const iceMap = Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => grid[r][c].ice || 0));
    const vineHit = new Set();

    toClear.forEach((info) => {
      const { r, c } = info;
      if (!inBound(r, c)) return;
      const cell = grid[r][c];
      if (cell.vine || info.vineHit) {
        if (cell.vine) vineHit.add(key(r, c));
        return;
      }
      const had = cell.color >= 0 || !!cell.special;
      if (had || iceMap[r][c] > 0) {
        if (iceMap[r][c] > 0) iceMap[r][c]--;
      }
      cell.color = -1;
      cell.special = null;
      cell.cage = false;

      [
        [r - 1, c],
        [r + 1, c],
        [r, c - 1],
        [r, c + 1],
      ].forEach(([rr, cc]) => {
        if (inBound(rr, cc) && grid[rr][cc].vine) vineHit.add(key(rr, cc));
      });
    });

    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        if (!grid[r][c].vine) grid[r][c].ice = iceMap[r][c];
      }

    vineHit.forEach((k) => {
      const [r, c] = k.split(",").map(Number);
      if (!grid[r][c].vine) return;
      grid[r][c].vine--;
      if (grid[r][c].vine <= 0) {
        const ice = iceMap[r][c] || 0;
        grid[r][c] = piece(randColor());
        grid[r][c].ice = ice;
      }
    });

    if (spawn && inBound(spawn.r, spawn.c) && !grid[spawn.r][spawn.c].vine) {
      const ice = grid[spawn.r][spawn.c].ice || 0;
      grid[spawn.r][spawn.c] = piece(spawn.type === "bird" ? -1 : spawn.color, spawn.type);
      grid[spawn.r][spawn.c].ice = ice;
    }

    fallGravity();
    const to = [];
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let c = 0; c < COLS; c++) row.push(center(r, c));
      to.push(row);
    }
    anim = {
      kind: "fall",
      t0: performance.now(),
      dur: FALL_MS,
      from: pos.map((row) => row.map((p) => ({ x: p.x, y: p.y }))),
      to,
      done: () => afterFall(),
    };
  }

  function fallGravity() {
    // 冰留在格子上，只掉棋子
    const iceMap = Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => grid[r][c].ice || 0));

    for (let c = 0; c < COLS; c++) {
      const fixed = [];
      for (let r = 0; r < ROWS; r++) if (grid[r][c].vine) fixed.push(r);
      const bounds = [-1, ...fixed, ROWS];
      for (let s = 0; s < bounds.length - 1; s++) {
        const top = bounds[s] + 1;
        const bottom = bounds[s + 1] - 1;
        if (top > bottom) continue;

        const stack = [];
        for (let r = top; r <= bottom; r++) {
          const cell = grid[r][c];
          if (cell.vine) continue;
          if (cell.color >= 0 || cell.special) {
            stack.push({ color: cell.color, special: cell.special, cage: cell.cage, fromR: r });
          }
        }
        for (let r = top; r <= bottom; r++) {
          if (!grid[r][c].vine) grid[r][c] = emptyCell();
        }
        let write = bottom;
        for (let i = stack.length - 1; i >= 0; i--) {
          const p = stack[i];
          grid[write][c] = piece(p.color, p.special);
          grid[write][c].cage = !!p.cage;
          pos[write][c] = { x: center(write, c).x, y: center(p.fromR, c).y };
          write--;
        }
        let spawnI = 0;
        for (let r = write; r >= top; r--) {
          if (grid[r][c].vine) continue;
          grid[r][c] = piece(randColor());
          spawnI++;
          pos[r][c] = { x: center(r, c).x, y: center(top - spawnI, c).y };
        }
      }
    }

    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        if (!grid[r][c].vine) grid[r][c].ice = iceMap[r][c];
      }
  }

  function afterFall() {
    resetPos();
    const matched = findMatches();
    if (matched.size) {
      let focus = null;
      matched.forEach((v) => {
        if (!focus) focus = v;
      });
      beginClear(matched, focus, false);
      return;
    }
    combo = 0;
    updateHUD();
    if (!hasMove()) {
      // 简单重洗颜色
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          if (grid[r][c].vine || grid[r][c].color < 0) continue;
          if (!grid[r][c].special) grid[r][c].color = randColor();
        }
      for (let g = 0; g < 15 && findMatches().size; g++) {
        findMatches().forEach(({ r, c }) => {
          if (!grid[r][c].special) grid[r][c].color = randColor();
        });
      }
    }
    if (checkEnd()) {
      anim = null;
      return;
    }
    goIdle();
  }

  function resetPos() {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) pos[r][c] = center(r, c);
  }

  function goIdle() {
    state = "idle";
    anim = null;
  }

  // ==================== 输入 ====================
  function cellAt(cx, cy) {
    const rect = canvas.getBoundingClientRect();
    const x = ((cx - rect.left) / rect.width) * BOARD;
    const y = ((cy - rect.top) / rect.height) * BOARD;
    const c = Math.floor(x / CELL);
    const r = Math.floor(y / CELL);
    if (!inBound(r, c)) return null;
    return { r, c };
  }

  let dragStart = null;
  let downXY = null;

  canvas.addEventListener("pointerdown", (e) => {
    ensureAudio();
    if (state !== "idle") return;
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell || !canSelect(cell.r, cell.c)) return;
    dragStart = cell;
    downXY = { x: e.clientX, y: e.clientY };
    hintPair = null;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (_) {}
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragStart || state !== "idle") return;
    const dx = e.clientX - downXY.x;
    const dy = e.clientY - downXY.y;
    if (Math.hypot(dx, dy) < 20) return;
    let nr = dragStart.r;
    let nc = dragStart.c;
    if (Math.abs(dx) > Math.abs(dy)) nc += dx > 0 ? 1 : -1;
    else nr += dy > 0 ? 1 : -1;
    const from = dragStart;
    dragStart = null;
    selected = null;
    if (inBound(nr, nc)) trySwap(from, { r: nr, c: nc });
  });

  canvas.addEventListener("pointerup", (e) => {
    if (state !== "idle") {
      dragStart = null;
      return;
    }
    if (dragStart && downXY) {
      const dx = e.clientX - downXY.x;
      const dy = e.clientY - downXY.y;
      if (Math.hypot(dx, dy) >= 16) {
        let nr = dragStart.r;
        let nc = dragStart.c;
        if (Math.abs(dx) > Math.abs(dy)) nc += dx > 0 ? 1 : -1;
        else nr += dy > 0 ? 1 : -1;
        const from = dragStart;
        dragStart = null;
        if (inBound(nr, nc)) trySwap(from, { r: nr, c: nc });
        return;
      }
    }
    const cell = cellAt(e.clientX, e.clientY);
    if (dragStart && cell) {
      if (selected && adj(selected, cell) && (selected.r !== cell.r || selected.c !== cell.c)) {
        trySwap(selected, cell);
      } else if (selected && selected.r === cell.r && selected.c === cell.c) {
        selected = null;
      } else if (canSelect(cell.r, cell.c)) {
        selected = cell;
      }
    }
    dragStart = null;
  });

  canvas.addEventListener("pointercancel", () => {
    dragStart = null;
  });

  el.restart.addEventListener("click", () => loadLevel(levelIndex));
  if (el.soundBtn)
    el.soundBtn.addEventListener("click", () => {
      soundOn = !soundOn;
      el.soundBtn.classList.toggle("off", !soundOn);
    });
  if (el.musicBtn) el.musicBtn.style.display = "none";
  if (el.fxBtn) el.fxBtn.style.display = "none";
  if (el.hintBtn)
    el.hintBtn.addEventListener("click", () => {
      if (state !== "idle" || hintsLeft <= 0) return;
      const h = findHint();
      if (!h) return;
      hintsLeft--;
      hintPair = h;
      updateHUD();
      sfx("swap");
    });
  if (el.startBtn)
    el.startBtn.addEventListener("click", () => {
      el.startOverlay.classList.add("hidden");
      state = "idle";
    });
  el.overlayBtn.addEventListener("click", () => {
    hideOverlay();
    if (goalMet()) {
      if (levelIndex >= LEVELS.length - 1) loadLevel(0);
      else loadLevel(levelIndex + 1);
    } else loadLevel(levelIndex);
  });

  // ==================== 绘制 ====================
  function roundRect(x, y, w, h, rad) {
    const rr = Math.min(rad, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawBoard() {
    // 深色棋盘格（衬托彩色 emoji）
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? "#3d3558" : "#2f2848";
        roundRect(c * CELL + 2, r * CELL + 2, CELL - 4, CELL - 4, 12);
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  function drawSpecialOverlay(special) {
    const r = CELL * 0.36;
    if (special === "row") {
      // 横向条纹光带
      const grd = ctx.createLinearGradient(-r, 0, r, 0);
      grd.addColorStop(0, "rgba(255, 200, 80, 0)");
      grd.addColorStop(0.5, "rgba(255, 210, 100, 0.55)");
      grd.addColorStop(1, "rgba(255, 200, 80, 0)");
      ctx.fillStyle = grd;
      ctx.fillRect(-r, -CELL * 0.1, r * 2, CELL * 0.2);
      ctx.strokeStyle = "rgba(255, 190, 80, 0.9)";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-r * 0.85, 0);
      ctx.lineTo(r * 0.85, 0);
      ctx.moveTo(r * 0.55, -CELL * 0.1);
      ctx.lineTo(r * 0.85, 0);
      ctx.lineTo(r * 0.55, CELL * 0.1);
      ctx.moveTo(-r * 0.55, -CELL * 0.1);
      ctx.lineTo(-r * 0.85, 0);
      ctx.lineTo(-r * 0.55, CELL * 0.1);
      ctx.stroke();
    } else if (special === "col") {
      const grd = ctx.createLinearGradient(0, -r, 0, r);
      grd.addColorStop(0, "rgba(255, 200, 80, 0)");
      grd.addColorStop(0.5, "rgba(255, 210, 100, 0.55)");
      grd.addColorStop(1, "rgba(255, 200, 80, 0)");
      ctx.fillStyle = grd;
      ctx.fillRect(-CELL * 0.1, -r, CELL * 0.2, r * 2);
      ctx.strokeStyle = "rgba(255, 190, 80, 0.9)";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.85);
      ctx.lineTo(0, r * 0.85);
      ctx.moveTo(-CELL * 0.1, -r * 0.55);
      ctx.lineTo(0, -r * 0.85);
      ctx.lineTo(CELL * 0.1, -r * 0.55);
      ctx.moveTo(-CELL * 0.1, r * 0.55);
      ctx.lineTo(0, r * 0.85);
      ctx.lineTo(CELL * 0.1, r * 0.55);
      ctx.stroke();
    } else if (special === "bomb") {
      // 双环包装感
      ctx.strokeStyle = "rgba(255, 120, 140, 0.85)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, CELL * 0.36, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255, 180, 100, 0.7)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, CELL * 0.26, 0, Math.PI * 2);
      ctx.stroke();
      // 四角光点
      ctx.fillStyle = "rgba(255, 200, 120, 0.9)";
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * CELL * 0.34, Math.sin(a) * CELL * 0.34, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (special === "bird") {
      // 彩虹分段环
      const colors = ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#c56cf0", "#ff8fab"];
      const segs = colors.length;
      for (let i = 0; i < segs; i++) {
        ctx.strokeStyle = colors[i];
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, CELL * 0.36, (i / segs) * Math.PI * 2 - Math.PI / 2, ((i + 0.85) / segs) * Math.PI * 2 - Math.PI / 2);
        ctx.stroke();
      }
    }
  }

  function drawEmoji(x, y, color, scale, special, clearT) {
    // 正常彩色 emoji + 特殊图形叠加（不包糖球）
    const fading = clearT > 0;
    ctx.save();
    ctx.translate(x, y - (fading ? clearT * 10 : 0));
    if (fading) ctx.globalAlpha = Math.max(0, 1 - clearT);
    else ctx.globalAlpha = 1;
    if (scale !== 1) ctx.scale(scale, scale);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const fontPx = Math.floor(CELL * 0.8);
    ctx.font = fontPx + 'px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';

    if (special === "bird") {
      ctx.fillText("✨", 0, 2);
      drawSpecialOverlay("bird");
    } else if (color >= 0) {
      ctx.fillText(EMOJIS[color], 0, 2);
      if (special) drawSpecialOverlay(special);
    }

    ctx.restore();
  }

  function drawIce(r, c, ice) {
    if (ice <= 0) return;
    const x = c * CELL + CELL / 2;
    const y = r * CELL + CELL / 2;
    ctx.save();
    ctx.translate(x, y);

    // 半透明冰罩（中心略透，保留 emoji 辨识）
    const deep = ice >= 2;
    const grd = ctx.createLinearGradient(-CELL * 0.3, -CELL * 0.3, CELL * 0.3, CELL * 0.3);
    if (deep) {
      grd.addColorStop(0, "rgba(180, 230, 255, 0.38)");
      grd.addColorStop(0.5, "rgba(120, 190, 230, 0.28)");
      grd.addColorStop(1, "rgba(160, 220, 250, 0.4)");
    } else {
      grd.addColorStop(0, "rgba(200, 240, 255, 0.28)");
      grd.addColorStop(0.5, "rgba(150, 210, 240, 0.18)");
      grd.addColorStop(1, "rgba(190, 235, 255, 0.3)");
    }
    roundRect(-CELL * 0.38, -CELL * 0.38, CELL * 0.76, CELL * 0.76, 11);
    ctx.fillStyle = grd;
    ctx.fill();
    ctx.strokeStyle = deep ? "rgba(180, 230, 255, 0.75)" : "rgba(200, 240, 255, 0.55)";
    ctx.lineWidth = deep ? 2.2 : 1.5;
    ctx.stroke();

    // 裂纹（2 层更明显）
    if (deep) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-CELL * 0.15, -CELL * 0.2);
      ctx.lineTo(CELL * 0.05, 0);
      ctx.lineTo(-CELL * 0.08, CELL * 0.22);
      ctx.moveTo(CELL * 0.12, -CELL * 0.18);
      ctx.lineTo(CELL * 0.2, CELL * 0.1);
      ctx.stroke();
    }

    // 层数角标
    ctx.fillStyle = deep ? "#1a6a9a" : "#2e86ab";
    ctx.beginPath();
    ctx.arc(CELL * 0.28, -CELL * 0.28, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(ice), CELL * 0.28, -CELL * 0.28 + 0.5);
    ctx.restore();
  }

  function drawVine(r, c, hp) {
    const x = c * CELL + CELL / 2;
    const y = r * CELL + CELL / 2;
    ctx.save();
    ctx.translate(x, y);
    roundRect(-CELL * 0.38, -CELL * 0.38, CELL * 0.76, CELL * 0.76, 11);
    const bg = ctx.createLinearGradient(-20, -20, 20, 20);
    bg.addColorStop(0, "#3d8b4f");
    bg.addColorStop(1, "#1e5c32");
    ctx.fillStyle = bg;
    ctx.fill();

    // 藤条
    ctx.strokeStyle = "rgba(160, 220, 140, 0.55)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(-CELL * 0.28, i * 12);
      ctx.quadraticCurveTo(0, i * 12 + 10, CELL * 0.28, i * 12 - 4);
      ctx.stroke();
    }
    // 叶片
    ctx.fillStyle = "rgba(120, 200, 100, 0.75)";
    for (const [lx, ly, rot] of [
      [-14, -10, -0.5],
      [12, 4, 0.4],
      [-6, 14, 0.2],
    ]) {
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, 8, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // HP 徽章
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold " + Math.floor(CELL * 0.2) + "px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(hp), 0, 1);
    ctx.restore();
  }

  function drawCage(x, y) {
    ctx.save();
    ctx.translate(x, y);
    const s = CELL * 0.32;
    // 金属外框
    ctx.strokeStyle = "#d4af37";
    ctx.lineWidth = 3;
    roundRect(-s, -s, s * 2, s * 2, 4);
    ctx.stroke();
    // 竖条
    ctx.strokeStyle = "rgba(212, 175, 55, 0.85)";
    ctx.lineWidth = 2.2;
    const bars = 4;
    for (let i = 0; i < bars; i++) {
      const bx = -s + ((i + 0.5) / bars) * s * 2;
      ctx.beginPath();
      ctx.moveTo(bx, -s + 2);
      ctx.lineTo(bx, s - 2);
      ctx.stroke();
    }
    // 横条
    ctx.beginPath();
    ctx.moveTo(-s + 2, 0);
    ctx.lineTo(s - 2, 0);
    ctx.stroke();
    // 高光
    ctx.strokeStyle = "rgba(255, 240, 180, 0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(-s + 2, -s + 2, s * 2 - 4, s * 2 - 4);
    ctx.restore();
  }

  function render(now) {
    ctx.clearRect(0, 0, BOARD, BOARD);
    drawBoard();

    if (hintPair && state === "idle") {
      [hintPair.a, hintPair.b].forEach((p) => {
        ctx.strokeStyle = "rgba(200,160,60,0.7)";
        ctx.lineWidth = 2.5;
        ctx.setLineDash([4, 3]);
        roundRect(p.c * CELL + 5, p.r * CELL + 5, CELL - 10, CELL - 10, 10);
        ctx.stroke();
        ctx.setLineDash([]);
      });
    }

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = grid[r][c];
        const p = pos[r][c];
        let scale = 1;
        let clearT = 0;
        if (anim && anim.kind === "clear" && anim.mask && anim.mask[r][c]) {
          clearT = Math.min(1, (now - anim.t0) / anim.dur);
          scale = Math.max(0, 1 - clearT);
        } else if (selected && selected.r === r && selected.c === c && state === "idle") {
          scale = 1.08;
        }

        if (cell.vine > 0) {
          drawVine(r, c, cell.vine);
          continue;
        }

        if (cell.color >= 0 || cell.special) {
          drawEmoji(p.x, p.y, cell.color, scale, cell.special, clearT);
        }
        if (cell.ice > 0) drawIce(r, c, cell.ice);
        if (cell.cage) drawCage(p.x, p.y);
      }
    }

    if (selected && state === "idle") {
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 3.5;
      roundRect(selected.c * CELL + 4, selected.r * CELL + 4, CELL - 8, CELL - 8, 12);
      ctx.stroke();
    }
  }

  // ==================== 主循环 ====================
  function frame(now) {
    if (anim) {
      const t = Math.min(1, (now - anim.t0) / anim.dur);
      const e = ease(t);
      if ((anim.kind === "swap" || anim.kind === "fall") && anim.from && anim.to) {
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            const a = anim.from[r][c];
            const b = anim.to[r][c];
            if (!a || !b) continue;
            pos[r][c].x = a.x + (b.x - a.x) * e;
            pos[r][c].y = a.y + (b.y - a.y) * e;
          }
        }
      }
      if (t >= 1) {
        const done = anim.done;
        anim = null;
        if (typeof done === "function") {
          try {
            done();
          } catch (err) {
            console.error(err);
            goIdle();
          }
        }
      }
    }
    render(now);
    requestAnimationFrame(frame);
  }

  // ==================== 启动：直接可玩 ====================
  if (el.startOverlay) el.startOverlay.classList.add("hidden");
  loadLevel(0);
  requestAnimationFrame(frame);
})();
