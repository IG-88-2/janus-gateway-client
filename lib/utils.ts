const freeice = require('freeice');
const moreIce = freeice();

export const getResolution = (media) => {

	let width = 0;
	let height = 0;
	let maxHeight = 0;

	if (media.video === 'lowres') {
		// Small resolution, 4:3
		height = 240;
		maxHeight = 240;
		width = 320;
	} else if(media.video === 'lowres-16:9') {
		// Small resolution, 16:9
		height = 180;
		maxHeight = 180;
		width = 320;
	} else if(media.video === 'hires' || media.video === 'hires-16:9' || media.video === 'hdres') {
		// High(HD) resolution is only 16:9
		height = 720;
		maxHeight = 720;
		width = 1280;
	} else if(media.video === 'fhdres') {
		// Full HD resolution is only 16:9
		height = 1080;
		maxHeight = 1080;
		width = 1920;
	} else if(media.video === '4kres') {
		// 4K resolution is only 16:9
		height = 2160;
		maxHeight = 2160;
		width = 3840;
	} else if(media.video === 'stdres') {
		// Normal resolution, 4:3
		height = 480;
		maxHeight = 480;
		width  = 640;
	} else if(media.video === 'stdres-16:9') {
		// Normal resolution, 16:9
		height = 360;
		maxHeight = 360;
		width = 640;
	} else {
		height = 480;
		maxHeight = 480;
		width = 640;
	}

	return {
		width,
		height,
		maxHeight
	}

}




export const getMaxBitrates = (simulcastMaxBitrates) => {

	const maxBitrates = {
		high: 900000,
		medium: 300000,
		low: 100000,
	};

	if (simulcastMaxBitrates) {
		if (simulcastMaxBitrates.high) {
			maxBitrates.high = simulcastMaxBitrates.high;
		}
		if (simulcastMaxBitrates.medium) {
			maxBitrates.medium = simulcastMaxBitrates.medium;
		}
		if (simulcastMaxBitrates.low) {
			maxBitrates.low = simulcastMaxBitrates.low;
		}
	}

	return maxBitrates;

}



export const getTransceiver = (pc:RTCPeerConnection, kind:"audio" | "video") : RTCRtpTransceiver => {

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

	return transceiver;

}



export const addTracks = (stream, config) => {
	
	stream.getTracks().forEach((track) => {
		
		if (track.kind === "audio") {
			config.pc.addTrack(track, stream);
		} else {
			const maxBitrates = getMaxBitrates(null);
			config.pc.addTransceiver(track, {
				direction: "sendrecv",
				streams: [stream],
				sendEncodings: [
					{ rid: "h", active: true, maxBitrate: maxBitrates.high },
					{ rid: "m", active: true, maxBitrate: maxBitrates.medium, scaleResolutionDownBy: 2 },
					{ rid: "l", active: true, maxBitrate: maxBitrates.low, scaleResolutionDownBy: 4 }
				]
			});
		}

	});

}



export const updateExistingAudioStream = (config, stream) => {

	const { myStream, pc } = config;
	
	myStream.addTrack(stream.getAudioTracks()[0]);
	
	const audioTransceiver = getTransceiver(pc, "audio");

	if (audioTransceiver && audioTransceiver.sender) {
		audioTransceiver.sender.replaceTrack(stream.getAudioTracks()[0]);
	} else {
		pc.addTrack(stream.getAudioTracks()[0], stream);
	}
	
}



export const updateExistingVideoStream = (config, stream) => {

	const { myStream, pc } = config;
	
	myStream.addTrack(stream.getVideoTracks()[0]);
	
	const videoTransceiver = getTransceiver(pc, "video");

	if (videoTransceiver && videoTransceiver.sender) {
		videoTransceiver.sender.replaceTrack(stream.getVideoTracks()[0]);
	} else {
		pc.addTrack(stream.getVideoTracks()[0], stream);
	}

}



export const pause = (n:number) => new Promise((resolve) => setTimeout(() => resolve(), n));


/*
stun.l.google.com:19305
stun1.l.google.com:19305
stun2.l.google.com:19305
stun3.l.google.com:19305
stun4.l.google.com:19305
*/
/*
remoteFeed.rfid = id;
remoteFeed.rfdisplay = display;
remoteFeed.simulcastStarted = true;
substream, temporal 
private_id
*/
/*
updateExistingAudioStream = (config, stream) => {

	const { myStream, pc } = config;
	
	myStream.addTrack(stream.getAudioTracks()[0]);
	
	const audioTransceiver = getTransceiver(pc, "audio");

	if (audioTransceiver && audioTransceiver.sender) {
		audioTransceiver.sender.replaceTrack(stream.getAudioTracks()[0]);
	} else {
		pc.addTrack(stream.getAudioTracks()[0], stream);
	}
	
}

updateExistingVideoStream = (config, stream) => {

	const { myStream, pc } = config;
	
	myStream.addTrack(stream.getVideoTracks()[0]);
	
	const videoTransceiver = getTransceiver(pc, "video");

	if (videoTransceiver && videoTransceiver.sender) {
		videoTransceiver.sender.replaceTrack(stream.getVideoTracks()[0]);
	} else {
		pc.addTrack(stream.getVideoTracks()[0], stream);
	}

}

addTracks = (stream, callbacks, config) => {
		
	stream.getTracks().forEach((track) => {
		
		if (track.kind === "audio") {
			config.pc.addTrack(track, stream);
		} else {
			const maxBitrates = this.getMaxBitrates(callbacks.simulcastMaxBitrates);
			config.pc.addTransceiver(track, {
				direction: "sendrecv",
				streams: [stream],
				sendEncodings: [
					{ rid: "h", active: true, maxBitrate: maxBitrates.high },
					{ rid: "m", active: true, maxBitrate: maxBitrates.medium, scaleResolutionDownBy: 2 },
					{ rid: "l", active: true, maxBitrate: maxBitrates.low, scaleResolutionDownBy: 4 }
				]
			});
		}

	});

}

const res1 = sdpTransform.parse(offer.sdp);

createPeerConnection = () => {

	const c : RTCConfiguration = {
		"iceServers": this.iceServers,
	};

	c["sdpSemantics"] = "unified-plan";
	
	this.pc = new RTCPeerConnection(c);
	
	if (this.pc.getStats) {
		this.volume = {
			value : null,
			timer : null
		};
		this.bitrate.value = "0 kbits/sec";
	}

	this.pc.oniceconnectionstatechange = (e) => {
		
		log('log')(this.id, `oniceconnectionstatechange`, e);

	}

	this.pc.onicecandidate = (event) => {
		
		if (!event.candidate) {
			
			this.iceDone = true;
			
			this.sendTrickleCandidate({"completed": true});

		} else {
			
			const candidate = {
				"candidate": event.candidate.candidate,
				"sdpMid": event.candidate.sdpMid,
				"sdpMLineIndex": event.candidate.sdpMLineIndex
			};
			
			this.sendTrickleCandidate(candidate);
				
		}

	}

	this.pc.ontrack = (event) => {

		if (!event.streams) {
			return;
		}

		this.remoteStream = event.streams[0];

		//if (this.onremotestream) {
			//this.onremotestream(this.remoteStream);
		//}

		if (event.track.onended) {
			return;
		}

		event.track.onended = (ev) => {
			//if (this.remoteStream && this.onremotestream) {
				//this.remoteStream.removeTrack(ev.target);
				//this.onremotestream(this.remoteStream);
			//}
		};

		event.track.onmute = event.track.onended;

		event.track.onunmute = (ev) => {
			//try {
			//	this.remoteStream.addTrack(ev.target);
			//	this.onremotestream(this.remoteStream);
			//} catch(e) {
				
			//};
		};

	}
	
	this.pc.onnegotiationneeded = this.onNegotiationNeeded;
	this.pc.onicecandidateerror = this.onIceCandidateError;
	this.pc.onicegatheringstatechange = this.onIceGatheringStateChange;
	this.pc.onsignalingstatechange = this.onSignalingStateChange;
	this.pc.onstatsended = stats => {

		log('log')(stats);
		
	};
	
}
*/
