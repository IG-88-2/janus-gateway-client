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
import { logger } from './logger';
import ReconnectingWebSocket from 'reconnecting-websocket';
import JanusPublisher from './publisher';
import JanusSubscriber from './subscriber';

//v1

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
	onError: (error:any) => void
}



class JanusClient {
	server:string
	room_id:string
	ws:ReconnectingWebSocket
	connected:boolean
	publisher:JanusPublisher
	subscribers:{ [id:string] : JanusSubscriber }
	calls:{ [id:string] : (message:any) => void } 
	keepAliveInterval:NodeJS.Timeout
	transactionTimeout:number
	onSubscriber: (subscriber:JanusSubscriber) => void
	onPublisher: (publisher:JanusPublisher) => void
	onError: (error:any) => void
	notifyConnected: () => void

	constructor(options:JanusOptions) {

		const { 
			server, 
			onSubscriber,
			onPublisher,
			onError
		} = options;

		this.server = server;
		this.ws = null;
		this.connected = false;
		this.subscribers = {};
		this.calls = {};
		this.onPublisher = onPublisher;
		this.onSubscriber = onSubscriber;
		this.onError = onError;
		this.transactionTimeout = 10000;
	}



	public initialize = () : Promise<void> => {
		
		this.ws = new ReconnectingWebSocket(
			this.server, 
			[],
			{
				WebSocket,
				connectionTimeout: 1000,
				maxRetries: 10
			}
		);

		this.ws.addEventListener('message', (response:MessageEvent) => {
			
			let message = null;

			try {
				message = JSON.parse(response.data);
			} catch(error) {}

			if (message) {
				const id = message.transaction;
				if (!id) {
					this.onEvent(message);
				} else {
					const resolve = this.calls[id];
					if (resolve) {
						resolve(message);
					}
				}
			}
		});

		this.ws.addEventListener('open', () => {

			this.connected = true;

			if (this.notifyConnected) {
				this.notifyConnected();
				delete this.notifyConnected;
			}

			this.keepAliveInterval = setInterval(() => {
				
				this.transaction(({ type:'keepalive' }))
				.catch((error) => {

					this.onError(error);

				});

			}, 5000);

		});
		
        this.ws.addEventListener('close', () => {

			this.connected = false;

			clearInterval(this.keepAliveInterval);

			this.keepAliveInterval = undefined;
			
		});
		
		this.ws.addEventListener('error', error => {
			
			logger.error(error);

		});

		return new Promise((resolve) => {

			this.notifyConnected = () => resolve();

		});
	}



	public terminate = async () => {
		
		if (this.publisher) {
			await this.publisher.terminate();
		}
		
		for(const id in this.subscribers) {
			const subscriber = this.subscribers[id];
			await subscriber.terminate();
		}

		this.subscribers = {};

		this.ws.close();
	}



	public leave = async () => {
		
		if (this.publisher) {
			await this.publisher.terminate();
		}

		this.publisher = undefined;

		for(const id in this.subscribers) {
			const subscriber = this.subscribers[id];
			const event = new Event('leaving');
			subscriber.dispatchEvent(event);
		}
		
		this.subscribers = {};
	}



	public mute = async () => {

		if (!this.publisher) {
			throw new Error('you should join room first');
		}

		return await this.publisher.configure({
			audio:false
		});
	}



	public unmute = async () => {

		if (!this.publisher) {
			throw new Error('you should join room first');
		}

		return await this.publisher.configure({
			audio:true
		});
	}



	public pause = async () => {

		if (!this.publisher) {
			throw new Error('you should join room first');
		}

		return await this.publisher.configure({
			video:false
		});
	}



	public resume = async () => {

		if (!this.publisher) {
			throw new Error('you should join room first');
		}

		return await this.publisher.configure({
			video:true
		});
	}



	private transaction = (request) => {

		const timeout = this.transactionTimeout;

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
			
			let t = setTimeout(() => {
				delete this.calls[id];
				const error = new Error(`${request.type} - timeout`);
				reject(error);
			}, timeout);
			

			const f = (message) => {
				
				if (message.transaction===id) {
					if (timeout){
						clearTimeout(t);
					}
					delete this.calls[id];
					if (message.type==="error") {
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



	private onEvent = async (json) => {
		
		if (json.type==="trickle") {
			const {
				sender,
				data
			} = json;
			if (this.publisher.handle_id===sender) {
				this.publisher.receiveTrickleCandidate(data);
			} else {
				for(const id in this.subscribers) {
					const subscriber = this.subscribers[id];
					if (subscriber.handle_id===sender) {
						subscriber.receiveTrickleCandidate(data);
					}
				}
			}
		} else if (json.type==="publishers") {
			const publishers : Participant[] = json.data;
			this.onPublishers(publishers);
		} else if (json.type==="media") {
			const { 
				sender, 
				data 
			} = json;
			const event = new Event('media', data)
			if (this.publisher.handle_id===sender) {
				this.publisher.dispatchEvent(event);
			} else {
				for(const id in this.subscribers) {
					const subscriber = this.subscribers[id];
					if (subscriber.handle_id===sender) {
						subscriber.dispatchEvent(event);
					}
				}
			}
		} else if (json.type==="leaving") {
			const { 
				leaving 
			} = json.data;
			const event = new Event('leaving');
			for(const id in this.subscribers) {
				const subscriber = this.subscribers[id];
				if (subscriber.feed===leaving) {
					subscriber.dispatchEvent(event);
				}
			}
		} else if (json.type==="internal") {

			logger.json(json);

			if (this.publisher && this.publisher.handle_id===json.sender) {
			
			} else {
				for(const id in this.subscribers) {
					const subscriber = this.subscribers[id];
					if (subscriber && subscriber.handle_id===json.sender) {
						
					}
				}
			}
		}
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



	public join = async (room_id:string) : Promise<void> => {
		
		this.room_id = room_id;

		if (this.publisher) {
			try {
				await this.publisher.terminate();
			} catch(error){}
		}

		this.publisher = new JanusPublisher({
			room_id: this.room_id,
			transaction: this.transaction
		});
		
		const publishers = await this.publisher.initialize();
		
		this.onPublishers(publishers);

		this.onPublisher(this.publisher);
	}



	private onPublishers = async (publishers : Participant[]) : Promise<void> => {
		
		for(let i = 0; i < publishers.length; i++) {

			const publisher = publishers[i];

			const feed = publisher.id;

			if (this.subscribers[feed]) {
				continue;
			}

			const subscriber = new JanusSubscriber({
				transaction: this.transaction, 
				room_id: this.room_id,
				feed,
				configuration: {},
				onTerminated: () => {
	
					delete this.subscribers[feed];
	
				}
			});

			this.subscribers[feed] = subscriber;

			this.onSubscriber(subscriber);

		}
	}
}



export default JanusClient;
