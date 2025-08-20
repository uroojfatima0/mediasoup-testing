import io, { Socket } from "socket.io-client";
import * as mediasoupClient from "mediasoup-client";

export class MediasoupClient {
    private socket: Socket;
    private device: mediasoupClient.Device | null = null;
    private producerTransport: mediasoupClient.types.Transport | null = null;

    constructor(serverUrl: string) {
        this.socket = io(serverUrl, { path: "/socket.io" });
    }

    async joinRoom(roomId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.socket.emit("join-room", { roomId }, (response: any) => {
                if (response.success) resolve();
                else reject(response.error);
            });
        });
    }

    private async loadDevice(): Promise<void> {
        if (this.device) return;

        const rtpCapabilities = await new Promise<any>((resolve) => {
            this.socket.emit("getRouterRtpCapabilities", (data: any) => resolve(data));
        });
        console.log("🔊 Router RTP Capabilities:", rtpCapabilities.routerRtpCapabilities);

        this.device = new mediasoupClient.Device();
        await this.device.load({ routerRtpCapabilities: rtpCapabilities.routerRtpCapabilities });
        console.log("📡 Device RTP Capabilities:", this.device.rtpCapabilities);
    }

    private async createProducerTransport(): Promise<void> {
        if (!this.device) throw new Error("Device not loaded");

        const { params } = await new Promise<any>((resolve, reject) => {
            this.socket.emit("createTransport", { sender: true }, (res: any) => {
                if (res.error) reject(res.error);
                else resolve(res);
            });
        });

        this.producerTransport = this.device.createSendTransport(params);

        let producerConnected = false;
        this.producerTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
            if (producerConnected) return; // ✅ prevent duplicate calls
            producerConnected = true;

            this.socket.emit("connectProducerTransport", { dtlsParameters }, (res: any) => {
                if (res.error) errback(new Error(res.error));
                else callback();
            });
        });

        this.producerTransport.on("produce", async ({ kind, rtpParameters }, callback, errback) => {
            this.socket.emit("produce", { kind, rtpParameters }, (res: any) => {
                if (res.error) errback(new Error(res.error));
                else callback({ id: res.id });
            });
        });
    }

    async produceStream(stream: MediaStream): Promise<void> {
        await this.loadDevice();
        await this.createProducerTransport();

        if (!this.producerTransport) throw new Error("Producer transport missing");

        for (const track of stream.getTracks()) {
            const producerData = await this.producerTransport.produce({ track });
            console.log("producerData:", producerData);
            console.log("tracks in producerstream:", stream.getTracks().length);
            console.log(
                "track.kind:",
                track.kind,
                "track.readyState:",
                track.readyState,
                "track.enabled:",
                track.enabled
            )
        }
    }

    private consumerTransport: mediasoupClient.types.Transport | null = null;

    async createConsumerTransport(): Promise<mediasoupClient.types.Transport> {
        if (this.consumerTransport) return this.consumerTransport; // ✅ reuse transport

        if (!this.device) throw new Error("Device not loaded");

        const { params } = await new Promise<any>((resolve, reject) => {
            this.socket.emit("createTransport", { sender: false }, (res: any) => {
                if (res.error) reject(res.error);
                else resolve(res);
            });
        });

        this.consumerTransport = this.device.createRecvTransport(params);

        let consumerConnected = false;
        this.consumerTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
            this.socket.emit("connectConsumerTransport", { dtlsParameters }, (res: any) => {
                console.log("🍺 consumer transport connection state:", this.consumerTransport?.connectionState);
                if (res.error) return errback(new Error(res.error));
                consumerConnected = true;  // ✅ mark connected only after success
                callback();
            });
        });


        return this.consumerTransport;
    }

    async consume(producerId: string): Promise<MediaStream> {
        await this.loadDevice();

        const consumerTransport = await this.createConsumerTransport();

        const { params } = await new Promise<any>((resolve, reject) => {
            this.socket.emit(
                "consume",
                {
                    producerId,
                    rtpCapabilities: this.device?.rtpCapabilities,
                },
                (res: any) => {
                    if (res.error) reject(res.error);
                    else resolve(res);
                }
            );
        });

        const consumer = await consumerTransport.consume({
            id: params.id,
            producerId: params.producerId,
            kind: params.kind,
            rtpParameters: params.rtpParameters,
        });

        const stream = new MediaStream();
        stream.addTrack(consumer.track);
        // In consume():
        console.log("🎞️ Consuming with params:", params);
        console.log("🛠️ Consumer rtpParameters:", consumer.rtpParameters);

        // Wait for server to resume RTP flow
        await new Promise<void>((resolve, reject) => {
            this.socket.emit("resumeConsumer", { consumerId: consumer.id }, (res: any) => {
                if (res?.error) reject(res.error);
                else resolve();
            });
        });

        return stream;
    }

    async getProducers(): Promise<{ id: string; kind: string }[]> {
        return new Promise((resolve, reject) => {
            this.socket.emit("getProducers", (res: any) => {
                if (res.error) reject(res.error);
                else resolve(res.producers);
            });
        });
    }

}
