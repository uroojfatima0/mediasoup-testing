import { useEffect, useMemo, useRef, useState } from "react";
import { MediasoupClient } from "../mediasoup/socketClient";

const SERVER_URL = "http://localhost:4000/mediasoup";
const ROOM_ID = "demo-room";

type LogLine = { t: string; msg: string };
const log = (setLogs: React.Dispatch<React.SetStateAction<LogLine[]>>, msg: string) =>
    setLogs((ls) => [...ls, { t: new Date().toISOString(), msg }]);

export default function ConsumerPage() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const remoteStreamRef = useRef<MediaStream>(new MediaStream());
    const startedRef = useRef(false);
    const [logs, setLogs] = useState<LogLine[]>([]);
    const [consumed, setConsumed] = useState<Record<string, boolean>>({});
    const client = useMemo(() => new MediasoupClient(SERVER_URL), []);

    // Attach the empty stream early but DO NOT call play() here
    useEffect(() => {
        const videoEl = videoRef.current;
        const remoteStream = remoteStreamRef.current;

        if (videoEl && !videoEl.srcObject) {
            videoEl.srcObject = remoteStream;
            videoEl.muted = true;
            videoEl.playsInline = true;
            // do not call play() here to avoid race with incoming tracks
            log(setLogs, "Initial attach: srcObject set (no play())");
        }
    }, []); // run once

    const consumeOne = async (producerId: string) => {
        if (consumed[producerId]) return;

        try {
            log(setLogs, `Consume request → producerId=${producerId}`);
            const stream = await client.consume(producerId);
            videoRef.current!.srcObject = stream;
            videoRef.current!.muted = false;
            const v = videoRef.current;
            if (!v) return;

// 1) attach the stream
            v.srcObject = stream;
// 2) ensure it’s muted so autoplay is permitted
            v.muted = true;
            v.playsInline = true;

// 3) now play
            v.play()
                .then(() => log(setLogs, "Remote video playing ✅"))
                .catch(e => log(setLogs, `Play blocked: ${e.message}`));
        } catch (err: any) {
            log(setLogs, `❌ Consume error for ${producerId}: ${err?.message || String(err)}`);
        }
    };

    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;

        const s = (client as any).socket;
        if (s?.on) {
            s.on("connect", () => log(setLogs, `SOCKET connected: id=${s.id}`));
            s.on("disconnect", (reason: string) => log(setLogs, `SOCKET disconnected: ${reason}`));
            s.on("connect_error", (e: Error) => log(setLogs, `SOCKET connect_error: ${e.message}`));

            s.on("new-producer", (payload: { producerId: string; producerSocketId: string; kind: string }) => {
                log(setLogs, `new-producer → id=${payload.producerId} kind=${payload.kind} from=${payload.producerSocketId}`);
                consumeOne(payload.producerId);
            });

            s.on("producer-closed", ({ producerId }: { producerId: string }) => {
                log(setLogs, `producer-closed → ${producerId}`);
                const tracks = remoteStreamRef.current.getTracks();
                tracks.forEach((t) => {
                    t.stop();
                    remoteStreamRef.current.removeTrack(t);
                });
                const v = videoRef.current;
                if (v) v.pause();
                setConsumed((m) => {
                    const copy = { ...m };
                    delete copy[producerId];
                    return copy;
                });
            });
        }

        const init = async () => {
            try {
                log(setLogs, "Joining room…");
                await client.joinRoom(ROOM_ID);
                log(setLogs, "Joined room ✅");

                log(setLogs, "Querying existing producers…");
                const producers = await client.getProducers();
                log(setLogs, `Found producers: ${JSON.stringify(producers) || "[]"}`);

                // ensure video element has srcObject set early (idempotent), but don't play yet
                if (videoRef.current && !videoRef.current.srcObject) {
                    videoRef.current.srcObject = remoteStreamRef.current;
                    videoRef.current.muted = true;
                    videoRef.current.playsInline = true;
                    log(setLogs, "Initial guard attach in init (no play)");
                }

                if (!producers.length) {
                    log(setLogs, "No producers yet. Waiting for new-producer events…");
                } else {
                    for (const p of producers) {
                        await consumeOne(p.id);
                    }
                }
            } catch (err: any) {
                log(setLogs, `❌ Receiver init error: ${err?.message || String(err)}`);
            }
        };

        init();

        return () => {
            if (s?.off) {
                s.off("connect");
                s.off("disconnect");
                s.off("connect_error");
                s.off("new-producer");
                s.off("producer-closed");
            }
            const tracks = remoteStreamRef.current.getTracks();
            tracks.forEach((t) => t.stop());
            remoteStreamRef.current = new MediaStream();
        };
    }, [client]);

    return (
        <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-6 gap-4">
            <h1 className="text-2xl font-semibold">Consumer</h1>
            <video ref={videoRef} autoPlay playsInline muted className="w-full max-w-xl rounded-xl shadow" />
            <div className="w-full max-w-xl bg-gray-800 rounded-xl p-3">
                <div className="font-mono text-sm max-h-64 overflow-auto">
                    {logs.map((l, i) => (
                        <div key={i}>
                            [{l.t}] {l.msg}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
