const { 
	cache: { 
		CacheableDataAccess 
	},
	tools: {
		DebugAndLog,
		Timer
	}
} = require("@63klabs/cache-data");

const { Config } = require("../config");
const GamesSample = require("../models/GamesSample.class.dao");

const logIdentifier = "GamesSample Service GET";

exports.fetch = async (query) => {

	return new Promise(async (resolve, reject) => {

		let results = {};
		const timer = new Timer(logIdentifier, true);
		DebugAndLog.debug(`${logIdentifier}: Query Received`, query);

		try {
			// we are going to modify the connection by adding a path
			let connection = Config.getConnection("games");
			let conn = connection.toObject();
			conn.options ??= {};
			conn.options.timeout ??= query?.calcMsToDeadline(query?.deadline) ?? Config.getSettings()?.externalRequestDefaultTimeoutInMs ?? 8000;

			let cacheCfg = connection.getCacheProfile("default");

			/* We can add pre-filters and some logic here, maybe transformations or cross walks as needed.
			We pass only the values needed by the DAO in the query object. 
			If it is date specific, we could calculate today's date or a date range */

			const daoQuery = {
				organizationCode: query?.organizationCode,
				gamePrimaryId: query?.gamePrimaryId
			};

			DebugAndLog.debug(`${logIdentifier}: Query to DAO`, daoQuery);

			/* Send the request through CacheData to see if we have a cached response.
			If we do, we will return it. If not, we will call the function passed as the
			second parameter with the conn and query as parameters to that function and
			use the response to get the data. */
			const cacheObj = await CacheableDataAccess.getData(
				cacheCfg, 
				GamesSample.getGames,
				conn, 
				daoQuery
			);

			results = cacheObj.getBody(true);

			DebugAndLog.debug(`${logIdentifier}: Retrieved games by organizationCode: ${query?.organizationCode}`, results);

		} catch (error) {
			DebugAndLog.error(`${logIdentifier}: Error: ${error.message}`, error.stack);
			// we could return an Error object in the data, but for now we will just log it and leave data as null
		} finally {
			timer.stop();
		}

		resolve(results);

	});

};
