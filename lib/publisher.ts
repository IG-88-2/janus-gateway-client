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



interface JanusPublisherOptions {
	transaction:(request:any) => Promise<any>,
	room_id:string,
	configuration:any,
	logger:Logger
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
			logger
		} = options;

		this.ptype = "publisher";

		this.id = uuidv1();
		
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



export default JanusPublisher;
