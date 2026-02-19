const { 
	cache: { 
		CacheableDataAccess 
	},
	tools: {
		DebugAndLog,
		Timer
	},
	// endpoint, // uncomment if using endpoint method
} = require("@63klabs/cache-data");

const { Config } = require("../config");

// Instead of endpoint.get you can wrap it in a DAO to perform advanced API access
const { ExampleDao } = require("../models");

const logIdentifier = "Example Service GET";

exports.fetch = async (query) => {

	return new Promise(async (resolve) => {

		let data = {};
		const timer = new Timer(logIdentifier, true);
		DebugAndLog.debug(`${logIdentifier}: Query Received`, query);

		try {

			/* -- EXAMPLE 1: ------------------------------------------------------
			Simple GET request using endpoint.get() with complete URI (no caching) */

			// const data = await endpoint.get({ 
			// 	uri: "https://api.chadkluck.net/games" 
			// });

			/* -- EXAMPLE 2: ------------------------------------------------------
			Simple GET request with connection from config using endpoint.get() (no caching) */

			// const conn = Config.getConn('myConnection');
			// const data = await endpoint.get(conn);

			/* -- EXAMPLE 3: ------------------------------------------------------
			GET request using connection from config using endpoint.get() with caching */

			// const { conn, cacheProfile } = Config.getConnCacheProfile('games', 'default');

			// /* We could add query parameters directly to conn or save them to be passed to DAO for handling */
			// conn.parameters = {
			// 	code: query?.code,
			// };

			// /* Send request through CacheableDataAccess to utilize caching */
			// const cacheObj = await CacheableDataAccess.getData(
			// 	cacheProfile, 
			// 	endpoint.get, // NOTE: do not use () we are passing the function, not executing it! CachableDataAccess will execute on MISS
			// 	conn, 
			// 	null
			// );
			// data = cacheObj.getBody(true);

			/* -- EXAMPLE 4: ------------------------------------------------------
			GET request using connection from config using CacheableDataAccess with 
			caching and ExampleDAO for advanced api handling */
			
			const { conn, cacheProfile } = Config.getConnCacheProfile('games', 'default');

			/* Send request through CacheableDataAccess to utilize caching */
			const cacheObj = await CacheableDataAccess.getData(
				cacheProfile, 
				ExampleDao.get, // use endpoint.get if not using a DAO - NOTE: do not use () we are passing the function, not executing it!
				conn,
				query // set to null if you are not passing any extra data to the DAO
			);

			data = cacheObj.getBody(true);

		} catch (error) {
			DebugAndLog.error(`${logIdentifier}: Error: ${error.message}`, error.stack);
			// we could return an Error object in the data, but for now we will just log it and leave data as null
		} finally {
			timer.stop();
			resolve(data);
		}


	});

};
