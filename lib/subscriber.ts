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

interface JanusSubscriberOptions {
	transaction:any, 
	room_id:string,
	feed:string,
	configuration?,
	onTerminated:() => void
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
	onTerminated:() => void
	attached: boolean


	constructor(options:JanusSubscriberOptions) {

		super();

		const { 
			transaction, 
			room_id,
			feed,
			configuration,
			onTerminated
		} = options;

		this.id = uuidv1();
		
		this.transaction = transaction;

		this.onTerminated = onTerminated; 

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
		
		this.createPeerConnection();

		this.addEventListener("leaving", () => {

			console.log('on leaving internal');

			this.terminate();

		});
	  
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
	
		if (this.attached) {
			await this.hangup();
			await this.detach();
		}

		if (this.pc) {
			this.pc.close();
		}
		
		this.onTerminated();

	}

	

	public createPeerConnection = () => {

		//TODO this.pc.getStats

		const configuration = {
			"iceServers": [{
				urls: "stun:stun.voip.eutelia.it:3478"
			}],
			"sdpSemantics": "unified-plan"
		};
		
		this.pc = new RTCPeerConnection(configuration);
		
		this.pc.oniceconnectionstatechange = (event) => {
			
		};

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

			this.stream = stream; //removeTrack, addTrack
			
			stream.onaddtrack = (t) => {
				


			};

			stream.onremovetrack = (t) => {

				

			};
			
			event.track.onended = (e) => {
				
				console.log('track onended', e);

			};

			event.track.onmute = (e) => {


				
			};

			event.track.onunmute = (e) => {


				
			};
			
		}
		
		this.pc.onnegotiationneeded = () => {

			console.log(this.pc.signalingState);

		};

		this.pc.onicecandidateerror = error => {
		
			console.log(error);
		
		};

		this.pc.onicegatheringstatechange = e => {

			console.log(this.pc.iceGatheringState);

		};
		
		this.pc.onsignalingstatechange = e => {

			console.log('onsignalingstatechange', this.pc.signalingState);
			
		};
		
		this.pc.onstatsended = stats => {

			console.log(stats);
			
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



	public createAnswer = (jsep) => {
		
		return this.pc
		.setRemoteDescription(jsep)
		.then(() => {
			
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
				vt = this.pc.addTransceiver("video", { direction: "recvonly" }); //"recvonly" "sendonly" "sendrecv" "inactive"
				at = this.pc.addTransceiver("audio", { direction: "recvonly" });
			}
			
			return this.pc.createAnswer({
				iceRestart: true
			})
			.then((answer) => {
				
				this.pc.setLocalDescription(answer);
				
				return answer;

			});

		});

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

		return this.transaction(request);

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



	configure = ({ jsep }) => {

	

	}



	mute = () => {



	}



	unmute = () => {



	}



	pause = ({
		video,
		audio
	}) => {



	}



	resume = ({
		video,
		audio
	}) => {



	}
	
}



export default JanusSubscriber;
