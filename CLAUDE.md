# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Street Soccer Multiplayer** ([TRE] Futzin dos Treinadores) is a real-time multiplayer soccer game where players join a queue, get automatically assigned to balanced teams, and play matches. The app uses WebSocket for live game synchronization and includes an admin panel for match control.

**Type:** Fullstack web application (Node.js backend, vanilla JavaScript frontend)
**Key Features:** Real-time multiplayer, physics-based ball mechanics, player queue system, admin controls, persistent player rankings

## Getting Started

### Installation & Setup
```bash
npm install                 # Install dependencies
```

### Environment Variables
Create a `.env` file in the root with:
```
PORT=8000                   # Server port (default: 8000)
DBPASS=<mongodb_connection_string>  # MongoDB connection URL (required)
DBROUTE=/users             # API endpoint for user data (default: /users)
COOKIE_SECURE=1            # Set to 1 for HTTPS environments
```

### Running the Application
```bash
npm run dev                 # Development mode with nodemon (watches for changes)
npm start                   # Production mode
```

The server starts on the configured PORT and serves:
- **Frontend:** `/` (welcome page) → `/play` (game page)
- **WebSocket:** Connected via Socket.io for real-time game updates
- **Admin Panel:** `/admin` (requires login with hardcoded credentials from server.js)

## Architecture

### Overall Design Pattern
**Single-instance server architecture:** The entire game runs on one Node.js server with a single "Arena" instance managing all players and matches. No separate game rooms per match—all players in a single global arena that rotates through queuing, countdown, and active play phases.

### Data Flow

**Client → Server (WebSocket Events)**
- Player joins arena: `player:join` → Arena queues player
- Input: `input:key`, `input:mouse`, `input:joystick`, `input:shoot`, `input:tackle`
- Chat: `chat:send`

**Server → Client (WebSocket Events)**
- Arena state broadcast: `arena:state` (queue, active players, match status)
- Game tick: `game:tick` (player/ball positions at ~16ms intervals, 60 FPS)
- State changes: `join:accepted`, `join:error`, `countDown`, `timeLeft`, `score`, `play-sound`

### Server Architecture

#### Core Server Files

**server.js**
- Express app setup, static file serving, MongoDB connection
- Routes: welcome page (`/`), game page (`/play`), admin endpoints (`/admin/*`)
- Initializes global Arena instance and starts it with `arena.run()`

**arena.js** (~600 lines)
- **Single central orchestrator** managing all game logic, player queue, team assignment, and match flow
- **State machine with 7 states:**
  - `LOCKED`: Waiting for admin unlock
  - `WAITING`: Queue exists, ready for next match
  - `COUNTDOWN`: Countdown before match starts (3-2-1-Go)
  - `PLAYING`: Active match in progress
  - `GOLDEN_GOAL`: First team to score after time expires wins (sudden death)
  - `PAUSED`: Match paused by admin
  - `BETWEEN_MATCH`: Results display before next match
- **Key responsibilities:**
  - Queue management: `enqueue()`, `dequeueOnline()`, `pruneQueue()`
  - Active player management: `addActivePlayer()`, `removeActivePlayer()`
  - Team balancing: `getBalancedTeam()` assigns 2 teams of max 5 players each
  - Match lifecycle: `startNextMatch()`, `finishMatch()`, `pauseMatch()`, `resume()`
  - Timer management: Match clock (180 seconds default), countdown (3 seconds)
  - Broadcasting: `broadcastState()` updates all clients every 1 second with arena state
  - Database: Persists queue to MongoDB via `persistQueue()`
- **Update loop:** Two intervals
  - `16ms interval` (60 FPS): `update()` → `sendTick()` (physics + game tick)
  - `1000ms interval`: `handleTimer()` → `broadcastState()` (time updates + state sync)

**player.js** (~240 lines)
- Server-side Player class extending Entity (physics base)
- Handles movement input (`moveHandler`, `joystickHandler`)
- Stores shot direction (`thetaHandler`)
- Ball possession logic via collision detection
- Serialization: `getData()` (physics state), `getInitData()` (team/name)

**ball.js** (~180 lines)
- Server-side Ball class extending Entity
- Physics: velocity, acceleration, friction (0.96)
- Collision detection with players and arena walls
- Goal detection logic for both team courts (left/right)
- Ball follows player when held (smooth possession)
- Goal pole collision handling

**websocket.js** (~70 lines)
- Socket.io connection handler
- Delegates all events to Arena methods
- Routes input events (`input:key`, `input:shoot`, etc.) to arena

**User.js** (~110 lines)
- MongoDB schemas: User (visitor tracking), PlayerProfile (ranking stats), QueueEntry (queue persistence)
- Models: `UserModel`, `VisitModel`, `PlayerProfileModel`, `QueueEntryModel`

**utils.js** (~75 lines)
- `nanoid()`: Generates short random IDs
- `logip()`: Tracks visitor IPs and user agents in MongoDB

### Client Architecture

**File Structure**
```
client/
  game/
    index.js          # Main entry point, p5.js setup, socket listeners
    cgame.js          # Client-side Game class (syncs server state)
    cplayer.js        # Client-side Player class (rendering + animations)
    cball.js          # Client-side Ball class (rendering)
    field.js          # Arena field rendering
    helper.js         # Rendering utilities, chat, scoreboard, UI
    game.ejs          # Game HTML template
    *.css             # Canvas styling
  welcome/
    welcome.html      # Welcome/login page
    welcome.js        # Player name input, navigation
  homescreen/
    addtohomescreen.js # PWA installation prompts
  constants.js        # Shared game constants (field size, speeds, formations)
  service-worker.js   # PWA offline support
  manifest.json       # PWA manifest
  style.css           # Global styles
```

#### Game Rendering Pipeline (Client)

**index.js** (main game loop)
- Uses p5.js for 2D canvas rendering
- Initializes Socket.io connection, loads assets (player sprites, sounds)
- `onsock()`: Registers WebSocket listeners
- Frame loop:
  1. Receives `game:tick` event from server (16ms, 60 FPS)
  2. `cgame.updateClient()` syncs player/ball data from server
  3. `display()` renders field + players + ball on canvas
  4. Input handlers emit to server: `input:key`, `input:mouse`, `input:joystick`, `input:shoot`
- Camera scaling for responsive viewport

**Arena State Synchronization**
- `arena:state` event fires every 1 second (not tied to physics loop)
- Contains: queue list, active players, match status, countdown, rankings
- Updates lobby UI: queue position, team assignment, countdown display

**Player Rendering**
- cplayer.js handles sprite animations based on movement direction (12 directional poses)
- Ball indicator shows which player has possession
- Name tag and color-coded circles for team identification
- Highlight effect when player holds the ball

**Constants** (client/constants.js)
- Field dimensions: 1000×600px
- Goal dimensions: 100px height, 50px width per side
- Player physics: radius 12px, acceleration 0.3, friction 0.9
- Ball physics: radius 10px, collision radius 15px (bigger hitbox for easier possession)
- Game timing: 180 seconds (3 minutes) per match, 3-second countdown
- Formations: Pre-defined spawning positions for both teams (up to 7 players per side)

### Physics System

Shared by both server and client (via Entity base class in both):

**Movement Model**
- Acceleration-based with friction dampening
- `update()`: x += vx, vx += ax, vx *= friction (0.9 for players, 0.96 for ball)
- Keyboard input maps to acceleration (WASD keys)
- Joystick input provides continuous acceleration in any direction

**Collision Detection**
- Player-to-player: Elastic collision impulse transfer
- Player-to-ball: Ball follows player when in collision radius (15px)
- Ball-to-wall: Bounce with configurable elasticity
- Goal detection: Ball crosses goal line → score and reset

**Ball Possession Mechanics**
- When ball enters player's collision radius AND player is closest (no other player closer):
  - Ball "follows" player at fixed distance + angle
  - Player acceleration is reduced by factor (0.7) when holding ball
  - Shot angle determined by mouse/aim direction
  - Speed determined by player velocity + shoot speed constant (9 units)

### Admin Panel

**Location:** `/admin` (requires cookie-based session or HTTP Basic Auth)

**Credentials:** Hardcoded in server.js
```javascript
const ADMIN_USER = 'Treinadores';
const ADMIN_PASS = 'tremelhorcia';
```

**Admin Controls** (via POST to `/admin/api/<action>`)
- `unlock`: Enable arena transitions (move from LOCKED to WAITING)
- `lock`: Pause arena, prevent new matches
- `start`: Manually start next match
- `pause` / `resume`: Pause/resume current match
- `end`: Force finish current match
- `reset-game`: Clear all players and scores
- `reset-ranking`: Clear player statistics
- `clear-queue`: Empty the waiting queue
- `clear-chat`: Clear chat messages
- `remove-player`: Kick player by name

**State API:** GET `/admin/api/state` returns full arena state for dashboard display

## Match Flow

1. **Queue Phase (WAITING)**
   - Players join via `player:join` WebSocket event
   - Added to `arena.queue` (FIFO)
   - When 2+ players online: auto-transition to COUNTDOWN (if unlocked)

2. **Countdown (COUNTDOWN)**
   - 3-second countdown displayed to all players
   - Match starts automatically after countdown

3. **Active Play (PLAYING)**
   - Physics loop updates 60 FPS (16ms ticks)
   - Players move, pass, shoot; ball physics resolved
   - Match ends when timer reaches 0

4. **Golden Goal (GOLDEN_GOAL)**
   - If score is tied at match end, play sudden death
   - First goal wins the match
   - Returns to WAITING after winner determined

5. **Between Match (BETWEEN_MATCH)**
   - Brief pause for results display
   - Returning match players auto-promoted to next match

6. **Back to WAITING**
   - Active players move to front of queue if they want to play again
   - New match starts with new or returning players

## Key Design Decisions

### Why Single Arena Instance
- Simpler state management (no per-room complexity)
- Centralized queue for fair turn-taking
- Shared leaderboard/rankings across all players
- All players see the same tournament bracket simultaneously

### Physics on Server
- Server-authoritative: All physics calculations happen server-side to prevent cheating
- Clients receive authoritative state and render locally
- 60 FPS server loop ensures smooth, consistent simulation

### Ball Possession Model
- When ball is held by player: ball position locked to player (not physics-driven)
- This simplifies: no complex friction, predictable passing, easier skill ceiling
- Release mechanism: shoot action applies velocity based on aim + speed

### Team Balancing
- Automatic assignment on match start: tries to split players 50/50
- Does not account for skill (no ELO/ratings yet)
- Mid-match departures: queue moves to fill gaps

## Performance Notes

- **Frame Rate:** Server targets 60 FPS (16ms tick), clients render at display refresh rate
- **Broadcast:** Arena state sent every 1 second (not tied to physics loop)
- **Player Limit:** Max 10 active players per match (5 per team); queue scales to N players
- **Physics Bottleneck:** O(n²) player-to-player collision checks; acceptable for n≤10

## Dependencies & Stack

**Backend:**
- Express 4.17: Web server
- Socket.io 4.1: WebSocket real-time communication
- Mongoose 6.0: MongoDB object modeling
- EJS: Server-side templating

**Frontend:**
- p5.js (CDN): 2D graphics library
- Socket.io client: WebSocket client
- Joystick.js: Virtual joystick for mobile
- Bootstrap: UI components (admin panel)

**Database:**
- MongoDB: Player profiles, queue state, visit tracking

**Node Versions:** Works with Node 12+; tested with Node 14+

