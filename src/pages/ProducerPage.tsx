import { useEffect, useMemo, useRef } from "react";
import { MediasoupClient } from "../mediasoup/socketClient";

const SERVER_URL = "http://localhost:4000/mediasoup";
const ROOM_ID = "demo-room";

export default function ProducerPage() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const startedRef = useRef(false);
    const client = useMemo(() => new MediasoupClient(SERVER_URL), []);

    useEffect(() => {
        const s = (client as any).socket;
        if (startedRef.current) return;
        startedRef.current = true;


        const start = async () => {
            try {
                await client.joinRoom(ROOM_ID);
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    videoRef.current.muted = true;
                    videoRef.current.playsInline = true;
                    videoRef.current
                        .play()
                        .then(() => console.log("▶️ Local preview playing ✅"))
                        .catch((e) => console.warn("⚠️ Local preview play() blocked:", e.message));
                }

                await client.produceStream(stream);

                // Debug when tracks stop
                stream.getTracks().forEach((t) =>
                    t.addEventListener("ended", () => console.warn(`🛑 Local ${t.kind} track ended`))
                );
            } catch (err: any) {
                console.error("❌ Producer error:", err);
            }
        };

        start();

        return () => {
            const media = videoRef.current?.srcObject as MediaStream | null;
            media?.getTracks().forEach((t) => {
                t.stop();
            });

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
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full max-w-xl rounded-xl shadow"
            />
        </div>
    );
}
