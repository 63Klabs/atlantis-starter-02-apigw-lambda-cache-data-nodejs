const { tools: {DebugAndLog, APIRequest} } = require("@63klabs/cache-data");
const { ApiSample } = require("./ApiSample.class.dao");

const getGames = async (connection, query) => {
	return (new GamesSample(connection, query).get());
};

class GamesSample extends ApiSample {
	constructor(connection, query) {

		super(connection);
		this.query = query;

		this._setRequest(connection);
	}

	/**
	 * 
	 * @returns {object} Response
	 */

	async get() {
		const initialResponse = await super.get();
		
		if (!initialResponse.success || !("total_record_count" in initialResponse.body) || !("user" in initialResponse.body) || this.request.parameters?.offset > 0) {
			return initialResponse;
		}
	
		const limit = this.request.parameters.limit ??= 100;
		const totalRecords = initialResponse.body.total_record_count;
		
		// Calculate all required offsets
		const offsets = [];
		for (let offset = limit; offset < totalRecords; offset += limit) {
			offsets.push(offset);
		}
	
		if (offsets.length === 0) {
			return initialResponse;
		}
	
		// Process in batches of 5 (or your desired concurrency limit)
		const batchSize = 5;
		const allResults = [];
		
		for (let i = 0; i < offsets.length; i += batchSize) {
			const batchOffsets = offsets.slice(i, i + batchSize);
			const batchPromises = batchOffsets.map(offset => {
				const clonedRequest = {
					...this.request,
					parameters: { ...this.request.parameters, offset },
					note: `${this.request.origNote}[${offset}]`
				};
				
				const instance = new this.constructor(clonedRequest);
				return instance.get();
			});
	
			const batchResults = await Promise.all(batchPromises);
			allResults.push(...batchResults);
		}
	
		// Combine all results
		const allUsers = [
			...initialResponse.body.user,
			...allResults.flatMap(result => result.body.user)
		];
	
		return {
			...initialResponse,
			body: {
				...initialResponse.body,
				user: allUsers
			}
		};
	}
	

	async _call() {

		var response = null;

		try {

			response = await super._call(); // we are good to send the request on

		} catch (error) {
			// something went wrong
			DebugAndLog.error(`Error in GamesSample call: Error: ${error.message}`, error.stack);
			response = APIRequest.responseFormat(false, 500, "Error in call");
		}

		return response;

	};

	_setRequest() {

		this.request.path = "/games/v1/games" + (this.query?.gamePrimaryId ? `/${this.query.gamePrimaryId}` : '');
		this.request.parameters ??= {}; 
		// set query for Data Access Object
		if (this.query?.organizationCode) {
			this.request.parameters.q = `all~${this.query.organizationCode}`;
			this.request.parameters.include_fields = [
				"photo_url", "profile_identifier_url", "game_name", 
				"display_title","position","game_webpages"
			];
			this.request.parameters.limit = this.query.limit ?? 100;
			this.request.parameters.offset = this.query.offset ?? 0;
		}

		DebugAndLog.debug(`Request: ${JSON.stringify(this.request)}`);

		this.request.note += " (games/v1/games/)";
		this.request.origNote = this.request.note;
		
	};

};

module.exports = {
	getGames,
	getDataDirectFromURI
};