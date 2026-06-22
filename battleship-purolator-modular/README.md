# Purolator Driver Battle League (Battleship)

A real-time, two-player Battleship game themed as a Purolator logistics
"driver battle league." Players place a fleet of delivery vehicles on a
grid and take turns firing at their opponent's board.

## Running locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`. Open it in two browser tabs (or share
the room code with someone else) to play a match.

## Project structure

```
server/
  index.js              # entrypoint: wires everything together, starts the HTTP/socket server
  src/
    constants.js         # ships, board size limits, timeouts
    validation.js        # input sanitizing/validation helpers
    leaderboard.js        # leaderboard, aggregated by player name
    roomManager.js        # in-memory room store + lifecycle helpers
    roomCloser.js         # shared "delete room + notify players" helper
    handlers/
      roomLifecycle.js     # create_room, join_room, set_board_dim, disconnect
      gameplay.js          # place_ships, fire, request_rematch

public/
  index.html             # page markup
  css/styles.css          # all styling
  js/
    config.js             # static config (airport codes, board size options)
    state.js              # shared client-side state
    utils.js              # DOM/formatting helpers
    grid.js               # board rendering
    settings.js           # display settings panel
    socketClient.js        # socket connection + leaderboard rendering
    lobby.js              # create/join room screens
    placement.js          # fleet placement screen + board resizing
    game.js               # battle screen, firing, game over, rematch
    main.js               # app init

docs/
  teams-integration.md   # notes on a possible Teams-based random match feature

test/
  unit-flow.js           # full game flow + leaderboard aggregation test
  board-dim-test.js      # 8x8 board validation test
  small-board-test.js    # minimum board size (6x6) fits all ships
  board-confirm-test.js  # board-size propose/accept/decline handshake test
```

## Tests

```bash
npm test
```

Runs a set of in-process tests (no real network needed) covering a full
game + rematch flow, leaderboard aggregation by player name, and the
configurable board size feature.

## Features

- **Real-time multiplayer** over Socket.IO, with reconnect handling.
- **Configurable board size** (anywhere from 6x6 to 15x15) — either player
  can propose a new size on the Fleet Setup screen. The other player gets
  an accept/decline prompt; the board only resizes if they confirm. This
  is locked once someone has placed their fleet.
- **Leaderboard aggregated by player name** — if the same callsign plays
  multiple matches (e.g. requesting a rematch), their wins, losses, shots
  and accuracy accumulate into a single row instead of creating duplicate
  entries.
- **Package-tracking sidebar** that logs every shot as a "delivery event"
  using Canadian airport codes for grid coordinates.
- Display settings for grid size, font scale, toasts, animations, and
  ship health bars.
