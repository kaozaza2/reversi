#!/usr/bin/env python3
import pickle
import random
import socket
import struct
import threading
import time
import os
from collections import deque
from concurrent.futures import ThreadPoolExecutor

###############################################################################
# CONFIGURATION
###############################################################################
SERVER_HOST = "0.0.0.0"
SERVER_PORT = 7777
MAX_UDP_PACKET_SIZE = 65507
PLAYER_IDLE_TIMEOUT = 180
SERVER_TICK_INTERVAL = 0.25
CPU_THINK_DELAY_MS = (250, 700)
ENABLE_VERBOSE_LOG = True
MAX_CHAT_HISTORY = 50
MAX_CHAT_MESSAGE_LENGTH = 60000
REVERSI_AI_Q_TABLE = None


###############################################################################
# UTILITIES
###############################################################################
def log_message(*args):
    if not ENABLE_VERBOSE_LOG:
        return
    timestamp = time.strftime("%H:%M:%S")
    thread_name = threading.current_thread().name
    print(f"[{timestamp}][{thread_name}]", *args)


def current_time():
    return time.time()


def generate_player_id():
    return random.randrange(1, 2 ** 31 - 1)


def generate_lobby_id(existing_lobbies):
    while True:
        x = random.randrange(1, 65535)
        if x not in existing_lobbies:
            return x


###############################################################################
# ENUMS & CONSTANTS
###############################################################################
class MessageType:
    HELLO = 1
    LIST_LOBBIES = 2
    CREATE_LOBBY = 3
    JOIN_LOBBY = 4
    LEAVE = 5
    PLACE = 6
    PING = 7
    INSPECT = 8
    CHAT = 9

    WELCOME = 101
    LOBBIES = 102
    LOBBY_CREATED = 103
    JOINED = 104
    GAME_STATE = 105
    PONG = 106
    LEFT = 107
    INSPECT_RESULT = 109
    CHAT_MESSAGE = 110
    ERROR = 199


class GameMode:
    PLAYER_VS_PLAYER = 0
    PLAYER_VS_CPU = 1
    PLAYER_VS_AI = 2


class GameStatus:
    WAITING = 0
    PLAYING = 1
    FINISHED = 2


class ErrorCode:
    BAD_REQUEST = 1
    INVALID_MOVE = 2
    LOBBY_NOT_FOUND = 3
    LOBBY_FULL_OR_STARTED = 4
    NOT_IN_LOBBY = 5
    GAME_NOT_ACTIVE = 6
    NOT_YOUR_TURN = 7
    ILLEGAL_MOVE = 8
    APPLY_FAILED = 9
    UNKNOWN_MESSAGE_TYPE = 10
    SPECTATOR_MOVE_NOT_ALLOWED = 11
    MESSAGE_TOO_LONG = 12


###############################################################################
# REVERSI LOGIC
###############################################################################
DIRECTIONS = [
    (-1, -1), (-1, 0), (-1, 1),
    (0, -1), (0, 1),
    (1, -1), (1, 0), (1, 1)
]

_initial_board = None


def create_initial_board():
    global _initial_board
    if _initial_board is None:
        _initial_board = [[255] * 8 for _ in range(8)]
        _initial_board[3][3] = _initial_board[4][4] = 0
        _initial_board[3][4] = _initial_board[4][3] = 1
    return [row[:] for row in _initial_board]


def is_in_bounds(x, y):
    return 0 <= x < 8 and 0 <= y < 8


def find_legal_moves(board, player):
    opponent = 1 - player
    moves = set()
    for y in range(8):
        for x in range(8):
            if board[y][x] != 255:
                continue
            for dx, dy in DIRECTIONS:
                cx, cy = x + dx, y + dy
                saw_opponent = False
                while is_in_bounds(cx, cy) and board[cy][cx] == opponent:
                    saw_opponent = True
                    cx += dx
                    cy += dy
                if saw_opponent and is_in_bounds(cx, cy) and board[cy][cx] == player:
                    moves.add((x, y))
                    break
    return sorted(moves)


def apply_player_move(board, player, x, y):
    if not is_in_bounds(x, y) or board[y][x] != 255:
        return False, 0
    opponent = 1 - player
    flips = []
    for dx, dy in DIRECTIONS:
        path = []
        cx, cy = x + dx, y + dy
        while is_in_bounds(cx, cy) and board[cy][cx] == opponent:
            path.append((cx, cy))
            cx += dx
            cy += dy
        if path and is_in_bounds(cx, cy) and board[cy][cx] == player:
            flips.extend(path)
    if not flips:
        return False, 0
    board[y][x] = player
    for fx, fy in flips:
        board[fy][fx] = player
    return True, 1 + len(flips)


def count_pieces(board):
    b = w = 0
    for row in board:
        for c in row:
            if c == 0:
                b += 1
            elif c == 1:
                w += 1
    return b, w


def clone_board(board):
    return [row[:] for row in board]


def ai_state_key(board):
    key = ""
    for row in board:
        for column in row:
            if column == 0:
                key += "B"
            elif column == 1:
                key += "W"
            else:
                key += " "
    return "B" + key


def ai_select_move(board, ai_player):
    if not REVERSI_AI_Q_TABLE:
        print("AI not available, fallback to CPU")
        return cpu_select_move(board, ai_player)

    moves = find_legal_moves(board, ai_player)
    if not moves:
        return None

    s = ai_state_key(board)
    if s not in REVERSI_AI_Q_TABLE:
        return random.choice(moves)

    best_value = None
    best_moves = []

    for (x, y) in moves:
        idx = x * 8 * y
        v = REVERSI_AI_Q_TABLE[idx]
        if best_value is None or v > best_value:
            best_value = v
            best_moves = [(x, y)]
        elif v == best_value:
            best_moves.append((x, y))

    return random.choice(best_moves)


def cpu_select_move(board, cpu_player):
    moves = find_legal_moves(board, cpu_player)
    if not moves:
        return None
    corner_bonus = 100
    edge_bonus = 10

    best_score = -1
    best_move = moves[0]

    for (x, y) in moves:
        tmp = clone_board(board)
        success, flipped = apply_player_move(tmp, cpu_player, x, y)
        if not success:
            continue
        score = flipped
        if (x, y) in {(0, 0), (0, 7), (7, 0), (7, 7)}:
            score += corner_bonus
        elif x in (0, 7) or y in (0, 7):
            score += edge_bonus
        if score > best_score:
            best_score = score
            best_move = (x, y)
    return best_move


def check_game_over(board, current_turn):
    """Check if the game is over (no legal moves for both players)."""
    # Check if current player has moves
    current_moves = find_legal_moves(board, current_turn)
    if current_moves:
        return False

    # Check if opponent has moves
    opponent = 1 - current_turn
    opponent_moves = find_legal_moves(board, opponent)
    if opponent_moves:
        return False

    # Neither player has moves - game over
    return True


###############################################################################
# DATA CLASSES
###############################################################################
class Player:
    __slots__ = ("address", "name", "player_id", "last_active", "lobby_id")

    def __init__(self, address, name="Guest"):
        self.address = address
        self.name = name
        self.player_id = generate_player_id()
        self.last_active = current_time()
        self.lobby_id = None

    def refresh(self):
        self.last_active = current_time()


class ChatMessage:
    __slots__ = ("sender", "message", "timestamp")

    def __init__(self, sender, message):
        self.sender = sender
        self.message = message
        self.timestamp = current_time()


class Lobby:
    __slots__ = (
        "lobby_id",
        "mode",
        "started",
        "players",
        "player_addresses",
        "board",
        "turn_index",
        "status",
        "winner",
        "pass_streak",
        "chat_history",
        "_cpu_action_due",
        "_last_hash",
    )

    def __init__(self, lobby_id, mode):
        self.lobby_id = lobby_id
        self.mode = mode
        self.started = False
        self.players = []
        self.player_addresses = []
        self.board = create_initial_board()
        self.turn_index = 0
        self.status = GameStatus.WAITING
        self.winner = None
        self.pass_streak = 0
        self.chat_history = deque(maxlen=MAX_CHAT_HISTORY)
        self._last_hash = None

    def add_chat(self, sender, msg):
        if len(msg.encode("utf-8")) > MAX_CHAT_MESSAGE_LENGTH:
            return False
        self.chat_history.append(ChatMessage(sender, msg))
        return True

    def state_hash(self):
        return (
            self.status,
            self.turn_index,
            tuple(tuple(r) for r in self.board),
        )


###############################################################################
# SERVER IMPLEMENTATION
###############################################################################
class ReversiUDPServer:
    def __init__(self):
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.socket.bind((SERVER_HOST, SERVER_PORT))
        self.socket.setblocking(False)

        self.players_by_address = {}
        self.players_by_id = {}
        self.lobbies = {}

        self.PLAYER_LOCK = threading.RLock()
        self.LOBBY_LOCK = threading.RLock()

        self.executor = ThreadPoolExecutor(max_workers=16)

        self.running = True

    def start(self):
        print(f"Server started udp://{SERVER_HOST}:{SERVER_PORT}")
        threading.Thread(target=self._recv_loop, daemon=True).start()
        threading.Thread(target=self._tick_loop, daemon=True).start()

        try:
            while self.running:
                time.sleep(1)
        except KeyboardInterrupt:
            print("Stopping...")
            self.running = False

    ###############################################################################
    # RECEIVE LOOP
    ###############################################################################
    def _recv_loop(self):
        while self.running:
            try:
                data, addr = self.socket.recvfrom(MAX_UDP_PACKET_SIZE)
                self.executor.submit(self._handle_packet, data, addr)
            except BlockingIOError:
                time.sleep(0.001)
            except Exception as e:
                log_message("recv error:", e)

    ###############################################################################
    # HANDLE PACKETS
    ###############################################################################
    def _get_or_create_player(self, addr):
        with self.PLAYER_LOCK:
            p = self.players_by_address.get(addr)
            if p:
                p.refresh()
                return p

            p = Player(addr)
            self.players_by_address[addr] = p
            self.players_by_id[p.player_id] = p
            p.refresh()
            return p

    def _handle_packet(self, data, addr):
        if not data:
            return
        msg = data[0]
        player = self._get_or_create_player(addr)

        try:
            if msg == MessageType.HELLO:
                self._handle_hello(data, player)
            elif msg == MessageType.CREATE_LOBBY:
                self._handle_create_lobby(data, player)
            elif msg == MessageType.PLACE:
                self._handle_place(data, player)
            elif msg == MessageType.CHAT:
                self._handle_chat(data, player)
            elif msg == MessageType.LEAVE:
                self._handle_leave(player)
            else:
                self._send_error(addr, ErrorCode.UNKNOWN_MESSAGE_TYPE)
        except Exception as e:
            log_message("handle error:", e)
            self._send_error(addr, ErrorCode.BAD_REQUEST)

    ###############################################################################
    # HELLO
    ###############################################################################
    def _handle_hello(self, data, player):
        name_len = data[1]
        name = "Player"
        if name_len:
            name = data[2: 2 + name_len].decode("utf-8", "ignore")
        player.name = name

        # WELCOME PACKET
        payload = (
                bytes([MessageType.WELCOME])
                + struct.pack("!I", player.player_id)
                + bytes([len(name.encode("utf-8"))])
                + name.encode("utf-8")
        )

        self.socket.sendto(payload, player.address)

    ###############################################################################
    # CREATE LOBBY
    ###############################################################################
    def _handle_create_lobby(self, data, player):
        mode = data[1]
        with self.LOBBY_LOCK:
            lobby_id = generate_lobby_id(self.lobbies)
            lb = Lobby(lobby_id, mode)
            lb.players.append(player.player_id)
            lb.player_addresses.append(player.address)
            self.lobbies[lobby_id] = lb
            player.lobby_id = lobby_id

            self._maybe_start(lobby_id)

    def _maybe_start(self, lobby_id):
        with self.LOBBY_LOCK:
            lb = self.lobbies.get(lobby_id)
            if not lb or lb.started:
                return

            if lb.mode in (GameMode.PLAYER_VS_CPU, GameMode.PLAYER_VS_AI) and len(lb.players) == 1:
                lb.players.append("AI" if lb.mode == GameMode.PLAYER_VS_AI else "CPU")
                lb.player_addresses.append(None)

            if len(lb.players) == 2:
                lb.started = True
                lb.status = GameStatus.PLAYING
                lb.turn_index = random.randint(0, 1)
                log_message(f"Lobby {lobby_id} started, first turn: player {lb.turn_index}")
                self._send_state(lb)

    ###############################################################################
    # CHAT
    ###############################################################################
    def _handle_chat(self, data, player):
        if not player.lobby_id:
            return self._send_error(player.address, ErrorCode.NOT_IN_LOBBY)

        with self.LOBBY_LOCK:
            lb = self.lobbies.get(player.lobby_id)
            if not lb:
                return self._send_error(player.address, ErrorCode.LOBBY_NOT_FOUND)

            if len(data) < 3:
                return self._send_error(player.address, ErrorCode.BAD_REQUEST)

            msg_len = struct.unpack_from("!H", data, 1)[0]
            start = 3
            end = start + msg_len

            if msg_len > MAX_CHAT_MESSAGE_LENGTH or len(data) < end:
                return self._send_error(player.address, ErrorCode.MESSAGE_TOO_LONG)

            message = data[start:end].decode("utf-8", "ignore")

            if not lb.add_chat(player.name, message):
                return self._send_error(player.address, ErrorCode.MESSAGE_TOO_LONG)

            self._broadcast_chat(lb, player.name, message)

    def _broadcast_chat(self, lb, sender, message):
        name_bytes = sender.encode("utf-8")[:50]
        msg_bytes = message.encode("utf-8")[:MAX_CHAT_MESSAGE_LENGTH]

        payload = (
                bytes([MessageType.CHAT_MESSAGE])
                + struct.pack("!H", lb.lobby_id)
                + bytes([len(name_bytes)])
                + name_bytes
                + struct.pack("!H", len(msg_bytes))
                + msg_bytes
                + struct.pack("!Q", int(current_time() * 1000))
        )

        for addr in lb.player_addresses:
            if addr:
                self.socket.sendto(payload, addr)

    ###############################################################################
    # PLACE
    ###############################################################################
    def _handle_place(self, data, player):
        with self.LOBBY_LOCK:
            lb = self.lobbies.get(player.lobby_id)
            if not lb:
                return self._send_error(player.address, ErrorCode.NOT_IN_LOBBY)

            if lb.status != GameStatus.PLAYING:
                return self._send_error(player.address, ErrorCode.GAME_NOT_ACTIVE)

            try:
                idx = lb.players.index(player.player_id)
            except ValueError:
                return self._send_error(
                    player.address, ErrorCode.SPECTATOR_MOVE_NOT_ALLOWED
                )

            if lb.turn_index != idx:
                return self._send_error(player.address, ErrorCode.NOT_YOUR_TURN)

            x, y = data[1], data[2]
            if (x, y) not in find_legal_moves(lb.board, idx):
                return self._send_error(player.address, ErrorCode.ILLEGAL_MOVE)

            ok, _ = apply_player_move(lb.board, idx, x, y)
            if not ok:
                return self._send_error(player.address, ErrorCode.APPLY_FAILED)

            log_message(f"Player {idx} ({player.name}) placed at ({x}, {y})")

            # Switch turn
            lb.turn_index = 1 - lb.turn_index

            # Check if next player has moves
            next_moves = find_legal_moves(lb.board, lb.turn_index)
            if not next_moves:
                log_message(f"Player {lb.turn_index} has no moves, checking game over")
                # Check if game is over
                if check_game_over(lb.board, lb.turn_index):
                    lb.status = GameStatus.FINISHED
                    p0, p1 = count_pieces(lb.board)
                    if p0 > p1:
                        lb.winner = 0
                    elif p1 > p0:
                        lb.winner = 1
                    else:
                        lb.winner = -1  # Tie
                    log_message(f"Game over! Winner: {lb.winner}, Score: {p0}-{p1}")
                else:
                    # Skip to other player
                    log_message(f"Player {lb.turn_index} has no moves, skipping turn")
                    lb.turn_index = 1 - lb.turn_index

            self._send_state(lb)

    ###############################################################################
    # GAME STATE
    ###############################################################################
    def _send_state(self, lb):
        h = lb.state_hash()
        if h == lb._last_hash:
            return
        lb._last_hash = h

        b, w = count_pieces(lb.board)

        header = bytearray()
        header.append(MessageType.GAME_STATE)
        header.extend(
            struct.pack(
                "!HBBBBBB",
                lb.lobby_id,
                lb.status,
                lb.turn_index,
                255,
                b,
                w,
                0,
            )
        )

        flat = bytearray()
        for row in lb.board:
            for c in row:
                flat.append(c)

        payload = bytes(header + flat)

        for addr in lb.player_addresses:
            if addr:
                self.socket.sendto(payload, addr)

    ###############################################################################
    # LEAVE
    ###############################################################################
    def _handle_leave(self, player):
        with self.LOBBY_LOCK:
            if not player.lobby_id:
                return
            lb = self.lobbies.get(player.lobby_id)
            if not lb:
                player.lobby_id = None
                return

            if player.player_id in lb.players:
                idx = lb.players.index(player.player_id)
                lb.players.pop(idx)
                lb.player_addresses.pop(idx)

            player.lobby_id = None
            if not lb.players:
                del self.lobbies[lb.lobby_id]

    ###############################################################################
    # TICK LOOP
    ###############################################################################
    def _tick_loop(self):
        while self.running:
            time.sleep(SERVER_TICK_INTERVAL)
            self._tick()

    def _tick(self):
        ts = current_time()

        # CPU MOVE
        with self.LOBBY_LOCK:
            for lb in list(self.lobbies.values()):
                if (
                        lb.started
                        and lb.status == GameStatus.PLAYING
                        and lb.turn_index < len(lb.players)
                        and lb.players[lb.turn_index] in ("CPU", "AI")
                ):
                    if not hasattr(lb, "_cpu_action_due"):
                        d = random.randint(*CPU_THINK_DELAY_MS) / 1000
                        lb._cpu_action_due = ts + d
                    elif ts >= lb._cpu_action_due:
                        cpu_name = lb.players[lb.turn_index]
                        if cpu_name == "AI":
                            mv = ai_select_move(lb.board, lb.turn_index)
                        else:
                            mv = cpu_select_move(lb.board, lb.turn_index)

                        if mv:
                            x, y = mv
                            apply_player_move(lb.board, lb.turn_index, x, y)
                            log_message(f"{cpu_name} (player {lb.turn_index}) moved to ({x}, {y})")
                        else:
                            log_message(f"{cpu_name} has no moves")

                        # Switch turn
                        lb.turn_index = 1 - lb.turn_index

                        # Check if next player has moves
                        next_moves = find_legal_moves(lb.board, lb.turn_index)
                        if not next_moves:
                            if check_game_over(lb.board, lb.turn_index):
                                lb.status = GameStatus.FINISHED
                                p0, p1 = count_pieces(lb.board)
                                if p0 > p1:
                                    lb.winner = 0
                                elif p1 > p0:
                                    lb.winner = 1
                                else:
                                    lb.winner = -1
                                log_message(f"Game over! Winner: {lb.winner}, Score: {p0}-{p1}")
                            else:
                                # Skip turn back to CPU
                                lb.turn_index = 1 - lb.turn_index

                        if hasattr(lb, "_cpu_action_due"):
                            del lb._cpu_action_due
                        self._send_state(lb)

        # Idle players
        if int(ts) % 5 == 0:
            with self.PLAYER_LOCK:
                dead = [
                    (addr, p)
                    for addr, p in self.players_by_address.items()
                    if ts - p.last_active > PLAYER_IDLE_TIMEOUT
                ]
                for addr, p in dead:
                    del self.players_by_address[addr]
                    self.players_by_id.pop(p.player_id, None)
                    if p.lobby_id:
                        self._handle_leave(p)

    ###############################################################################
    # ERROR
    ###############################################################################
    def _send_error(self, addr, code):
        self.socket.sendto(bytes([MessageType.ERROR, code]), addr)


###############################################################################
# MAIN
###############################################################################
if __name__ == "__main__":
    if os.path.exists("reversi_q_table.pkl"):
        with open("reversi_q_table.pkl", "rb") as f:
            REVERSI_AI_Q_TABLE = pickle.load(f)

    ReversiUDPServer().start()
