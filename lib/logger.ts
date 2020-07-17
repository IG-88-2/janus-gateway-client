import { Consola, BrowserReporter } from 'consola';
const moment = require('moment');



const _logger : any = new Consola({
    level: 3,
    reporters: [
      new BrowserReporter()
    ]
});



const getDatePrefix = () => {

    const date = moment().format('H:mm:ss:SSS');

    return date;

};



export const logger = {
    success: (...args) => {
        
        _logger.success(getDatePrefix(), ...args);

    },
    info: (...args) => {
        
        _logger.info(getDatePrefix(), ...args);
        
    },
    error: (error:any) => {
        
        _logger.error(error);

    },
    json: (...args) => {
        
        _logger.info(`JSON`, getDatePrefix(), ...args);

    },
    tag: (tag:string, type:`success` | `info` | `error`) => (...args) => {
        
        const tagged = _logger.withTag(tag);
        
        if (tagged[type]) {
            tagged[type](getDatePrefix(), ...args);
		}
		
    }
};
