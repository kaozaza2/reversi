import {ErrorCode, MessageType} from "../client/src/net/protocol.js";

const MessageTypeName = Object.fromEntries(
    Object.entries(MessageType).map(([k, v]) => [v, k])
);

export function decodePacket(buf) {
    if (!buf || buf.length === 0) {
        console.log("Empty packet");
        return;
    }

    const type = buf[0];
    const typeName = MessageTypeName[type] || `UNKNOWN(${type})`;

    console.log(`\n========== PACKET (${buf.length} bytes) ==========`);

    console.log(`TYPE: ${typeName} (${type})`);

    let offset = 1;

    switch (type) {
        //--------------------------------------
        // HELLO (client → server)
        //--------------------------------------
        case MessageType.HELLO: {
            const nameLen = buf[offset++];
            const nameBytes = buf.slice(offset, offset + nameLen);
            const name = new TextDecoder().decode(nameBytes);

            console.log("HELLO:");
            console.log("  nameLen:", nameLen);
            console.log("  name:", name);

            break;
        }

        //--------------------------------------
        // WELCOME (server → client)
        // [0] type
        // [1-4] playerId
        // [5] nameLen
        // [..] name
        //--------------------------------------
        case MessageType.WELCOME: {
            const pid =
                (buf[offset] << 24) |
                (buf[offset + 1] << 16) |
                (buf[offset + 2] << 8) |
                buf[offset + 3];
            offset += 4;

            const nameLen = buf[offset++];
            const nameBytes = buf.slice(offset, offset + nameLen);
            const name = new TextDecoder().decode(nameBytes);

            console.log("WELCOME:");
            console.log("  playerId:", pid);
            console.log("  nameLen:", nameLen);
            console.log("  name:", name);

            break;
        }

        //--------------------------------------
        // CREATE_LOBBY
        //--------------------------------------
        case MessageType.CREATE_LOBBY: {
            const mode = buf[offset];
            console.log("CREATE_LOBBY:");
            console.log("  mode:", mode);
            break;
        }

        //--------------------------------------
        // GAME_STATE
        // HEADER = 9 bytes
        //--------------------------------------
        case MessageType.GAME_STATE: {
            if (buf.length < 9 + 64) {
                console.log("Malformed GAME_STATE");
                break;
            }

            const lobbyId = (buf[1] << 8) | buf[2];
            const status = buf[3];
            const turn = buf[4];
            const p0 = buf[6];
            const p1 = buf[7];

            console.log("GAME_STATE:");
            console.log("  lobbyId:", lobbyId);
            console.log("  status:", status);
            console.log("  turnIndex:", turn);
            console.log("  blackPieces:", p0);
            console.log("  whitePieces:", p1);

            const board = buf.slice(9, 73);
            console.log("  board:");

            for (let i = 0; i < board.length; i += 8) {
                const b = [...board.slice(i, i + 8)]
                console.log("         ", b);
            }

            break;
        }

        //--------------------------------------
        // CHAT_MESSAGE
        //--------------------------------------
        case MessageType.CHAT_MESSAGE: {
            const lobbyId = (buf[offset] << 8) | buf[offset + 1];
            offset += 2;

            const nameLen = buf[offset++];
            const name = new TextDecoder().decode(
                buf.slice(offset, offset + nameLen)
            );
            offset += nameLen;

            const msgLen = (buf[offset] << 8) | buf[offset + 1];
            offset += 2;

            const message = new TextDecoder().decode(
                buf.slice(offset, offset + msgLen)
            );
            offset += msgLen;

            let ts = 0n;
            for (let i = 0; i < 8; i++) {
                ts = (ts << 8n) | BigInt(buf[offset + i]);
            }

            console.log("CHAT_MESSAGE:");
            console.log("  lobbyId:", lobbyId);
            console.log("  sender:", name);
            console.log("  message:", message);
            console.log("  timestamp:", ts.toString());

            break;
        }

        //--------------------------------------
        // ERROR
        //--------------------------------------
        case MessageType.ERROR: {
            const code = buf[offset];
            const reason = Object.entries(ErrorCode)
                .find(([k, v]) => v === code)?.[0] || `Unknown(${code})`;

            console.log("ERROR:");
            console.log("  code:", code);
            console.log("  reason:", reason);
            break;
        }

        //--------------------------------------
        // DEFAULT
        //--------------------------------------
        default: {
            console.log("RAW PACKET:", buf);
        }
    }

    console.log("============================================\n");
}
