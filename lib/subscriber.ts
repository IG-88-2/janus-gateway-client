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
import { v1 as uuidv1 } from 'uuid';
import { getTransceiver } from './utils';



interface Logger {
	enable: () => void,
	disable: () => void,
	success: (...args:any[]) => void,
	info: (...args:any[]) => void,
	error: (error:any) => void,
	json: (...args:any[]) => void,
	tag: (tag:string, type:`success` | `info` | `error`) => (...args:any[]) => void
}



interface JanusSubscriberOptions {
	transaction:any, 
	room_id:string,
	feed:string,
	configuration:any,
	logger:Logger
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
	logger: Logger

	constructor(options:JanusSubscriberOptions) {

		super();

		const { 
			transaction, 
			room_id,
			feed,
			configuration,
			logger
		} = options;

		this.id = uuidv1();
		
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



export default JanusSubscriber;
