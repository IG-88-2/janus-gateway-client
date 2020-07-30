import "@babel/polyfill";
interface JanusOptions {
    server: string;
    onSubscriber: (subscriber: JanusSubscriber) => void;
    onPublisher: (publisher: JanusPublisher) => void;
    onError: (error: any) => void;
    getId: () => string;
    WebSocket: any;
    logger: {
        enable: () => void;
        disable: () => void;
        success: (...args: any[]) => void;
        info: (...args: any[]) => void;
        error: (error: any) => void;
        json: (...args: any[]) => void;
        tag: (tag: string, type: `success` | `info` | `error`) => (...args: any[]) => void;
    };
}
interface JanusPublisherOptions {
    transaction: (request: any) => Promise<any>;
    getId: () => string;
    room_id: string;
    configuration: any;
    logger: Logger;
}
interface JanusSubscriberOptions {
    transaction: (request: any) => Promise<any>;
    getId: () => string;
    room_id: string;
    feed: string;
    configuration: any;
    logger: Logger;
}
interface Logger {
    enable: () => void;
    disable: () => void;
    success: (...args: any[]) => void;
    info: (...args: any[]) => void;
    error: (error: any) => void;
    json: (...args: any[]) => void;
    tag: (tag: string, type: `success` | `info` | `error`) => (...args: any[]) => void;
}
export declare class JanusPublisher extends EventTarget {
    id: string;
    room_id: string;
    handle_id: number;
    ptype: "publisher";
    transaction: (request: any) => Promise<any>;
    pc: RTCPeerConnection;
    stream: MediaStream;
    candidates: any[];
    configuration: any;
    publishing: boolean;
    attached: boolean;
    volume: {
        value: any;
        timer: any;
    };
    bitrate: {
        value: any;
        bsnow: any;
        bsbefore: any;
        tsnow: any;
        tsbefore: any;
        timer: any;
    };
    iceConnectionState: any;
    iceGatheringState: any;
    signalingState: any;
    statsInterval: any;
    stats: any;
    logger: Logger;
    constructor(options: JanusPublisherOptions);
    initialize: () => Promise<any>;
    terminate: () => Promise<void>;
    renegotiate: ({ audio, video }: {
        audio: any;
        video: any;
    }) => Promise<any>;
    private createPeerConnection;
    private sendTrickleCandidate;
    receiveTrickleCandidate: (candidate: any) => void;
    createOffer: (options: any) => Promise<RTCSessionDescriptionInit>;
    attach: () => Promise<any>;
    join: () => Promise<any>;
    configure: (data: any) => Promise<any>;
    publish: ({ jsep }: {
        jsep: any;
    }) => Promise<void>;
    joinandconfigure: (jsep: any) => Promise<any>;
    unpublish: () => Promise<any>;
    detach: () => Promise<any>;
    hangup: () => Promise<any>;
    leave: () => Promise<any>;
}
export declare class JanusSubscriber extends EventTarget {
    id: string;
    room_id: string;
    handle_id: number;
    feed: string;
    ptype: "subscriber";
    transaction: any;
    pc: RTCPeerConnection;
    stream: MediaStream;
    candidates: any[];
    configuration: any;
    volume: {
        value: any;
        timer: any;
    };
    bitrate: {
        value: any;
        bsnow: any;
        bsbefore: any;
        tsnow: any;
        tsbefore: any;
        timer: any;
    };
    joined: boolean;
    attached: boolean;
    iceConnectionState: any;
    iceGatheringState: any;
    signalingState: any;
    statsInterval: any;
    stats: any;
    logger: Logger;
    constructor(options: JanusSubscriberOptions);
    initialize: () => Promise<void>;
    terminate: () => Promise<void>;
    createPeerConnection: () => void;
    private sendTrickleCandidate;
    receiveTrickleCandidate: (candidate: any) => void;
    createAnswer: (jsep: any) => Promise<RTCSessionDescriptionInit>;
    attach: () => Promise<any>;
    join: () => any;
    configure: (data: any) => Promise<any>;
    start: (jsep: any) => any;
    hangup: () => Promise<any>;
    detach: () => Promise<any>;
    leave: () => Promise<any>;
}
export declare class JanusClient {
    server: string;
    room_id: string;
    ws: any;
    connected: boolean;
    connecting: boolean;
    publisher: JanusPublisher;
    subscribers: {
        [id: string]: JanusSubscriber;
    };
    calls: {
        [id: string]: (message: any) => void;
    };
    keepAlive: any;
    keepAliveInterval: number;
    transactionTimeout: number;
    socketOptions: any;
    onSubscriber: (subscriber: JanusSubscriber) => void;
    onPublisher: (publisher: JanusPublisher) => void;
    notifyConnected: () => void;
    onError: (error: any) => void;
    getId: () => string;
    WebSocket: any;
    logger: any;
    constructor(options: JanusOptions);
    initialize: () => Promise<void>;
    private onOpen;
    private onClose;
    private onMessage;
    private onEvent;
    private onTrickle;
    private onPublishers;
    private onMedia;
    private onLeaving;
    private onInternal;
    private cleanup;
    terminate: () => Promise<void>;
    join: (room_id: string) => Promise<void>;
    leave: () => Promise<void>;
    mute: () => Promise<any>;
    unmute: () => Promise<any>;
    pause: () => Promise<any>;
    resume: () => Promise<any>;
    private transaction;
    getRooms: () => Promise<any>;
    createRoom: (description: string) => Promise<any>;
}
export {};
