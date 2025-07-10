const { tools: {Timer, DebugAndLog} } = require("@63klabs/cache-data");
const GamesSampleSvc = require("../models/gamesSample.service");
const GamesSample = require("../views/gamesSample.view");

const logIdentifier = "GamesSample Controller GET";

/**
 * Get function called by Router. This function will dispatch the appropriate task 
 * based on the request properties such as query string or header values.
 * @param {object} props 
 * @returns {object} data
 */
exports.get = async (props) => {

	let data = null;
	const timer = new Timer(logIdentifier, true);
	DebugAndLog.debug(`${logIdentifier}: Properties received`, props);

	return new Promise(async (resolve, reject) => {

		try {
			
			let id = props?.pathParameters?.id;

			DebugAndLog.debug(`${logIdentifier}: id: ${id}`);

			const query = {
				id: id,
				calcMsToDeadline: props?.calcMsToDeadline,
				deadline: props?.deadline
			};

			data = GamesSample.view( await GamesSampleSvc.fetch(query) );

			DebugAndLog.debug(`${logIdentifier}: GamesSample by Id: ${query?.id}`, data);

		} catch (error) {
			DebugAndLog.error(`${logIdentifier}: Error: ${error.message}`, error.stack);
			// we could return an Error object in the data, but for now we will just log it and leave data as null
		} finally {
			timer.stop();
			resolve (data);
		}

	});
}
