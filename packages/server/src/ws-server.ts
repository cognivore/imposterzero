import { randomBytes } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { GameDef, PlayerId, ReplaySink } from "@imposter-zero/types";
import type { IKState, IKAction } from "@imposter-zero/engine";
import {
  type PlayingRoom,
  type ScoringRoom,
  type FinishedRoom,
  type OutboundMessage,
  roomTransition,
  continueAfterScoring,
} from "./room.js";
import { ConnectionRegistry, type RegistryEntry } from "./connection-registry.js";
import {
  type BotStrategy,
  type MatchContext,
  RandomStrategy,
  addBot,
  isBot,
  botDisplayName,
  rankSignatureCard,
} from "./bot-player.js";
import {
  type ManagedRoom,
  type RoomStore,
  emptyStore,
  createManagedRoom,
  findRoomOfPlayer,
  addPlayerToRoom,
  removePlayerFromRoom,
  playersInRoom,
  browsersOnly,
  destroyRoom,
  listRoomSummaries,
  pruneEmptyRooms,
  updateManagedRoomTargetScore,
  updateManagedRoomExpansion,
  updateManagedRoomTournament,
} from "./room-manager.js";
import { draftStateToView, perPlayerDraftMessages } from "./room.js";
import type { DraftingRoom } from "./room.js";
import { createReplayRecorder, nullRecorder, type ReplayRecorder } from "./replay-recorder.js";
import { fileReplaySink } from "./replay-writer.js";

export interface ServerOptions {
  readonly port?: number;
  readonly targetScore?: number;
  readonly turnDuration?: number;
  readonly autoAdvanceScoring?: boolean;
  readonly reconnectWindowMs?: number;
  readonly botDelayMs?: number;
  readonly botStrategy?: BotStrategy;
  readonly replayDir?: string;
  readonly botModelName?: string;
}

export interface ServerHandle {
  readonly port: number;
  readonly ready: Promise<void>;
  readonly close: () => Promise<void>;
}

type AnyMessage = OutboundMessage | { readonly type: string; [k: string]: unknown };

const sendJson = (ws: WebSocket, msg: AnyMessage): void => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
};

export const startServer = (
  game: GameDef<IKState, IKAction>,
  options: ServerOptions = {},
): ServerHandle => {
  const {
    port = 0,
    turnDuration = 30_000,
    autoAdvanceScoring = true,
    reconnectWindowMs = 60_000,
    botDelayMs = 250,
    botStrategy = RandomStrategy,
    replayDir,
    botModelName = "Bot",
  } = options;

  const store: RoomStore = emptyStore();
  const registry = new ConnectionRegistry({ reconnectWindowMs });

  const wss = new WebSocketServer({ port });

  const readyPromise = new Promise<void>((resolve) => {
    wss.on("listening", resolve);
  });

  const actualPort = (): number =>
    (wss.address() as { port: number }).port;

  // ---- Helpers: send to groups ----

  const wsForPlayer = (playerId: string): WebSocket | null => {
    const entry = registry.findByPlayerId(playerId);
    return entry?.ws ?? null;
  };

  const broadcastToRoom = (managed: ManagedRoom, messages: ReadonlyArray<OutboundMessage>): void => {
    const pids = playersInRoom(store, managed.id);
    for (const msg of messages) {
      const data = JSON.stringify(msg);
      for (const pid of pids) {
        const ws = wsForPlayer(pid);
        if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(data);
      }
    }
  };

  const broadcastDraftState = (managed: ManagedRoom): void => {
    if (managed.room.phase !== "drafting") return;
    const drafting = managed.room as DraftingRoom;
    const msgs = perPlayerDraftMessages(drafting);
    const pids = playersInRoom(store, managed.id);
    for (let i = 0; i < drafting.lobby.players.length; i++) {
      const playerName = drafting.lobby.players[i]!.id;
      const entry = registry.allConnected().find((e) => e.name === playerName);
      if (!entry) continue;
      const pid = entry.playerId;
      if (!pids.includes(pid)) continue;
      const ws = wsForPlayer(pid);
      if (ws !== null && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msgs[i]));
      }
    }
  };

  const sendRoomListTo = (ws: WebSocket): void => {
    sendJson(ws, { type: "room_list", rooms: listRoomSummaries(store) });
  };

  const broadcastRoomListToBrowsers = (): void => {
    const allPids = registry.allConnected().map((e) => e.playerId);
    const browserPids = browsersOnly(store, allPids);
    const msg = JSON.stringify({ type: "room_list", rooms: listRoomSummaries(store) });
    for (const pid of browserPids) {
      const ws = wsForPlayer(pid);
      if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  };

  // ---- Replay recording ----

  const makeRoomRecorder = (): ReplayRecorder<IKState, IKAction> =>
    replayDir
      ? createReplayRecorder(fileReplaySink<IKState, IKAction>(replayDir))
      : nullRecorder as ReplayRecorder<IKState, IKAction>;

  const recordLifecycle = (m: ManagedRoom, messages: ReadonlyArray<OutboundMessage>, now: number): void => {
    const rec = m.replayRecorder;
    for (const msg of messages) {
      if (msg.type === "game_start" && m.room.phase === "playing") {
        const playing = m.room as PlayingRoom;
        const round = playing.match.roundsPlayed + 1;
        if (round === 1) {
          rec.startMatch({
            matchId: `${m.id}-${randomBytes(4).toString("hex")}`,
            roomId: m.id,
            playerNames: playing.lobby.players.map((p) => p.id),
            numPlayers: playing.lobby.players.length,
            targetScore: m.targetScore,
            startedAt: now,
          });
        }
        rec.startRound(round, playing.session.state, now);
      }
      if (msg.type === "round_over") {
        rec.endRound(msg.roundsPlayed, msg.state, msg.scores, msg.matchScores, now);
      }
      if (msg.type === "match_over") {
        rec.endMatch(msg.winners, msg.finalScores, now);
      }
    }
  };

  const playerNameForIdx = (playing: PlayingRoom, idx: PlayerId): string => {
    for (const [id, pidx] of playing.session.playerMapping) {
      if (pidx === idx) return id;
    }
    return "";
  };

  // ---- Per-room timers ----

  const clearRoomTurnTimer = (m: ManagedRoom): void => {
    if (m.turnTimer !== null) { clearTimeout(m.turnTimer); m.turnTimer = null; }
  };

  const clearRoomBotTimer = (m: ManagedRoom): void => {
    if (m.botTimer !== null) { clearTimeout(m.botTimer); m.botTimer = null; }
  };

  const clearRoomScoringTimer = (m: ManagedRoom): void => {
    if (m.scoringTimer !== null) { clearTimeout(m.scoringTimer); m.scoringTimer = null; }
  };

  const scheduleScoringTimer = (m: ManagedRoom): void => {
    clearRoomScoringTimer(m);
    if (m.room.phase !== "scoring") return;
    const scoring = m.room as ScoringRoom;
    const delay = Math.max(1, scoring.reviewDeadline - Date.now() + 1);
    m.scoringTimer = setTimeout(() => {
      if (m.room.phase !== "scoring") return;
      const now = Date.now();
      const sr = m.room as ScoringRoom;
      for (const player of sr.lobby.players) {
        if (sr.readyPlayers.has(player.id)) continue;
        const result = roomTransition(m.room, { kind: "ready", playerId: player.id, now }, now);
        if (result.ok) {
          m.room = result.value.room;
          broadcastToRoom(m, result.value.messages);
          recordLifecycle(m, result.value.messages, now);
        }
      }
      scheduleTurnTimer(m);
      scheduleBotTurn(m);
    }, delay);
  };

  const findBotByIndex = (m: ManagedRoom, playing: PlayingRoom, playerIdx: PlayerId): string | null => {
    for (const [id, idx] of playing.session.playerMapping) {
      if (idx === playerIdx && isBot(m.botRegistry, id)) return id;
    }
    return null;
  };

  const advanceIfScoring = (m: ManagedRoom, now: number): void => {
    if (m.room.phase !== "scoring") return;

    if (autoAdvanceScoring) {
      const result = continueAfterScoring(m.room as ScoringRoom, now);
      m.room = result.room;
      broadcastToRoom(m, result.messages);
      recordLifecycle(m, result.messages, now);
      return;
    }

    for (const player of m.room.lobby.players) {
      if (!isBot(m.botRegistry, player.id)) continue;
      const scoring = m.room as ScoringRoom;
      if (scoring.readyPlayers.has(player.id)) continue;
      const result = roomTransition(m.room, { kind: "ready", playerId: player.id, now }, now);
      if (result.ok) {
        m.room = result.value.room;
        broadcastToRoom(m, result.value.messages);
        recordLifecycle(m, result.value.messages, now);
      }
    }

    if (m.room.phase === "scoring") {
      scheduleScoringTimer(m);
    }
  };

  const scheduleBotDraft = (m: ManagedRoom): void => {
    for (let guard = 0; guard < 20; guard++) {
      if (m.room.phase !== "drafting") break;
      const drafting = m.room as import("./room.js").DraftingRoom;
      const ds = drafting.draftState;
      const now = Date.now();
      let acted = false;

      if (ds.phase.tag === "selection") {
        const needed = drafting.tournament ? 1 : ds.config.signaturesPerPlayer;
        const pool = ds.config.signaturePool
          .map((k) => k.name)
          .sort((a, b) => rankSignatureCard(b) - rankSignatureCard(a));
        for (const player of drafting.lobby.players) {
          if (!isBot(m.botRegistry, player.id)) continue;
          const idx = drafting.lobby.players.findIndex((p) => p.id === player.id);
          if (idx < 0 || (ds.playerSelections[idx]?.length ?? 0) >= needed) continue;
          const picks = pool.slice(0, needed);
          const result = roomTransition(m.room, { kind: "draft_select", playerId: player.id, cards: picks, now }, now);
          if (result.ok) { m.room = result.value.room; broadcastDraftState(m); broadcastToRoom(m, result.value.messages); recordLifecycle(m, result.value.messages, now); acted = true; }
        }
      } else if (ds.phase.tag === "draft_order") {
        const nonTrueKing = ((ds.trueKing + 1) % ds.numPlayers) as PlayerId;
        const chooserId = drafting.lobby.players[nonTrueKing]?.id;
        if (chooserId && isBot(m.botRegistry, chooserId)) {
          const result = roomTransition(m.room, { kind: "draft_order", playerId: chooserId, goFirst: true, now }, now);
          if (result.ok) { m.room = result.value.room; broadcastDraftState(m); broadcastToRoom(m, result.value.messages); recordLifecycle(m, result.value.messages, now); acted = true; }
        }
      } else if (ds.phase.tag === "drafting") {
        const currentPicker = ds.phase.pickerOrder[ds.phase.currentPickerIdx]!;
        const pickerId = drafting.lobby.players[currentPicker]?.id;
        if (pickerId && isBot(m.botRegistry, pickerId) && ds.phase.faceUp.length > 0) {
          const ranked = [...ds.phase.faceUp].sort(
            (a, b) => rankSignatureCard(b) - rankSignatureCard(a),
          );
          const card = ranked[0]!;
          const result = roomTransition(m.room, { kind: "draft_pick", playerId: pickerId, card, now }, now);
          if (result.ok) { m.room = result.value.room; broadcastDraftState(m); broadcastToRoom(m, result.value.messages); recordLifecycle(m, result.value.messages, now); acted = true; }
        }
      }

      if (!acted) break;
    }

    if ((m.room as unknown as { phase: string }).phase === "playing") {
      const playing = m.room as unknown as PlayingRoom;
      (m.room as unknown as { session: typeof playing.session }).session = {
        ...playing.session,
        turnDeadline: Date.now() + playing.session.turnDuration,
      };
      scheduleTurnTimer(m);
      scheduleBotTurn(m);
    }
  };

  const scheduleBotTurn = (m: ManagedRoom): void => {
    clearRoomBotTimer(m);
    if (m.room.phase === "drafting") {
      scheduleBotDraft(m);
      return;
    }
    if (m.room.phase !== "playing") return;

    const playing = m.room as PlayingRoom;
    const activePlayer = playing.game.currentPlayer(playing.session.state) as PlayerId;
    const activeBotId = findBotByIndex(m, playing, activePlayer);
    if (activeBotId === null) return;

    m.botTimer = setTimeout(() => {
      if (m.room.phase !== "playing") return;
      const current = m.room as PlayingRoom;
      const round = current.match.roundsPlayed + 1;
      const legal = current.game.legalActions(current.session.state);
      if (legal.length === 0) return;

      const matchCtx: MatchContext = {
        scores: current.match.scores,
        roundsPlayed: current.match.roundsPlayed,
      };
      const action = botStrategy.selectAction(
        current.session.state,
        activePlayer,
        legal,
        matchCtx,
      );
      const now = Date.now();
      const result = roomTransition(m.room, { kind: "action", playerId: activeBotId, action, now }, now);
      if (!result.ok) return;

      m.room = result.value.room;
      broadcastToRoom(m, result.value.messages);
      m.replayRecorder.recordAction(round, activePlayer, activeBotId, action, false, now);
      recordLifecycle(m, result.value.messages, now);
      advanceIfScoring(m, now);
      scheduleTurnTimer(m);
      scheduleBotTurn(m);
    }, botDelayMs);
  };

  const scheduleTurnTimer = (m: ManagedRoom): void => {
    clearRoomTurnTimer(m);
    if (m.room.phase !== "playing") return;
    const playing = m.room as PlayingRoom;
    const delay = Math.max(1, playing.session.turnDeadline - Date.now() + 1);
    m.turnTimer = setTimeout(() => {
      if (m.room.phase !== "playing") return;
      const pre = m.room as PlayingRoom;
      const round = pre.match.roundsPlayed + 1;
      const timeoutLegal = pre.game.legalActions(pre.session.state);
      const timeoutAction = timeoutLegal[0];
      const activeIdx = pre.game.currentPlayer(pre.session.state) as PlayerId;
      const activeId = playerNameForIdx(pre, activeIdx);

      const now = Date.now();
      const result = roomTransition(m.room, { kind: "timeout", now }, now);
      if (!result.ok) return;
      m.room = result.value.room;
      broadcastToRoom(m, result.value.messages);
      if (result.value.messages.length > 0 && timeoutAction !== undefined) {
        m.replayRecorder.recordAction(round, activeIdx, activeId, timeoutAction, true, now);
        recordLifecycle(m, result.value.messages, now);
      }
      advanceIfScoring(m, now);
      scheduleTurnTimer(m);
      scheduleBotTurn(m);
    }, delay);
  };

  // ---- Room-scoped state snapshot (for reconnect) ----

  const sendStateSnapshot = (ws: WebSocket, m: ManagedRoom, playerName?: string): void => {
    const playerNames = m.room.lobby.players.map((p) => p.id);
    if (m.room.phase === "playing") {
      const playing = m.room as PlayingRoom;
      const legalActions = playing.game.legalActions(playing.session.state);
      const activePlayer = playing.game.currentPlayer(playing.session.state) as PlayerId;
      sendJson(ws, { type: "state", state: playing.session.state, legalActions, activePlayer, playerNames, turnDeadline: playing.session.turnDeadline });
    } else if (m.room.phase === "finished") {
      const finished = m.room as FinishedRoom;
      sendJson(ws, { type: "match_over", winners: finished.winners, finalScores: [...finished.match.scores], playerNames });
    } else if (m.room.phase === "scoring") {
      const scoring = m.room as ScoringRoom;
      sendJson(ws, {
        type: "round_over",
        state: scoring.lastState,
        scores: scoring.lastRoundScores,
        matchScores: [...scoring.match.scores],
        roundsPlayed: scoring.match.roundsPlayed,
        playerNames,
        reviewDeadline: scoring.reviewDeadline,
      });
      if (scoring.readyPlayers.size > 0) {
        sendJson(ws, { type: "scoring_ready", readyPlayers: [...scoring.readyPlayers] });
      }
    } else if (m.room.phase === "drafting") {
      const drafting = m.room as import("./room.js").DraftingRoom;
      const playerIdx = playerName !== undefined
        ? drafting.lobby.players.findIndex((p) => p.id === playerName)
        : -1;
      sendJson(ws, { type: "lobby_state", lobby: m.room.lobby });
      sendJson(ws, {
        type: "draft_state",
        tournament: drafting.tournament,
        playerNames,
        draftPhase: draftStateToView(drafting.draftState, (playerIdx >= 0 ? playerIdx : 0) as PlayerId, drafting.tournament),
      });
    } else {
      sendJson(ws, { type: "lobby_state", lobby: m.room.lobby });
    }
  };

  // ---- Room-scoped bot add ----

  const handleAddBot = (ws: WebSocket, m: ManagedRoom, now: number): void => {
    const botId = botDisplayName(botModelName, m.botCounter++);

    const joinResult = roomTransition(m.room, { kind: "join", playerId: botId }, now);
    if (!joinResult.ok) {
      sendJson(ws, { type: "error", message: joinResult.error.kind });
      return;
    }
    m.room = joinResult.value.room;
    broadcastToRoom(m, joinResult.value.messages);

    m.botRegistry = addBot(m.botRegistry, botId);

    const readyResult = roomTransition(m.room, { kind: "ready", playerId: botId, now }, now);
    if (!readyResult.ok) {
      sendJson(ws, { type: "error", message: readyResult.error.kind });
      return;
    }
    m.room = readyResult.value.room;
    broadcastToRoom(m, readyResult.value.messages);
    broadcastDraftState(m);
    recordLifecycle(m, readyResult.value.messages, now);

    advanceIfScoring(m, now);
    scheduleTurnTimer(m);
    scheduleBotTurn(m);
    broadcastRoomListToBrowsers();
  };

  // ---- Connection handler ----

  // ---- Shared post-auth: send welcome + room state or room list ----

  const sendWelcomeAndState = (ws: WebSocket, entry: RegistryEntry): void => {
    sendJson(ws, { type: "welcome", token: entry.token, playerId: entry.playerId, name: entry.name });
    const managed = findRoomOfPlayer(store, entry.playerId);
    if (managed) {
      sendJson(ws, { type: "room_joined", roomId: managed.id });
      sendJson(ws, { type: "room_settings", targetScore: managed.targetScore, maxPlayers: managed.maxPlayers, hostId: managed.createdBy, tournament: managed.tournament });
      sendStateSnapshot(ws, managed, entry.name ?? undefined);
    } else {
      sendRoomListTo(ws);
    }
  };

  wss.on("connection", (ws: WebSocket) => {
    let activeEntry: RegistryEntry | null = null;

    ws.on("message", (raw: Buffer | string) => {
      const msgNow = Date.now();
      let msg: { type: string; [key: string]: unknown };
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf-8"));
      } catch {
        sendJson(ws, { type: "error", message: "Invalid JSON" });
        return;
      }

      // ---- Auth (subsumes both fresh connect and reconnect) ----
      if (msg.type === "auth") {
        const token = typeof msg.token === "string" ? msg.token : null;
        const restored = token ? registry.reconnect(ws, token, msgNow) : null;
        if (activeEntry && restored && activeEntry !== restored) registry.remove(activeEntry.token);
        activeEntry = restored ?? registry.register(ws, msgNow);
        const authName = typeof msg.name === "string" ? msg.name.trim() : null;
        if (authName && !activeEntry.name) registry.setName(activeEntry.token, authName);
        sendWelcomeAndState(ws, activeEntry);
        return;
      }

      if (!activeEntry) {
        sendJson(ws, { type: "error", message: "auth_required" });
        return;
      }

      const playerId = activeEntry.playerId;

      if (msg.type === "set_name") {
        const raw = String(msg.name ?? "").trim();
        if (raw.length < 1 || raw.length > 20) {
          sendJson(ws, { type: "error", message: "name_invalid" });
          return;
        }
        if (!registry.setName(activeEntry.token, raw)) {
          sendJson(ws, { type: "error", message: "name_taken" });
          return;
        }
        sendJson(ws, { type: "name_accepted", name: raw });
        return;
      }

      if (msg.type === "list_rooms") {
        sendRoomListTo(ws);
        return;
      }

      if (msg.type === "create_room") {
        const name = activeEntry.name;
        if (!name) {
          sendJson(ws, { type: "error", message: "name_required" });
          return;
        }
        if (findRoomOfPlayer(store, playerId)) {
          sendJson(ws, { type: "error", message: "already_in_room" });
          return;
        }

        const maxPlayers = Math.min(4, Math.max(2, Number(msg.maxPlayers) || 4));
        const targetScore = Math.min(99, Math.max(1, Number(msg.targetScore) || 7));

        const managed = createManagedRoom(store, game, name, maxPlayers, targetScore, turnDuration, msgNow, null, makeRoomRecorder());
        updateManagedRoomExpansion(managed, true);

        const joinResult = roomTransition(managed.room, { kind: "join", playerId: name }, msgNow);
        if (joinResult.ok) {
          managed.room = joinResult.value.room;
        }
        addPlayerToRoom(store, playerId, managed.id);

        sendJson(ws, { type: "room_created", roomId: managed.id });
        sendJson(ws, { type: "room_settings", targetScore: managed.targetScore, maxPlayers: managed.maxPlayers, hostId: managed.createdBy, tournament: managed.tournament });
        sendJson(ws, { type: "lobby_state", lobby: managed.room.lobby });
        broadcastRoomListToBrowsers();
        return;
      }

      if (msg.type === "join_room") {
        const name = activeEntry.name;
        if (!name) {
          sendJson(ws, { type: "error", message: "name_required" });
          return;
        }
        if (findRoomOfPlayer(store, playerId)) {
          sendJson(ws, { type: "error", message: "already_in_room" });
          return;
        }

        const roomId = msg.roomId as string;
        const managed = store.rooms.get(roomId);
        if (!managed) {
          sendJson(ws, { type: "error", message: "room_not_found" });
          return;
        }

        const result = roomTransition(managed.room, { kind: "join", playerId: name }, msgNow);
        if (!result.ok) {
          sendJson(ws, { type: "error", message: result.error.kind });
          return;
        }
        managed.room = result.value.room;
        addPlayerToRoom(store, playerId, managed.id);

        sendJson(ws, { type: "room_joined", roomId: managed.id });
        sendJson(ws, { type: "room_settings", targetScore: managed.targetScore, maxPlayers: managed.maxPlayers, hostId: managed.createdBy, tournament: managed.tournament });
        broadcastToRoom(managed, result.value.messages);
        broadcastRoomListToBrowsers();
        return;
      }

      if (msg.type === "leave_room") {
        const managed = findRoomOfPlayer(store, playerId);
        if (!managed) {
          sendJson(ws, { type: "error", message: "not_in_room" });
          return;
        }

        const name = activeEntry.name ?? playerId;
        if (managed.room.phase === "lobby") {
          const result = roomTransition(managed.room, { kind: "leave", playerId: name }, msgNow);
          if (result.ok) {
            managed.room = result.value.room;
            broadcastToRoom(managed, result.value.messages);
          }
        }

        removePlayerFromRoom(store, playerId);

        const remaining = playersInRoom(store, managed.id);
        if (remaining.length === 0) {
          destroyRoom(store, managed);
        }

        sendRoomListTo(ws);
        broadcastRoomListToBrowsers();
        return;
      }

      if (msg.type === "update_settings") {
        const managed = findRoomOfPlayer(store, playerId);
        if (!managed) {
          sendJson(ws, { type: "error", message: "not_in_room" });
          return;
        }
        const name = activeEntry.name ?? playerId;
        if (managed.createdBy !== name) {
          sendJson(ws, { type: "error", message: "not_host" });
          return;
        }
        if (managed.room.phase !== "lobby") {
          sendJson(ws, { type: "error", message: "game_in_progress" });
          return;
        }
        if (msg.targetScore !== undefined) {
          const newTarget = Math.min(99, Math.max(1, Number(msg.targetScore) || 7));
          updateManagedRoomTargetScore(managed, newTarget);
        }
        if (msg.tournament !== undefined) {
          updateManagedRoomTournament(managed, msg.tournament === true);
        }
        const settingsMsg = { type: "room_settings" as const, targetScore: managed.targetScore, maxPlayers: managed.maxPlayers, hostId: managed.createdBy, tournament: managed.tournament };
        const pids = playersInRoom(store, managed.id);
        for (const pid of pids) {
          const w = wsForPlayer(pid);
          if (w !== null && w.readyState === WebSocket.OPEN) sendJson(w, settingsMsg);
        }
        broadcastRoomListToBrowsers();
        return;
      }

      // ---- In-room messages (require player to be in a room) ----

      const managed = findRoomOfPlayer(store, playerId);
      if (!managed) {
        sendJson(ws, { type: "error", message: "not_in_room" });
        return;
      }

      const name = activeEntry.name ?? playerId;

      if (msg.type === "add_bot") {
        handleAddBot(ws, managed, msgNow);
        return;
      }

      if (msg.type === "join") {
        const result = roomTransition(managed.room, { kind: "join", playerId: name }, msgNow);
        if (!result.ok) {
          sendJson(ws, { type: "error", message: result.error.kind });
          return;
        }
        managed.room = result.value.room;
        broadcastToRoom(managed, result.value.messages);
        scheduleTurnTimer(managed);
        scheduleBotTurn(managed);
        return;
      }

      if (msg.type === "ready") {
        const result = roomTransition(managed.room, { kind: "ready", playerId: name, now: msgNow }, msgNow);
        if (!result.ok) {
          sendJson(ws, { type: "error", message: result.error.kind });
          return;
        }
        managed.room = result.value.room;
        broadcastToRoom(managed, result.value.messages);
        broadcastDraftState(managed);
        recordLifecycle(managed, result.value.messages, msgNow);
        advanceIfScoring(managed, msgNow);
        scheduleTurnTimer(managed);
        scheduleBotTurn(managed);
        broadcastRoomListToBrowsers();
        return;
      }

      if (msg.type === "draft_select" || msg.type === "draft_order" || msg.type === "draft_pick") {
        if (managed.room.phase !== "drafting") {
          sendJson(ws, { type: "error", message: "not_in_draft" });
          return;
        }
        const action =
          msg.type === "draft_select" ? { kind: "draft_select" as const, playerId: name, cards: msg.cards as ReadonlyArray<string>, now: msgNow }
          : msg.type === "draft_order" ? { kind: "draft_order" as const, playerId: name, goFirst: msg.goFirst === true, now: msgNow }
          : { kind: "draft_pick" as const, playerId: name, card: msg.card as string, now: msgNow };
        const result = roomTransition(managed.room, action, msgNow);
        if (!result.ok) {
          sendJson(ws, { type: "error", message: result.error.kind });
          return;
        }
        managed.room = result.value.room;
        broadcastDraftState(managed);
        broadcastToRoom(managed, result.value.messages);
        recordLifecycle(managed, result.value.messages, msgNow);
        scheduleTurnTimer(managed);
        scheduleBotTurn(managed);
        return;
      }

      if (msg.type === "action") {
        if (managed.room.phase !== "playing") {
          sendJson(ws, { type: "error", message: "not_in_game" });
          return;
        }

        const playing = managed.room as PlayingRoom;
        const round = playing.match.roundsPlayed + 1;
        const playerIdx = playing.session.playerMapping.get(name);

        const action = msg.action as IKAction;
        const result = roomTransition(managed.room, { kind: "action", playerId: name, action, now: msgNow }, msgNow);
        if (!result.ok) {
          sendJson(ws, { type: "error", message: result.error.kind });
          return;
        }
        managed.room = result.value.room;
        broadcastToRoom(managed, result.value.messages);
        if (playerIdx !== undefined) {
          managed.replayRecorder.recordAction(round, playerIdx, name, action, false, msgNow);
        }
        recordLifecycle(managed, result.value.messages, msgNow);
        advanceIfScoring(managed, msgNow);
        scheduleTurnTimer(managed);
        scheduleBotTurn(managed);
        return;
      }

      sendJson(ws, { type: "error", message: `Unknown message type: ${msg.type}` });
    });

    ws.on("close", () => {
      if (activeEntry) registry.disconnect(activeEntry.token, Date.now(), ws);
    });
  });

  const pruneInterval = setInterval(() => pruneEmptyRooms(store, Date.now()), 60_000);

  return {
    get port() {
      return actualPort();
    },
    ready: readyPromise,
    close: () =>
      new Promise<void>((resolve, reject) => {
        clearInterval(pruneInterval);
        for (const m of store.rooms.values()) {
          clearRoomTurnTimer(m);
          clearRoomBotTimer(m);
          clearRoomScoringTimer(m);
        }
        for (const entry of registry.allConnected()) {
          entry.ws!.close();
        }
        wss.close((err) => (err ? reject(err) : resolve()));
      }),
  };
};
