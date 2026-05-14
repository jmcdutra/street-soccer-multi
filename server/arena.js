"use strict";

require("../client/constants.js");
require("./player.js");
require("./ball.js");

const { PlayerProfileModel, QueueEntryModel } = require("./User.js");

const ARENA_ROOM = "arena";
const STATUS = {
  LOCKED: "LOCKED",
  WAITING: "WAITING",
  COUNTDOWN: "COUNTDOWN",
  PLAYING: "PLAYING",
  GOLDEN_GOAL: "GOLDEN_GOAL",
  PAUSED: "PAUSED",
  BETWEEN_MATCH: "BETWEEN_MATCH"
};

const MATCH_SECONDS = 180;
const GOAL_TARGET = 3;
const MAX_TEAM_SIZE = 5;
const MAX_ACTIVE_PLAYERS = MAX_TEAM_SIZE * 2;
const MIN_PLAYERS = 2;
const CHAT_LIMIT = 80;

class Arena {
  constructor() {
    this.status = STATUS.LOCKED;
    this.unlocked = false;
    this.players = {};
    this.activeByName = {};
    this.connections = {};
    this.queue = [];
    this.chatMessages = [];
    this.ball = new Ball();
    this.ballHolder = null;
    this.lastShooterId = null;
    this.scoreA = 0;
    this.scoreB = 0;
    this.matchEndsAt = null;
    this.matchRemainingMs = MATCH_SECONDS * 1000;
    this.pausedFromStatus = null;
    this.intervalId = null;
    this.timeIntervalId = null;
    this.countdownTimeoutId = null;
    this.nextMatchTimeoutId = null;
    this.kickoffPlayerId = null;
    this.stateDirty = true;
    this.finishing = false;
    this.queuePersistRevision = 0;
    this.queuePersistPromise = Promise.resolve();
  }

  async init() {
    try {
      this.queue = [];
      await QueueEntryModel.deleteMany({});
    } catch (err) {
      console.log("Arena queue restore failed:", err.message);
    }
  }

  run() {
    clearInterval(this.intervalId);
    clearInterval(this.timeIntervalId);
    this.intervalId = setInterval(() => {
      this.update();
      this.sendTick();
    }, 16);
    this.timeIntervalId = setInterval(() => {
      this.handleTimer();
      this.broadcastState();
    }, 1000);
  }

  io() {
    return global.io;
  }

  clearScheduledTransitions() {
    clearTimeout(this.countdownTimeoutId);
    clearTimeout(this.nextMatchTimeoutId);
    this.countdownTimeoutId = null;
    this.nextMatchTimeoutId = null;
    this.finishing = false;
  }

  resetMatchClock(remainingMs = MATCH_SECONDS * 1000) {
    this.matchEndsAt = null;
    this.matchRemainingMs = Math.max(0, remainingMs);
    this.pausedFromStatus = null;
  }

  currentMatchRemainingMs() {
    if (this.status === STATUS.GOLDEN_GOAL || this.pausedFromStatus === STATUS.GOLDEN_GOAL) return 0;
    if (this.matchEndsAt) return Math.max(0, this.matchEndsAt - Date.now());
    return Math.max(0, this.matchRemainingMs ?? MATCH_SECONDS * 1000);
  }

  startMatchClock() {
    const remainingMs = Math.max(0, this.matchRemainingMs ?? MATCH_SECONDS * 1000);
    this.matchRemainingMs = remainingMs;
    this.matchEndsAt = Date.now() + remainingMs;
  }

  pauseMatchClock() {
    this.matchRemainingMs = this.currentMatchRemainingMs();
    this.matchEndsAt = null;
  }

  persistQueue() {
    const revision = ++this.queuePersistRevision;
    const queueSnapshot = [...this.queue];
    const onlineSnapshot = new Set(queueSnapshot.filter((name) => this.isOnline(name)));

    this.queuePersistPromise = this.queuePersistPromise
      .catch(() => {})
      .then(async () => {
        if (revision !== this.queuePersistRevision) return;

        if (!queueSnapshot.length) {
          await QueueEntryModel.deleteMany({});
          return;
        }

        await QueueEntryModel.deleteMany({ name: { $nin: queueSnapshot } });
        await QueueEntryModel.bulkWrite(
          queueSnapshot.map((name, index) => ({
            updateOne: {
              filter: { name },
              update: {
                $set: {
                  name,
                  position: index + 1,
                  online: onlineSnapshot.has(name),
                  lastSeen: new Date()
                }
              },
              upsert: true
            }
          }))
        );
      })
      .catch((err) => {
        console.log("Arena persistQueue failed:", err.message);
      });
  }

  async join(sock, rawName) {
    const name = this.cleanName(rawName);
    if (!name) {
      sock.emit("join:error", "Informe um nome válido.");
      return;
    }

    const current = this.connections[name];
    if (current?.online && current.sockId !== sock.id) {
      sock.emit("join:error", "Esse nome já está online.");
      return;
    }

    sock.join(ARENA_ROOM);
    sock.playerName = name;
    this.connections[name] = { sockId: sock.id, online: true, joinedAt: Date.now() };
    this.ensureProfile(name).catch((err) => {
      console.log("Arena ensureProfile failed:", err.message);
    });
    this.enqueue(name);
    this.persistQueue();
    sock.emit("join:accepted", { name });

    if (this.unlocked && this.status === STATUS.WAITING) {
      this.startNextMatch();
    }
    this.broadcastState();
  }

  disconnect(sock) {
    const name = sock.playerName;
    if (!name || !this.connections[name]) return;
    if (this.connections[name].sockId !== sock.id) return;

    const active = this.activeByName[name];
    this.removeFromQueue(name);
    if (active) this.removeActivePlayer(name, false);
    delete this.connections[name];
    sock.playerName = null;
    QueueEntryModel.deleteOne({ name }).catch(() => {});
    if (active) {
      this.handleActiveDeparture(active.team);
      return;
    }
    this.persistQueue();
    this.broadcastState();
  }

  leave(sock) {
    const name = sock.playerName;
    if (!name) return;
    const active = this.activeByName[name];

    this.removeFromQueue(name);
    if (active) this.removeActivePlayer(name, false);
    if (this.connections[name]?.sockId === sock.id) delete this.connections[name];
    sock.playerName = null;
    QueueEntryModel.deleteOne({ name }).catch(() => {});
    if (active) {
      this.handleActiveDeparture(active.team);
      return;
    }
    this.persistQueue();
    this.broadcastState();
  }

  cleanName(name) {
    return String(name ?? "").trim().replace(/\s+/g, " ").substring(0, 18);
  }

  isOnline(name) {
    return Boolean(this.connections[name]?.online);
  }

  enqueue(name) {
    if (!this.queue.includes(name) && !this.activeByName[name]) {
      this.queue.push(name);
    }
  }

  removeFromQueue(name) {
    this.queue = this.queue.filter((entry) => entry !== name);
  }

  pruneQueue() {
    const seen = new Set();
    const nextQueue = [];
    let changed = false;

    for (const name of this.queue) {
      if (!name || seen.has(name) || this.activeByName[name] || !this.isOnline(name)) {
        changed = true;
        continue;
      }
      seen.add(name);
      nextQueue.push(name);
    }

    if (changed) this.queue = nextQueue;
    return changed;
  }

  dequeueOnline() {
    const index = this.queue.findIndex((name) => this.isOnline(name) && !this.activeByName[name]);
    if (index < 0) return null;
    const [name] = this.queue.splice(index, 1);
    QueueEntryModel.deleteOne({ name }).catch(() => {});
    return name;
  }

  activeCount(team) {
    return Object.values(this.activeByName).filter((entry) => entry.team === team).length;
  }

  activePlayerCount() {
    return Object.keys(this.activeByName).length;
  }

  getBalancedTeam(nextIndex = 0) {
    const countA = this.activeCount("A");
    const countB = this.activeCount("B");
    if (countA >= MAX_TEAM_SIZE) return "B";
    if (countB >= MAX_TEAM_SIZE) return "A";
    if (countA === countB) return nextIndex % 2 === 0 ? "A" : "B";
    return countA < countB ? "A" : "B";
  }

  spawnPositionForTeam(team) {
    const count = this.activeCount(team);
    const formation = team === "A" ? basic_formation.teamL : basic_formation.teamR;
    return formation[count % formation.length];
  }

  addActivePlayer(name, team, options = {}) {
    const connection = this.connections[name];
    if (!connection?.online) return false;
    const player = new Player(connection.sockId, Math.random() * C.Width, Math.random() * C.Height, C.playerRadius, false, name);
    player.teamName = team;
    if (options.position !== false) {
      const pos = options.position ?? this.spawnPositionForTeam(team);
      player.reset(pos.x, pos.y);
    }
    this.players[connection.sockId] = player;
    this.activeByName[name] = { sockId: connection.sockId, team };
    if (options.resetFormation !== false) this.resetFormation();
    return true;
  }

  removeActivePlayer(name, appendToQueue) {
    const active = this.activeByName[name];
    if (!active) return;
    delete this.players[active.sockId];
    delete this.activeByName[name];
    if (appendToQueue) this.enqueue(name);
    this.persistQueue();
  }

  promoteQueuedPlayer(team) {
    if (this.activeCount(team) >= MAX_TEAM_SIZE) return false;
    const index = this.queue.findIndex((name) => this.isOnline(name) && !this.activeByName[name]);
    if (index < 0) return false;
    const [name] = this.queue.splice(index, 1);
    return this.addActivePlayer(name, team, { resetFormation: false });
  }

  requeueActivePlayersToFront() {
    const activeNames = Object.keys(this.activeByName).filter((name) => this.isOnline(name));
    const remainingQueue = this.queue.filter((name) => !activeNames.includes(name));
    this.queue = [...activeNames, ...remainingQueue];
  }

  transitionToWaitingState() {
    this.players = {};
    this.activeByName = {};
    this.ball.reset();
    this.ballHolder = null;
    this.lastShooterId = null;
    this.kickoffPlayerId = null;
    this.scoreA = 0;
    this.scoreB = 0;
    this.resetMatchClock();
    this.status = this.unlocked ? STATUS.WAITING : STATUS.LOCKED;
    this.persistQueue();
    this.broadcastState();
  }

  handleActiveDeparture(team) {
    if (![STATUS.COUNTDOWN, STATUS.PLAYING, STATUS.GOLDEN_GOAL, STATUS.PAUSED].includes(this.status)) {
      this.persistQueue();
      this.broadcastState();
      return;
    }

    if (team) this.promoteQueuedPlayer(team);
    this.persistQueue();

    if (this.activePlayerCount() < MIN_PLAYERS) {
      this.clearScheduledTransitions();
      this.requeueActivePlayersToFront();
      this.transitionToWaitingState();
      return;
    }

    this.broadcastState();
  }

  resetFormation(startTeam = "B") {
    this.ball.reset();
    this.ballHolder = null;
    this.lastShooterId = null;
    this.kickoffPlayerId = null;
    let startPlayer = 0;
    let left = 0;
    let right = 0;
    for (const player of Object.values(this.players)) {
      if (player.teamName === "A") {
        if (startTeam === "A" && startPlayer === 0) {
          player.reset(20, 10);
          this.kickoffPlayerId = player.id;
          startPlayer = 1;
        } else {
          const pos = basic_formation.teamL[left % basic_formation.teamL.length];
          player.reset(pos.x, pos.y);
          left++;
        }
      } else {
        if (startTeam === "B" && startPlayer === 0) {
          player.reset(20, 10);
          this.kickoffPlayerId = player.id;
          startPlayer = 1;
        } else {
          const pos = basic_formation.teamR[right % basic_formation.teamR.length];
          player.reset(pos.x, pos.y);
          right++;
        }
      }
    }
  }

  startNextMatch() {
    this.clearScheduledTransitions();
    if (!this.unlocked) {
      this.status = STATUS.LOCKED;
      this.broadcastState();
      return;
    }

    if (this.pruneQueue()) this.persistQueue();

    for (const name of Object.keys(this.activeByName)) {
      this.removeActivePlayer(name, true);
    }

    this.players = {};
    this.activeByName = {};
    this.scoreA = 0;
    this.scoreB = 0;
    this.resetMatchClock();

    const candidates = [];
    while (candidates.length < MAX_ACTIVE_PLAYERS) {
      const name = this.dequeueOnline();
      if (!name) break;
      candidates.push(name);
    }
    // Shuffle so teams are randomized each match
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    let picked = 0;
    for (const name of candidates) {
      const team = this.getBalancedTeam(picked);
      if (this.addActivePlayer(name, team, { resetFormation: false })) picked++;
    }

    if (picked < MIN_PLAYERS) {
      this.requeueActivePlayersToFront();
      this.transitionToWaitingState();
      return;
    }

    this.resetFormation();
    this.persistQueue();
    this.status = STATUS.COUNTDOWN;
    this.broadcastState();
    this.io()?.in(ARENA_ROOM).emit("countDown", C.countDown);
    this.countdownTimeoutId = setTimeout(() => {
      if (this.status !== STATUS.COUNTDOWN) return;
      if (this.activePlayerCount() < MIN_PLAYERS) {
        this.requeueActivePlayersToFront();
        this.transitionToWaitingState();
        return;
      }
      this.status = STATUS.PLAYING;
      this.startMatchClock();
      this.broadcastState();
    }, C.countDown);
  }

  unlock() {
    this.clearScheduledTransitions();
    this.unlocked = true;
    if (this.status === STATUS.LOCKED) this.status = STATUS.WAITING;
    this.startNextMatch();
  }

  lock() {
    this.clearScheduledTransitions();
    this.unlocked = false;
    for (const name of Object.keys(this.activeByName)) {
      this.removeActivePlayer(name, true);
    }
    this.players = {};
    this.activeByName = {};
    this.ball.reset();
    this.ballHolder = null;
    this.lastShooterId = null;
    this.kickoffPlayerId = null;
    this.scoreA = 0;
    this.scoreB = 0;
    this.resetMatchClock();
    this.status = STATUS.LOCKED;
    this.persistQueue();
    this.broadcastState();
  }

  pause() {
    if ([STATUS.PLAYING, STATUS.GOLDEN_GOAL].includes(this.status)) {
      this.pausedFromStatus = this.status;
      this.pauseMatchClock();
      this.status = STATUS.PAUSED;
      this.broadcastState();
    }
  }

  resume() {
    if (!this.unlocked || this.status !== STATUS.PAUSED) return;
    if (this.activePlayerCount() < MIN_PLAYERS) {
      this.requeueActivePlayersToFront();
      this.transitionToWaitingState();
      return;
    }
    this.status = this.pausedFromStatus === STATUS.GOLDEN_GOAL ? STATUS.GOLDEN_GOAL : STATUS.PLAYING;
    this.pausedFromStatus = null;
    if (this.status === STATUS.PLAYING) this.startMatchClock();
    this.broadcastState();
  }

  async finishMatch(winnerTeam) {
    if (this.finishing) return;
    this.clearScheduledTransitions();
    this.finishing = true;
    const activeNames = Object.keys(this.activeByName);
    const winnerNames = activeNames.filter((name) => this.activeByName[name].team === winnerTeam);
    if (winnerTeam) {
      PlayerProfileModel.updateMany(
        { name: { $in: winnerNames } },
        { $inc: { points: 2, wins: 1, matches: 1 }, $set: { lastSeen: new Date() } }
      ).catch((err) => console.log("Arena finishMatch winner update failed:", err.message));
      const loserNames = activeNames.filter((name) => this.activeByName[name].team !== winnerTeam);
      if (loserNames.length) {
        PlayerProfileModel.updateMany(
          { name: { $in: loserNames } },
          { $inc: { matches: 1 }, $set: { lastSeen: new Date() } }
        ).catch((err) => console.log("Arena finishMatch loser update failed:", err.message));
      }
    } else if (activeNames.length) {
      PlayerProfileModel.updateMany(
        { name: { $in: activeNames } },
        { $inc: { matches: 1 }, $set: { lastSeen: new Date() } }
      ).catch((err) => console.log("Arena finishMatch draw update failed:", err.message));
    }

    this.status = STATUS.BETWEEN_MATCH;
    this.resetMatchClock(0);
    this.broadcastState();
    this.nextMatchTimeoutId = setTimeout(() => {
      this.finishing = false;
      this.startNextMatch();
    }, 3500);
  }

  handleTimer() {
    if (this.status !== STATUS.PLAYING || !this.matchEndsAt) return;
    if (Date.now() < this.matchEndsAt) return;
    if (this.scoreA === this.scoreB) {
      this.status = STATUS.GOLDEN_GOAL;
      this.matchEndsAt = null;
      this.matchRemainingMs = 0;
      return;
    }
    this.finishMatch(this.scoreA > this.scoreB ? "A" : "B");
  }

  shoot(mouse, id) {
    if (![STATUS.PLAYING, STATUS.GOLDEN_GOAL].includes(this.status)) return;
    const player = this.players[id];
    if (!player) return;
    player.thetaHandler(mouse.x, mouse.y);
    if (!this.ball.isCollide(player)) return;
    if (this.kickoffPlayerId !== null && this.kickoffPlayerId === id) this.kickoffPlayerId = null;
    const theta = player.theta;
    const radSum = 1 + C.playerRadius + C.ballBigRadius;
    this.ball.x = player.x + Math.cos(theta) * radSum;
    this.ball.y = player.y + Math.sin(theta) * radSum;
    this.ball.vx = player.vx + Math.cos(theta) * C.shootSpeed;
    this.ball.vy = player.vy + Math.sin(theta) * C.shootSpeed;
    this.lastShooterId = id;
    this.io()?.in(ARENA_ROOM).emit("play-sound", "kick");
  }

  ballUpdate() {
    let newHolder = null;
    for (const key in this.players) {
      const collides = this.ball.isCollide(this.players[key]);
      this.players[key].hasBall = false;
      if (collides) {
        if (newHolder == null) newHolder = key;
        else {
          newHolder = null;
          break;
        }
      }
    }

    let isGoal = false;
    if (!newHolder) {
      this.ball.update();
      isGoal = this.ball.wallCollide(C.wall_e_ball);
    } else {
      this.ball.updateFollow(this.players[newHolder]);
      isGoal = this.ball.wallCollide(C.wall_e_ball / 9);
    }
    if (newHolder) this.players[newHolder].hasBall = true;

    if (newHolder !== this.ballHolder) {
      if (this.ballHolder && this.players[this.ballHolder]) {
        this.players[this.ballHolder].multiplyAcc(1 / C.playerAccFac);
      }
      if (newHolder && this.players[newHolder]) {
        this.players[newHolder].multiplyAcc(C.playerAccFac);
      }
    }

    if (isGoal) this.handleGoal(isGoal);
    this.ballHolder = newHolder;
  }

  async handleGoal(goalSide) {
    if (![STATUS.PLAYING, STATUS.GOLDEN_GOAL].includes(this.status)) return;
    const scoringTeam = goalSide === "A" ? "B" : "A";
    if (scoringTeam === "A") this.scoreA++;
    else this.scoreB++;
    const matchIsOver = this.scoreA >= GOAL_TARGET || this.scoreB >= GOAL_TARGET || this.status === STATUS.GOLDEN_GOAL;
    if (!matchIsOver) this.pauseMatchClock();
    this.status = matchIsOver ? STATUS.BETWEEN_MATCH : STATUS.COUNTDOWN;

    // Award points to everyone on the scoring team
    const scoringTeamNames = Object.entries(this.activeByName)
      .filter(([, data]) => data.team === scoringTeam)
      .map(([name]) => name);
    if (scoringTeamNames.length) {
      PlayerProfileModel.updateMany(
        { name: { $in: scoringTeamNames } },
        { $inc: { points: 5 }, $set: { lastSeen: new Date() } }
      ).catch((err) => console.log("Arena goal team update failed:", err.message));
    }
    // Award goal stat only to the actual scorer
    const scorer = this.players[this.lastShooterId];
    if (scorer?.teamName === scoringTeam) {
      PlayerProfileModel.updateOne(
        { name: scorer.username },
        { $inc: { goals: 1 }, $set: { lastSeen: new Date() } },
        { upsert: true }
      ).catch((err) => console.log("Arena goal scorer update failed:", err.message));
    }

    this.io()?.in(ARENA_ROOM).emit("score", { scoreA: this.scoreA, scoreB: this.scoreB });
    this.io()?.in(ARENA_ROOM).emit("play-sound", "goal");

    if (matchIsOver) {
      this.finishMatch(scoringTeam);
      return;
    }

    this.resetFormation(goalSide);
    this.broadcastState();
    this.io()?.in(ARENA_ROOM).emit("countDown", C.countDown);
    clearTimeout(this.countdownTimeoutId);
    this.countdownTimeoutId = setTimeout(() => {
      if (this.status === STATUS.COUNTDOWN) {
        if (this.activePlayerCount() < MIN_PLAYERS) {
          this.requeueActivePlayersToFront();
          this.transitionToWaitingState();
          return;
        }
        this.status = STATUS.PLAYING;
        this.startMatchClock();
        this.broadcastState();
      }
    }, C.countDown);
  }

  update() {
    if ([STATUS.PLAYING, STATUS.GOLDEN_GOAL].includes(this.status)) this.ballUpdate();
    else {
      this.ball.update();
      this.ball.goalCollide();
    }

    const players = Object.values(this.players);
    for (const player of players) {
      if (this.kickoffPlayerId !== null) {
        player.vx = 0;
        player.vy = 0;
        player.ax = 0;
        player.ay = 0;
      } else {
        player.update();
        player.wallCollide();
      }
    }
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        players[i].collide(players[j]);
      }
    }
  }

  tackle(id) {
    if (![STATUS.PLAYING, STATUS.GOLDEN_GOAL].includes(this.status)) return;
    const p = this.players[id];
    if (!p) return;
    const dy = this.ball.y - p.y;
    const dx = this.ball.x - p.x;
    if (dx * dx + dy * dy > C.tackleDist * C.tackleDist) return;
    if (!this.ballHolder || p.hasBall || !p.canTackle) return;
    p.canTackle = false;
    setTimeout(() => p.canTackle = true, C.tackleCooldown);
    const theta = Math.atan2(dy, dx);
    p.vx = C.tackleSpeed * Math.cos(theta);
    p.vy = C.tackleSpeed * Math.sin(theta);
  }

  playerData() {
    const data = {};
    for (const [id, player] of Object.entries(this.players)) {
      data[id] = {
        ...player.getData(),
        username: player.username,
        teamName: player.teamName
      };
    }
    return data;
  }

  sendTick() {
    this.io()?.in(ARENA_ROOM).emit("game:tick", {
      playerData: this.playerData(),
      ballData: this.ball.getData()
    });
  }

  timeLeft() {
    if (this.status === STATUS.GOLDEN_GOAL) return 0;
    return Math.ceil(this.currentMatchRemainingMs() / 1000);
  }

  nextByTeam() {
    const next = { A: [], B: [] };
    let index = Object.keys(this.activeByName).length;
    for (const name of this.queue) {
      if (!this.isOnline(name)) continue;
      const team = index % 2 === 0 ? "A" : "B";
      next[team].push(name);
      index++;
      if (next.A.length >= 5 && next.B.length >= 5) break;
    }
    return next;
  }

  publicState() {
    const active = Object.entries(this.activeByName).map(([name, data]) => ({
      name,
      team: data.team,
      online: this.isOnline(name)
    }));
    return {
      status: this.status,
      unlocked: this.unlocked,
      scoreA: this.scoreA,
      scoreB: this.scoreB,
      timeLeft: this.timeLeft(),
      active,
      queue: this.queue.map((name, index) => ({ name, index: index + 1, online: this.isOnline(name) })),
      next: this.nextByTeam(),
      chat: this.chatMessages.slice(-CHAT_LIMIT),
      maxTeamSize: MAX_TEAM_SIZE,
      goalTarget: GOAL_TARGET,
      matchSeconds: MATCH_SECONDS
    };
  }

  playerRole(name) {
    if (!name) return "spectator";
    if (this.activeByName[name]) return "player";
    if (this.queue.includes(name)) return "queued";
    return "spectator";
  }

  emitState(sock, state = null) {
    if (!state) {
      if (this.pruneQueue()) this.persistQueue();
      state = this.publicState();
    }
    sock.emit("arena:state", {
      ...state,
      me: {
        name: sock.playerName ?? null,
        role: this.playerRole(sock.playerName),
        socketId: sock.id
      }
    });
  }

  broadcastState() {
    const io = this.io();
    if (!io) return;
    if (this.pruneQueue()) this.persistQueue();
    const state = this.publicState();
    for (const sock of io.sockets.sockets.values()) {
      if (sock.rooms.has(ARENA_ROOM)) {
        sock.emit("arena:state", {
          ...state,
          me: {
            name: sock.playerName ?? null,
            role: this.playerRole(sock.playerName),
            socketId: sock.id
          }
        });
      }
    }
  }

  async ranking() {
    return PlayerProfileModel.find().sort({ points: -1, goals: -1, wins: -1, name: 1 }).limit(100).lean();
  }

  async adminState() {
    if (this.pruneQueue()) this.persistQueue();
    return {
      ...this.publicState(),
      ranking: await this.ranking()
    };
  }

  async ensureProfile(name) {
    await PlayerProfileModel.updateOne(
      { name },
      { $setOnInsert: { name }, $set: { lastSeen: new Date() } },
      { upsert: true }
    );
  }

  async resetRanking() {
    await PlayerProfileModel.updateMany({}, { points: 0, goals: 0, wins: 0, matches: 0 });
  }

  clearQueue() {
    this.clearScheduledTransitions();
    this.queue = [];
    QueueEntryModel.deleteMany({}).catch(() => {});
    this.status = this.unlocked ? STATUS.WAITING : STATUS.LOCKED;
    this.players = {};
    this.activeByName = {};
    this.ball.reset();
    this.ballHolder = null;
    this.lastShooterId = null;
    this.kickoffPlayerId = null;
    this.scoreA = 0;
    this.scoreB = 0;
    this.resetMatchClock();
    this.broadcastState();
  }

  clearChat() {
    this.chatMessages = [];
    this.io()?.in(ARENA_ROOM).emit("chat:cleared");
    this.broadcastState();
  }

  removePlayer(name) {
    const cleaned = this.cleanName(name);
    const active = this.activeByName[cleaned];
    this.removeFromQueue(cleaned);
    if (active) this.removeActivePlayer(cleaned, false);
    const connection = this.connections[cleaned];
    delete this.connections[cleaned];
    const sock = connection?.sockId ? this.io()?.sockets.sockets.get(connection.sockId) : null;
    if (sock) {
      sock.playerName = null;
      sock.disconnect(true);
    }
    QueueEntryModel.deleteOne({ name: cleaned }).catch(() => {});
    if (active) {
      this.handleActiveDeparture(active.team);
      return;
    }
    this.persistQueue();
    this.broadcastState();
  }

  resetGame() {
    this.clearScheduledTransitions();
    for (const name of Object.keys(this.activeByName)) this.removeActivePlayer(name, true);
    this.players = {};
    this.activeByName = {};
    this.ball.reset();
    this.ballHolder = null;
    this.lastShooterId = null;
    this.kickoffPlayerId = null;
    this.scoreA = 0;
    this.scoreB = 0;
    this.resetMatchClock();
    this.status = this.unlocked ? STATUS.WAITING : STATUS.LOCKED;
    this.persistQueue();
    this.broadcastState();
  }

  chat(sock, text) {
    const message = String(text ?? "").trim().substring(0, 220);
    if (!message || !sock.playerName) return;
    const payload = {
      name: sock.playerName,
      text: message,
      at: new Date().toISOString()
    };
    this.chatMessages.push(payload);
    this.chatMessages = this.chatMessages.slice(-CHAT_LIMIT);
    this.io()?.in(ARENA_ROOM).emit("chat:message", payload);
    this.broadcastState();
  }
}

module.exports = { Arena, STATUS };
