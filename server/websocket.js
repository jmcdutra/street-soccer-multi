const socketio = require('socket.io');
const { server } = require("./server.js");

const io = socketio(server, { cors: { origin: '*' } });
global.io = io;

io.on("connection", (sock) => {
    const arena = global.arena;
    sock.join("arena");
    arena.emitState(sock);

    sock.on("arena:sync", () => {
        arena.emitState(sock);
    });

    sock.on("player:join", async ({ name } = {}) => {
        try {
            await arena.join(sock, name);
        } catch (err) {
            console.log(err);
            sock.emit("join:error", "Não foi possível entrar na arena.");
        }
    });

    sock.on("ping", (sendtime) => {
        sock.emit("ping", sendtime);
    });

    sock.on("disconnect", () => {
        arena.disconnect(sock);
    });

    sock.on("player:leave", (_payload = {}, done) => {
        arena.leave(sock);
        if (typeof done === "function") done({ ok: true });
    });

    sock.on("input:key", (keyInfo = {}) => {
        const player = arena.players[sock.id];
        if (!player) return;
        player.moveHandler(keyInfo.ecode, keyInfo.direction);
    });

    sock.on("input:mouse", (mouse = {}) => {
        const player = arena.players[sock.id];
        if (!player) return;
        player.thetaHandler(mouse.x, mouse.y);
    });

    sock.on("input:joystick", (dxdy = {}) => {
        const player = arena.players[sock.id];
        if (!player) return;
        player.joystickHandler(dxdy);
    });

    sock.on("input:shoot", (mouse = {}) => {
        arena.shoot(mouse, sock.id);
    });

    sock.on("input:tackle", () => {
        arena.tackle(sock.id);
    });

    sock.on("chat:send", ({ text } = {}) => {
        arena.chat(sock, text);
    });
});

module.exports = { io };
