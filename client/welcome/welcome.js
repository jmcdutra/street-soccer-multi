"use strict";

const form = document.getElementById("join-form");
const nameInput = document.getElementById("player-name");
const statusEl = document.getElementById("arena-status");
const queueCountEl = document.getElementById("queue-count");
const queuePreviewEl = document.getElementById("queue-preview");
const copyEl = document.getElementById("arena-copy");
const loading = document.getElementById("loading");
const spectateBtn = document.getElementById("spectate-btn");
const HABBO_MISSING_KEY = "missingHabboHeads";
const missingHabboHeads = new Set(loadMissingHabboHeads());
let lastQueueSignature = null;

const savedName = localStorage.getItem("name");
if (savedName) nameInput.value = savedName;

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

function habboHead(name) {
    const key = habboKey(name);
    if (!key || missingHabboHeads.has(key)) return "";
    const safeName = escapeHtml(name);
    return `<img class="habbo-head" data-habbo-name="${safeName}" src="${habboHeadUrl(name)}" alt="${safeName}" loading="lazy" referrerpolicy="no-referrer" onerror="onHabboHeadError(this)">`;
}

function nameWithHead(name) {
    const safeName = escapeHtml(name);
    return `<span class="name-with-head">${habboHead(name)}<span>${safeName}</span></span>`;
}

function showLoading() {
    if (loading) loading.style.display = "flex";
}

function statusLabel(status) {
    const labels = {
        LOCKED: "bloqueado",
        WAITING: "aguardando",
        COUNTDOWN: "começando",
        PLAYING: "em jogo",
        GOLDEN_GOAL: "gol de ouro",
        PAUSED: "pausado",
        BETWEEN_MATCH: "intervalo"
    };
    return labels[status] ?? status;
}

function renderQueue(queue) {
    const signature = queue
        .map((entry) => `${entry.index}:${entry.name}:${entry.online ? 1 : 0}`)
        .join("|");

    if (signature === lastQueueSignature) return;
    lastQueueSignature = signature;

    queueCountEl.innerText = `${queue.length} jogador${queue.length === 1 ? "" : "es"}`;
    queuePreviewEl.innerHTML = queue.slice(0, 10).map((entry) => `
        <div class="admin-item">
            <strong class="queue-name"><small>#${entry.index}</small>${nameWithHead(entry.name)}</strong>
            <small>${entry.online ? "online" : "offline"}</small>
        </div>
    `).join("") || '<div class="admin-item"><small>Ninguém na fila ainda.</small></div>';
}

async function loadArena() {
    try {
        const response = await fetch("/api/arena");
        const state = await response.json();
        statusEl.innerText = statusLabel(state.status);
        copyEl.innerText = state.status === "LOCKED"
            ? "A arena está bloqueada. Entre na fila e aguarde os treinadores liberarem."
            : "A arena está liberada. Você será levado para o campo e entrará quando chegar sua vez.";
        renderQueue(state.queue);
    } catch (err) {
        statusEl.innerText = "offline";
        copyEl.innerText = "Não foi possível carregar a arena agora.";
    }
}

form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = nameInput.value.trim().replace(/\s+/g, " ").substring(0, 18);
    if (!name) return;
    localStorage.setItem("name", name);
    showLoading();
    window.location.href = `/play?name=${encodeURIComponent(name)}`;
});

spectateBtn?.addEventListener("click", () => {
    localStorage.removeItem("name");
    showLoading();
    window.location.href = "/play?spectator=1";
});

loadArena();
setInterval(loadArena, 2500);
