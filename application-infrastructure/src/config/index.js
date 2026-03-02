
const { 
	cache: {
		Cache,
		CacheableDataAccess
	},
	tools: {
		DebugAndLog,
		Timer,
		CachedParameterSecrets,
		CachedSSMParameter,
		//_ConfigSuperClass,
		AppConfig,
		// ClientRequest,
		// Response,
		// Connections
	} 
} = require("@63klabs/cache-data");

const settings = require("./settings.js");
const validations = require("./validations.js");
const connections = require("./connections.js");
const responses = require("./responses.js");

/**
 * Extends tools.AppConfig
 * Used to create a custom Config interface
 */
class Config extends AppConfig {

	/**
	 * This is custom initialization code for the application. Depending 
	 * upon needs, the init function from the AppConfig and Cache classes
	 * may be used as needed. Init is async, and a promise is stored, allowing the 
	 * lambda function to wait until the promise is finished.
	 */
	static async init() {

		const timerConfigInit = new Timer("timerConfigInit", true);
				
		try {

			AppConfig.init( { settings, validations, connections, responses, debug: true } );

			// Cache settings
			Cache.init({
				secureDataKey: new CachedSSMParameter(process.env.PARAM_STORE_PATH+'CacheData_SecureDataKey', {refreshAfter: 43200}), // 12 hours
			});

			DebugAndLog.debug("Cache: ", Cache.info());

		} catch (error) {
			DebugAndLog.error(`Could not initialize Config ${error.message}`, error.stack);
		} finally {
			timerConfigInit.stop();
		};

		return AppConfig.promise();
	};

	static async prime() {
		return Promise.all([
			CacheableDataAccess.prime(),
			CachedParameterSecrets.prime()
		]);
	};
};

module.exports = {
	Config
};