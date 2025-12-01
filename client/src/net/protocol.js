export const MessageType = {
    HELLO: 1,
    LIST_LOBBIES: 2,
    CREATE_LOBBY: 3,
    JOIN_LOBBY: 4,
    LEAVE: 5,
    PLACE: 6,
    PING: 7,
    INSPECT: 8,
    CHAT: 9,

    WELCOME: 101,
    LOBBIES: 102,
    LOBBY_CREATED: 103,
    JOINED: 104,
    GAME_STATE: 105,
    PONG: 106,
    LEFT: 107,
    INSPECT_RESULT: 109,
    CHAT_MESSAGE: 110,
    ERROR: 199,
}

export const GameMode = {
    PLAYER_VS_PLAYER: 0,
    PLAYER_VS_CPU: 1,
}

export const GameState = {
    WAITING: 0,
    PLAYING: 1,
    FINISHED: 2,
}

export const ErrorCode = {
    BAD_REQUEST: 1,
    INVALID_MOVE: 2,
    LOBBY_NOT_FOUND: 3,
    LOBBY_FULL_OR_STARTED: 4,
    NOT_IN_LOBBY: 5,
    GAME_NOT_ACTIVE: 6,
    NOT_YOUR_TURN: 7,
    ILLEGAL_MOVE: 8,
    APPLY_FAILED: 9,
    UNKNOWN_MESSAGE_TYPE: 10,
    SPECTATOR_MOVE_NOT_ALLOWED: 11,
    MESSAGE_TOO_LONG: 12,
}
