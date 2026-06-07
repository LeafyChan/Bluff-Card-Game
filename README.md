# 🃏 Cheat / Bullshit — Online Multiplayer Card Game

A real-time multiplayer card game built with Node.js, Express, and Socket.io.

## Run locally

```bash
npm install
npm start
# Open http://localhost:3000 in multiple browser tabs to test
```

For development with auto-restart:
```bash
npm run dev
```

---

## Deploy for FREE (online, anyone can play)

### Step 1 — Push to GitHub

1. Create a free account at https://github.com
2. Create a new repository called `cheat-card-game`
3. In your project folder, run:

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/cheat-card-game.git
git push -u origin main
```

---

### Step 2 — Deploy backend to Render (free)

1. Go to https://render.com and sign up (free, no credit card)
2. Click **New → Web Service**
3. Connect your GitHub repo
4. Fill in these settings:
   - **Name**: cheat-card-game
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
5. Click **Deploy**
6. Wait ~2 minutes. You'll get a URL like `https://cheat-card-game.onrender.com`

> ⚠️ Free Render services sleep after 15 min of inactivity. First load may take ~30 seconds to wake up.

---

### Step 3 — Play!

Share your Render URL with friends. Everyone opens it in their browser, uses the same room code, and plays in real-time.

---

## How to play

1. One player creates a room, shares the 4-letter code
2. Others join with the same code
3. First player hits **Start Game** (need 2+ players)
4. On your turn: select cards from your hand → pick a rank → Play
5. The next player can **Call Bluff** before playing
6. First to empty their hand wins (but final play can still be challenged!)

## File structure

```
cheat-card-game/
├── server/
│   └── index.js        ← Node.js + Socket.io game server
├── client/
│   └── public/
│       └── index.html  ← Full frontend (single file)
├── package.json
└── README.md
```
