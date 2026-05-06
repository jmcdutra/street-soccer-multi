const http=require('http');
const express=require('express');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');
const {nanoid,logip} = require("./utils.js");
const {UserModel,VisitModel} = require('./User.js');
const mongoose = require('mongoose');
const { Arena } = require('./arena.js');

require('dotenv').config();
const roomsRouter = require('./routes/rooms')
// const {Ball,Player}=require('./client/ball')
console.log(`server.js loaded ${Date.now()}`);
global.games = {};
global.arena = new Arena();
global.arena.init().catch(err => console.log(err));
global.arena.run();


const app=express();
const server=http.createServer(app);
module.exports.server = server;

app.set('view engine','ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

// Cookies and User IDs
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const db = process.env.DBPASS;

// Connect to MongoDB
mongoose
  .connect(db,{ useNewUrlParser: true ,useUnifiedTopology: true})
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.log(err));


app.get("/", async function (req,res){ 
    logip(req,res).catch(err => console.log("Error logging visit", err));
    res.set('Cache-Control', 'no-store, max-age=0');
    // res.render('../client/welcome/welcome.ejs');
    res.sendFile("/client/welcome/welcome.html",{root:path.join(__dirname,"../")});
})

app.get("/play", async function (req,res){
    const playerName = String(req.query.name ?? '').trim();
    const isSpectator = req.query.spectator === '1';
    if (!playerName && !isSpectator) {
        return res.redirect('/');
    }
    logip(req,res).catch(err => console.log("Error logging visit", err));
    res.render(path.join(__dirname, '../client/game/game.ejs'),{playerName});
})

app.get('/api/arena', async (req,res)=>{
    res.json(await global.arena.adminState());
});

const ADMIN_USER = 'Treinadores';
const ADMIN_PASS = 'tremelhorcia';
const ADMIN_COOKIE = 'admin_session';
const ADMIN_COOKIE_VALUE = Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64');

function hasAdminCookie(req) {
    return req.cookies?.[ADMIN_COOKIE] === ADMIN_COOKIE_VALUE;
}

function renderAdminLogin(res, error = '') {
    res.status(error ? 401 : 200).send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login | Treinadores</title>
    <link rel="stylesheet" href="/style.css">
    <style>
        body { min-height: 100vh; display: grid; place-items: center; overflow: auto; }
        .login-panel { width: min(420px, calc(100vw - 32px)); padding: 24px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
        .login-panel h1 { margin: 0 0 8px; font-family: var(--font-display); text-transform: uppercase; }
        .login-panel p { color: var(--muted); }
        .login-panel form { display: grid; gap: 12px; margin-top: 18px; }
        .login-error { color: var(--accent); margin: 0; }
    </style>
</head>
<body>
    <main class="login-panel">
        <p class="hero-kicker">Área restrita</p>
        <h1>Treinadores</h1>
        <p>Entre com o usuário e senha do painel admin.</p>
        ${error ? `<p class="login-error">${error}</p>` : ''}
        <form method="post" action="/admin/login">
            <input class="form-control" name="username" placeholder="Usuário" autocomplete="username" autofocus>
            <input class="form-control" name="password" type="password" placeholder="Senha" autocomplete="current-password">
            <button class="btn btn-primary" type="submit">Entrar</button>
        </form>
    </main>
</body>
</html>`);
}

function basicAdminAuth(req, res, next) {
    if (hasAdminCookie(req)) return next();
    const auth = req.headers.authorization || '';
    const [scheme, encoded] = auth.split(' ');
    if (scheme === 'Basic' && encoded) {
        const decoded = Buffer.from(encoded, 'base64').toString('utf8');
        const separator = decoded.indexOf(':');
        const user = decoded.slice(0, separator);
        const pass = decoded.slice(separator + 1);
        if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
    }
    if (req.path.startsWith('/admin/api/')) {
        res.set('WWW-Authenticate', 'Basic realm="Treinadores", charset="UTF-8"');
        return res.status(401).json({ error: 'Authentication required' });
    }
    return res.redirect('/admin/login');
}

app.get('/admin/login', (req,res)=>{
    if (hasAdminCookie(req)) return res.redirect('/admin');
    renderAdminLogin(res);
});

app.post('/admin/login', (req,res)=>{
    const user = String(req.body.username ?? '');
    const pass = String(req.body.password ?? '');
    if (user === ADMIN_USER && pass === ADMIN_PASS) {
        res.cookie(ADMIN_COOKIE, ADMIN_COOKIE_VALUE, {
            httpOnly: true,
            sameSite: 'lax',
            maxAge: 12 * 60 * 60 * 1000
        });
        return res.redirect('/admin');
    }
    return renderAdminLogin(res, 'Usuário ou senha inválidos.');
});

app.post('/admin/logout', (req,res)=>{
    res.clearCookie(ADMIN_COOKIE);
    res.redirect('/admin/login');
});

app.get('/admin', basicAdminAuth, (req,res)=>{
    res.render('admin');
});

app.get('/admin/api/state', basicAdminAuth, async (req,res)=>{
    res.json(await global.arena.adminState());
});

app.post('/admin/api/:action', basicAdminAuth, async (req,res)=>{
    const action = req.params.action;
    const arena = global.arena;
    if(action === 'unlock') arena.unlock();
    else if(action === 'lock') arena.lock();
    else if(action === 'start') arena.startNextMatch();
    else if(action === 'pause') arena.pause();
    else if(action === 'resume') arena.resume();
    else if(action === 'end') await arena.finishMatch(arena.scoreA === arena.scoreB ? null : (arena.scoreA > arena.scoreB ? 'A' : 'B'));
    else if(action === 'reset-game') arena.resetGame();
    else if(action === 'reset-ranking') await arena.resetRanking();
    else if(action === 'clear-queue') arena.clearQueue();
    else if(action === 'clear-chat') arena.clearChat();
    else if(action === 'remove-player') arena.removePlayer(req.body.name);
    else return res.status(404).json({error:'Unknown admin action'});
    res.json({ok:true});
});

app.use("/",express.static("client", { maxAge: '1d' }));


app.use('/room',roomsRouter)

const dbRoute = process.env.DBROUTE || '/users';
if (!process.env.DBROUTE) {
    console.warn(`DBROUTE is not set, defaulting to ${dbRoute}`);
}

app.use(dbRoute, async (req,res)=>{
    let data = await UserModel.find();
    res.json(data);
});
// required only to run the file once
const stopwatch_ = require("./stopwatch.js");
const constants_ = require("../client/constants.js");
const player_ = require("./player.js");
const ball_ = require("./ball.js");

const websocket=require('./websocket.js');
server.on('error', (err) => {
    console.error('Server error:', err);
});
const port=process.env.PORT ?? 8000;
server.listen(port,()=>{
    console.log("server listening on port ",port);
});
