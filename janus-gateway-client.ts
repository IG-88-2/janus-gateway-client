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
const uuidv1 = require('uuid').v1;



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
	WebSocket: any,
	subscriberRtcConfiguration: any,
	publisherRtcConfiguration: any,
	transactionTimeout: number,
	keepAliveInterval: number,
	user_id:string,
	socketOptions?
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
	onError: (error:any) => void,
	rtcConfiguration:any,
	mediaConstraints: MediaStreamConstraints,
	room_id:string,
	user_id:string,
	logger:Logger
}



interface JanusSubscriberOptions {
	transaction:(request:any) => Promise<any>,
	rtcConfiguration:any,
	room_id:string,
	feed:string,
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



class JanusPublisher extends EventTarget {
	id: string
	room_id: string
	handle_id: number
	ptype: "publisher"
	transaction:(request:any) => Promise<any>
	pc: RTCPeerConnection
	stream: MediaStream
	candidates: any[]
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
	rtcConfiguration: any
	mediaConstraints: any
	logger: Logger
	onError: any
	terminated: boolean

	constructor(options:JanusPublisherOptions) {

		super();

		const { 
			transaction,
			room_id,
			user_id,
			rtcConfiguration,
			mediaConstraints,
			logger,
			onError
		} = options;

		this.ptype = "publisher";

		this.rtcConfiguration = rtcConfiguration;

		this.mediaConstraints = mediaConstraints;

		this.id = user_id;
		
		this.transaction = transaction;
		
		this.room_id = room_id;

		this.onError = onError;
		
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

		this.createPeerConnection(this.rtcConfiguration);

	}



	public initialize = async () => {

		await this.attach();

		const jsep = await this.createOffer(this.mediaConstraints);
		
		const response = await this.joinandconfigure(jsep);

		return response.load.data.publishers;

	}



	public terminate = async () => {

		this.terminated = true;

		const event = new Event('terminated');

		if (this.pc) {
			clearInterval(this.statsInterval);
			this.pc.close();
		}

		if (this.stream) {
			const tracks = this.stream.getTracks();
			for(let i = 0; i < tracks.length; i++) {
				const track = tracks[i];
				await track.stop();
			}
		}

		this.dispatchEvent(event);

		if (this.publishing) {
			try {
				await this.unpublish();
			} catch(error) {
				this.onError(error);
			}
		}

		if (this.attached) {
			try {
				await this.hangup();
			} catch(error) {
				this.onError(error);
			}

			try {
				await this.detach();
			} catch(error) {
				this.onError(error);
			}
		}
		
	}



	public renegotiate = async ({
		audio,
		video,
		mediaConstraints
	}) => {

		const jsep = await this.createOffer(mediaConstraints || this.mediaConstraints);

		this.logger.json(jsep);
		
		const configured = await this.configure({
			jsep,
			audio,
			video
		});

		this.logger.json(configured);

		return configured;

	}
	


	private createPeerConnection = (configuration?: RTCConfiguration) => {
		
		this.pc = new RTCPeerConnection(configuration);

		if (this.statsInterval) {
			clearInterval(this.statsInterval);
		}

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
			
			if (this.pc.signalingState==="closed" && !this.terminated) {
				this.renegotiate({
					audio: true,
					video: true,
					mediaConstraints: this.mediaConstraints
				})
				.then((reconfigured) => this.logger.json(reconfigured))
				.catch((error) => this.logger.error(error));
			}

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



	public createOffer = async (mediaConstraints: MediaStreamConstraints) => {
		
		const media = mediaConstraints || {
			audio: true,
			video: true 
		};

		//why - send encoding crashes puppeteer ???  
		const videoOptions : RTCRtpTransceiverInit = {
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

		const audioOptions : RTCRtpTransceiverInit = {
			direction: "sendonly" 
		};

		const stream: MediaStream = await navigator.mediaDevices.getUserMedia(media);
		
		this.stream = stream;

		let tracks = stream.getTracks();

		let videoTrack = tracks.find((t) => t.kind==="video");

		let audioTrack = tracks.find((t) => t.kind==="audio");
			
		let vt = getTransceiver(this.pc, "video");

		let at = getTransceiver(this.pc, "audio");
			
		if (vt && at) {
			vt.direction = "sendonly";
			at.direction = "sendonly";
		} else {
			//TODO DOMException: Failed to execute 'addTransceiver' on 'RTCPeerConnection': The RTCPeerConnection's signalingState is 'closed'
			if (this.pc.signalingState==="closed" && !this.terminated) {
				this.createPeerConnection(this.rtcConfiguration);
			}
			vt = this.pc.addTransceiver("video", videoOptions);
			at = this.pc.addTransceiver("audio", audioOptions);
		}
		
		await vt.sender.replaceTrack(videoTrack);
		
		await at.sender.replaceTrack(audioTrack);
			
		const offer = await this.pc.createOffer({});
		
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

		//TODO result undefined due to connection already terminated
		this.handle_id = result.load;

		this.attached = true;

		return result;

	}

	

	public join = () => {
		
		const request = {
			type: "join",
			load: {
				id: this.id,
				room_id: this.room_id,
				handle_id: this.handle_id,
				ptype: this.ptype
			}
		};

		return this.transaction(request);
		
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
				id: this.id,
				room_id: this.room_id,
				handle_id: this.handle_id,
				ptype: this.ptype,
				jsep
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
		
		const result = await this.transaction(request);

		this.publishing = false;
		
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
		
		const result = await this.transaction(request);

		this.publishing = false;

		this.attached = false;

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
	
}



class JanusSubscriber extends EventTarget {
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
	rtcConfiguration: any
	logger: Logger
	terminated: boolean

	constructor(options:JanusSubscriberOptions) {

		super();

		const { 
			transaction, 
			room_id,
			feed,
			rtcConfiguration,
			logger
		} = options;

		this.id = feed;

		this.feed = feed;
		
		this.transaction = transaction;
		
		this.room_id = room_id;

		this.ptype = "subscriber";

		this.attached = false;

		this.rtcConfiguration = rtcConfiguration;

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
		
		this.createPeerConnection(rtcConfiguration);
	  
	}



	public initialize = async (options?: RTCOfferOptions) : Promise<void> => {
		
		await this.attach();

		const { load } = await this.join();

		const { jsep } = load;
		
		const answer = await this.createAnswer(jsep, options);

		const started = await this.start(answer);
		
		return started;

	}
	


	public terminate = async () => {

		const event = new Event('terminated');

		this.terminated = true;

		this.dispatchEvent(event);

		if (this.pc) {
			clearInterval(this.statsInterval);
			this.pc.close();
		}

		if (this.attached) {
			await this.hangup();
			await this.detach();
		}
		
	}

	

	public createPeerConnection = (configuration?: RTCConfiguration) => {
		
		this.pc = new RTCPeerConnection(configuration);

		if (this.statsInterval) {
			clearInterval(this.statsInterval);
		}

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



	public createAnswer = async (jsep, options?: RTCOfferOptions) => {
		
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
			//TODO DOMException: Failed to execute 'addTransceiver' on 'RTCPeerConnection': The RTCPeerConnection's signalingState is 'closed'
			if (this.pc.signalingState==="closed" && !this.terminated) {
				this.createPeerConnection(this.rtcConfiguration);
			}
			vt = this.pc.addTransceiver("video", { direction: "recvonly" });
			at = this.pc.addTransceiver("audio", { direction: "recvonly" });
		}
		
		const answer = await this.pc.createAnswer(options);

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
		
		const result = await this.transaction(request);

		this.attached = false;

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



class JanusClient {
	server:string
	room_id:string
	ws:any
	terminating:boolean
	connected:boolean
	initializing:boolean
	publisher:JanusPublisher
	subscribers:{ [id:string] : JanusSubscriber }
	calls:{ [id:string] : (message:any) => void } 
	keepAlive:any
	keepAliveInterval:number
	transactionTimeout:number
	socketOptions:any
	onSubscriber: (subscriber:JanusSubscriber) => void
	onPublisher: (publisher:JanusPublisher) => void
	notifyConnected: (error?:any) => void
	onError: (error:any) => void
	subscriberRtcConfiguration: any
	publisherRtcConfiguration: any
	WebSocket: any
	logger: any
	user_id:string
	
	constructor(options:JanusOptions) {

		const {
			onSubscriber,
			onPublisher,
			onError,
			WebSocket,
			logger,
			server,
			subscriberRtcConfiguration,
			publisherRtcConfiguration,
			transactionTimeout,
			keepAliveInterval,
			user_id,
			socketOptions
		} = options;
		
		console.log('janus socket options', socketOptions);

		this.user_id = user_id;

		this.WebSocket = WebSocket;

		this.logger = logger;

		this.server = `${server}/?id=${user_id}`; //server;

		this.ws = null;

		this.initializing = false;

		this.connected = false;

		this.terminating = false;

		this.subscribers = {};

		this.calls = {};

		this.subscriberRtcConfiguration = subscriberRtcConfiguration;

		this.publisherRtcConfiguration = publisherRtcConfiguration;

		this.onError = onError;

		this.onPublisher = onPublisher;

		this.onSubscriber = onSubscriber;

		//TODO ws.refresh()

		this.socketOptions = {
			WebSocket,
			connectionTimeout: 5000,
			maxRetries: 50,
			...(socketOptions || {})
		};

		this.transactionTimeout = transactionTimeout;

		this.keepAliveInterval = keepAliveInterval;
		
		this.logger.enable();

	}



	public initialize = () : Promise<void> => {
		
		if (this.terminating) {
			throw new Error('termination in progress...');
		}

		if (this.connected) {
			throw new Error('already initialized...');
		}

		if (this.initializing) {
			throw new Error('initialization in progress...');
		}
		
		this.logger.success(`initialize... ${this.server}`);
		
		this.initializing = true;

		this.ws = new this.WebSocket(
			this.server, 
			[],
			this.socketOptions
		);

		this.ws.addEventListener('message', this.onMessage);
		
		this.ws.addEventListener('error', this.onError);
		
		return new Promise((resolve) => {

			this.notifyConnected = () => resolve();

		});

	}



	public terminate = async () => {
		
		if (!this.initializing && !this.connected) {
			throw new Error('already terminated...');
		}

		if (this.terminating) {
			throw new Error('termination in progress...');
		}

		this.terminating = true;
		
		await this.cleanup();

		this.logger.info(`terminate: remove event listeners...`);
		
		this.ws.removeEventListener('message', this.onMessage);
		
        this.ws.removeEventListener('close', this.onClose);
		
		this.ws.removeEventListener('error', this.onError);

		if (this.notifyConnected) {
			this.notifyConnected({
				cancel: true
			});
			delete this.notifyConnected;
		}
		
		this.logger.info(`terminate: close connection...`);

		this.ws.close();

		this.onClose();

		this.ws = undefined;

		this.terminating = false;

	}



	public replaceVideoTrack = async (deviceId) => {
		
		try {
			const tracks = this.publisher.stream.getVideoTracks();

			const audioTracks = this.publisher.stream.getAudioTracks();

			for(let i = 0; i < tracks.length; i++) {
				const track = tracks[i];
				await track.stop();
			}

			for(let j = 0; j < audioTracks.length; j++) {
				const track = audioTracks[j];
				await track.stop();
			}
		} catch(error) {
			this.onError(error);
		}

		let vt = getTransceiver(this.publisher.pc, "video");
		
		const mediaStream = await navigator.mediaDevices.getUserMedia({
			audio: true,
			video: { 
				deviceId: { 
					exact: deviceId
				}
			}
		});
		
		this.publisher.stream = mediaStream;

		const t = mediaStream.getVideoTracks()[0];

		await vt.sender.replaceTrack(t);
		
	}



	private onClose = () => {

		this.logger.info(`connection closed...`);

		this.connected = false;

		this.initializing = false;

		clearInterval(this.keepAlive);

		this.keepAlive = undefined;
		
	}



	public join = async (
		room_id:string,
		mediaConstraints?: MediaStreamConstraints
	) : Promise<void> => {
		
		this.room_id = room_id;

		if (this.publisher) {
			try {
				await this.publisher.terminate();
				this.publisher.transaction = (...args) => Promise.resolve();
				delete this.publisher;
			} catch(error) {}
		}

		this.publisher = new JanusPublisher({
			room_id: this.room_id,
			user_id: this.user_id,
			transaction: this.transaction,
			logger: this.logger,
			onError: this.onError,
			mediaConstraints,
			rtcConfiguration: this.publisherRtcConfiguration
		});

		const publishers = await this.publisher.initialize();

		this.onPublisher(this.publisher);

		if (!publishers || !Array.isArray(publishers)) {
			const error = new Error(`could not retrieve participants info`);
			throw error;
		}

		this.onPublishers(publishers);
		
	}



	public leave = async () => {
		
		if (this.terminating) {
			throw new Error('termination in progress...');
		}
		
		await this.cleanup();

	}



	private cleanup = async () => {
		
		if (this.publisher) {
			this.logger.info(`terminate publisher ${this.publisher.handle_id}...`);
			try {
				await this.publisher.terminate();
				this.publisher.transaction = (...args) => Promise.resolve();
				delete this.publisher;
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
				subscriber.transaction = (...args) => Promise.resolve();
				delete this.subscribers[subscriber.feed];
			} catch(error) {
				this.onError(error);
			}
		}

		this.subscribers = {};

	}



	private onOpen = () => {

		this.logger.success(`connection established...`);
		
		this.initializing = false;

		this.connected = true;

		this.ws.removeEventListener('close', this.onClose);

		this.ws.addEventListener('close', this.onClose);

		if (this.notifyConnected) {
			this.notifyConnected();
			delete this.notifyConnected;
		}

		if (this.keepAlive) {
			clearInterval(this.keepAlive);
		}

		this.keepAlive = setInterval(() => {
			
			this.transaction(({ type:'keepalive' }))
			.catch((error) => {

				this.onError(error);

			});

		}, this.keepAliveInterval);

	}



	private onMessage = (response:MessageEvent) => {
		
		if (response.data==='connected') {
			this.onOpen();
			return;
		}

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
				rtcConfiguration: this.subscriberRtcConfiguration
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
				delete this.subscribers[subscriber.feed];
				subscriber.transaction = (...args) => Promise.resolve();
				try {
					await subscriber.terminate();
				} catch(error) {
					this.onError(error);
				}
				subscriber.dispatchEvent(event);
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

		this.logger.info(`transaction - ${request.type}`);
		
		if (!this.connected) {
			const error = new Error(`client should be initialized before you can make transaction`);
			throw error;
		}

		const id = uuidv1();

		request.transaction = id;
		
		let r = null;
		let p = null;
		
		try {
			r = JSON.stringify(request);
		} catch(error) {
			return Promise.reject(error);
		}
		
		p = new Promise((resolve, reject) => {
			
			const t = setTimeout(() => {
				if (!this.connected && !this.initializing) {
					this.initialize();
				}
				this.logger.info(`timeout called for ${id}`);
				delete this.calls[id];
				const error = new Error(`${request.type} - timeout`);
				reject(error);
			}, this.transactionTimeout);
			
			const f = (message) => {
				this.logger.info(`resolving transaction ${id} - ${message.transaction}`);
				if (message.transaction===id) {
					clearTimeout(t);
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



	public createRoom = (
		description:string,
		bitrate:number,
		bitrate_cap:boolean,
		videocodec:string,
		vp9_profile:string,
		permanent:boolean
	) => {

		return this.transaction({ 
			type : "create_room", 
			load : {
				description,
				bitrate,
				bitrate_cap,
				videocodec,
				vp9_profile,
				permanent
			} 
		});

	}
	
}

export {
	JanusClient, 
	JanusPublisher, 
	JanusSubscriber 
};