"use strict";

let startBtn = null;
let bgSound = document.querySelector('#bg-sound');
let muteBtn = document.querySelector('#mute-btn');
let canvasDiv = document.getElementById('canvasDiv');
let currentArenaState = null;
let currentRole = 'spectator';
let canControl = false;
const HABBO_MISSING_KEY = "missingHabboHeads";
const missingHabboHeads = new Set(loadMissingHabboHeads());

document.getElementById("home").addEventListener("click", () => {
    window.location.href = '/';
});

function leaveArena() {
    const goHome = () => {
        localStorage.removeItem('name');
        window.location.href = '/';
    };

    if (!sock?.connected) {
        goHome();
        return;
    }

    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        goHome();
    };
    sock.emit('player:leave', {}, finish);
    setTimeout(finish, 600);
}

function isTypingTarget(event) {
    const tagName = event.target?.tagName;
    return event.target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(tagName);
}

function openHelpModal() {
    const modal = document.getElementById('help-modal');
    if (!modal) return;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
}

function closeHelpModal() {
    const modal = document.getElementById('help-modal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    localStorage.setItem('soccerHelpSeen', '1');
}

function maybeOpenHelpModal() {
    if (localStorage.getItem('soccerHelpSeen') === '1') return;
    setTimeout(openHelpModal, 450);
}

function sendTackle() {
    if (canControl) sock.emit("input:tackle");
}

function setEventListener() {
    canvasDiv.addEventListener('mousedown', () => {
        if (canControl) sock.emit("input:shoot", getMouseTransformed());
    });

    const tackleButton = document.querySelector('#tackle');
    tackleButton.addEventListener('click', sendTackle);
    tackleButton.addEventListener('touchstart', (event) => {
        event.preventDefault();
        sendTackle();
    });

    document.addEventListener('keydown', (e) => {
        if (e.code === "Escape" && document.getElementById('help-modal')?.classList.contains('is-open')) {
            closeHelpModal();
            return;
        }
        if (isTypingTarget(e)) return;
        if (!canControl) return;
        let ecode = e.code;
        if (ecode in moveKeyMap) ecode = moveKeyMap[ecode];
        if (!e.repeat && (ecode in pressed)) {
            sock.emit("input:key", { ecode: ecode, direction: 1 });
        }
        if (!e.repeat && (ecode == "Space" || ecode == "KeyT")) {
            e.preventDefault();
            sendTackle();
        }
    });

    document.addEventListener('keyup', (e) => {
        if (isTypingTarget(e)) return;
        if (!canControl) return;
        let ecode = e.code;
        if (ecode in moveKeyMap) ecode = moveKeyMap[ecode];
        if (!e.repeat && (ecode in pressed)) {
            sock.emit("input:key", { ecode: ecode, direction: 0 });
        }
    });

    joystick = new VirtualJoystick({
        container: document.querySelector("#canvasDiv"),
        innerRadius: 20,
        outerRadius: 40,
        stickRadius: 40,
        limitStickTravel: true,
        mouseSupport: true,
    });

    joystick.addEventListener('touchStartValidation', (e) => {
        if (!canControl) return false;
        var touch = e.changedTouches[0];
        return touch.pageX < window.innerWidth / 2;
    });

    shootingBtn = new VirtualJoystick({
        container: document.querySelector("#canvasDiv"),
        limitStickTravel: true,
        innerRadius: 20,
        outerRadius: 40,
        stickRadius: 40,
        strokeStyle1: '#f1000077',
        strokeStyle3: '#e4353577',
    });

    shootingBtn.addEventListener('touchStartValidation', (e) => {
        if (!canControl) return false;
        var touch = e.changedTouches[0];
        return touch.pageX > window.innerWidth / 2;
    });

    muteBtn.addEventListener('click', () => {
        mute = 1 - mute;
        localStorage.setItem('mute', String(mute));
        bgSound.muted = Boolean(mute);
        const icon = document.getElementById('mute-icon');
        if (icon) icon.src = mute ? '/assets/som_desativado.png' : '/assets/som_ativado.png';
    });

    document.getElementById('leave-btn')?.addEventListener('click', leaveArena);
    document.getElementById('help-btn')?.addEventListener('click', openHelpModal);
    document.querySelectorAll('[data-help-close]').forEach((el) => {
        el.addEventListener('click', closeHelpModal);
    });

    document.getElementById('chat-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const input = document.getElementById('chat-input');
        const text = input.value.trim();
        if (!text) return;
        sock.emit('chat:send', { text });
        input.value = '';
    });

    document.querySelector('#left-area').style.display = 'none';
    document.querySelector('#right-area').style.display = 'none';
}

function changeTheme() {
    bgColor = '#4ca64c';
}

function playBg() {
    bgSound.play().catch(() => {});
    const icon = document.getElementById('mute-icon');
    if (localStorage.mute == '1') {
        bgSound.muted = true;
        if (icon) icon.src = '/assets/som_desativado.png';
    } else {
        localStorage.mute = '0';
        if (icon) icon.src = '/assets/som_ativado.png';
    }
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[char]));
}

function loadMissingHabboHeads() {
    try {
        return JSON.parse(localStorage.getItem(HABBO_MISSING_KEY) || "[]");
    } catch (err) {
        return [];
    }
}

function saveMissingHabboHeads() {
    localStorage.setItem(HABBO_MISSING_KEY, JSON.stringify([...missingHabboHeads]));
}

function habboKey(name) {
    return String(name ?? "").trim().toLowerCase();
}

function habboHeadUrl(name) {
    const cleanName = String(name ?? "").trim();
    return `https://www.habbo.com.br/habbo-imaging/avatarimage?user=${encodeURIComponent(cleanName)}&headonly=1&direction=2&head_direction=2&gesture=sml&size=s`;
}

function onHabboHeadError(img) {
    const key = habboKey(img?.dataset?.habboName);
    if (key) {
        missingHabboHeads.add(key);
        saveMissingHabboHeads();
    }
    img?.remove();
}
window.onHabboHeadError = onHabboHeadError;

function habboHead(name, className = "habbo-head") {
    const key = habboKey(name);
    if (!key || missingHabboHeads.has(key)) return "";
    const safeName = escapeHtml(name);
    return `<img class="${className}" data-habbo-name="${safeName}" src="${habboHeadUrl(name)}" alt="${safeName}" loading="lazy" referrerpolicy="no-referrer" onerror="onHabboHeadError(this)">`;
}

function nameWithHead(name) {
    return `<span class="name-with-head">${habboHead(name)}<span>${escapeHtml(name)}</span></span>`;
}

function renderMiniList(id, names, emptyText) {
    const el = document.getElementById(id);
    el.innerHTML = names.map((entry) => {
        const name = typeof entry === 'string' ? entry : entry.name;
        return `<div class="mini-item">${nameWithHead(name)}</div>`;
    }).join('') || `<div class="mini-item"><small>${emptyText}</small></div>`;
}

function renderQueue(queue) {
    const el = document.getElementById('queue-list');
    el.innerHTML = queue.slice(0, 12).map((entry) => `
        <div class="queue-item">
            <span class="queue-name"><small>#${entry.index}</small>${nameWithHead(entry.name)}</span>
        </div>
    `).join('') || '<div class="queue-item"><small>Fila vazia</small></div>';
}

function fmtTime(seconds) {
    seconds = Math.max(0, Number(seconds || 0));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function statusText(status) {
    const labels = {
        LOCKED: 'Bloqueado',
        WAITING: 'Aguardando',
        COUNTDOWN: 'Começando',
        PLAYING: 'Em jogo',
        GOLDEN_GOAL: 'Gol de ouro',
        BETWEEN_MATCH: 'Intervalo'
    };
    return labels[status] ?? status;
}

function arenaDisplayStatus(state) {
    if (state.status === 'LOCKED') return 'Bloqueado';
    if (state.status === 'GOLDEN_GOAL') return 'Gol de ouro';
    if (state.me?.role === 'queued') return 'Na fila';
    if (state.me?.role === 'player') return 'Jogando';
    if (state.me?.role === 'spectator') return 'Assistindo';
    return statusText(state.status);
}

function renderArenaState(state) {
    currentArenaState = state;
    currentRole = state.me?.role ?? 'spectator';
    canControl = currentRole === 'player' && ['PLAYING', 'GOLDEN_GOAL'].includes(state.status);

    document.getElementById('arena-status').innerText = arenaDisplayStatus(state);
    document.getElementById('scoreboard-a').innerText = state.scoreA;
    document.getElementById('scoreboard-b').innerText = state.scoreB;
    document.getElementById('time-left').innerText = state.status === 'GOLDEN_GOAL' ? 'golden' : fmtTime(state.timeLeft);
    document.getElementById('player-name-label').innerHTML = state.me?.name ? nameWithHead(state.me.name) : 'Espectador';

    renderMiniList('active-a', state.active.filter(p => p.team === 'A'), 'Sem jogadores');
    renderMiniList('active-b', state.active.filter(p => p.team === 'B'), 'Sem jogadores');
    renderMiniList('next-a', state.next.A, 'Aguardando');
    renderMiniList('next-b', state.next.B, 'Aguardando');
    renderQueue(state.queue);
    renderChat(state.chat);

    const overlay = document.getElementById('lock-overlay');
    const title = document.getElementById('overlay-title');
    const copy = document.getElementById('overlay-copy');
    const shouldShowOverlay = state.status === 'LOCKED' || currentRole !== 'player';
    overlay.style.display = shouldShowOverlay ? 'block' : 'none';
    if (state.status === 'LOCKED') {
        title.innerText = 'Arena bloqueada';
        copy.innerText = 'Você está na fila. Aguarde os treinadores liberarem o jogo.';
    } else if (currentRole === 'queued') {
        title.innerText = 'Você está na fila';
        copy.innerText = 'Assista enquanto espera sua vez na próxima rotação.';
    } else if (currentRole === 'spectator') {
        title.innerText = 'Modo espectador';
        copy.innerText = 'Entre pela tela inicial para participar da fila.';
    }
}

function renderChat(messages) {
    const log = document.getElementById('chat-log');
    log.innerHTML = messages.map((message) => `
        <div class="chat-message">
            <strong>${nameWithHead(message.name)}</strong>
            <p>${escapeHtml(message.text)}</p>
        </div>
    `).join('');
    log.scrollTop = log.scrollHeight;
}

function extractImage(fullImage) {
    let x = 0, y = 0, imageList = [];
    for (let r = 0; r < 4; r++) {
        y = r * C.picHeight;
        x = 0;
        for (let c = 0; c < 3; c++) {
            let img = fullImage.get(x, y, C.picWidth, C.picHeight);
            imageList.push(img);
            x += C.picWidth;
        }
    }
    let img = fullImage.get(0, C.picHeight, C.picWidth, C.picHeight);
    imageList.push(img); imageList.push(img); imageList.push(img);
    return imageList;
}
