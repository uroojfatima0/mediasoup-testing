import io, { Socket } from "socket.io-client";
import * as mediasoupClient from "mediasoup-client";

export class MediasoupClient {
    private socket: Socket;
    private device: mediasoupClient.Device | null = null;
    private producerTransport: mediasoupClient.types.Transport | null = null;
    private consumerTransport: mediasoupClient.types.Transport | null = null;

    constructor(serverUrl: string) {
        this.socket = io(serverUrl, { path: "/socket.io" });
    }

    async joinRoom(roomId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.socket.emit("join-room", { roomId }, (response: any) => {
                if (response.success) {
                    resolve();
                } else {
                    reject(response.error);
                }
            });
        });
    }

    private async loadDevice(): Promise<void> {
        if (this.device) {
            return;
        }

        const rtpCapabilities = await new Promise<any>((resolve) => {
            this.socket.emit("getRouterRtpCapabilities", (data: any) => resolve(data));
        });

        this.device = new mediasoupClient.Device();
        await this.device.load({ routerRtpCapabilities: rtpCapabilities.routerRtpCapabilities });
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
            if (producerConnected) return;
            this.socket.emit("connectProducerTransport", { dtlsParameters }, (res: any) => {
                if (res.error) {
                    console.error("❌ Producer transport DTLS connect failed:", res.error);
                    errback(new Error(res.error));
                } else {
                    producerConnected = true;
                    callback();
                }
            });
        });

        this.producerTransport.on("produce", async ({ kind, rtpParameters }, callback, errback) => {
            this.socket.emit("produce", { kind, rtpParameters }, (res: any) => {
                if (res.error) {
                    console.error("❌ Produce failed:", res.error);
                    errback(new Error(res.error));
                } else {
                    callback({ id: res.id });
                }
            });
        });
    }

    async produceStream(stream: MediaStream): Promise<void> {
        await this.loadDevice();
        await this.createProducerTransport();

        if (!this.producerTransport) throw new Error("Producer transport missing");

        for (const track of stream.getTracks()) {
            await this.producerTransport.produce({ track });
        }
    }

    async createConsumerTransport(): Promise<mediasoupClient.types.Transport> {
        if (this.consumerTransport) {
            return this.consumerTransport;
        }
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
            if (consumerConnected) return;
            this.socket.emit("connectConsumerTransport", { dtlsParameters }, (res: any) => {
                if (res.error) {
                    console.error("❌ Consumer transport DTLS connect failed:", res.error);
                    errback(new Error(res.error));
                } else {
                    consumerConnected = true;
                    callback();
                }
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
        await consumerTransport.getStats();
        await consumer.getStats();
        await new Promise<void>((resolve, reject) => {
            this.socket.emit("resumeConsumer", { consumerId: consumer.id }, (res: any) => {
                if (res?.error) {
                    console.error("❌ Resume consumer failed:", res.error);
                    reject(res.error);
                } else {
                    resolve();
                }
            });
        });

        const stream = new MediaStream();
        stream.addTrack(consumer.track);

        return stream;
    }

    async getProducers(): Promise<{ id: string; kind: string }[]> {
        return new Promise((resolve, reject) => {
            this.socket.emit("getProducers", (res: any) => {
                if (res.error) {
                    console.error("❌ getProducers failed:", res.error);
                    reject(res.error);
                } else {
                    resolve(res.producers);
                }
            });
        });
    }
}
