'use strict';
const $ = id => document.getElementById(id);
let animationEnabled = true;
const SUPPORTED_IMAGE_PATTERN = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
const isSupportedImageName = name => SUPPORTED_IMAGE_PATTERN.test(String(name || ''));
const indexedEntries = (window.DEFAULT_AVATARS || []).filter(entry => isSupportedImageName(entry.file));
const avatarSource = file => ['..', 'shared', 'defaults', '头像', file]
  .map(part => part === '..' ? part : encodeURIComponent(part))
  .join('/');
const normalizeRoster = roster => roster.map((entry, index) => ({
  id: index,
  number: index + 1,
  numberedName: `小伙伴${index + 1}`,
  nickname: String(entry.nickname || '').trim(),
  file: entry.file,
  src: new URL(avatarSource(entry.file), location.href).href,
}));
let defaultEntries = normalizeRoster(indexedEntries);
let entries = defaultEntries.map(entry => ({ ...entry }));
let lookup = new Map(entries.map(entry => [entry.id, entry]));
let game = new Lottery(entries.map(entry => entry.id));
let busy = false;
let activeAction = null;
let currentIsPreview = false;
let objectUrls = [];
let settingsView = 'settings-home';
let addDraft = [];
let deleteSelection = new Set();
let managementQuery = '';
let editDraft = null;
let avatarDirectoryHandle = null;
let sortDraft = [];

const entryOf = id => lookup.get(id);
const nicknameOf = id => entryOf(id).nickname;
const numberOf = id => entryOf(id).numberedName;

function randomIndex(n) {
  const limit = Math.floor(4294967296 / n) * n;
  const value = new Uint32Array(1);
  do { crypto.getRandomValues(value); } while (value[0] >= limit);
  return value[0] % n;
}

function empty(message) {
  const element = document.createElement('div');
  element.className = 'empty-pool';
  const icon = document.createElement('b');
  icon.textContent = '✳';
  element.append(icon, document.createTextNode(message));
  return element;
}

function poolCard(entry, state, extraClass = '') {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `pool-card ${state}${extraClass ? ` ${extraClass}` : ''}`;
  element.dataset.id = entry.id;
  element.disabled = busy || state === 'current-slot';
  element.title = state === 'revealed' ? `查看${entry.nickname}` : state === 'unrevealed' ? `抽取${entry.numberedName}` : '当前正在展示';
  let face;
  if (state === 'revealed') {
    face = new Image();
    face.className = 'card-front';
    face.src = entry.src;
    face.alt = entry.nickname;
  } else if (state === 'current-slot') {
    face = document.createElement('div');
    face.className = 'card-space';
    face.setAttribute('aria-label', `${entry.numberedName}的空卡位`);
  } else {
    face = document.createElement('div');
    face.className = 'card-back';
    face.setAttribute('aria-hidden', 'true');
  }
  const label = document.createElement('span');
  label.textContent = state === 'revealed' ? entry.nickname : state === 'current-slot' ? '\u00a0' : entry.numberedName;
  label.title = label.textContent;
  element.append(face, label);
  if (state !== 'current-slot') element.onclick = () => selectFromSeat(entry.id);
  return element;
}

function centerRect() {
  const area = $('picture').getBoundingClientRect();
  const size = Math.min(area.width, area.height);
  return { left: area.left + (area.width - size) / 2, top: area.top + (area.height - size) / 2, width: size, height: size };
}

function alignHero() {
  const picture = $('picture');
  const size = Math.min(picture.clientWidth, picture.clientHeight);
  Object.assign($('hero').style, {
    width: `${size}px`, height: `${size}px`,
    left: `${(picture.clientWidth - size) / 2}px`, top: `${(picture.clientHeight - size) / 2}px`,
  });
}

function render() {
  const remainingSet = new Set(game.remaining);
  const revealedSet = new Set([...game.past, ...game.replay]);
  $('pending-count').textContent = `${game.remaining.length} 未认识`;
  $('progress').textContent = `${entries.length - game.remaining.length} / ${entries.length}`;
  const poolCards = entries.map(entry => poolCard(entry,
    entry.id === game.current ? 'current-slot' : revealedSet.has(entry.id) ? 'revealed' : 'unrevealed'));
  $('pending').replaceChildren(...poolCards);
  if (!entries.length) $('pending').append(empty('选择一个图片文件夹开始'));

  const current = game.current === null ? null : entryOf(game.current);
  $('hero').hidden = !current;
  $('placeholder').hidden = !!current;
  if (current) {
    $('hero').src = current.src;
    $('hero').alt = current.nickname;
  } else {
    $('hero').removeAttribute('src');
    $('hero').alt = '';
  }
  alignHero();
  $('selected-name').textContent = current ? current.nickname : '准备好认识新朋友了吗？';
  $('selected-name').title = current ? current.nickname : '';

  const canDraw = !!(game.replay.length || game.remaining.length);
  $('stage-label').textContent = busy ? (activeAction === 'backward' ? '正在放回' : activeAction === 'previous' ? '正在返回' : activeAction === 'preview' ? '正在查看' : '正在抽取') : current ? '当前选中' : '等待相遇';
  $('status').textContent = busy
    ? (activeAction === 'backward' ? '正面卡片正在回到原位…' : activeAction === 'previous' ? '正在回到上一位伙伴…' : activeAction === 'preview' ? '正在打开已认识的伙伴…' : '卡片正在翻开…')
    : !canDraw && current ? '本轮已全部抽完'
      : game.replay.length ? '继续抽取会沿原顺序前进'
        : currentIsPreview && current ? '临时查看，不会加入回退顺序'
          : current ? `还有 ${game.remaining.length} 位尚未认识` : game.remaining.length ? '已载入卡片，随时可以开始' : '所有伙伴都已认识';
  $('draw').disabled = busy || !canDraw;
  $('draw').replaceChildren(document.createTextNode(busy ? (activeAction === 'backward' ? '正在放回…' : activeAction === 'previous' ? '正在返回…' : '正在揭晓…') : !canDraw ? '本轮已结束' : current ? '抽取下一位' : '抽取一位'));
  const arrow = document.createElement('span'); arrow.textContent = '↗'; $('draw').append(arrow);
  $('back').disabled = busy || !game.past.length;
  $('put-back').disabled = busy || game.current === null;
  $('reset').disabled = busy;
  $('folder').disabled = busy;
  $('manage-partners').disabled = busy;
  $('add-partners').disabled = busy;
  $('sort-partners').disabled = busy || defaultEntries.length < 2;
  $('bind-folder').disabled = busy;
  $('reload').disabled = busy;
  $('settings').disabled = busy;
  $('animation-switch').disabled = busy;
  $('animation-switch').checked = animationEnabled;
  document.body.dataset.animation = animationEnabled ? 'full' : 'off';
  if (busy) closeSettings();
}

function showSettingsView(id) {
  settingsView = id;
  document.querySelectorAll('.settings-view').forEach(view => { view.hidden = view.id !== id; });
}

function openSettings() {
  showSettingsView('settings-home');
  $('settings-panel').hidden = false;
  $('settings').setAttribute('aria-expanded', 'true');
  document.body.classList.add('settings-open');
  refreshFolderBindingStatus();
  $('settings-close').focus();
}

function closeSettings(restoreFocus = false) {
  releaseAddDraft();
  releaseEditDraft();
  deleteSelection.clear();
  sortDraft = [];
  $('settings-panel').hidden = true;
  $('settings').setAttribute('aria-expanded', 'false');
  document.body.classList.remove('settings-open');
  showSettingsView('settings-home');
  if (restoreFocus) $('settings').focus();
}

$('settings').onclick = () => {
  if ($('settings-panel').hidden) openSettings();
  else closeSettings(true);
};
$('settings-close').onclick = () => closeSettings(true);
$('settings-panel').onclick = event => {
  if (event.target === $('settings-panel')) closeSettings(true);
};
$('animation-switch').onchange = () => {
  if (busy) return;
  animationEnabled = $('animation-switch').checked;
  render();
};

function bringIntoView(card) {
  const grid = $('pending');
  const cardRect = card.getBoundingClientRect();
  const gridRect = grid.getBoundingClientRect();
  if (cardRect.top < gridRect.top) grid.scrollTop -= gridRect.top - cardRect.top + 4;
  if (cardRect.bottom > gridRect.bottom) grid.scrollTop += cardRect.bottom - gridRect.bottom + 4;
}

function visiblePoolAnchor(id) {
  const card = document.querySelector(`.pool-card[data-id="${id}"]`);
  if (card) {
    bringIntoView(card);
    return card.querySelector('.card-back, .card-front, .card-space');
  }
  return null;
}

function relativePosition(rect, base) {
  return {
    x: rect.left + rect.width / 2 - base.left - base.width / 2,
    y: rect.top + rect.height / 2 - base.top - base.height / 2,
    scale: Math.min(rect.width / base.width, rect.height / base.height),
  };
}

function flightLayer() {
  const layer = document.createElement('div');
  layer.className = 'card-flight-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.append(layer);
  return layer;
}

function frontFace(entry) {
  const front = document.createElement('div');
  front.className = 'flight-face flight-front';
  const image = new Image();
  image.src = entry.src;
  image.alt = '';
  front.append(image);
  return front;
}

function makeFrontCard(entry, rect, layer, className = '') {
  const card = document.createElement('div');
  card.className = `flight-card ${className}`.trim();
  Object.assign(card.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  card.append(frontFace(entry));
  const name = document.createElement('span');
  name.className = 'flight-name';
  name.textContent = entry.nickname;
  card.append(name);
  layer.append(card);
  return card;
}

function makeFlipCard(entry, rect, layer) {
  const card = document.createElement('div');
  card.className = 'flight-card drawing-card';
  Object.assign(card.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  const turn = document.createElement('div');
  turn.className = 'flight-turn';
  const back = document.createElement('div');
  back.className = 'flight-face flight-back';
  back.textContent = entry.numberedName;
  turn.append(frontFace(entry), back);
  card.append(turn);
  const name = document.createElement('span');
  name.className = 'flight-name';
  name.textContent = entry.nickname;
  card.append(name);
  layer.append(card);
  return { card, turn, name };
}

function runAnimation(element, frames, duration, easing = 'cubic-bezier(.22,.72,.25,1)') {
  const animation = element.animate(frames, { duration, easing, fill: 'both' });
  return { animation, done: animation.finished.catch(() => {}) };
}

async function preload(entry) {
  const image = new Image();
  image.src = entry.src;
  await Promise.race([image.decode().catch(() => {}), new Promise(resolve => setTimeout(resolve, 350))]);
}

async function animateDraw(nextId, commit) {
  const target = entryOf(nextId);
  const fresh = game.remaining.includes(nextId);
  await preload(target);
  const sourceElement = visiblePoolAnchor(nextId);
  await new Promise(requestAnimationFrame);
  const center = centerRect();
  const sourceRect = sourceElement?.getBoundingClientRect() || center;
  const from = relativePosition(sourceRect, center);
  const layer = flightLayer();
  const moving = fresh ? makeFlipCard(target, center, layer) : { card: makeFrontCard(target, center, layer, 'drawing-card') };
  const animations = [];
  const sourceCard = sourceElement?.closest('.pool-card');
  if (sourceCard) sourceCard.style.visibility = 'hidden';
  moving.card.style.zIndex = '3';
  const travel = runAnimation(moving.card, [
    { offset: 0, transform: `translate(${from.x}px,${from.y}px) scale(${from.scale})` },
    { offset: .45, transform: `translate(${from.x * .16}px,${from.y * .14 - 28}px) scale(.88)` },
    { offset: .78, transform: 'translate(0,-12px) scale(1.035)' },
    { offset: 1, transform: 'translate(0,0) scale(1)' },
  ], fresh ? 1500 : 1150);
  const done = [travel.done];
  animations.push(travel.animation);
  if (fresh) {
    const flip = runAnimation(moving.turn, [
      { offset: 0, transform: 'rotateY(180deg) rotateX(10deg) rotateZ(-10deg)' },
      { offset: .38, transform: 'rotateY(176deg) rotateX(8deg) rotateZ(-5deg)' },
      { offset: .68, transform: 'rotateY(72deg) rotateX(3deg) rotateZ(2deg)' },
      { offset: .9, transform: 'rotateY(-8deg) rotateX(-2deg)' },
      { offset: 1, transform: 'rotateY(0deg) rotateX(0deg)' },
    ], 1500, 'linear');
    const name = runAnimation(moving.name, [{ opacity: 0 }, { offset: .68, opacity: 0 }, { opacity: 1 }], 1500, 'linear');
    animations.push(flip.animation, name.animation);
    done.push(flip.done, name.done);
  }
  const finish = () => animations.forEach(animation => animation.finish());
  window.addEventListener('resize', finish, { once: true });
  try {
    await Promise.all(done);
    commit();
    render();
  } finally {
    window.removeEventListener('resize', finish);
    animations.forEach(animation => animation.cancel());
    sourceCard && (sourceCard.style.visibility = '');
    layer.remove();
  }
}

async function animateReturn(commit) {
  const returning = entryOf(game.current);
  const slot = visiblePoolAnchor(returning.id);
  await new Promise(requestAnimationFrame);
  const center = centerRect();
  const destination = slot?.getBoundingClientRect() || center;
  const to = relativePosition(destination, center);
  const layer = flightLayer();
  const moving = makeFrontCard(returning, center, layer, 'returning-card');
  moving.style.zIndex = '3';
  const travel = runAnimation(moving, [
    { offset: 0, opacity: 1, transform: 'translate(0,0) scale(1)' },
    { offset: .28, opacity: 1, transform: `translate(${to.x * .18}px,${to.y * .12 - 24}px) scale(.9)` },
    { offset: .72, opacity: 1, transform: `translate(${to.x * .78}px,${to.y * .72 - 10}px) scale(${Math.max(to.scale, .32)})` },
    { offset: 1, opacity: 1, transform: `translate(${to.x}px,${to.y}px) scale(${to.scale})` },
  ], 1150);
  const animations = [travel.animation];
  const finish = () => animations.forEach(animation => animation.finish());
  window.addEventListener('resize', finish, { once: true });
  try {
    await travel.done;
    commit();
    render();
  } finally {
    window.removeEventListener('resize', finish);
    animations.forEach(animation => animation.cancel());
    layer.remove();
  }
}

async function animatePrevious(targetId, commit) {
  const target = entryOf(targetId);
  const oldId = game.current;
  await preload(target);
  const source = visiblePoolAnchor(targetId);
  const destination = oldId === null ? null : visiblePoolAnchor(oldId);
  await new Promise(requestAnimationFrame);
  const center = centerRect();
  const from = relativePosition(source?.getBoundingClientRect() || center, center);
  const to = destination ? relativePosition(destination.getBoundingClientRect(), center) : null;
  const layer = flightLayer();
  const incoming = makeFrontCard(target, center, layer, 'previous-incoming');
  incoming.style.zIndex = '3';
  const sourceCard = source?.closest('.pool-card');
  if (sourceCard) sourceCard.style.visibility = 'hidden';
  const incomingMotion = runAnimation(incoming, [
    { offset: 0, transform: `translate(${from.x}px,${from.y}px) scale(${from.scale})` },
    { offset: .7, transform: 'translate(0,-10px) scale(1.025)' },
    { offset: 1, transform: 'translate(0,0) scale(1)' },
  ], 1050);
  const animations = [incomingMotion.animation];
  const done = [incomingMotion.done];
  if (oldId !== null && to) {
    const outgoing = makeFrontCard(entryOf(oldId), center, layer, 'previous-outgoing');
    outgoing.style.zIndex = '2';
    const outgoingMotion = runAnimation(outgoing, [
      { offset: 0, transform: 'translate(0,0) scale(1)' },
      { offset: .35, transform: `translate(${to.x * .2}px,${to.y * .15 - 20}px) scale(.88)` },
      { offset: 1, transform: `translate(${to.x}px,${to.y}px) scale(${to.scale})` },
    ], 1050);
    animations.push(outgoingMotion.animation);
    done.push(outgoingMotion.done);
  }
  const finish = () => animations.forEach(animation => animation.finish());
  window.addEventListener('resize', finish, { once: true });
  try {
    await Promise.all(done);
    commit();
    render();
  } finally {
    window.removeEventListener('resize', finish);
    animations.forEach(animation => animation.cancel());
    sourceCard && (sourceCard.style.visibility = '');
    layer.remove();
  }
}

function returnCurrent() {
  if (game.current === null) return false;
  if (!currentIsPreview) game.past.push(game.current);
  game.current = null;
  currentIsPreview = false;
  game.backtrack = null;
  return true;
}

function stepPrevious() {
  if (!game.past.length) return false;
  if (game.current !== null && !currentIsPreview) game.replay.unshift(game.current);
  game.current = game.past.pop();
  currentIsPreview = false;
  game.backtrack = true;
  return true;
}

function selectSeat(id, fresh) {
  if (fresh) {
    const index = game.remaining.indexOf(id);
    if (index < 0) return false;
    game.remaining.splice(index, 1);
  }
  game.current = id;
  currentIsPreview = !fresh;
  game.backtrack = null;
  return true;
}

async function draw() {
  if (busy || (!game.replay.length && !game.remaining.length)) return;
  busy = true;
  const stage = document.querySelector('.stage');
  stage.setAttribute('aria-busy', 'true');
  try {
    if (game.current !== null) {
      activeAction = 'backward';
      render();
      if (animationEnabled) {
        stage.classList.add('card-moving');
        await animateReturn(returnCurrent);
      } else {
        returnCurrent();
        render();
      }
    }
    activeAction = 'forward';
    render();
    const chosenIndex = game.replay.length ? null : randomIndex(game.remaining.length);
    const nextId = game.replay.length ? game.replay[0] : game.remaining[chosenIndex];
    if (animationEnabled) {
      stage.classList.add('card-moving');
      await animateDraw(nextId, () => { game.draw(() => chosenIndex); currentIsPreview = false; });
    } else {
      game.draw(() => chosenIndex);
      currentIsPreview = false;
      render();
    }
  } finally {
    stage.classList.remove('card-moving');
    stage.removeAttribute('aria-busy');
    activeAction = null;
    busy = false;
    render();
  }
}

async function selectFromSeat(id) {
  if (busy || id === game.current) return;
  const fresh = game.remaining.includes(id);
  const known = game.past.includes(id) || game.replay.includes(id);
  if (!fresh && !known) return;
  busy = true;
  const stage = document.querySelector('.stage');
  stage.setAttribute('aria-busy', 'true');
  try {
    if (game.current !== null) {
      activeAction = 'backward';
      render();
      if (animationEnabled) {
        stage.classList.add('card-moving');
        await animateReturn(returnCurrent);
      } else {
        returnCurrent();
        render();
      }
    }
    activeAction = fresh ? 'forward' : 'preview';
    render();
    if (animationEnabled) {
      stage.classList.add('card-moving');
      await animateDraw(id, () => selectSeat(id, fresh));
    } else {
      selectSeat(id, fresh);
      render();
    }
  } finally {
    stage.classList.remove('card-moving');
    stage.removeAttribute('aria-busy');
    activeAction = null;
    busy = false;
    render();
  }
}

async function previous() {
  if (busy || !game.past.length) return;
  const targetId = game.past[game.past.length - 1];
  busy = true;
  activeAction = 'previous';
  render();
  const stage = document.querySelector('.stage');
  stage.setAttribute('aria-busy', 'true');
  try {
    if (animationEnabled) {
      stage.classList.add('card-moving');
      await animatePrevious(targetId, stepPrevious);
    } else {
      stepPrevious();
      render();
    }
  } finally {
    stage.classList.remove('card-moving');
    stage.removeAttribute('aria-busy');
    activeAction = null;
    busy = false;
    render();
  }
}

async function putBack() {
  if (busy || game.current === null) return;
  busy = true;
  activeAction = 'backward';
  render();
  const stage = document.querySelector('.stage');
  stage.setAttribute('aria-busy', 'true');
  try {
    if (animationEnabled) {
      stage.classList.add('card-moving');
      await animateReturn(returnCurrent);
    } else {
      returnCurrent();
      render();
    }
  } finally {
    stage.classList.remove('card-moving');
    stage.removeAttribute('aria-busy');
    activeAction = null;
    busy = false;
    render();
  }
}

function releaseAddDraft() {
  addDraft.forEach(item => URL.revokeObjectURL(item.preview));
  addDraft = [];
  $('add-partner-list').replaceChildren();
  $('add-files').value = '';
}

function releaseEditDraft() {
  if (editDraft?.replacementPreview) URL.revokeObjectURL(editDraft.replacementPreview);
  editDraft = null;
  $('edit-avatar-file').value = '';
}

const AVATAR_HANDLE_DB = 'icebreaker-local-settings';
const AVATAR_HANDLE_STORE = 'handles';
const AVATAR_HANDLE_KEY = 'avatar-directory';

function openAvatarHandleDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('当前浏览器不能保存文件夹绑定。'));
      return;
    }
    const request = indexedDB.open(AVATAR_HANDLE_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(AVATAR_HANDLE_STORE)) request.result.createObjectStore(AVATAR_HANDLE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开本地设置。'));
  });
}

async function readStoredAvatarDirectory() {
  try {
    const database = await openAvatarHandleDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(AVATAR_HANDLE_STORE, 'readonly');
      const request = transaction.objectStore(AVATAR_HANDLE_STORE).get(AVATAR_HANDLE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
    });
  } catch {
    return null;
  }
}

async function storeAvatarDirectory(directory) {
  try {
    const database = await openAvatarHandleDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(AVATAR_HANDLE_STORE, 'readwrite');
      transaction.objectStore(AVATAR_HANDLE_STORE).put(directory, AVATAR_HANDLE_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  } catch {
    // Some local-file browser contexts cannot persist file-system handles.
  }
}

async function validateAvatarDirectory(directory) {
  if (!directory || directory.name !== '头像') throw new Error('请选择当前项目中的“头像”文件夹。');
  try {
    await directory.getFileHandle('avatars.js');
  } catch {
    throw new Error('所选文件夹中没有 avatars.js，请选择当前项目使用的“头像”文件夹。');
  }
}

async function requestDirectoryPermission(directory) {
  if (typeof directory.queryPermission !== 'function') return true;
  const options = { mode: 'readwrite' };
  if (await directory.queryPermission(options) === 'granted') return true;
  return typeof directory.requestPermission === 'function' && await directory.requestPermission(options) === 'granted';
}

async function refreshFolderBindingStatus() {
  if (!avatarDirectoryHandle) avatarDirectoryHandle = await readStoredAvatarDirectory();
  $('folder-binding-status').textContent = avatarDirectoryHandle?.name === '头像' ? '已记录' : '未绑定';
}

function manifestRecords(roster) {
  return normalizeRoster(roster).map(entry => ({
    id: entry.id,
    number: entry.number,
    numberedName: entry.numberedName,
    nickname: entry.nickname,
    file: entry.file,
    src: avatarSource(entry.file),
  }));
}

async function writeAvatarManifest(directory, roster) {
  const manifest = await directory.getFileHandle('avatars.js', { create: true });
  const writable = await manifest.createWritable();
  const content = `window.DEFAULT_AVATARS = ${JSON.stringify(manifestRecords(roster), null, 2)};\n`;
  try {
    await writable.write(content);
  } finally {
    await writable.close();
  }
}

async function chooseAvatarDirectory(forcePicker = false) {
  if (location.protocol !== 'file:') {
    throw new Error('永久增删改只能在本地打开 index.html 时使用；在线页面不能改写服务器文件。');
  }
  if (typeof window.showDirectoryPicker !== 'function') {
    throw new Error('当前浏览器不支持写入本地文件夹，请使用最新版 Edge 或 Chrome。');
  }
  if (!forcePicker) {
    if (!avatarDirectoryHandle) avatarDirectoryHandle = await readStoredAvatarDirectory();
    if (avatarDirectoryHandle) {
      try {
        if (await requestDirectoryPermission(avatarDirectoryHandle)) {
          await validateAvatarDirectory(avatarDirectoryHandle);
          $('folder-binding-status').textContent = '已授权';
          return avatarDirectoryHandle;
        }
      } catch {
        avatarDirectoryHandle = null;
      }
    }
  }
  const directory = await window.showDirectoryPicker({ id: 'icebreaker-avatar-folder', mode: 'readwrite' });
  await validateAvatarDirectory(directory);
  avatarDirectoryHandle = directory;
  await storeAvatarDirectory(directory);
  $('folder-binding-status').textContent = '已授权';
  return directory;
}

function applyPersistentRoster(roster) {
  objectUrls.forEach(url => URL.revokeObjectURL(url));
  objectUrls = [];
  defaultEntries = normalizeRoster(roster);
  entries = defaultEntries.map(entry => ({ ...entry }));
  lookup = new Map(entries.map(entry => [entry.id, entry]));
  game = new Lottery(entries.map(entry => entry.id));
  currentIsPreview = false;
  closeSettings();
  render();
}

function uniqueFileName(original, reservedNames) {
  const dot = original.lastIndexOf('.');
  const stem = dot > 0 ? original.slice(0, dot) : original;
  const extension = dot > 0 ? original.slice(dot) : '';
  let candidate = original;
  let suffix = 2;
  while (reservedNames.has(candidate.toLocaleLowerCase('zh-CN'))) candidate = `${stem} (${suffix++})${extension}`;
  reservedNames.add(candidate.toLocaleLowerCase('zh-CN'));
  return candidate;
}

function renderAddDraft() {
  const rows = addDraft.map((item, index) => {
    const row = document.createElement('div');
    row.className = 'add-partner-row';
    const image = new Image();
    image.src = item.preview;
    image.alt = '';
    const label = document.createElement('label');
    const filename = document.createElement('span');
    filename.textContent = item.file.name;
    filename.title = item.file.name;
    const input = document.createElement('input');
    input.type = 'text';
    input.required = true;
    input.maxLength = 100;
    input.value = item.nickname;
    input.setAttribute('aria-label', `${item.file.name}的昵称`);
    input.oninput = () => { addDraft[index].nickname = input.value; };
    label.append(filename, input);
    row.append(image, label);
    return row;
  });
  $('add-partner-list').replaceChildren(...rows);
}

async function prepareAddDraft(files) {
  releaseAddDraft();
  let failed = 0;
  for (const file of files) {
    if (!isSupportedImageName(file.name)) continue;
    const preview = URL.createObjectURL(file);
    const image = new Image();
    image.src = preview;
    try {
      await image.decode();
      addDraft.push({ file, preview, nickname: file.name.replace(/\.[^.]+$/, '') });
    } catch {
      URL.revokeObjectURL(preview);
      failed++;
    }
  }
  if (!addDraft.length) {
    alert('没有可读取的图片。只支持 JPG、JPEG、PNG、WebP、GIF、BMP 和 AVIF。');
    return;
  }
  renderAddDraft();
  showSettingsView('add-partner-view');
  $('add-partner-list').querySelector('input')?.focus();
  if (failed) alert(`${failed} 张图片无法读取，已自动跳过。`);
}

function rosterData() {
  return defaultEntries.map(entry => ({ file: entry.file, nickname: entry.nickname }));
}

function filteredManagementEntries() {
  const query = managementQuery.trim().toLocaleLowerCase('zh-CN');
  if (!query) return defaultEntries;
  return defaultEntries.filter(entry => [entry.numberedName, entry.number, entry.nickname, entry.file]
    .some(value => String(value).toLocaleLowerCase('zh-CN').includes(query)));
}

function updateManagementControls(visibleEntries = filteredManagementEntries()) {
  const visibleFiles = new Set(visibleEntries.map(entry => entry.file));
  const visibleSelected = [...deleteSelection].filter(file => visibleFiles.has(file)).length;
  $('manage-count').textContent = `共 ${visibleEntries.length} 位 · 已选择 ${deleteSelection.size} 位`;
  $('delete-confirm').disabled = deleteSelection.size === 0;
  $('manage-all').checked = visibleEntries.length > 0 && visibleSelected === visibleEntries.length;
  $('manage-all').indeterminate = visibleSelected > 0 && visibleSelected < visibleEntries.length;
}

function openEditView(file) {
  releaseEditDraft();
  const index = defaultEntries.findIndex(entry => entry.file === file);
  if (index < 0) return;
  const entry = defaultEntries[index];
  editDraft = { originalFile: entry.file, replacement: null, replacementPreview: null };
  $('edit-preview').src = entry.src;
  $('edit-preview').alt = entry.nickname;
  $('edit-filename').textContent = entry.file;
  $('edit-nickname').value = entry.nickname;
  showSettingsView('edit-partner-view');
  $('edit-nickname').focus();
}

function renderManagementView() {
  const visibleEntries = filteredManagementEntries();
  const rows = visibleEntries.map(entry => {
    const row = document.createElement('div');
    row.className = 'manage-partner-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = entry.file;
    checkbox.checked = deleteSelection.has(entry.file);
    checkbox.setAttribute('aria-label', `选择${entry.nickname}`);
    checkbox.onchange = () => {
      if (checkbox.checked) deleteSelection.add(entry.file);
      else deleteSelection.delete(entry.file);
      updateManagementControls(visibleEntries);
    };
    const image = new Image();
    image.src = entry.src;
    image.alt = entry.nickname;
    const text = document.createElement('span');
    text.className = 'partner-meta';
    const nickname = document.createElement('strong');
    nickname.textContent = entry.nickname;
    const number = document.createElement('small');
    number.textContent = `${entry.numberedName} · ${entry.file}`;
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'row-edit-button';
    edit.textContent = '编辑';
    edit.onclick = () => openEditView(entry.file);
    text.append(nickname, number);
    row.append(checkbox, image, text, edit);
    return row;
  });
  if (!rows.length) {
    const message = document.createElement('div');
    message.className = 'management-empty';
    message.textContent = defaultEntries.length ? '没有找到匹配的伙伴' : '还没有伙伴，请先添加';
    rows.push(message);
  }
  $('manage-partner-list').replaceChildren(...rows);
  updateManagementControls(visibleEntries);
}

function moveSortItem(fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= sortDraft.length || toIndex >= sortDraft.length) return;
  const [moved] = sortDraft.splice(fromIndex, 1);
  sortDraft.splice(toIndex, 0, moved);
  renderSortView();
}

function renderSortView() {
  const entryMap = new Map(defaultEntries.map(entry => [entry.file, entry]));
  const rows = sortDraft.map((item, index) => {
    const entry = entryMap.get(item.file);
    const row = document.createElement('div');
    row.className = 'sort-partner-row';
    row.draggable = true;
    row.dataset.index = index;
    const handle = document.createElement('span');
    handle.className = 'sort-handle';
    handle.textContent = '⋮⋮';
    handle.title = '拖动调整顺序';
    const image = new Image();
    image.src = entry?.src || avatarSource(item.file);
    image.alt = item.nickname;
    const text = document.createElement('span');
    text.className = 'partner-meta';
    const nickname = document.createElement('strong');
    nickname.textContent = item.nickname;
    const number = document.createElement('small');
    number.textContent = `小伙伴${index + 1} · ${item.file}`;
    text.append(nickname, number);
    const actions = document.createElement('span');
    actions.className = 'sort-actions';
    const up = document.createElement('button');
    up.type = 'button';
    up.textContent = '↑';
    up.title = '上移';
    up.setAttribute('aria-label', `上移${item.nickname}`);
    up.disabled = index === 0;
    up.onclick = () => moveSortItem(index, index - 1);
    const down = document.createElement('button');
    down.type = 'button';
    down.textContent = '↓';
    down.title = '下移';
    down.setAttribute('aria-label', `下移${item.nickname}`);
    down.disabled = index === sortDraft.length - 1;
    down.onclick = () => moveSortItem(index, index + 1);
    actions.append(up, down);
    row.addEventListener('dragstart', event => {
      row.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', event => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    });
    row.addEventListener('drop', event => {
      event.preventDefault();
      moveSortItem(Number(event.dataTransfer.getData('text/plain')), index);
    });
    row.append(handle, image, text, actions);
    return row;
  });
  $('sort-partner-list').replaceChildren(...rows);
}

$('draw').onclick = draw;
$('back').onclick = previous;
$('put-back').onclick = putBack;
$('reset').onclick = () => {
  if (!busy && confirm('清空本轮记录，重新随机抽取？')) {
    game = new Lottery(entries.map(entry => entry.id));
    currentIsPreview = false;
    closeSettings();
    render();
  }
};
$('reload').onclick = () => {
  if (!busy && confirm('重新加载页面会清空本轮进度，并读取磁盘中的最新伙伴。继续吗？')) location.reload();
};
$('folder').onclick = () => {
  if (busy) return;
  closeSettings();
  $('files').value = '';
  $('files').click();
};
$('manage-partners').onclick = () => {
  if (busy) return;
  managementQuery = '';
  deleteSelection.clear();
  $('partner-search').value = '';
  renderManagementView();
  showSettingsView('manage-partner-view');
  $('partner-search').focus();
};
$('bind-folder').onclick = async () => {
  if (busy) return;
  try {
    await chooseAvatarDirectory(true);
    alert('头像文件夹已绑定，后续增删改会优先复用。');
  } catch (error) {
    if (error.name !== 'AbortError') alert(error.message);
  }
};
$('partner-search').oninput = event => {
  managementQuery = event.target.value;
  renderManagementView();
};
$('manage-back').onclick = $('manage-done').onclick = () => {
  deleteSelection.clear();
  showSettingsView('settings-home');
};
$('manage-all').onchange = () => {
  const visibleEntries = filteredManagementEntries();
  if ($('manage-all').checked) visibleEntries.forEach(entry => deleteSelection.add(entry.file));
  else visibleEntries.forEach(entry => deleteSelection.delete(entry.file));
  renderManagementView();
};
$('sort-partners').onclick = () => {
  if (busy || defaultEntries.length < 2) return;
  sortDraft = rosterData();
  renderSortView();
  showSettingsView('sort-partner-view');
};
$('sort-back').onclick = $('sort-cancel').onclick = () => {
  sortDraft = [];
  renderManagementView();
  showSettingsView('manage-partner-view');
};
$('sort-shuffle').onclick = () => {
  if (sortDraft.length < 2) return;
  const previousOrder = sortDraft.map(entry => entry.file);
  for (let index = sortDraft.length - 1; index > 0; index--) {
    const swapIndex = randomIndex(index + 1);
    [sortDraft[index], sortDraft[swapIndex]] = [sortDraft[swapIndex], sortDraft[index]];
  }
  if (sortDraft.every((entry, index) => entry.file === previousOrder[index])) sortDraft.push(sortDraft.shift());
  renderSortView();
};
$('sort-save').onclick = async () => {
  if (!sortDraft.length) return;
  const unchanged = sortDraft.every((entry, index) => entry.file === defaultEntries[index]?.file);
  if (unchanged) {
    sortDraft = [];
    renderManagementView();
    showSettingsView('manage-partner-view');
    return;
  }
  let directory;
  try {
    directory = await chooseAvatarDirectory();
  } catch (error) {
    if (error.name !== 'AbortError') alert(error.message);
    return;
  }
  const button = $('sort-save');
  button.disabled = true;
  button.textContent = '正在保存…';
  try {
    await writeAvatarManifest(directory, sortDraft);
    applyPersistentRoster(sortDraft);
    alert('伙伴顺序已保存，编号已自动更新，并重置本轮进度。');
  } catch (error) {
    alert(`顺序保存失败：${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = '保存顺序';
  }
};
$('add-partners').onclick = () => {
  if (busy) return;
  releaseAddDraft();
  $('add-files').click();
};
$('add-files').onchange = event => prepareAddDraft([...event.target.files]);
$('add-back').onclick = $('add-cancel').onclick = () => {
  releaseAddDraft();
  renderManagementView();
  showSettingsView('manage-partner-view');
};
$('add-partner-view').onsubmit = async event => {
  event.preventDefault();
  if (!$('add-partner-view').reportValidity() || !addDraft.length) return;
  const blankNickname = addDraft.findIndex(item => !item.nickname.trim());
  if (blankNickname >= 0) {
    alert('每张图片都需要填写昵称。');
    $('add-partner-list').querySelectorAll('input')[blankNickname]?.focus();
    return;
  }
  let directory;
  try {
    directory = await chooseAvatarDirectory();
  } catch (error) {
    if (error.name !== 'AbortError') alert(error.message);
    return;
  }
  const button = $('add-save');
  button.disabled = true;
  button.textContent = '正在写入…';
  const written = [];
  try {
    const reserved = new Set();
    for await (const name of directory.keys()) reserved.add(name.toLocaleLowerCase('zh-CN'));
    const additions = [];
    for (const item of addDraft) {
      const fileName = uniqueFileName(item.file.name, reserved);
      const handle = await directory.getFileHandle(fileName, { create: true });
      const writable = await handle.createWritable();
      try {
        await writable.write(item.file);
      } finally {
        await writable.close();
      }
      written.push(fileName);
      additions.push({ file: fileName, nickname: item.nickname.trim() });
    }
    const nextRoster = [...rosterData(), ...additions];
    await writeAvatarManifest(directory, nextRoster);
    const addedCount = additions.length;
    applyPersistentRoster(nextRoster);
    alert(`已添加 ${addedCount} 位伙伴，并重置本轮进度。`);
  } catch (error) {
    for (const name of written) {
      try { await directory.removeEntry(name); } catch { /* best-effort rollback */ }
    }
    alert(`添加失败：${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = '写入头像文件夹';
  }
};

$('edit-back').onclick = $('edit-cancel').onclick = () => {
  releaseEditDraft();
  renderManagementView();
  showSettingsView('manage-partner-view');
};
$('edit-choose-avatar').onclick = () => {
  $('edit-avatar-file').value = '';
  $('edit-avatar-file').click();
};
$('edit-avatar-file').onchange = async event => {
  const [file] = event.target.files;
  if (!file || !editDraft) return;
  if (!isSupportedImageName(file.name)) {
    alert('只支持 JPG、JPEG、PNG、WebP、GIF、BMP 和 AVIF 图片。');
    return;
  }
  const preview = URL.createObjectURL(file);
  const image = new Image();
  image.src = preview;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(preview);
    alert('所选图片无法读取，请换一张图片。');
    return;
  }
  if (editDraft.replacementPreview) URL.revokeObjectURL(editDraft.replacementPreview);
  editDraft.replacement = file;
  editDraft.replacementPreview = preview;
  $('edit-preview').src = preview;
  $('edit-filename').textContent = `${file.name}（待写入）`;
};
$('edit-partner-view').onsubmit = async event => {
  event.preventDefault();
  if (!editDraft || !$('edit-partner-view').reportValidity()) return;
  const nickname = $('edit-nickname').value.trim();
  if (!nickname) {
    alert('昵称不能为空。');
    return;
  }
  let directory;
  try {
    directory = await chooseAvatarDirectory();
  } catch (error) {
    if (error.name !== 'AbortError') alert(error.message);
    return;
  }
  const button = $('edit-save');
  button.disabled = true;
  button.textContent = '正在保存…';
  let writtenFile = null;
  let oldFileDeleteFailed = false;
  try {
    const nextRoster = rosterData();
    const currentIndex = nextRoster.findIndex(entry => entry.file === editDraft.originalFile);
    const updated = nextRoster[currentIndex];
    updated.nickname = nickname;
    if (editDraft.replacement) {
      const reserved = new Set();
      for await (const name of directory.keys()) reserved.add(name.toLocaleLowerCase('zh-CN'));
      writtenFile = uniqueFileName(editDraft.replacement.name, reserved);
      const handle = await directory.getFileHandle(writtenFile, { create: true });
      const writable = await handle.createWritable();
      try {
        await writable.write(editDraft.replacement);
      } finally {
        await writable.close();
      }
      updated.file = writtenFile;
    }
    await writeAvatarManifest(directory, nextRoster);
    if (writtenFile) {
      try { await directory.removeEntry(editDraft.originalFile); } catch { oldFileDeleteFailed = true; }
    }
    applyPersistentRoster(nextRoster);
    alert(oldFileDeleteFailed
      ? '修改已保存并重置本轮进度，但旧头像未能删除，请手动检查“头像”文件夹。'
      : '伙伴资料已更新，并重置本轮进度。');
  } catch (error) {
    if (writtenFile) {
      try { await directory.removeEntry(writtenFile); } catch { /* best-effort rollback */ }
    }
    alert(`修改失败：${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = '保存修改';
  }
};
$('delete-confirm').onclick = async () => {
  if (!deleteSelection.size) return;
  const count = deleteSelection.size;
  if (!confirm(`将永久删除选中的 ${count} 位伙伴及其本地图片，删除后无法恢复，并会重置本轮进度。确定继续吗？`)) return;
  let directory;
  try {
    directory = await chooseAvatarDirectory();
  } catch (error) {
    if (error.name !== 'AbortError') alert(error.message);
    return;
  }
  const button = $('delete-confirm');
  button.disabled = true;
  button.textContent = '正在删除…';
  try {
    const nextRoster = defaultEntries
      .filter(entry => !deleteSelection.has(entry.file))
      .map(({ file, nickname }) => ({ file, nickname }));
    await writeAvatarManifest(directory, nextRoster);
    let failed = 0;
    for (const file of deleteSelection) {
      try { await directory.removeEntry(file); } catch { failed++; }
    }
    applyPersistentRoster(nextRoster);
    alert(failed
      ? `伙伴列表已更新并重置本轮进度，但有 ${failed} 个图片文件未能从磁盘删除，请手动检查“头像”文件夹。`
      : `已永久删除 ${count} 位伙伴，并重置本轮进度。`);
  } catch (error) {
    alert(`删除失败：${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = '删除选中的伙伴';
  }
};

$('files').onchange = async event => {
  const relativeName = file => file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name;
  const files = [...event.target.files]
    .filter(file => isSupportedImageName(file.name))
    .sort((a, b) => relativeName(a).localeCompare(relativeName(b), 'zh-CN', { numeric: true }) || (relativeName(a) < relativeName(b) ? -1 : 1));
  if (!files.length) {
    alert('这个文件夹没有支持的图片，请选择包含 JPG、PNG 或 WebP 等图片的文件夹。');
    return;
  }
  if ((game.current !== null || game.past.length || game.replay.length) && !confirm('更换文件夹会清空本轮记录，继续吗？')) return;
  busy = true;
  render();
  $('status').textContent = '正在检查图片…';
  const accepted = [];
  const nextUrls = [];
  const indexedFiles = new Map(defaultEntries.map(entry => [entry.file, entry]));
  let failed = 0;
  for (const file of files) {
    const src = URL.createObjectURL(file);
    const image = new Image();
    image.src = src;
    try {
      await image.decode();
      const indexed = indexedFiles.get(relativeName(file));
      const number = accepted.length + 1;
      accepted.push({
        id: accepted.length,
        number,
        numberedName: `小伙伴${number}`,
        nickname: indexed?.nickname || file.name.replace(/\.[^.]+$/, ''),
        file: relativeName(file),
        src,
      });
      nextUrls.push(src);
    } catch {
      URL.revokeObjectURL(src);
      failed++;
    }
  }
  if (accepted.length) {
    objectUrls.forEach(url => URL.revokeObjectURL(url));
    objectUrls = nextUrls;
    entries = accepted;
    lookup = new Map(entries.map(entry => [entry.id, entry]));
    game = new Lottery(entries.map(entry => entry.id));
    currentIsPreview = false;
  }
  busy = false;
  render();
  if (failed) alert(`${failed} 张图片无法读取，已跳过。${accepted.length ? `成功载入 ${accepted.length} 张图片。` : '保留原来的图片和进度。'}`);
};

document.addEventListener('keydown', event => {
  if (!$('settings-panel').hidden) {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (settingsView === 'settings-home') closeSettings(true);
      else {
        releaseAddDraft();
        releaseEditDraft();
        deleteSelection.clear();
        sortDraft = [];
        showSettingsView('settings-home');
        $('settings-close').focus();
      }
    }
    return;
  }
  const remoteDraw = event.code === 'ArrowDown' || event.code === 'PageDown';
  const remotePrevious = event.code === 'ArrowUp' || event.code === 'PageUp';
  if (!event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && (remoteDraw || remotePrevious)) {
    event.preventDefault();
    if (remoteDraw) draw();
    else previous();
    return;
  }
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || /INPUT|TEXTAREA|SELECT|BUTTON|A/.test(event.target.tagName)) return;
  if (event.code === 'Space' || event.code === 'ArrowRight') {
    event.preventDefault();
    draw();
  }
  if (event.code === 'ArrowLeft') {
    event.preventDefault();
    previous();
  }
});

new ResizeObserver(alignHero).observe($('picture'));
refreshFolderBindingStatus();
render();
