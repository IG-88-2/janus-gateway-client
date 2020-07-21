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
