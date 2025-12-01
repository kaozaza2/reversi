import {decodePacket} from "./debug"

const SERVER_HOST = "127.0.0.1";
const SERVER_PORT = 7777;
const WS_PORT = 8080;

function createUdpBridge() {
    let ws = null;

    return Bun.udpSocket({
        socket: {
            data(_socket, buf, port, addr) {
                if (!ws || ws.readyState !== WebSocket.OPEN) return;

                decodePacket(buf);

                ws.send(buf);
            },
            close() {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.close();
                }
            },
            error(_socket, error) {
                console.error("UDP error:", error);
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.close();
                }
            },
        },
    }).then(udp => ({
        udp,
        setWebSocket(nextWs) {
            ws = nextWs;
        },
        send(buf) {
            udp.send(buf, SERVER_PORT, SERVER_HOST);
        },
        close() {
            udp.close();
        },
    }));
}

Bun.serve({
    port: WS_PORT,

    async fetch(req, server) {
        const upgraded = server.upgrade(req, {
            data: {
                udpBridgePromise: createUdpBridge(),
            },
        });

        if (upgraded) return;

        return new Response("WebSocket upgrade failed", { status: 500 });
    },

    websocket: {
        async open(ws) {
            const bridge = await ws.data.udpBridgePromise;
            ws.data.udpBridge = bridge;
            bridge.setWebSocket(ws);
        },

        message(ws, message) {
            const bridge = ws.data.udpBridge;
            if (!bridge) return;

            let buf;

            if (typeof message === "string") {
                buf = new TextEncoder().encode(message);
            } else if (message instanceof ArrayBuffer) {
                buf = new Uint8Array(message);
            } else if (ArrayBuffer.isView(message)) {
                buf = new Uint8Array(
                    message.buffer,
                    message.byteOffset,
                    message.byteLength
                );
            } else {
                return;
            }

            decodePacket(buf);

            bridge.send(buf);
        },

        close(ws) {
            if (ws.data && ws.data.udpBridge) {
                ws.data.udpBridge.close();
            }
        },

        error(ws, err) {
            console.error("WebSocket error:", err);
            if (ws.data && ws.data.udpBridge) {
                ws.data.udpBridge.close();
            }
        },
    },
});

console.log(
    `Gateway running: ws://localhost:${WS_PORT} -> udp://${SERVER_HOST}:${SERVER_PORT}`
);
