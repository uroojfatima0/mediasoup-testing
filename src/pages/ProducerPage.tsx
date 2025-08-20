import { useEffect, useMemo, useRef, useState } from "react";
import { MediasoupClient } from "../mediasoup/socketClient";

const SERVER_URL = "http://localhost:4000/mediasoup";
const ROOM_ID = "demo-room";

type LogLine = { t: string; msg: string };
const log = (setLogs: React.Dispatch<React.SetStateAction<LogLine[]>>, msg: string) =>
    setLogs((ls) => [...ls, { t: new Date().toISOString(), msg }]);

export default function ProducerPage() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const startedRef = useRef(false);
    const [logs, setLogs] = useState<LogLine[]>([]);
    const client = useMemo(() => new MediasoupClient(SERVER_URL), []);

    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;

        const s = (client as any).socket;
        if (s?.on) {
            s.on("connect", () => log(setLogs, `SOCKET connected: id=${s.id}`));
            s.on("disconnect", (reason: string) => log(setLogs, `SOCKET disconnected: ${reason}`));
            s.on("connect_error", (e: Error) => log(setLogs, `SOCKET connect_error: ${e.message}`));
        }

        const start = async () => {
            try {
                log(setLogs, "Joining room…");
                await client.joinRoom(ROOM_ID);
                log(setLogs, "Joined room ✅");

                log(setLogs, "Requesting getUserMedia({ video:true, audio:true })…");
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                const vTracks = stream.getVideoTracks().length;
                const aTracks = stream.getAudioTracks().length;
                log(setLogs, `Got local stream: videoTracks=${vTracks}, audioTracks=${aTracks}`);

                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    videoRef.current.muted = true;
                    videoRef.current.playsInline = true;
                    videoRef.current
                        .play()
                        .then(() => log(setLogs, "Local preview playing ✅"))
                        .catch((e) => log(setLogs, `Local preview play() blocked: ${e.message}`));
                }

                log(setLogs, "Producing tracks…");
                await client.produceStream(stream);
                log(setLogs, "Produce completed ✅ (tracks sent to router)");

                // Helpful: notify if any track ends
                stream.getTracks().forEach((t) =>
                    t.addEventListener("ended", () => log(setLogs, `Local ${t.kind} track ended`))
                );
            } catch (err: any) {
                log(setLogs, `❌ Producer error: ${err?.message || String(err)}`);
            }
        };

        start();

        return () => {
            // Optional: stop preview tracks on unmount
            const media = videoRef.current?.srcObject as MediaStream | null;
            media?.getTracks().forEach((t) => t.stop());
            if (s?.off) {
                s.off("connect");
                s.off("disconnect");
                s.off("connect_error");
            }
        };
    }, [client]);

    return (
        <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-6 gap-4">
            <h1 className="text-2xl font-semibold">Producer</h1>
            <video ref={videoRef} autoPlay playsInline muted className="w-full max-w-xl rounded-xl shadow" />
            <div className="w-full max-w-xl bg-gray-800 rounded-xl p-3">
                <div className="font-mono text-sm max-h-64 overflow-auto">
                    {logs.map((l, i) => (
                        <div key={i}>[{l.t}] {l.msg}</div>
                    ))}
                </div>
            </div>
        </div>
    );
}
