// =====================================================
// 사운드 추가 훅(추후):
// const sfx = {
//   deal: new Audio("sfx/deal.wav"),
//   flip: new Audio("sfx/flip.wav"),
//   win:  new Audio("sfx/win.wav"),
//   lose: new Audio("sfx/lose.wav"),
// };
// 사용 예:
// sfx.deal.currentTime = 0; sfx.deal.play();
// =====================================================

const SAVE_KEY = "special_blackjack_money_only";
const INITIAL_MONEY = 10000; // ✅ 기본 소지금 1만원

// ---------- 저장(소지금만) ----------
function loadMoney() {
  const raw = localStorage.getItem(SAVE_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : INITIAL_MONEY;
}
function saveMoney(m) {
  localStorage.setItem(SAVE_KEY, String(m));
}

// ---------- 덱(원본 동일) ----------
let deck = [];
function createDeck() {
  deck = [];
  const ranks = [
    0, 0, 0, 0,
    1, 1, 1, 1, 1,
    2, 2, 2, 2, 2,
    3, 3, 3, 3, 3,
    4, 4, 4, 4, 4,
    5, 5, 5, 5, 5, 5,
    6, 6, 6, 6, 6, 6,
    7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7
  ];
  for (let k = 0; k < 4; k++) {
    for (const r of ranks) deck.push({ rank: r });
  }
  shuffle(deck);
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}
function drawCard() {
  if (deck.length === 0) createDeck();
  return deck.pop();
}

// ---------- 점수(원본 동일) ----------
function cardValue(c) {
  return (c.rank === 0) ? 8 : c.rank;
}
function handValue(hand) {
  let value = 0;
  let aces = 0; // rank=0 개수
  for (const c of hand) {
    value += cardValue(c);
    if (c.rank === 0) aces++;
  }
  while (value > 15 && aces) {
    value -= 8;
    aces--;
  }
  return value;
}
function isBlackjack15_2cards(hand) {
  return (hand.length === 2 && handValue(hand) === 15);
}

// ---------- UI 참조 ----------
const table = document.getElementById("table");

const dealerHandEl = document.getElementById("dealerHand");
const dealerSumEl = document.getElementById("dealerSum");

const deckStackEl = document.getElementById("deckStack");
const deckLeftEl = document.getElementById("deckLeft");

const playerBlocksEl = document.getElementById("playerBlocks");
const moneyEl = document.getElementById("money");
const betEl = document.getElementById("bet");

const btnBet = document.getElementById("btnBet");
const btnDeal = document.getElementById("btnDeal");

// ---------- 게임 상태 ----------
let money = loadMoney();
let pendingBet = 0;     // ✅ 베팅은 0부터 시작(버튼으로만 증가)
let baseBet = 0;        // 현재 라운드의 1핸드 베팅(스플릿 시 손패별로 동일)
let phase = "betting";  // betting | resolvingSplit | playing | dealer | roundOver

let dealerHand = [];
let dealerHidden = true;
let dealerBlackjack = false;

let playerHands = [[]]; // 스플릿 시 [hand1, hand2]
let playerBets = [];    // 각 핸드별 베팅
let results = [];       // 'done' | 'stand'
let outcomes = [];      // 'blackjack' | 'bust' | null (표시/정산 보조)
let activeHandIdx = 0;

// 핸드 DOM 참조 캐시(라운드 중 불필요한 재렌더 방지)
let handEls = [];       // [#playerHand0, #playerHand1...]
let actionEls = [];     // [#actions0, #actions1...]
let sumEls = [];        // [#playerSum0, #playerSum1...]

// ---------- 인디케이터 ----------
function updateIndicators() {
  moneyEl.textContent = money.toLocaleString();

  // ✅ 베팅 표시: betting 단계에서는 pendingBet, 그 외엔 playerBets 합
  const shownBet = (phase === "betting" || phase === "roundOver")
    ? pendingBet
    : (playerBets.reduce((a, b) => a + b, 0));

  betEl.textContent = shownBet.toLocaleString();
  deckLeftEl.textContent = String(deck.length);
}
function setDealerSum() {
  dealerSumEl.textContent = dealerHidden ? "?" : String(handValue(dealerHand));
}
function setPlayerSums() {
  for (let i = 0; i < playerHands.length; i++) {
    if (sumEls[i]) sumEls[i].textContent = String(handValue(playerHands[i]));
  }
}

// ---------- 카드 DOM (img + flip) ----------
function makeCardElement({ faceRank = null, faceUp = false }) {
  const card = document.createElement("div");
  card.className = "card";

  const inner = document.createElement("div");
  inner.className = "card-inner";

  const back = document.createElement("div");
  back.className = "card-back";
  const backImg = document.createElement("img");
  backImg.src = "cards/back.png"; // png로 바꾸면 back.png
  back.appendChild(backImg);

  const face = document.createElement("div");
  face.className = "card-face";
  const faceImg = document.createElement("img");
  if (faceRank !== null) faceImg.src = `cards/${faceRank}.png`; // png면 .png
  face.appendChild(faceImg);

  inner.appendChild(back);
  inner.appendChild(face);
  card.appendChild(inner);

  if (faceUp) card.classList.add("is-face");
  return card;
}

function flipCard(cardEl, rank) {
  const faceImg = cardEl.querySelector(".card-face img");
  if (rank !== undefined && rank !== null) {
    faceImg.src = `cards/${rank}.png`; // png면 .png
  }
  cardEl.classList.add("is-face");
  // sfx.flip?.play(); // 추후
}

// ---------- 좌표 유틸 ----------
function viewportToTablePoint(pt) {
  const tr = table.getBoundingClientRect();
  return { x: pt.x - tr.left, y: pt.y - tr.top };
}

function getCenterViewport(el){
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function getHandCenterTable(handEl){
  return viewportToTablePoint(getCenterViewport(handEl));
}
function getDeckCenterTable(){
  return viewportToTablePoint(getCenterViewport(deckStackEl));
}

function dealCardTo(handEl, { rank, keepFaceDown = true }) {
  return new Promise((resolve) => {
    const flying = makeCardElement({
      faceRank: keepFaceDown ? null : rank,
      faceUp: !keepFaceDown
    });

    flying.classList.add("flying");
    table.appendChild(flying);

    // 시작/도착 좌표: 반드시 "table 로컬 좌표"
    const start = getDeckCenterTable();
    const end   = getHandCenterTable(handEl);

    // 요소 크기
    const w = flying.offsetWidth;
    const h = flying.offsetHeight;

    const startX = start.x - w / 2;
    const startY = start.y - h / 2;
    const endX   = end.x   - w / 2;
    const endY   = end.y   - h / 2;

    // 시작 위치 세팅 (transition 없이)
    flying.style.transition = "none";
    flying.style.transform = `translate3d(${startX}px, ${startY}px, 0)`;

    // ✅ reflow 강제(이게 없으면 ‘안 움직임’이 재발할 수 있습니다)
    flying.getBoundingClientRect();

    // 이동 시작 (transition 복원)
    flying.style.transition = ""; // .flying CSS의 transition 사용
    requestAnimationFrame(() => {
      flying.style.transform = `translate3d(${endX}px, ${endY}px, 0)`;
    });

    flying.addEventListener("transitionend", (e) => {
      if (e.propertyName !== "transform") return;
      flying.classList.remove("flying");
      flying.style.transform = "";
      handEl.appendChild(flying);
      resolve(flying);
    }, { once: true });
  });
}

// ---------- 라운드 종료 페이드아웃 ----------
function fadeOutAndClear() {
  const allCards = table.querySelectorAll(".card");
  allCards.forEach(c => c.classList.add("fade-out"));
  requestAnimationFrame(() => allCards.forEach(c => c.classList.add("go")));
  return new Promise((resolve) => {
    setTimeout(() => {
      dealerHandEl.innerHTML = "";
      playerBlocksEl.innerHTML = "";
      resolve();
    }, 460);
  });
}

// ---------- 플레이어 블록 생성(스플릿 대응) ----------
function initPlayerBlocks(nHands) {
  playerBlocksEl.innerHTML = "";
  handEls = [];
  actionEls = [];
  sumEls = [];

  for (let idx = 0; idx < nHands; idx++) {
    const block = document.createElement("div");
    block.className = "player-block";
    if (idx === activeHandIdx && phase === "playing") block.classList.add("active");

    const head = document.createElement("div");
    head.className = "player-head";

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = (nHands === 1) ? "PLAYER 0" : `PLAYER ${idx}`;

    const sum = document.createElement("div");
    sum.className = "sum";
    sum.id = `playerSum${idx}`;
    sum.textContent = "0";

    head.appendChild(label);
    head.appendChild(sum);

    const handEl = document.createElement("div");
    handEl.className = "hand";
    handEl.id = `playerHand${idx}`;

    const actions = document.createElement("div");
    actions.className = "player-actions";
    actions.id = `actions${idx}`;

    block.appendChild(head);
    block.appendChild(handEl);
    block.appendChild(actions);
    playerBlocksEl.appendChild(block);

    handEls[idx] = handEl;
    actionEls[idx] = actions;
    sumEls[idx] = sum;
  }
}

function markActiveBlock() {
  const blocks = playerBlocksEl.querySelectorAll(".player-block");
  blocks.forEach((b, idx) => {
    b.classList.toggle("active", phase === "playing" && idx === activeHandIdx);
  });
}

// ---------- 버튼 세트 설정 ----------
function setBettingButtonsEnabled(enabled) {
  btnBet.disabled = !enabled;
  btnDeal.disabled = !enabled;
}

function clearAllPlayerActions() {
  for (const el of actionEls) el.innerHTML = "";
}

function setSplitChoiceButtons() {
  // ✅ 스플릿 가능 시: SPLIT / DO NOT (PLAYER 0에만 표시)
  clearAllPlayerActions();
  const el = actionEls[0];
  if (!el) return;

  const b1 = document.createElement("button");
  b1.textContent = "SPLIT";
  b1.onclick = () => doSplit();

  const b2 = document.createElement("button");
  b2.textContent = "DO NOT";
  b2.onclick = () => cancelSplit();

  el.appendChild(b1);
  el.appendChild(b2);
}

function setPlayButtons() {
  // ✅ playing 시: 각 핸드에 HIT/STAND (+조건부 DOUBLE), 비활성은 disabled
  for (let i = 0; i < playerHands.length; i++) {
    const actionsEl = actionEls[i];
    if (!actionsEl) continue;
    actionsEl.innerHTML = "";

    const isActive = (phase === "playing" && i === activeHandIdx);

    const hit = document.createElement("button");
    hit.textContent = "HIT";
    hit.disabled = !isActive;
    hit.onclick = () => playerHit();

    const stand = document.createElement("button");
    stand.textContent = "STAND";
    stand.disabled = !isActive;
    stand.onclick = () => playerStand();

    actionsEl.appendChild(hit);
    actionsEl.appendChild(stand);

    // 더블: 원본처럼 “현재 핸드가 2장이고 money>=baseBet”일 때만 표시(또는 disabled)
    if (isActive && playerHands[i].length === 2) {
      const dbl = document.createElement("button");
      dbl.textContent = "DOUBLE";
      dbl.disabled = (money < baseBet);
      dbl.onclick = () => playerDouble();
      actionsEl.appendChild(dbl);
    }
  }
}

function showProceedButton() {
  // ✅ PROCEED 단일 버튼(PLAYER 0 actions에만)
  clearAllPlayerActions();
  const el = document.getElementById("actions0");
  if (!el) return;

  el.innerHTML = "";
  const btn = document.createElement("button");
  btn.textContent = "PROCEED";
  btn.onclick = async () => {
    await fadeOutAndClear();
    resetToBetting();
  };
  el.appendChild(btn);
}

// ---------- 상태 초기화 ----------
function resetToBetting() {
  phase = "betting";
  baseBet = 0;

  dealerHand = [];
  dealerHidden = true;
  dealerBlackjack = false;

  playerHands = [[]];
  playerBets = [];
  results = [];
  outcomes = [];
  activeHandIdx = 0;

  pendingBet = 0; // ✅ 라운드 끝나면 베팅 0으로 초기화

  initPlayerBlocks(1); // 화면상 PLAYER 0 블록은 항상 준비
  setDealerSum();
  updateIndicators();
  setBettingButtonsEnabled(true);

  // betting 단계에서는 액션 버튼 없음
  clearAllPlayerActions();
}

// ---------- 베팅 버튼 ----------
btnBet.addEventListener("click", () => {
  if (phase !== "betting") return;
  pendingBet += 500;
  updateIndicators();
});

btnDeal.addEventListener("click", async () => {
  if (phase !== "betting") return;
  if (pendingBet <= 0) return;
  if (pendingBet > money) return;

  // 라운드 시작
  if (deck.length === 0) createDeck();
  shuffle(deck); // 원본: 라운드 시작 시 셔플

  phase = "dealing";
  setBettingButtonsEnabled(false);

  baseBet = pendingBet;
  pendingBet = 0;               // ✅ DEAL 누르면 입력 베팅은 0으로 리셋
  money -= baseBet;
  saveMoney(money);

  dealerHand = [];
  playerHands = [[]];
  playerBets = [baseBet];
  results = [];
  outcomes = [];
  dealerHidden = true;

  // UI 블록 1개 재생성(카드 DOM 정리)
  initPlayerBlocks(1);

  // 딜: “모두 뒷면으로” 덱에서 날아옴
  for (let t = 0; t < 2; t++) {
    const p = drawCard(); playerHands[0].push(p);
    await dealCardTo(handEls[0], { rank: p.rank, keepFaceDown: true });

    const d = drawCard(); dealerHand.push(d);
    await dealCardTo(dealerHandEl, { rank: d.rank, keepFaceDown: true });
  }

  // 공개 규칙:
  // 플레이어 2장 공개(뒤집기)
  const pCards = handEls[0].querySelectorAll(".card");
  flipCard(pCards[0], playerHands[0][0].rank);
  flipCard(pCards[1], playerHands[0][1].rank);

  // 딜러는 1장만 공개(2번째는 히든 유지)
  const dCards = dealerHandEl.querySelectorAll(".card");
  flipCard(dCards[0], dealerHand[0].rank);
  // dCards[1]은 back 유지

  dealerBlackjack = isBlackjack15_2cards(dealerHand);

  // 표시 갱신
  setDealerSum();
  setPlayerSums();
  updateIndicators();

  // 스플릿 가능 여부(원본: card_value 동일 & money>=bet)
  const canSplit = (cardValue(playerHands[0][0]) === cardValue(playerHands[0][1]) && money >= baseBet);

  if (canSplit) {
    phase = "resolvingSplit";
    setSplitChoiceButtons();
  } else {
    phase = "playing";
    activeHandIdx = 0;
    markActiveBlock();
    setPlayButtons();
  }
});

// ---------- 스플릿 ----------
function rebuildHandsToMatchState() {
  // 현재 playerHands 상태에 맞춰 hand DOM 재구성(스플릿 직후에만 사용)
  initPlayerBlocks(playerHands.length);
  for (let i = 0; i < playerHands.length; i++) {
    for (const c of playerHands[i]) {
      const el = makeCardElement({ faceRank: c.rank, faceUp: true });
      handEls[i].appendChild(el);
    }
  }
  setPlayerSums();
  updateIndicators();
}

function doSplit() {
  if (phase !== "resolvingSplit") return;

  // 원본: 추가 bet 차감
  money -= baseBet;
  saveMoney(money);

  const original = playerHands[0];
  const c1 = original[0];
  const c2 = original[1];

  const n1 = drawCard();
  const n2 = drawCard();

  playerHands = [
    [c1, n1],
    [c2, n2]
  ];
  playerBets = [baseBet, baseBet];
  results = [];
  outcomes = [];
  activeHandIdx = 0;

  rebuildHandsToMatchState();

  phase = "playing";
  markActiveBlock();
  setPlayButtons();
}

function cancelSplit() {
  if (phase !== "resolvingSplit") return;
  phase = "playing";
  activeHandIdx = 0;
  markActiveBlock();
  setPlayButtons();
}

// ---------- 플레이어 액션 ----------
function currentHand() {
  return playerHands[activeHandIdx];
}

async function preCheckCurrentHand() {
  const i = activeHandIdx;
  const h = playerHands[i];

  // 플레이어 블랙잭(2장 & 15)
  if (isBlackjack15_2cards(h)) {
    outcomes[i] = "blackjack";
    results[i] = "done";

    if (dealerBlackjack) {
      // 무승부: 베팅 반환
      money += playerBets[i];
      saveMoney(money);
    } else {
      // 블랙잭 배당 2.5배
      money += Math.floor(playerBets[i] * 2.5);
      saveMoney(money);
    }
    updateIndicators();
    await advanceHandOrDealer();
    return true;
  }

  // 딜러 블랙잭이면(별도 메시지 없음): 현재 핸드는 즉시 패배 처리
  if (dealerBlackjack) {
    results[i] = "done";
    // outcomes[i]는 굳이 bust로 두지 않고 null로 둠(표시 단계에서 dealerBJ로 LOSE 처리)
    await advanceHandOrDealer();
    return true;
  }

  return false;
}

async function playerHit() {
  if (phase !== "playing") return;
  if (await preCheckCurrentHand()) return;

  const h = currentHand();
  const c = drawCard();
  h.push(c);

  const cardEl = await dealCardTo(handEls[activeHandIdx], { rank: c.rank, keepFaceDown: true });
  flipCard(cardEl, c.rank);

  setPlayerSums();
  updateIndicators();

  if (handValue(h) > 15) {
    outcomes[activeHandIdx] = "bust";
    results[activeHandIdx] = "done";
    await advanceHandOrDealer();
    return;
  }

  setPlayButtons();
}

async function playerStand() {
  if (phase !== "playing") return;
  if (await preCheckCurrentHand()) return;

  results[activeHandIdx] = "stand";
  await advanceHandOrDealer();
}

async function playerDouble() {
  if (phase !== "playing") return;

  const h = currentHand();
  if (h.length !== 2) return;
  if (money < baseBet) return;

  if (await preCheckCurrentHand()) return;

  // 원본: 돈에서 bet 추가 차감, 베팅 증가, 카드 1장만 받고 stand 또는 done
  money -= baseBet;
  playerBets[activeHandIdx] += baseBet;
  saveMoney(money);

  const c = drawCard();
  h.push(c);

  const cardEl = await dealCardTo(handEls[activeHandIdx], { rank: c.rank, keepFaceDown: true });
  flipCard(cardEl, c.rank);

  setPlayerSums();
  updateIndicators();

  if (handValue(h) > 15) {
    outcomes[activeHandIdx] = "bust";
    results[activeHandIdx] = "done";
  } else {
    results[activeHandIdx] = "stand";
  }

  await advanceHandOrDealer();
}

// ---------- 다음 핸드/딜러 턴 ----------
async function advanceHandOrDealer() {
  // 다음 처리할 핸드 찾기
  for (let idx = 0; idx < playerHands.length; idx++) {
    if (!results[idx]) {
      activeHandIdx = idx;
      markActiveBlock();
      setPlayButtons();
      return;
    }
  }
  // 모든 핸드 결과 있음 => 딜러 턴
  await dealerTurnAndResolve();
}

// ---------- 딜러 턴 & 정산(원본 규칙 유지) ----------
async function dealerTurnAndResolve() {
  phase = "dealer";
  dealerHidden = false;

  // 히든 카드 공개(뒤집기)
  const dCards = dealerHandEl.querySelectorAll(".card");
  if (dCards[1]) flipCard(dCards[1], dealerHand[1].rank);

  // 딜러 블랙잭이 아닌 경우: <12까지 히트
  if (!dealerBlackjack) {
    while (handValue(dealerHand) < 12) {
      const c = drawCard();
      dealerHand.push(c);
      const el = await dealCardTo(dealerHandEl, { rank: c.rank, keepFaceDown: true });
      flipCard(el, c.rank);
    }
  }

  setDealerSum();
  updateIndicators();

  // 정산(원본 마지막 루프와 동일, 단 블랙잭/버스트는 이미 done 처리된 핸드는 제외)
  const dealerScore = handValue(dealerHand);

  for (let i = 0; i < playerHands.length; i++) {
    if (results[i] === "done") continue; // 블랙잭/버스트/딜러BJ로 이미 처리

    const pScore = handValue(playerHands[i]);

    if (dealerScore > 15) {
      money += playerBets[i] * 2;
    } else if (pScore > dealerScore) {
      money += playerBets[i] * 2;
    } else if (pScore === dealerScore) {
      money += playerBets[i];
    } else {
      // 패배: 지급 없음
    }
  }

  saveMoney(money);
  updateIndicators();

  // ✅ 결과 표시(합계 인디케이터 자리에 텍스트)
  // - blackjack: "BLACKJACK!!"
  // - push: "PUSH"
  // - win/lose: "WIN!" / "LOSE"
  // - bust는 "LOSE"로
  for (let i = 0; i < playerHands.length; i++) {
    let text = "";

    const playerBJ = (outcomes[i] === "blackjack");
    const playerBust = (outcomes[i] === "bust");

    if (playerBJ && !dealerBlackjack) {
      text = "BLACKJACK!!";
    } else if (dealerBlackjack) {
      // 딜러 블랙잭은 별도 메시지 X, 결과만 반영
      // 플레이어가 BJ면 PUSH, 아니면 LOSE
      text = playerBJ ? "PUSH" : "LOSE";
    } else if (playerBust) {
      text = "LOSE";
    } else {
      // 일반 비교(stand였던 핸드들 + done이 아닌 핸드)
      const pScore = handValue(playerHands[i]);
      if (dealerScore > 15) text = "WIN!";
      else if (pScore > dealerScore) text = "WIN!";
      else if (pScore === dealerScore) text = "PUSH";
      else text = "LOSE";
    }

    if (sumEls[i]) sumEls[i].textContent = text;
  }

  phase = "roundOver";
  markActiveBlock();

  // ✅ 액션을 PROCEED 단일 버튼으로 교체
  showProceedButton();
}

// ---------- 시작 ----------
createDeck();
resetToBetting();
updateIndicators();