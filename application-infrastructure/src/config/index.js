
const { cache, tools } = require('@63klabs/cache-data');
const settings = require("./settings.json"); // settings.json must have settings, policies, and referrers properties
const validations = require("./validations.js");
const connections = require("./connections.js");

/* increase the log level - comment out when not needed  */
// tools.DebugAndLog.setLogLevel(5, "2025-10-30T04:59:59Z"); // we can increase the debug level with an expiration

/**
 * Extends tools._ConfigSuperClass
 * Used to create a custom Config interface
 * Usage: should be placed near the top of the script file outside 
 * of the event handler. It should be global and must be initialized.
 * @example
 * const obj = require("./classes.js");
 * obj.Config.init();
 */
class Config extends tools._ConfigSuperClass {

	/**
	 * This is custom initialization code for the application. Depending 
	 * upon needs, the _init functions from the super class may be used
	 * as needed. Init is async, and a promise is stored, allowing the 
	 * lambda function to wait until the promise is finished.
	 */
	static async init() {
		
		tools._ConfigSuperClass._promise = new Promise(async (resolve, reject) => {

			const timerConfigInit = new tools.Timer("timerConfigInit", true);
				
			try {

				tools.ClientRequest.init( { validations } );
				tools.Response.init( { settings } );
				tools._ConfigSuperClass._connections = new tools.Connections(connections);

				// Cache settings
				cache.Cache.init(); // we will leave empty and use the Lambda environment variables
				tools.DebugAndLog.debug("Cache: ", cache.Cache.info());
				
				resolve(true);
			} catch (error) {
				tools.DebugAndLog.error(`Could not initialize Config ${error.message}`, error.stack);
				reject(false);
			} finally {
				timerConfigInit.stop();
			};
			
		});

	};

	static async prime() {
		return Promise.all([
			cache.CacheableDataAccess.prime(),
			tools.CachedParameterSecrets.prime()
		]);
	};
};

module.exports = {
	Config
};