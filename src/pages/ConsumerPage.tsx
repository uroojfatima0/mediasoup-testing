import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import { MediasoupClient } from "../mediasoup/socketClient";

const SERVER_URL = "http://localhost:4000/mediasoup";
const ROOM_ID = "demo-room";

export default function ConsumerPage() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const remoteStreamRef = useRef<MediaStream>(new MediaStream());
    const startedRef = useRef(false);
    const [consumed, setConsumed] = useState<Record<string, boolean>>({});
    const [ready, setReady] = useState(false);

    const client = useMemo(() => new MediasoupClient(SERVER_URL), []);

    // Attach the shared MediaStream once
    useEffect(() => {
        const v = videoRef.current;
        if (v && !v.srcObject) {
            v.srcObject = remoteStreamRef.current;
            v.playsInline = true;
            v.muted = true; // keep muted for autoplay
        }
    }, []);

    const consumeOne = useCallback( async (producerId: string) => {
        if (consumed[producerId]) return;
        try {
            const stream = await client.consume(producerId);
            stream.getTracks().forEach((track) => {
                remoteStreamRef.current.addTrack(track);
            });
            setConsumed((m) => ({ ...m, [producerId]: true }));
            setReady(true);
        } catch (err: any) {
            console.error(`❌ Consume error for ${producerId}:`, err);
        }
    }, [client, consumed]);

    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;

        const s = (client as any).socket;
        if (s?.on) {
            s.on("new-producer", (payload: { producerId: string; kind: string }) => {
                consumeOne(payload.producerId);
            });

            s.on("producer-closed", ({ producerId }: { producerId: string }) => {
                remoteStreamRef.current.getTracks().forEach((t) => {
                    if (t.id === producerId) {
                        remoteStreamRef.current.removeTrack(t);
                        t.stop();
                    }
                });
                setConsumed((m) => {
                    const copy = { ...m };
                    delete copy[producerId];
                    return copy;
                });
            });
        }

        const init = async () => {
            try {
                await client.joinRoom(ROOM_ID);
                const producers = await client.getProducers();
                if (producers.length) {
                    for (const p of producers) {
                        await consumeOne(p.id);
                    }
                } else {
                    console.log("ℹ️ No producers yet. Waiting for new-producer events…");
                }
            } catch (err: any) {
                console.error("❌ Receiver init error:", err);
            }
        };

        init();

        return () => {
            if (s?.off) {
                s.off("new-producer");
                s.off("producer-closed");
            }
            remoteStreamRef.current.getTracks().forEach((t) => t.stop());
            remoteStreamRef.current = new MediaStream();
        };
    }, [client, consumeOne]);

    // Button allows user to unmute
    const handleUnmute = async () => {
        if (videoRef.current) {
            try {
                videoRef.current.muted = false;
                await videoRef.current.play();
            } catch (err: any) {
                console.error("❌ Unmute failed:", err.message);
            }
        }
    };

    useEffect(() => {
        if (ready && videoRef.current && remoteStreamRef.current) {
            videoRef.current.srcObject = remoteStreamRef.current;
        }
    }, [ready]);

    useEffect(() => {
        const unmuteAll = () => {
            const video = videoRef.current;
            if (video) {
                video.muted = false;
                video.play();
            }
            document.removeEventListener("click", unmuteAll);
        };

        document.addEventListener("click", unmuteAll);
        document.addEventListener("keydown", unmuteAll);

        return () => {
            document.removeEventListener("click", unmuteAll);
            document.removeEventListener("keydown", unmuteAll);
        };
    }, []);

    return (
        <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-6 gap-4">
            <h1 className="text-2xl font-semibold">Consumer</h1>

            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full max-w-xl rounded-xl shadow"
            />

            {ready && (
                <button
                    onClick={handleUnmute}
                    className="px-4 py-2 bg-green-600 rounded-xl shadow hover:bg-green-500"
                >
                    🔊 Unmute
                </button>
            )}
        </div>
    );
}
