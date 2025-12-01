import React, {useEffect, useRef, useState} from 'react'
import {LogOut, MessageSquare, Play, Send, Users, Wifi, WifiOff} from 'lucide-react'
import {ErrorCode, GameMode, GameState, MessageType} from './net/protocol'

const ReversiGame = () => {
    const canvasRef = useRef(null)
    const wsRef = useRef(null)
    const [gameState, setGameState] = useState('menu')
    const [playerName, setPlayerName] = useState('')
    const [playerId, setPlayerId] = useState(null)
    const [currentLobby, setCurrentLobby] = useState(null)
    const [chatMessages, setChatMessages] = useState([])
    const [chatInput, setChatInput] = useState('')
    const [board, setBoard] = useState(null)
    const [currentTurn, setCurrentTurn] = useState(0)
    const [gameStatus, setGameStatus] = useState(GameState.WAITING)
    const [scores, setScores] = useState({player0: 2, player1: 2})
    const [validMoves, setValidMoves] = useState([])
    const [myPlayerIndex, setMyPlayerIndex] = useState(null)
    const [connected, setConnected] = useState(false)
    const [selectedGameMode, setSelectedGameMode] = useState(GameMode.PLAYER_VS_PLAYER)

    const BOARD_SIZE = 8
    const CELL_SIZE = 50
    const PIECE_RADIUS = 20
    const WS_URL = 'ws://localhost:8080'

    // WebSocket connection
    useEffect(() => {
        const ws = new WebSocket(WS_URL)

        ws.binaryType = 'arraybuffer'

        ws.onopen = () => {
            console.log('Connected to WebSocket bridge')
            setConnected(true)
        }

        ws.onclose = () => {
            console.log('Disconnected from server')
            setConnected(false)
        }

        ws.onerror = (error) => {
            console.error('WebSocket error:', error)
            setConnected(false)
        }

        ws.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
                const buffer = new Uint8Array(event.data)
                handleServerMessage(buffer)
            }
        }

        wsRef.current = ws

        return () => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close()
            }
        }
    }, [])

    const sendMessage = (data) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            const uint8Array = new Uint8Array(data)
            wsRef.current.send(uint8Array)
            console.log('Sent:', uint8Array)
        }
    }

    const handleServerMessage = (buffer) => {
        const messageType = buffer[0]
        console.log('Received message type:', messageType, 'length:', buffer.length)

        switch (messageType) {
            case MessageType.WELCOME:
                handleWelcome(buffer)
                break
            case MessageType.GAME_STATE:
                handleGameState(buffer)
                break
            case MessageType.CHAT_MESSAGE:
                handleChatMessage(buffer)
                break
            case MessageType.ERROR:
                handleError(buffer)
                break
            case MessageType.PONG:
                console.log('Pong received')
                break
            default:
                console.log('Unknown message type:', messageType)
        }
    }

    const handleWelcome = (buffer) => {
        const view = new DataView(buffer.buffer, buffer.byteOffset)
        const id = view.getUint32(1, false)
        const nameLength = buffer[5]
        const name = new TextDecoder().decode(buffer.slice(6, 6 + nameLength))

        console.log('Welcome! Player ID:', id, 'Name:', name)
        setPlayerId(id)
        setGameState('lobby')
    }

    const handleGameState = (buffer) => {
        const view = new DataView(buffer.buffer, buffer.byteOffset)

        const lobbyId = view.getUint16(1, false)
        const status = buffer[3]
        const turn = buffer[4]
        const player0Count = buffer[6]
        const player1Count = buffer[7]

        console.log('Game state:', {lobbyId, status, turn, player0Count, player1Count, myPlayerIndex})

        setCurrentLobby(lobbyId)
        setGameStatus(status)
        setCurrentTurn(turn)
        setScores({player0: player0Count, player1: player1Count})

        if (buffer.length >= 9 + 64) {
            const newBoard = Array(8).fill(null).map(() => Array(8).fill(255))

            for (let row = 0; row < 8; row++) {
                for (let col = 0; col < 8; col++) {
                    const byteIndex = 9 + (row * 8 + col)
                    newBoard[row][col] = buffer[byteIndex]
                }
            }

            console.log('Board updated:', newBoard)
            setBoard(newBoard)

            if (status === 1 && gameState !== 'game') {
                setGameState('game')
                if (chatMessages.length === 0) {
                    setChatMessages([{sender: 'System', message: 'Game started!'}])
                }
            }

            // Calculate valid moves
            const currentPlayerIndex = myPlayerIndex !== null ? myPlayerIndex : 0
            if (turn === currentPlayerIndex && status === 1) {
                const moves = getValidMoves(newBoard, currentPlayerIndex)
                console.log('Valid moves for player', currentPlayerIndex, ':', moves)
                setValidMoves(moves)
            } else {
                console.log('Not my turn, clearing valid moves')
                setValidMoves([])
            }
        }
    }

    const handleChatMessage = (buffer) => {
        const view = new DataView(buffer.buffer, buffer.byteOffset)

        const lobbyId = view.getUint16(1, false)
        const nameLength = buffer[3]
        const senderName = new TextDecoder().decode(buffer.slice(4, 4 + nameLength))

        const msgLengthOffset = 4 + nameLength
        const msgLength = view.getUint16(msgLengthOffset, false)

        const msgStart = msgLengthOffset + 2
        const message = new TextDecoder().decode(buffer.slice(msgStart, msgStart + msgLength))

        console.log('Chat:', senderName, ':', message)
        setChatMessages(prev => [...prev, {sender: senderName, message}])
    }

    const handleError = (buffer) => {
        const errorCode = buffer[1]
        const errorMessages = {
            [ErrorCode.BAD_REQUEST]: 'Bad request',
            [ErrorCode.INVALID_MOVE]: 'Invalid move',
            [ErrorCode.LOBBY_NOT_FOUND]: 'Lobby not found',
            [ErrorCode.LOBBY_FULL_OR_STARTED]: 'Lobby full or started',
            [ErrorCode.NOT_IN_LOBBY]: 'Not in lobby',
            [ErrorCode.GAME_NOT_ACTIVE]: 'Game not active',
            [ErrorCode.NOT_YOUR_TURN]: 'Not your turn',
            [ErrorCode.ILLEGAL_MOVE]: 'Illegal move',
            [ErrorCode.APPLY_FAILED]: 'Apply failed',
            [ErrorCode.UNKNOWN_MESSAGE_TYPE]: 'Unknown message',
            [ErrorCode.SPECTATOR_MOVE_NOT_ALLOWED]: 'Spectator cannot move',
            [ErrorCode.MESSAGE_TOO_LONG]: 'Message too long'
        }
        console.error('Server error:', errorCode, errorMessages[errorCode])
        alert(errorMessages[errorCode] || 'Unknown error')
    }

    const isValidMove = (board, row, col, player) => {
        if (board[row][col] !== 255) return false

        const directions = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
        const opponent = player === 0 ? 1 : 0

        for (let [dr, dc] of directions) {
            let r = row + dr, c = col + dc, hasOpponent = false

            while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
                if (board[r][c] === opponent) hasOpponent = true
                else if (board[r][c] === player && hasOpponent) return true
                else break
                r += dr;
                c += dc
            }
        }
        return false
    }

    const getValidMoves = (board, player) => {
        const moves = []
        for (let i = 0; i < BOARD_SIZE; i++) {
            for (let j = 0; j < BOARD_SIZE; j++) {
                if (isValidMove(board, i, j, player)) moves.push([i, j])
            }
        }
        return moves
    }

    useEffect(() => {
        if (!canvasRef.current || gameState !== 'game' || !board) return

        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')

        console.log('Drawing board, validMoves:', validMoves.length, 'myPlayerIndex:', myPlayerIndex, 'currentTurn:', currentTurn, 'gameStatus:', gameStatus)

        ctx.fillStyle = '#0d9488'
        ctx.fillRect(0, 0, canvas.width, canvas.height)

        ctx.strokeStyle = '#000'
        ctx.lineWidth = 1
        for (let i = 0; i <= BOARD_SIZE; i++) {
            ctx.beginPath()
            ctx.moveTo(i * CELL_SIZE, 0)
            ctx.lineTo(i * CELL_SIZE, BOARD_SIZE * CELL_SIZE)
            ctx.stroke()

            ctx.beginPath()
            ctx.moveTo(0, i * CELL_SIZE)
            ctx.lineTo(BOARD_SIZE * CELL_SIZE, i * CELL_SIZE)
            ctx.stroke()
        }

        // Draw valid moves - check conditions
        const isMyTurn = myPlayerIndex !== null && currentTurn === myPlayerIndex
        const isPlaying = gameStatus === GameState.PLAYING
        console.log('Drawing valid moves?', {isMyTurn, isPlaying, validMovesCount: validMoves.length})

        if (isMyTurn && isPlaying && validMoves.length > 0) {
            ctx.fillStyle = 'rgba(255, 255, 0, 0.5)'
            validMoves.forEach(([row, col]) => {
                console.log('Drawing valid move at:', row, col)
                ctx.fillRect(col * CELL_SIZE + 2, row * CELL_SIZE + 2, CELL_SIZE - 4, CELL_SIZE - 4)
            })
        }

        for (let i = 0; i < BOARD_SIZE; i++) {
            for (let j = 0; j < BOARD_SIZE; j++) {
                if (board[i][j] < 2) {
                    ctx.beginPath()
                    ctx.arc(j * CELL_SIZE + CELL_SIZE / 2, i * CELL_SIZE + CELL_SIZE / 2, PIECE_RADIUS, 0, 2 * Math.PI)
                    ctx.fillStyle = board[i][j] === 0 ? '#000' : '#fff'
                    ctx.fill()
                    ctx.strokeStyle = '#333'
                    ctx.lineWidth = 2
                    ctx.stroke()
                }
            }
        }
    }, [board, validMoves, currentTurn, myPlayerIndex, gameState, gameStatus])

    const handleCanvasClick = (e) => {
        if (myPlayerIndex === null || currentTurn !== myPlayerIndex || gameStatus !== GameState.PLAYING) return

        const canvas = canvasRef.current
        const rect = canvas.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        const col = Math.floor(x / CELL_SIZE)
        const row = Math.floor(y / CELL_SIZE)

        if (validMoves.some(([r, c]) => r === row && c === col)) {
            sendMessage([MessageType.PLACE, col, row])
            setValidMoves([])
        }
    }

    const joinLobby = () => {
        if (!playerName.trim() || !connected) return
        const nameBytes = new TextEncoder().encode(playerName)
        sendMessage([MessageType.HELLO, nameBytes.length, ...nameBytes])
    }

    const createLobby = (mode) => {
        setSelectedGameMode(mode)
        sendMessage([MessageType.CREATE_LOBBY, mode])
        setMyPlayerIndex(0)
        setChatMessages([{
            sender: 'System',
            message: mode === GameMode.PLAYER_VS_PLAYER ? 'Waiting for opponent...' : 'Playing vs CPU...'
        }])
    }

    const sendChatMessage = () => {
        if (!chatInput.trim()) return

        const msgBytes = new TextEncoder().encode(chatInput)
        const msgLength = msgBytes.length

        if (msgLength > 60000) {
            return alert('Message too long (max 60000 bytes)')
        }

        const lengthBytes = new Uint8Array(2)
        new DataView(lengthBytes.buffer).setUint16(0, msgLength, false)

        sendMessage([MessageType.CHAT, ...lengthBytes, ...msgBytes])
        setChatInput('')
    }

    const leaveGame = () => {
        sendMessage([MessageType.LEAVE])
        setGameState('lobby')
        setBoard(null)
        setMyPlayerIndex(null)
        setChatMessages([])
        setValidMoves([])
    }

    if (gameState === 'menu') {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-teal-600 to-cyan-700">
                <div className="bg-white rounded-lg shadow-2xl p-8 w-96">
                    <h1 className="text-4xl font-bold text-center mb-6 text-teal-700">Reversi</h1>

                    <div className="mb-4 flex items-center justify-center gap-2">
                        {connected ? (<><Wifi className="text-green-500" size={20}/><span
                                className="text-green-600 font-semibold">Connected</span></>) : (<><WifiOff
                                className="text-red-500" size={20}/><span
                                className="text-red-600 font-semibold">Disconnected</span></>)}
                    </div>

                    <div className="space-y-4">
                        <input
                            type="text"
                            placeholder="Enter your name"
                            value={playerName}
                            onChange={(e) => setPlayerName(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && joinLobby()}
                            className="w-full px-4 py-3 border-2 border-teal-300 rounded-lg focus:outline-none focus:border-teal-500"
                        />
                        <button
                            onClick={joinLobby}
                            disabled={!playerName.trim() || !connected}
                            className="w-full bg-teal-600 text-white py-3 rounded-lg font-semibold hover:bg-teal-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
                        >
                            <Users size={20}/>Join Server
                        </button>
                    </div>

                    <div className="mt-6 text-center text-sm text-gray-600">
                        <p>Let's play togather</p>
                        <p className="text-xs mt-1">Having Fun!</p>
                    </div>
                </div>
            </div>)
    }

    if (gameState === 'lobby') {
        return (<div className="min-h-screen bg-gradient-to-br from-teal-600 to-cyan-700 p-8">
                <div className="max-w-4xl mx-auto">
                    <div className="bg-white rounded-lg shadow-2xl p-6 mb-6">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-2xl font-bold text-teal-700">Game Lobby</h2>
                            <span className="text-gray-600">Welcome, {playerName}!</span>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <button onClick={() => createLobby(GameMode.PLAYER_VS_PLAYER)}
                                    className="bg-teal-600 text-white py-4 rounded-lg font-semibold hover:bg-teal-700 transition flex items-center justify-center gap-2">
                                <Users size={20}/>Player vs Player
                            </button>
                            <button onClick={() => createLobby(GameMode.PLAYER_VS_CPU)}
                                    className="bg-cyan-600 text-white py-4 rounded-lg font-semibold hover:bg-cyan-700 transition flex items-center justify-center gap-2">
                                <Play size={20}/>Player vs CPU
                            </button>
                        </div>
                    </div>

                    <div className="bg-white rounded-lg shadow-2xl p-6">
                        <h3 className="text-xl font-bold text-teal-700 mb-4">Instructions</h3>
                        <ul className="space-y-2 text-gray-700">
                            <li>• Choose a game mode to create a lobby</li>
                            <li>• In PvP mode, wait for another player to join (not implemented yet)</li>
                            <li>• Black (Player 0) or White (Player 1) starts randomly</li>
                            <li>• Capture opponent pieces by surrounding them</li>
                            <li>• Yellow highlights show valid moves on your turn</li>
                            <li>• Game ends when no moves are available</li>
                        </ul>
                    </div>
                </div>
            </div>)
    }

    return (<div className="min-h-screen bg-gradient-to-br from-teal-600 to-cyan-700 p-4">
            <div className="max-w-6xl mx-auto">
                <div className="bg-white rounded-lg shadow-2xl p-6 mb-4">
                    <div className="flex justify-between items-center">
                        <div>
                            <h2 className="text-2xl font-bold text-teal-700">
                                {selectedGameMode === GameMode.PLAYER_VS_PLAYER ? 'Player vs Player' : 'Player vs CPU'}
                            </h2>
                            <p className="text-sm text-gray-600">Lobby #{currentLobby}</p>
                        </div>
                        <button onClick={leaveGame}
                                className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition flex items-center gap-2">
                            <LogOut size={18}/>Leave
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="lg:col-span-2">
                        <div className="bg-white rounded-lg shadow-2xl p-6">
                            <div className="flex justify-between mb-4">
                                <div className="text-center">
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className="w-6 h-6 rounded-full bg-black border-2 border-gray-700"></div>
                                        <span className="font-semibold">Black: {scores.player0}</span>
                                    </div>
                                    {myPlayerIndex === 0 && <span className="text-sm text-teal-600">(You)</span>}
                                </div>
                                <div className="text-center">
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className="w-6 h-6 rounded-full bg-white border-2 border-gray-700"></div>
                                        <span className="font-semibold">White: {scores.player1}</span>
                                    </div>
                                    {myPlayerIndex === 1 && <span className="text-sm text-teal-600">(You)</span>}
                                </div>
                            </div>

                            <div className="mb-4 text-center">
                                {gameStatus === GameState.WAITING &&
                                    <p className="text-lg font-semibold text-orange-600">Waiting for players...</p>}
                                {gameStatus === GameState.PLAYING && (<p className="text-lg font-semibold">
                                        {currentTurn === myPlayerIndex ? <span
                                                className="text-green-600">Your turn! Click a yellow square to move.</span> :
                                            <span className="text-gray-600">{currentTurn === 0 ? 'Black' : 'White'}'s turn</span>}
                                    </p>)}
                                {gameStatus === GameState.FINISHED && <p className="text-xl font-bold text-red-600">Game
                                    Over! {scores.player0 > scores.player1 ? 'Black' : scores.player1 > scores.player0 ? 'White' : 'Tie'}!</p>}
                            </div>

                            <div className="flex justify-center">
                                <canvas ref={canvasRef} width={BOARD_SIZE * CELL_SIZE} height={BOARD_SIZE * CELL_SIZE}
                                        onClick={handleCanvasClick}
                                        className="border-4 border-teal-700 rounded cursor-pointer"/>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-lg shadow-2xl p-6 flex flex-col h-[600px]">
                        <div className="flex items-center gap-2 mb-4">
                            <MessageSquare className="text-teal-600"/>
                            <h3 className="text-xl font-bold text-teal-700">Chat</h3>
                        </div>

                        <div className="flex-1 overflow-y-auto mb-4 space-y-2">
                            {chatMessages.map((msg, idx) => (<div key={idx} className="bg-teal-50 rounded p-2">
                                    <span className="font-semibold text-teal-700">{msg.sender}: </span>
                                    <span className="text-gray-700">{msg.message}</span>
                                </div>))}
                        </div>

                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
                                placeholder="Type a message..."
                                className="flex-1 px-3 py-2 border-2 border-teal-300 rounded-lg focus:outline-none focus:border-teal-500"
                            />
                            <button onClick={sendChatMessage}
                                    className="bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition">
                                <Send size={18}/>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>)
}

export default ReversiGame