/// <reference path="../libraries/TSDef/p5.global-mode.d.ts" />
"use strict";

let game, sock;
let apna_player;
let bluePlayerImgList, redPlayerImgList, whitePlayerImgList;
let BlueFullImg, RedFullImg, WhiteFullImg;
let field;
let joystick, canvas, shootingBtn;
let bgColor = '#4ca64c';
let navbarF = 0.07;
let openSans;
let kickSound = document.querySelector('#kick-sound');
let goalSound = document.querySelector('#goal-sound');
let mute = localStorage.mute == '1' ? 1 : 0;
let scoreBoardA = document.getElementById('scoreboard-a');
let scoreBoardB = document.getElementById('scoreboard-b');
let playerName = (window.INITIAL_PLAYER_NAME || new URLSearchParams(location.search).get('name') || '').trim();
let Cam = {
    shift: null,
    scale: 1,
};

function fitCameraToStage() {
    if (!canvas) return;
    Cam.scale = Math.min(canvas.width / C.Width, canvas.height / C.Height) * 0.985;
}

function getMouseTransformed() {
    let mx = (mouseX - Cam.shift.x) / Cam.scale;
    let my = (mouseY - Cam.shift.y) / Cam.scale;
    return { x: mx, y: my };
}

const pressed = {
    'KeyA': 0,
    'KeyW': 0,
    'KeyD': 0,
    'KeyS': 0
};

const moveKeyMap = {
    'ArrowLeft': 'KeyA',
    'ArrowUp': 'KeyW',
    'ArrowRight': 'KeyD',
    'ArrowDown': 'KeyS',
};

function onsock() {
    sock.on('connect', () => {
        sock.emit('arena:sync');
    });

    sock.on('join:accepted', ({ name }) => {
        playerName = name;
        localStorage.setItem('name', name);
        markArenaReady();
    });

    sock.on('join:error', (message) => {
        alert(message);
        window.location.href = '/';
    });

    sock.on('game:tick', (data) => {
        const { playerData, ballData } = data;
        game.updateClient(playerData, ballData);
        apna_player = game.players[sock.id];
        if (apna_player) apna_player.strokeColor = "#ff2b3f";
        if (apna_player && canControl) {
            sock.emit('input:mouse', getMouseTransformed());
            apna_player.shootingSend();
            apna_player.joystickSend();
        }
    });

    sock.on('arena:state', renderArenaState);
    sock.on('chat:cleared', () => renderChat([]));

    let go321 = document.querySelector('#go321');
    go321.style.display = 'none';
    sock.on('countDown', (countDownTime) => {
        go321.style.display = '';
        setTimeout(() => {
            go321.style.display = 'none';
        }, countDownTime);
    });

    sock.on('play-sound', (event) => {
        if (mute == 1) return;
        kickSound.volume = 0.5;
        goalSound.volume = 0.18;
        if (event == 'kick') kickSound.play();
        if (event == 'goal') goalSound.play();
    });

    sock.on('score', ({ scoreA, scoreB }) => {
        scoreBoardA.innerText = scoreA;
        scoreBoardB.innerText = scoreB;
    });

    let pingElem = document.querySelector('#ping');
    sock.on("ping", (sendtime) => {
        let ping = Date.now() - sendtime;
        pingElem.innerText = `Ping: ${ping}`;
    });

    setInterval(() => {
        let sendtime = Date.now();
        sock.emit("ping", sendtime);
        document.querySelector('#fps').innerText = `FPS: ${Math.floor(frameRate())}`;
    }, 1000);
}

let ball_img;
function preload() {
    ball_img = loadImage('/assets/ball-dark-light.png');
    BlueFullImg = loadImage('/assets/blue.png');
    RedFullImg = loadImage('/assets/red.png');
    WhiteFullImg = loadImage('/assets/white.png');
    openSans = loadFont("/assets/OpenSans-Light.ttf");
}

function mouseWheel(e) {
    if (!currentArenaState || currentArenaState.status === 'LOCKED') return;
    if (mouseX < 0 || mouseY < 0 || mouseX > width || mouseY > height) return;
    let f = Math.pow(1.001, e.delta);
    Cam.scale /= f;
    Cam.scale = clamp(Cam.scale, 0.6, 2.8);
    return false;
}

function windowResized() {
    const stage = document.querySelector('.arena-stage');
    resizeCanvas(stage.clientWidth, stage.clientHeight);
    fitCameraToStage();
}

function setup() {
    const stage = document.querySelector('.arena-stage');
    canvas = createCanvas(stage.clientWidth, stage.clientHeight);
    canvas.parent('canvasDiv');
    fitCameraToStage();
    textFont(openSans);
    textSize(20);
    field = new Field();
    bluePlayerImgList = extractImage(BlueFullImg);
    redPlayerImgList = extractImage(RedFullImg);
    whitePlayerImgList = extractImage(WhiteFullImg);

    sock = io();
    game = new Game('arena');
    setEventListener();
    onsock();
    if (playerName) {
        sock.emit('player:join', { name: playerName });
    }
    changeTheme();
}

const clamp = (num, min, max) => Math.min(Math.max(num, min), max);

function draw() {
    if (!field || !game) return;

    let focus = createVector(0, 0);

    Cam.shift = createVector(0, 0);
    Cam.shift.add(focus.x, focus.y);
    Cam.shift.add(-C.Width / 2, -C.Height / 2);
    Cam.shift.mult(Cam.scale);
    Cam.shift.add(canvas.width / 2, canvas.height / 2);

    translate(Cam.shift);
    scale(Cam.scale);
    field.display(bgColor);
    game.display();
}
