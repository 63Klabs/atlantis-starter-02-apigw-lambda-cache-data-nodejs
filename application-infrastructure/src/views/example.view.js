/* A view filters, transforms, and maps data from the model, or models, to a response 
	A view should be called from the controller, or if the view is cached, from the service.
*/

const { tools: {Timer} } = require("@63klabs/cache-data");
const { DebugAndLog } = require("@63klabs/cache-data/src/lib/tools");

const logIdentifier = "Example View";

/** 
 * Generic filter to exclude null values
 * @param {object} data 
 * @returns {boolean} exclude 
 */
const filter = (dataItem = null) => {
	let include = true;
	if (dataItem == null) return false;
	return include;
}

// For this data we want to assign an index to each item in the view, so we can track it
let index = 0;

/**
 * Generic transformer
 * @param {object} data 
 * @returns {object} data
 */
const transform = (data) => {

	const returnData = {
		game_id: `G-${++index}`,
		display_name: data
	};

	return returnData;
}

/**
 * Generic view
 * @param {object} resultsFromSvc
 * @returns {{count: number, items: Array<{id: number, display: string}>}} data
 */
exports.view = (resultsFromSvc) => {
	const viewTimer = new Timer(`Timer: ${logIdentifier}`, true);

	// if data then data else empty array
	const dataArray = Array.isArray(resultsFromSvc?.gamechoices) ? resultsFromSvc?.gamechoices : [];

	// The filter and transform functions can be customized or replaced as needed
	// They can also be combined so that the filter and transform are done in one pass 
	// which is more efficient especially for large datasets, 
	// But for clarity we will keep them separate here.

	// filter the data
	const filteredArray = dataArray.filter((item) => filter(item));

	// transform the data
	const transformedArray = filteredArray.map((item) => transform(item));

	// put new Array back in data
	const finalView = { count: transformedArray.length, items: transformedArray};

	viewTimer.stop();

	return finalView;	

}

/* ====================================================================================================
    Non-Generic
    ====================================================================================================*/

// add new views here