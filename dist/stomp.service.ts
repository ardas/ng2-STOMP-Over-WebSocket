import { Injectable } from '@angular/core';
import * as Stomp from 'stompjs';
import * as SockJS from 'sockjs-client';

interface Config {
	//websocket endpoint
	host:string;
	//optional headers
	headers?:Object;
	//heartbeats (ms)
	heartbeatIn?: number;
	heartbeatOut?: number;
	//debuging
	debug?:boolean;
	//reconnection time (ms)
	recTimeout?:number;
	firstReconnectMaxRandomTimeout?:number;
	maxRecTimeout?:number;
	timeoutMultiplier?:number;
	//queue object
	queue:any;
	//queue cheking Time (ms)
	queueCheckTime?: number;
}


@Injectable()
export class StompService {

	public config = null;

	private socket: any;

	public stomp : any;

	private timer: any;
	private timerTry = 0;

	private resolveConPromise: (...args: any[]) => void;
	private rejectConPromise: (...args: any[]) => any;
	public queuePromises = [];

	private disconnectPromise: any;
	private resolveDisConPromise: (...args: any[]) => void;

	public status: string;



	constructor() {

		this.status = 'CLOSED';

		//Create promise
	 	this.disconnectPromise = new Promise(
	 	  (resolve, reject) => this.resolveDisConPromise = resolve
	 	);
	}


	/**
	 * Configure
	 */
	public configure(config: Config):void{
		this.config = config;
	}


	/**
	 * Try to establish connection to server
	 */
	public startConnect(): Promise<{}>{
		if (this.config === null) {
      		throw Error('Configuration required!');
    	}

		this.status = 'CONNECTING';

		//Prepare Client
		this.socket = new SockJS(this.config.host, undefined, {...this.config.options});
		this.stomp = Stomp.over(this.socket);

		this.stomp.heartbeat.outgoing = this.config.heartbeatOut || 10000;
		this.stomp.heartbeat.incoming = this.config.heartbeatIn || 10000;

		//Debuging connection
		if(this.config.debug){
			this.stomp.debug = function(str) {
			  console.log(str);
			};
		}else{
			this.stomp.debug = false;
		}

		//Connect to server
		this.stomp.connect(this.config.headers || {}, this.onConnect,this.onError);
		return new Promise(
			(resolve, reject) => {
				this.resolveConPromise = resolve;
				this.rejectConPromise = reject;
			}
		);
		
	}


	/**
	 * Successfull connection to server
	 */
	public onConnect = (frame:any) => {
	 	this.status = 'CONNECTED';
	 	this.resolveConPromise();
	 	this.clearTimer();
	 	//console.log('Connected: ' + frame);
	}

	/**
	 * Unsuccessfull connection to server
	 */
	public onError = (error: string ) => {

		console.warn('error', error);
		this.rejectConPromise();

		// Check error and try reconnect
		if (error.indexOf && error.indexOf('Lost connection') !== -1) {
			const reconnectTimeout = this.increaseAndGetReconnectTime();
			if(this.config.debug){
				console.log(`Reconnecting in ${reconnectTimeout / 1000} sec...`);
			}
			this.timer = setTimeout(() => {
				this.startConnect();
			}, reconnectTimeout);
		}
	}

	/**
	 * Subscribe 
	 */
	public subscribe(destination:string, callback:any, headers?:Object){
		headers = headers || {};
		return this.stomp.subscribe(destination, function(response){
			let message = JSON.parse(response.body);
			let headers = response.headers;
			callback(message,headers);
		},headers);
	}

	/**
	 * Unsubscribe
	 */
	public unsubscribe(subscription:any){
		subscription.unsubscribe();
	}


	/**
	 * Send 
	 */
	public send(destination:string, body:any, headers?:Object):void {
		let message = JSON.stringify(body);
		headers = headers || {}
		this.stomp.send(destination, headers, message);
	}


	/**
	 * Disconnect stomp
	 */
	public disconnect(): Promise<{}> {
		this.stomp.disconnect(() => {this.resolveDisConPromise(); this.status = 'CLOSED'});
		this.clearTimer();

		return this.disconnectPromise;
	}



	/**
	 * After specified subscription
	 */
	public after(name:string): Promise<{}> {
		this.nameCheck(name);
		if(this.config.debug) console.log('checking '+name+' queue ...');
		let checkQueue = setInterval(()=>{
			if(this.config.queue[name]){
      	clearInterval(checkQueue);
      	this.queuePromises[name]();
      	if(this.config.debug) console.log('queue '+name+' <<< has been complated');
      	return false;
      }
		},this.config.queueCheckTime || 100);

		if(!this.queuePromises[name+'promice']){
			this.queuePromises[name+'promice'] = new Promise(
	 	  	(resolve, reject) => this.queuePromises[name] = resolve
	 		);
		}
		return this.queuePromises[name+'promice'];
	}


	/**
	 * Done specified subscription
	 */
	public done(name:string):void{
		this.nameCheck(name);
		this.config.queue[name] = true;
	}


	/**
	 * Turn specified subscription on pending mode
	 */
	public pending(name:string):void{
		this.nameCheck(name);
		this.config.queue[name] = false;
		if(this.config.debug) console.log('queue '+name+' <<<<<<  turned on pending mode');
	}


	/**
	 * Check name in queue
	 */
	private nameCheck(name:string):void{
		if(!this.config.queue.hasOwnProperty(name)){
			throw Error("'"+name+"' has not found in queue");
		}
	}

	private clearTimer() {
		this.timer && clearTimeout(this.timer);
		this.timer = null;
		this.timerTry = 0;
	}

	private increaseAndGetReconnectTime() {
		const defaultTimeout = this.config.recTimeout || 5000;
		this.timerTry += 1;
		if (this.timerTry === 1 && this.config.firstReconnectMaxRandomTimeout) {
			return Math.floor(Math.random() * this.config.firstReconnectMaxRandomTimeout);
		}
		const timeoutMultiplier = this.config.timeoutMultiplier || 2;
		const maxTimeout = this.config.maxRecTimeout || 24 * 3600 * 1000;
		return Math.min(maxTimeout, defaultTimeout * (Math.pow(timeoutMultiplier, this.timerTry - 1)));
	}

}