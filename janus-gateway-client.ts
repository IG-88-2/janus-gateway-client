/*
	The MIT License (MIT)

	Copyright (c) 2016 Meetecho

	Permission is hereby granted, free of charge, to any person obtaining
	a copy of this software and associated documentation files (the "Software"),
	to deal in the Software without restriction, including without limitation
	the rights to use, copy, modify, merge, publish, distribute, sublicense,
	and/or sell copies of the Software, and to permit persons to whom the
	Software is furnished to do so, subject to the following conditions:

	The above copyright notice and this permission notice shall be included
	in all copies or substantial portions of the Software.

	THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
	OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
	FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
	THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR
	OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
	ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
	OTHER DEALINGS IN THE SOFTWARE.
*/
import "@babel/polyfill";

interface Participant {
	id: string,
	audio_codec: string,
	video_codec: string,
	talking: boolean
}



interface JanusOptions {
	server:string,
	onSubscriber: (subscriber:JanusSubscriber) => void,
	onPublisher: (publisher:JanusPublisher) => void
	onError: (error:any) => void,
	getId:() => string,
	WebSocket: any,
	logger: {
		enable: () => void,
		disable: () => void,
		success: (...args:any[]) => void,
		info: (...args:any[]) => void,
		error: (error:any) => void,
		json: (...args:any[]) => void,
		tag: (tag:string, type:`success` | `info` | `error`) => (...args:any[]) => void
	}
}



interface JanusPublisherOptions {
	transaction:(request:any) => Promise<any>,
	getId:() => string,
	room_id:string,
	configuration:any,
	logger:Logger
}



interface JanusSubscriberOptions {
	transaction:(request:any) => Promise<any>,
	getId:() => string,
	room_id:string,
	feed:string,
	configuration:any,
	logger:Logger
}



interface Logger {
	enable: () => void,
	disable: () => void,
	success: (...args:any[]) => void,
	info: (...args:any[]) => void,
	error: (error:any) => void,
	json: (...args:any[]) => void,
	tag: (tag:string, type:`success` | `info` | `error`) => (...args:any[]) => void
}



const getTransceiver = (pc:RTCPeerConnection, kind:"audio" | "video") : RTCRtpTransceiver => {

	let transceiver = null;

	let transceivers = pc.getTransceivers();

	if (transceivers && transceivers.length > 0) {
		for (let t of transceivers) {
			if(
				(t.sender && t.sender.track && t.sender.track.kind === kind) ||
				(t.receiver && t.receiver.track && t.receiver.track.kind === kind)
			) {
				transceiver = t;
				break;
			}
		}
	}

	return transceiver as RTCRtpTransceiver;

}



const waitUntil = async (f : (t:number) => Promise<boolean>, timeout:number, defaultInterval?:number) => {

    let interval = defaultInterval || 1000;
  
    let time = 0;
  
    const w = async (resolve:() => void, reject:(error:any) => void) => {
  
        let done = false; 
      
        try {
            
            done = await f(time);
    
        } catch(e) {

        }
  
        if (done) {

            resolve();

        } else if(timeout && time > timeout) {
            
            const error = new Error('waitUntil - timeout');

            reject(error); 

        } else {
        
            time += interval;
    
            setTimeout(() => w(resolve, reject), interval); 
        
        }
  
    };
  
    return new Promise(w);
  
}



export class JanusPublisher extends EventTarget {
	id: string
	room_id: string
	handle_id: number
	ptype: "publisher"
	transaction:(request:any) => Promise<any>
	pc: RTCPeerConnection
	stream: MediaStream
	candidates: any[]
	configuration: any
	publishing: boolean
	attached: boolean
	volume: {
		value: any,
		timer: any
	}
	bitrate: {
		value: any,
		bsnow: any,
		bsbefore: any,
		tsnow: any,
		tsbefore: any,
		timer: any
	}
	iceConnectionState: any
	iceGatheringState: any
	signalingState: any
	statsInterval: any
	stats: any
	logger: Logger

	constructor(options:JanusPublisherOptions) {

		super();

		const { 
			transaction,
			room_id,
			configuration,
			logger,
			getId
		} = options;

		this.ptype = "publisher";

		this.id = getId();
		
		this.transaction = transaction;

		this.configuration = configuration;
		
		this.room_id = room_id;
		
		this.publishing = false;

		this.volume = {
			value: null,
			timer: null
		};

		this.bitrate = {
			value: null,
			bsnow: null,
			bsbefore: null,
			tsnow: null,
			tsbefore: null,
			timer: null
		};

		this.logger = logger;

		this.handle_id = null;

		this.createPeerConnection();

	}



	public initialize = async () => {

		await this.attach();

		const options = {};
		
		const jsep = await this.createOffer(options);

		const response = await this.joinandconfigure(jsep);

		return response.load.data.publishers;

	}



	public terminate = async () => {

		const event = new Event('terminated');

		this.dispatchEvent(event);

		if (this.publishing) {
			await this.unpublish();
		}

		if (this.attached) {
			await this.hangup();
			await this.detach();
		}

		if (this.pc) {
			clearInterval(this.statsInterval);
			this.pc.close();
		}
		
	}



	public renegotiate = async ({
		audio,
		video
	}) => {
		
		const options = {
			iceRestart : true
		};
		
		const jsep = await this.createOffer(options);

		this.logger.json(jsep);
		
		const configured = await this.configure({
			jsep,
			audio,
			video
		});

		this.logger.json(configured);

		return configured;

	}
	


	private createPeerConnection = () => {
		
		const configuration = {
			"iceServers": [{
				urls: "stun:stun.voip.eutelia.it:3478"
			}],
			"sdpSemantics" : "unified-plan"
		};
		
		this.pc = new RTCPeerConnection(configuration);

		this.statsInterval = setInterval(() => {

			this.pc.getStats()
			.then((stats) => {

				this.stats = stats;

			})
			.catch((error) => {

				this.logger.error(error);

			});

		}, 3000);

		this.pc.onicecandidate = (event) => {
			
			if (!event.candidate) {
				
				this.sendTrickleCandidate({
					"completed": true 
				});

			} else {
				
				const candidate = {
					"candidate": event.candidate.candidate,
					"sdpMid": event.candidate.sdpMid,
					"sdpMLineIndex": event.candidate.sdpMLineIndex
				};
				
				this.sendTrickleCandidate(candidate);
					
			}

		};
		
		this.pc.oniceconnectionstatechange = (e) => {
			
			this.iceConnectionState = this.pc.iceConnectionState;

			if (this.pc.iceConnectionState==="disconnected") {
				const event = new Event("disconnected");
				this.dispatchEvent(event);
			}

			this.logger.info(`[${this.ptype}] oniceconnectionstatechange ${this.pc.iceConnectionState}`);
			
		};
		
		this.pc.onnegotiationneeded = () => {
			
			this.logger.info(`[${this.ptype}] onnegotiationneeded ${this.pc.signalingState}`);

		};

		this.pc.onicegatheringstatechange = e => {
			
			this.iceGatheringState = this.pc.iceGatheringState;

			this.logger.info(`[${this.ptype}] onicegatheringstatechange ${this.pc.iceGatheringState}`);

		};
		
		this.pc.onsignalingstatechange = e => {
			
			this.signalingState = this.pc.signalingState;

			this.logger.info(`[${this.ptype}] onicegatheringstatechange ${this.pc.signalingState}`);
			
		};

		this.pc.onicecandidateerror = error => {
		
			this.logger.error(error);
		
		};
		
		this.pc.onstatsended = stats => {

			this.logger.json(stats);
			
		};
		
	}



	private sendTrickleCandidate = (candidate) => {

		const request = {
			type:"candidate",
			load:{
				room_id: this.room_id,
				handle_id: this.handle_id,
				candidate
			}
		};
		
		return this.transaction(request);

	}



	public receiveTrickleCandidate = (candidate) : void => {

		this.candidates.push(candidate);

	}



	public createOffer = async(options) => {
		
		const media = {
			audio: true,
			video: true 
		};

		//TODO why send encoding crashes puppeteer ???  
		const videoOptions : any = {
			direction: "sendonly",
			/*
			streams: [stream],
			sendEncodings: [
				{ rid: "h", active: true, maxBitrate: maxBitrates.high },
				{ rid: "m", active: true, maxBitrate: maxBitrates.medium, scaleResolutionDownBy: 2 },
				{ rid: "l", active: true, maxBitrate: maxBitrates.low, scaleResolutionDownBy: 4 }
			]
			*/
		};

		const audioOptions : any = {
			direction: "sendonly" 
		};

		const stream = await navigator.mediaDevices.getUserMedia(media);
		
		this.stream = stream;

		let tracks = stream.getTracks();

		let videoTrack = tracks.find((t) => t.kind==="video");

		let audioTrack = tracks.find((t) => t.kind==="audio");
			
		let vt = getTransceiver(this.pc, "video");

		let at = getTransceiver(this.pc, "audio");
			
		if (vt && at) {
			at.direction = "sendonly";
			vt.direction = "sendonly";
		} else {
			vt = this.pc.addTransceiver("video", videoOptions);
			at = this.pc.addTransceiver("audio", audioOptions);
		}
			
		vt.sender.replaceTrack(videoTrack);
		
		at.sender.replaceTrack(audioTrack);
			
		const offer = await this.pc.createOffer(options);
		
		this.pc.setLocalDescription(offer);
		
		return offer;
		
	}



	public attach = async () => {

		const request = {
			type: "attach",
			load: {
				room_id: this.room_id
			}
		};

		const result = await this.transaction(request);

		this.handle_id = result.load;

		this.attached = true;

		return result;

	}

	

	public join = () => {
		
		const request = {
			type: "join",
			load: {
				room_id: this.room_id,
				handle_id: this.handle_id,
				ptype: this.ptype
			}
		};

		return this.transaction(request);
		
	}



	public configure = async (data) => {

		const request : any = {
			type: "configure",
			load: {
				room_id: this.room_id,
				handle_id: this.handle_id,
				ptype: this.ptype
			}
		};

		if (data.jsep) {
			request.load.jsep = data.jsep;
		}

		if (data.audio!==undefined) {
			request.load.audio = data.audio;
		}

		if (data.video!==undefined) {
			request.load.video = data.video;
		}
		
		const configureResponse = await this.transaction(request);

		if (configureResponse.load.jsep) {
			await this.pc.setRemoteDescription(configureResponse.load.jsep);
		}

		if (this.candidates) {
			this.candidates.forEach((candidate) => {
				if (!candidate || candidate.completed) {
					this.pc.addIceCandidate(null);
				} else {
					this.pc.addIceCandidate(candidate);
				}
			});
			this.candidates = [];
		}
		
		this.publishing = true;

		return configureResponse;

	}



	public publish = async ({ jsep }) => {

		const request = {
			type: "publish",
			load: {
				room_id: this.room_id,
				jsep
			}
		};

		const response = await this.transaction(request);
		
		await this.pc.setRemoteDescription(response.load.jsep);
		
		if (this.candidates) {
			this.candidates.forEach((candidate) => {
				if (!candidate || candidate.completed) {
					this.pc.addIceCandidate(null);
				} else {
					this.pc.addIceCandidate(candidate);
				}
			});
			this.candidates = [];
		}

		this.publishing = true;
		
	}



	public joinandconfigure = async (jsep) => {

		const request = {
			type: "joinandconfigure",
			load: {
				room_id: this.room_id,
				handle_id: this.handle_id,
				jsep,
				ptype: this.ptype
			}
		};
		
		const configureResponse = await this.transaction(request);

		await this.pc.setRemoteDescription(configureResponse.load.jsep);
		
		if (this.candidates) {
			this.candidates.forEach((candidate) => {
				if (!candidate || candidate.completed) {
					this.pc.addIceCandidate(null);
				} else {
					this.pc.addIceCandidate(candidate);
				}
			});
			this.candidates = [];
		}

		this.publishing = true;

		return configureResponse;

	}



	public unpublish = async () => {

		const request = {
			type: "unpublish",
			load: {
				room_id: this.room_id,
				handle_id: this.handle_id
			}
		};

		this.publishing = false;

		const result = await this.transaction(request);
		
		return result;

	}



	public detach = async () => {

		const request = {
			type: "detach",
			load: {
				room_id: this.room_id,
				handle_id: this.handle_id
			}
		};

		this.publishing = false;

		const result = await this.transaction(request);
		
		return result;
		
	}



	public hangup = async () => {

		const request = {
			type: "hangup",
			load: {
				room_id: this.room_id,
				handle_id: this.handle_id
			}
		};

		this.publishing = false;

		const result = await this.transaction(request);
		
		return result;
		
	}



	public leave = async () => {

		const request = {
			type: "leave",
			load: {
				room_id: this.room_id
			}
		};

		this.publishing = false;

		const result = await this.transaction(request);
		
		return result;
		
	}
	
}



export class JanusSubscriber extends EventTarget {
	id: string
	room_id: string
	handle_id: number
	feed: string
	ptype: "subscriber"
	transaction: any
	pc: RTCPeerConnection
	stream: MediaStream
	candidates: any[]
	configuration: any
	volume: {
		value: any,
		timer: any
	}
	bitrate: {
		value: any,
		bsnow: any,
		bsbefore: any,
		tsnow: any,
		tsbefore: any,
		timer: any
	}
	joined: boolean
	attached: boolean
	iceConnectionState: any
	iceGatheringState: any
	signalingState: any
	statsInterval: any
	stats: any
	logger: Logger

	constructor(options:JanusSubscriberOptions) {

		super();

		const { 
			transaction, 
			room_id,
			feed,
			configuration,
			logger,
			getId
		} = options;

		this.id = getId();
		
		this.transaction = transaction;

		this.feed = feed;

		this.configuration = configuration;

		this.room_id = room_id;

		this.ptype = "subscriber";

		this.attached = false;

		this.volume = {
			value: null,
			timer: null
		};

		this.bitrate = {
			value: null,
			bsnow: null,
			bsbefore: null,
			tsnow: null,
			tsbefore: null,
			timer: null
		};

		this.logger = logger;

		this.createPeerConnection();
	  
	}



	public initialize = async () : Promise<void> => {
		
		await this.attach();

		const { load } = await this.join();

		const { jsep } = load;
		
		const answer = await this.createAnswer(jsep);

		const started = await this.start(answer);
		
		return started;

	}
	


	public terminate = async () => {

		const event = new Event('terminated');

		this.dispatchEvent(event);

		if (this.attached) {
			await this.hangup();
			await this.detach();
		}

		if (this.pc) {
			clearInterval(this.statsInterval);
			this.pc.close();
		}
		
	}

	

	public createPeerConnection = () => {
		
		const configuration = {
			"iceServers": [{
				urls: "stun:stun.voip.eutelia.it:3478"
			}],
			"sdpSemantics": "unified-plan"
		};
		
		this.pc = new RTCPeerConnection(configuration);

		this.statsInterval = setInterval(() => {

			this.pc.getStats()
			.then((stats) => {
				
				this.stats = stats;

			})
			.catch((error) => {

				this.logger.error(error);

			});

		}, 3000);
		
		this.pc.onicecandidate = (event) => {
			
			if (!event.candidate) {
				
				this.sendTrickleCandidate({
					"completed" : true 
				});

			} else {
				
				const candidate = {
					"candidate": event.candidate.candidate,
					"sdpMid": event.candidate.sdpMid,
					"sdpMLineIndex": event.candidate.sdpMLineIndex
				};
				
				this.sendTrickleCandidate(candidate);
					
			}

		};

		this.pc.ontrack = (event) => {
			
			if (!event.streams) {
				return;
			}
			
			const stream = event.streams[0];

			this.stream = stream;
			
			stream.onaddtrack = (t) => {
				


			};

			stream.onremovetrack = (t) => {

				

			};
			
			event.track.onended = (e) => {
				
				this.logger.info('[subscriber] track onended');

			};

			event.track.onmute = (e) => {


				
			};

			event.track.onunmute = (e) => {


				
			};
			
		}
		
		this.pc.onnegotiationneeded = () => {

			this.iceConnectionState = this.pc.iceConnectionState;

		};

		this.pc.oniceconnectionstatechange = (event) => {
			
			this.iceConnectionState = this.pc.iceConnectionState;
			
			if (this.pc.iceConnectionState==="disconnected") {
				const event = new Event("disconnected");
				this.dispatchEvent(event);
			}

			this.logger.info(`oniceconnectionstatechange ${this.pc.iceConnectionState}`);
			
		};

		this.pc.onicecandidateerror = error => {
		
			this.logger.error(error);
		
		};

		this.pc.onicegatheringstatechange = e => {

			this.iceGatheringState = this.pc.iceGatheringState;

			this.logger.info(this.pc.iceGatheringState);

		};
		
		this.pc.onsignalingstatechange = e => {

			this.signalingState = this.pc.signalingState;

			this.logger.info(`onsignalingstatechange ${this.pc.signalingState}`);
			
		};
		
		this.pc.onstatsended = stats => {

			this.logger.info(stats);
			
		};

	}



	private sendTrickleCandidate = (candidate) => {

		const request = {
			type:"candidate",
			load:{
				room_id: this.room_id,
				handle_id: this.handle_id,
				candidate
			}
		}
		
		return this.transaction(request);

	}



	public receiveTrickleCandidate = (candidate) : void => {

		this.candidates.push(candidate);

	}



	public createAnswer = async (jsep) => {
		
		await this.pc.setRemoteDescription(jsep);

		if (this.candidates) {
			this.candidates.forEach((candidate) => {
				if (candidate.completed || !candidate) {
					this.pc.addIceCandidate(null);
				} else {
					this.pc.addIceCandidate(candidate);
				}
			});
			this.candidates = [];
		}

		let vt = getTransceiver(this.pc, "video");
		let at = getTransceiver(this.pc, "audio");
		
		if (vt && at) {
			at.direction = "recvonly";
			vt.direction = "recvonly";
		} else {
			vt = this.pc.addTransceiver("video", { direction: "recvonly" });
			at = this.pc.addTransceiver("audio", { direction: "recvonly" });
		}
		
		const answer = await this.pc.createAnswer({
			iceRestart: true
		});

		this.pc.setLocalDescription(answer);
		
		return answer;

	}
	


	public attach = async () => {

		const request = {
			type: "attach",
			load: {
				room_id: this.room_id
			}
		};

		const result = await this.transaction(request);

		this.handle_id = result.load;

		this.attached = true;

		return result;

	}



	public join = () => {

		const request = {
			type: "join",
			load: {
				room_id: this.room_id,
				handle_id: this.handle_id,
				ptype: "subscriber",
				feed: this.feed
			}
		};

		return this.transaction(request)
		.then((response) => {

			this.joined = true;

			return response;

		});

	}



	public configure = async (data) => {

		const request : any = {
			type: "configure",
			load: {
				room_id: this.room_id,
				handle_id: this.handle_id,
				ptype: this.ptype
			}
		};

		if (data.jsep) {
			request.load.jsep = data.jsep;
		}

		if (data.audio!==undefined) {
			request.load.audio = data.audio;
		}

		if (data.video!==undefined) {
			request.load.video = data.video;
		}
		
		const configureResponse = await this.transaction(request);

		return configureResponse;

	}



	public start = (jsep) => {

		const request = {
			type: "start",
			load: {
				room_id: this.room_id,
				handle_id: this.handle_id,
				answer: jsep
			}
		};

		return this.transaction(request);

	}



	public hangup = async () => {
		
		const request = {
			type: "hangup",
			load: {
				room_id: this.room_id,
				handle_id: this.handle_id
			}
		};
		
		const result = await this.transaction(request);
		
		return result;
		
	}



	public detach = async () => {

		const request = {
			type: "detach",
			load: {
				room_id: this.room_id,
				handle_id: this.handle_id
			}
		};

		this.attached = false;

		const result = await this.transaction(request);

		this.handle_id = undefined;
		
		return result;
		
	}
	


	public leave = async () => {

		const request = {
			type: "leave",
			load: {
				room_id: this.room_id
			}
		};

		this.attached = false;

		const result = await this.transaction(request);
		
		return result;
		
	}
	
}



export class JanusClient {
	server:string
	room_id:string
	ws:any
	connected:boolean
	connecting:boolean
	publisher:JanusPublisher
	subscribers:{ [id:string] : JanusSubscriber }
	calls:{ [id:string] : (message:any) => void } 
	keepAlive:any
	keepAliveInterval:number
	transactionTimeout:number
	socketOptions:any
	onSubscriber: (subscriber:JanusSubscriber) => void
	onPublisher: (publisher:JanusPublisher) => void
	notifyConnected: () => void
	onError: (error:any) => void
	getId: () => string
	WebSocket: any
	logger: any
	
	constructor(options:JanusOptions) {

		const { 
			server, 
			onSubscriber,
			onPublisher,
			onError,
			WebSocket,
			getId,
			logger
		} = options;

		this.getId = getId;
		
		this.WebSocket = WebSocket;

		this.logger = logger;

		this.server = server;

		this.ws = null;

		this.connected = false;

		this.subscribers = {};

		this.calls = {};

		this.onError = onError;

		this.onPublisher = onPublisher;

		this.onSubscriber = onSubscriber;

		this.socketOptions = {
			WebSocket,
			connectionTimeout: 1000,
			maxRetries: 10
		};

		this.transactionTimeout = 30000;

		this.keepAliveInterval = 5000;

		this.logger.enable();

	}



	public initialize = () : Promise<void> => {
		
		this.connecting = true;

		this.ws = new this.WebSocket(
			this.server, 
			[],
			this.socketOptions
		);

		this.ws.addEventListener('message', this.onMessage);

		this.ws.addEventListener('open', this.onOpen);
		
        this.ws.addEventListener('close', this.onClose);
		
		this.ws.addEventListener('error', this.onError);
		
		return new Promise((resolve) => {

			this.notifyConnected = () => resolve();

		});

	}



	private onOpen = () => {

		this.logger.success(`connection established...`);
		
		this.connecting = false;

		this.connected = true;

		if (this.notifyConnected) {
			this.notifyConnected();
			delete this.notifyConnected;
		}

		this.keepAlive = setInterval(() => {
			
			this.transaction(({ type:'keepalive' }))
			.catch((error) => {

				this.onError(error);

			});

		}, this.keepAliveInterval);

	}



	private onClose = () => {

		this.logger.info(`connection closed...`);

		this.connected = false;

		clearInterval(this.keepAlive);

		this.keepAlive = undefined;

		this.cleanup();
		
	}



	private onMessage = (response:MessageEvent) => {
			
		let message = null;

		try {
			message = JSON.parse(response.data);
		} catch(error) {
			this.onError(error);
		}

		if (message) {

			const id = message.transaction;

			const isEvent : boolean = !id;

			if (isEvent) {
				this.onEvent(message);
			} else {
				const resolve = this.calls[id];
				if (resolve) {
					resolve(message);
				}
			}

		}

	}



	private onEvent = async (json) => {
		
		if (json.type==="trickle") {

			this.onTrickle(json);

		} else if (json.type==="publishers") {

			const publishers : Participant[] = json.data;

			if (!publishers || !Array.isArray(publishers)) {
				this.logger.json(json);
				const error = new Error(`onEvent - publishers incorrect format...`);
				this.onError(error);
				return;
			}

			this.onPublishers(publishers);

		} else if (json.type==="media") {

			this.onMedia(json);

		} else if (json.type==="leaving") {

			this.onLeaving(json);

		} else if (json.type==="internal") {

			this.onInternal(json);

		}
		
	}



	private onTrickle = (json) => {

		const { 
			sender, 
			data 
		} = json;

		if (!this.publisher) {
			const error = new Error(`onTrickle - publisher undefined for ${sender}...`);
			this.onError(error);
			return;
		}

		if (!sender) {
			const error = new Error(`onTrickle - sender is undefined...`);
			this.onError(error);
			return;
		}

		if (this.publisher.handle_id==sender) {
			this.logger.success(`received trickle candidate for publisher ${sender}...`);
			this.publisher.receiveTrickleCandidate(data);
		} else {
			for(const id in this.subscribers) {
				const subscriber = this.subscribers[id];

				if (subscriber.handle_id==sender) {
					this.logger.success(`received trickle candidate for subscriber ${sender}...`);
					subscriber.receiveTrickleCandidate(data);
				}
			}
		}

	}



	private onPublishers = async (publishers : Participant[]) : Promise<void> => {
		
		for(let i = 0; i < publishers.length; i++) {

			const publisher = publishers[i];

			const feed = publisher.id;

			if (this.subscribers[feed]) {
				this.logger.error(`onPublishers - subscriber ${feed} already attached for room ${this.room_id}`);
				continue;
			}

			const subscriber = new JanusSubscriber({
				transaction: this.transaction, 
				room_id: this.room_id,
				feed,
				logger: this.logger,
				getId: this.getId,
				configuration: {}
			});

			this.subscribers[feed] = subscriber;

			this.onSubscriber(subscriber);

		}

	}



	private onMedia = (json) => {

		const { 
			sender, 
			data 
		} = json;

		if (!this.publisher) {
			const error = new Error(`onMedia - publisher undefined for ${sender}...`);
			this.onError(error);
			return;
		}

		if (!sender) {
			const error = new Error(`onMedia - sender is undefined...`);
			this.onError(error);
			return;
		}

		const event = new Event('media', data);

		if (this.publisher.handle_id==sender) {
			this.publisher.dispatchEvent(event);
		} else {
			for(const id in this.subscribers) {
				const subscriber = this.subscribers[id];
				if (subscriber.handle_id==sender) {
					subscriber.dispatchEvent(event);
				}
			}
		}

	}



	private onLeaving = async (json) => {

		if (!json.data) {
			this.logger.json(json);
			const error = new Error(`onLeaving - data is undefined...`);
			this.onError(error);
			return;
		}

		const { 
			leaving 
		} = json.data;

		if (!this.publisher) {
			const error = new Error(`onLeaving - publisher is undefined...`);
			this.onError(error);
			return;
		}

		if (!leaving) {
			const error = new Error(`onLeaving - leaving is undefined...`);
			this.onError(error);
			return;
		}

		const event = new Event('leaving');

		for(const id in this.subscribers) {
			const subscriber = this.subscribers[id];
			if (subscriber.feed==leaving) {
				subscriber.dispatchEvent(event);
				try {
					await subscriber.terminate();
					delete this.subscribers[subscriber.feed];
				} catch(error) {
					this.onError(error);
				}
			}
		}

	}



	private onInternal = (json) => {

		this.logger.json(json);

		if (this.publisher && this.publisher.handle_id==json.sender) {
		
		} else {
			for(const id in this.subscribers) {
				const subscriber = this.subscribers[id];
				if (subscriber && subscriber.handle_id==json.sender) {
					
				}
			}
		}

	}



	private cleanup = async () => {

		if (this.publisher) {
			this.logger.info(`terminate publisher ${this.publisher.handle_id}...`);
			try {
				await this.publisher.terminate();
			} catch(error) {
				this.onError(error);
			}
		}
		
		for(const id in this.subscribers) {
			const subscriber = this.subscribers[id];
			const event = new Event('leaving');
			subscriber.dispatchEvent(event);
			this.logger.info(`terminate subscriber ${subscriber.handle_id}...`);
			try {
				await subscriber.terminate();
				delete this.subscribers[subscriber.feed];
			} catch(error) {
				this.onError(error);
			}
		}

		this.subscribers = {};

	}



	public terminate = async () => {
		
		this.logger.info(`terminate: remove event listeners...`);
		
		this.ws.removeEventListener('message', this.onMessage);

		this.ws.removeEventListener('open', this.onOpen);
		
        this.ws.removeEventListener('close', this.onClose);
		
		this.ws.removeEventListener('error', this.onError);
		
		this.logger.info(`terminate: close connection...`);

		this.ws.close();

		this.onClose();

		this.ws = undefined;

	}



	public join = async (room_id:string) : Promise<void> => {
		
		this.room_id = room_id;

		if (this.publisher) {
			try {
				await this.publisher.terminate();
			} catch(error){
				this.onError(error);
			}
		}
		
		try {

			this.publisher = new JanusPublisher({
				room_id: this.room_id,
				transaction: this.transaction,
				logger: this.logger,
				configuration: {},
				getId: this.getId
			});

			const publishers = await this.publisher.initialize();

			this.onPublisher(this.publisher);

			if (!publishers || !Array.isArray(publishers)) {
				const error = new Error(`join - publishers incorrect format...`);
				this.onError(error);
				return;
			}

			this.onPublishers(publishers);

		} catch(error) {

			this.onError(error);

		}
		
	}



	public leave = async () => {
		
		await this.cleanup();

	}



	public mute = async () => {

		if (!this.publisher) {
			throw new Error('mute - publisher is undefined...');
		}

		return await this.publisher.configure({
			audio:false
		});

	}



	public unmute = async () => {

		if (!this.publisher) {
			throw new Error('unmute - publisher is undefined...');
		}

		return await this.publisher.configure({
			audio:true
		});

	}



	public pause = async () => {

		if (!this.publisher) {
			throw new Error('pause - publisher is undefined...');
		}

		return await this.publisher.configure({
			video:false
		});

	}



	public resume = async () => {

		if (!this.publisher) {
			throw new Error('resume - publisher is undefined...');
		}

		return await this.publisher.configure({
			video:true
		});

	}



	private transaction = async (request) => {

		if (!this.connected) {
			this.logger.error(`transaction - not connected...`);
			if (this.connecting) {
				this.logger.info(`transaction - wait until connected...`);
				await waitUntil(() => Promise.resolve(this.connected), 30000, 500);
			} else {
				this.logger.info(`transaction - initialize...`);
				await this.initialize();
			}
		}

		const timeout = this.transactionTimeout;

		const id = this.getId();

		request.transaction = id;
		
		let r = null;
		let p = null;
		
		try {
			r = JSON.stringify(request);
		} catch(error) {
			return Promise.reject(error);
		}
		
		p = new Promise((resolve, reject) => {
			
			let t = setTimeout(() => {
				if (!this.connected && !this.connecting) {
					this.initialize();
				}
				delete this.calls[id];
				const error = new Error(`${request.type} - timeout`);
				reject(error);
			}, timeout);
			
			const f = (message) => {
				
				if (message.transaction===id) {
					if (timeout) {
						clearTimeout(t);
					}
					delete this.calls[id];
					if (message.type==="error") {
						this.logger.error(request);
						const error = new Error(message.load);
						reject(error);
					} else {
						resolve(message);
					}
				}

			};
			
			this.calls[id] = f;

		});
		
		this.ws.send(r);

		return p;
		
	}



	public getRooms = () => this.transaction({ type : "rooms" })



	public createRoom = (description:string) => {

		return this.transaction({ 
			type : "create_room", 
			load : {
				description
			} 
		});

	}
	
}
