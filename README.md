# janus-gateway-client
Logic related to signaling and negotiation between frontend
and nodejs backend. Using this package you can establish connection with nodejs server
which in turn making use of [janus-gateway-node](https://github.com/IG-88-2/janus-gateway-node).  
Package based upon [video](https://www.youtube.com/watch?v=zxRwELmyWU0&t=1s) about scaling [janus-gateway](https://github.com/meetecho/janus-gateway).  
This package is used inside [react-janus-videoroom](https://github.com/IG-88-2/react-janus-videoroom).  

## Getting Started  
```
yarn add janus-gateway-client 
```
![alt text](https://github.com/IG-88-2/janus-gateway-node/blob/master/xxx.png?raw=true)   

## Usage  
```
import { JanusClient } from 'janus-gateway-client';
import ReconnectingWebSocket from 'reconnecting-websocket';

...

const client = new JanusClient({
    onPublisher: this.onPublisher,
    onSubscriber: this.onSubscriber,
    onError: (error) => console.error(error),
    user_id,
    server,
    logger: this.logger,
    WebSocket: ReconnectingWebSocket,
    subscriberRtcConfiguration: rtcConfiguration,
    publisherRtcConfiguration: rtcConfiguration,
    transactionTimeout: 15000,
    keepAliveInterval: 10000
});

this.client.initialize()
.then(() => (

    this.client.getRooms()

))
.then(({ load }) => {

    const rooms = load; //use one of the rooms objects to retrieve room id and join specific room
    
    this.connected = true;

});
```  

## Options 

### server

> `string` | _required_

server running [janus-gateway-node](https://github.com/IG-88-2/janus-gateway-node).

```
const server = "wss://yoururl.com";
```

### onSubscriber

> `(subscriber:JanusSubscriber) => void` | _required_

this function will notify user when new participant joined room in which user currently publishing media.  

```
const onSubscriber = async (subscriber) => {
		
    subscriber.addEventListener("terminated", this.onSubscriberTerminated(subscriber));

    subscriber.addEventListener("leaving", this.onSubscriberLeaving(subscriber));

    subscriber.addEventListener("disconnected", this.onSubscriberLeaving(subscriber));
    
    try {

        await subscriber.initialize();
        
        if (this.props.onParticipantJoined) {
            this.props.onParticipantJoined(subscriber);
        }

        const subscribers = this.getSubscribers();
        
        if (this.nParticipants!==subscribers.length) {
            this.nParticipants = subscribers.length;
            this.onParticipantsAmountChange();
        }

        this.forceUpdate();
        
    } catch(error) {
        
        this.props.onError(error);

    }
    
}
```

### onPublisher

> `(publisher:JanusPublisher) => void` | _required_

called after publisher succesfully joined room.

```
const onPublisher = async (publisher) => {

    publisher.addEventListener("terminated", this.onPublisherTerminated(publisher));

    publisher.addEventListener("disconnected", this.onPublisherDisconnected(publisher));
    
    if (this.props.onConnected) {
        this.props.onConnected(publisher);
    }

    this.forceUpdate();

}
```

### WebSocket

> `any` | _required_

websocket instance.

### transactionTimeout

> `number` | _required_

time interval before incomplete transaction will throw timeout error.

### keepAliveInterval

> `number` | _required_

keepalive time interval for user.

### user_id

> `user_id` | _required_

unique user identifier.

### onError

> `(error:any) => void` | _required_

in case error occurred this. function will be invoked to notify user about error.  

### logger

> `Logger` | _required_

customize logging

```
interface Logger {
	enable: () => void,
	disable: () => void,
	success: (...args:any[]) => void,
	info: (...args:any[]) => void,
	error: (error:any) => void,
	json: (...args:any[]) => void,
	tag: (tag:string, type:`success` | `info` | `error`) => (...args:any[]) => void
}
```

### subscriberRtcConfiguration

> `any` | optional

### publisherRtcConfiguration

> `any` | optional

## Instance methods  

### initialize

> `() => Promise<JanusPublisher[]>`

establish connection with the server.

```
...
await this.client.initialize();
```

### terminate

> `() => Promise<void>`

terminate connection with server, perform cleanup actions.

```
...
await this.client.terminate();
```

### replaceVideoTrack

> `(cameraDeviceId:string) => Promise<void>`

replace current video source.

```
...
await this.client.replaceVideoTrack(this.props.cameraId);
```

### join

> `(room_id:string, mediaConstraints?: MediaStreamConstraints) => Promise<void>`

join specific room as a publisher and subscribe to all available participants feeds.

```
...
await this.client.join(room_id, mediaConstraints);
```

### leave

> `() => Promise<void>`

leave room in which user currently resides.

```
...
await this.client.leave();
```

## DEMO

[link](https://kreiadesign.com/)

## Contributing
Please consider to help by providing feedback on how this project can be 
improved or what is missing to make it useful for community. Thank you!
## Authors

* **Anatoly Strashkevich**

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details
