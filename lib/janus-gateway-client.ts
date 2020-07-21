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
import ReconnectingWebSocket from 'reconnecting-websocket';
import JanusPublisher from './publisher';
import JanusSubscriber from './subscriber';



const waitUntil = async (f, timeout, defaultInterval?) => {

    let interval = defaultInterval || 1000;
  
    let time = 0;
  
    const w = async (resolve, reject) => {
  
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
  
};



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



class JanusClient {
	server:string
	room_id:string
	ws:ReconnectingWebSocket
	connected:boolean
	connecting:boolean
	publisher:JanusPublisher
	subscribers:{ [id:string] : JanusSubscriber }
	calls:{ [id:string] : (message:any) => void } 
	keepAlive:NodeJS.Timeout
	keepAliveInterval:number
	transactionTimeout:number
	socketOptions:any
	onSubscriber: (subscriber:JanusSubscriber) => void
	onPublisher: (publisher:JanusPublisher) => void
	notifyConnected: () => void
	onError: (error:any) => void
	logger: any
	
	constructor(options:JanusOptions) {

		const { 
			server, 
			onSubscriber,
			onPublisher,
			onError,
			logger
		} = options;
		
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

		this.ws = new ReconnectingWebSocket(
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
				configuration: {}
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



export default JanusClient;
