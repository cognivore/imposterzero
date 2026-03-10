# Imposter Kings

A browser-based card game of deception and strategy. Features tournament drafting, expansion armies, and competitive 2–4 player matches.

## Prerequisites

- [Nix](https://nixos.org/download.html) with flakes enabled
- [direnv](https://direnv.net/) (optional, for automatic shell activation)
- [Caddy](https://caddyserver.com/) at `~/Caddy` (for local HTTPS, managed by the `install-service` script)

All compilers, linters, and runtime dependencies are provisioned via the Nix flake — no manual `npm install` needed outside of `pnpm install`.

## Quick Start (Development)

```bash
# Enter the Nix dev shell
nix develop

# Install dependencies
pnpm install --frozen-lockfile

# Build all packages (types → engine → server → web)
pnpm build

# Start the game server (port 30588)
node packages/server/dist/serve.js &

# Start the web dev server (port 5173, hot-reload)
pnpm --filter @imposter-zero/web dev
```

Open `http://localhost:5173` in your browser.

## Local Deployment (imposterzero.localhost)

The `install-service` script manages a macOS LaunchAgent that runs the game server on boot and registers a Caddy reverse-proxy site for `https://imposterzero.localhost`.

```bash
# First-time setup: build, install LaunchAgent, register Caddy site
./install-service install

# Rebuild and redeploy after code changes
./install-service build && ./install-service restart

# Check status
./install-service status

# View logs
./install-service logs        # last 50 lines
./install-service follow      # tail -f

# Stop and remove everything
./install-service uninstall
```

### What `install-service` does

| Command     | Effect |
|-------------|--------|
| `install`   | Builds server + web frontend (`WS_URL=wss://imposterzero.localhost`), generates a LaunchAgent plist, generates a Caddy site config at `~/Caddy/sites/imposterzero.Caddyfile`, loads the service, reloads Caddy. |
| `build`     | Runs `pnpm build` (TypeScript) + `vite build` (web bundle with production WS URL). Does not restart. |
| `restart`   | Unloads/reloads the LaunchAgent. Use after `build` to pick up new code. |
| `status`    | Shows PID, health check (HTTP 426 = WS healthy), Caddy proxy status, URLs. |
| `uninstall` | Stops the server, removes the LaunchAgent plist and Caddy site config. |

### Redeployment cheat-sheet

After making code changes:

```bash
./install-service build && ./install-service restart
```

This rebuilds everything and restarts the server. Caddy serves the new static files from `packages/web/dist/` immediately — no Caddy reload needed.

## Running Tests

```bash
# Unit + integration tests (vitest)
pnpm test

# Server e2e tests only
npx vitest run packages/server/src/__tests__/ --pool=forks

# Browser e2e tests (Playwright, headless Chromium)
pnpm test:e2e

# Browser tests with visible browser
npx playwright test --project=chromium --headed

# Browser tests with slow-motion (useful for debugging)
npx playwright test --project=chromium --headed --slow-mo=500
```

Playwright tests automatically start a game server (port 30590) and Vite dev server (port 5174) via `playwright.config.ts`.

## Project Structure

```
packages/
  types/     Protocol types, events, result monad
  engine/    Game rules, card effects, draft state machine, scoring
  server/    WebSocket server, room management, bot AI, session handling
  web/       React client (Vite), desktop + mobile tabletop layouts
  client/    CLI/test client utilities
e2e/         Playwright browser tests
training/    Bot policy training scripts (Python)
```

## Architecture

- **Engine**: Pure functional game logic. State transitions via `apply(state, action)`. No side effects. Property-tested with fast-check.
- **Server**: WebSocket server (`ws` library) with room management, turn timers, and bot AI. Expansion draft uses the engine's `DraftState` machine.
- **Web Client**: React + Zustand. Desktop uses a 3-column grid (`TabletopLayout`). Mobile (≤960px) uses a compact single-column layout (`MobileTabletop`) with sliding drawer and player zone modals.
- **Protocol**: Typed `ClientMessage` / `ServerMessage` unions in `packages/types`. Draft messages include per-player views computed server-side.
