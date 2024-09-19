"use client";
import { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";

interface LoggedInResponse {
    userId: string;
}

interface User {
    userId: string;
    username: string;
}

interface Message {
    from: string; // userId of the sender
    msg: string;
}

export default function Home() {
    const [username, setUsername] = useState<string>("");
    const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
    const [userId, setUserId] = useState<string>("");
    const [socket, setSocket] = useState<Socket | null>(null);
    const [connectedUsers, setConnectedUsers] = useState<User[]>([]);
    const [messages, setMessages] = useState<Message[]>([]);
    const [currentMessage, setCurrentMessage] = useState<string>("");
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [receivingCall, setReceivingCall] = useState<boolean>(false);
    const [caller, setCaller] = useState<string>("");
    const [callerSignal, setCallerSignal] = useState<any>(null);

    const userVideo = useRef<HTMLVideoElement>(null);
    const partnerVideo = useRef<HTMLVideoElement>(null);
    const connectionRef = useRef<RTCPeerConnection | null>(null);

    useEffect(() => {
        const newSocket = io("http://localhost:5000");
        setSocket(newSocket);

        newSocket.on("logged_in", (data: LoggedInResponse) => {
            setUserId(data.userId);
        });

        newSocket.on("user_list", (users: User[]) => {
            setConnectedUsers(users);
        });

        newSocket.on("private_message", (msg: Message) => {
            console.log("Received private message:", msg);
            setMessages((prevMessages) => [...prevMessages, msg]);
        });

        // Incoming call handling
        newSocket.on('call-made', async (data) => {
            setReceivingCall(true);
            setCaller(data.from);
            setCallerSignal(data.signal);
        });

        // Call accepted handling
        newSocket.on('call-accepted', async (signal) => {
            await connectionRef.current?.setRemoteDescription(new RTCSessionDescription(signal));
        });

        // ICE candidates handling
        newSocket.on('ice-candidate', async (candidate) => {
            try {
                await connectionRef.current?.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
                console.error('Error adding received ice candidate', e);
            }
        });

        // Get user media
        navigator.mediaDevices.getUserMedia({ video: true, audio: true })
            .then((currentStream) => {
                setStream(currentStream);
                if (userVideo.current) {
                    userVideo.current.srcObject = currentStream;
                }
            });

        return () => {
            newSocket.disconnect();
        };
    }, []);

    const handleLogin = () => {
        if (username.trim() !== "" && socket) {
            socket.emit("login", username);
            setIsLoggedIn(true);
            console.log(`Logged in as ${username}`);
        }
    };

    const handleSendMessage = () => {
        if (currentMessage.trim() !== "" && selectedUser && socket) {
            const newMessage: Message = {
                from: userId,
                msg: currentMessage,
            };
            socket.emit("private_message", { to: selectedUser.userId, msg: currentMessage });
            setMessages((prevMessages) => [...prevMessages, newMessage]);
            setCurrentMessage("");
            console.log(`Sent message to ${selectedUser.username}: ${currentMessage}`);
        }
    };

    const callUser = (id: string) => {
        const peer = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                // Add TURN servers here if needed
            ],
        });

        // Add tracks to peer connection
        stream?.getTracks().forEach((track) => peer.addTrack(track, stream));

        // Handle ICE candidates
        peer.onicecandidate = (event) => {
            if (event.candidate && socket) {
                socket.emit('ice-candidate', { to: id, candidate: event.candidate });
            }
        };

        // Handle incoming tracks
        peer.ontrack = (event) => {
            if (partnerVideo.current) {
                partnerVideo.current.srcObject = event.streams[0];
            }
        };

        // Create and send offer
        peer.createOffer()
            .then((offer) => peer.setLocalDescription(offer))
            .then(() => {
                socket?.emit('call-user', {
                    userToCall: id,
                    signalData: peer.localDescription,
                    from: userId,
                    name: username,
                });
            });

        connectionRef.current = peer;
    };

    const acceptCall = () => {
        const peer = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                // Add TURN servers here if needed
            ],
        });

        // Add tracks to peer connection
        stream?.getTracks().forEach((track) => peer.addTrack(track, stream));

        // Handle ICE candidates
        peer.onicecandidate = (event) => {
            if (event.candidate && socket) {
                socket.emit('ice-candidate', { to: caller, candidate: event.candidate });
            }
        };

        // Handle incoming tracks
        peer.ontrack = (event) => {
            if (partnerVideo.current) {
                partnerVideo.current.srcObject = event.streams[0];
            }
        };

        // Set remote description and create answer
        peer.setRemoteDescription(new RTCSessionDescription(callerSignal))
            .then(() => peer.createAnswer())
            .then((answer) => peer.setLocalDescription(answer))
            .then(() => {
                socket?.emit('answer-call', { signal: peer.localDescription, to: caller });
            });

        connectionRef.current = peer;
        setReceivingCall(false);
    };

    if (!isLoggedIn) {
        return (
            <div className="flex flex-col items-center justify-center h-screen bg-gray-800">
                <input
                    type="text"
                    placeholder="Enter username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="mb-4 p-2 border rounded text-black"
                />
                <button onClick={handleLogin} className="p-2 bg-blue-500 text-white rounded">
                    Login
                </button>
            </div>
        );
    }

    return (
        <div className="flex h-screen">
            <div className="w-1/4 bg-gray-900 p-4 text-white">
                <h2 className="text-xl font-bold mb-4">Connected Users</h2>
                <ul>
                    {connectedUsers.filter(user => user.userId !== userId).map((user) => (
                        <li
                            key={user.userId}
                            className={`mb-2 cursor-pointer ${selectedUser?.userId === user.userId ? 'font-bold' : ''}`}
                            onClick={() => setSelectedUser(user)}
                        >
                            {user.username}
                        </li>
                    ))}
                </ul>
            </div>
            <div className="w-3/4 flex flex-col bg-gray-100">
                <div className="flex-grow p-4 overflow-y-auto">
                    {selectedUser ? (
                        messages.filter(msg => 
                            (msg.from === userId && selectedUser) || 
                            msg.from === selectedUser.userId
                        ).map((msg, index) => (
                            <div key={index} className={`mb-2 flex ${msg.from === userId ? 'justify-end' : 'justify-start'}`}>
                                <div className={`p-2 rounded ${msg.from === userId ? 'bg-blue-500 text-white' : 'bg-gray-300 text-black'}`}>
                                    <strong>{msg.from === userId ? 'You' : selectedUser.username}:</strong> {msg.msg}
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="flex items-center justify-center h-full text-gray-500">
                            Select a user to start chatting
                        </div>
                    )}
                </div>
                {selectedUser && (
                    <div className="p-4 bg-gray-200">
                        <input
                            type="text"
                            value={currentMessage}
                            onChange={(e) => setCurrentMessage(e.target.value)}
                            className="w-full p-2 border rounded text-black outline-none border-0"
                            placeholder="Type a message..."
                            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                        />
                        <button
                            onClick={handleSendMessage}
                            className="mt-2 p-2 bg-blue-500 text-white rounded w-full"
                        >
                            Send
                        </button>
                        <button
                            onClick={() => callUser(selectedUser.userId)}
                            className="mt-2 p-2 bg-green-500 text-white rounded w-full"
                        >
                            Video Call
                        </button>
                    </div>
                )}
            </div>
            {/* Video Elements */}
            <div className="fixed top-0 right-0 m-4">
                <video playsInline muted ref={userVideo} autoPlay style={{ width: "200px" }} />
                <video playsInline ref={partnerVideo} autoPlay style={{ width: "200px" }} />
            </div>
            {/* Incoming Call Prompt */}
            {receivingCall && (
                <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50">
                    <div className="bg-white p-4 rounded">
                        <h2>Incoming Call...</h2>
                        <button onClick={acceptCall} className="mt-2 p-2 bg-blue-500 text-white rounded">
                            Accept
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
