/*
* Application settings file
*
* This file contains application settings that are used throughout the application
* These settings are loaded by the application and can be accessed by any module
* 
* Settings can be loaded from environment variables, other files, or hardcoded values
* 
* For more information on how to use this file, see the README.md file
* 
* Example:
* const { Config } = require("./config");
* const mySetting = Config.settings().someSetting;
* 
* You can organize settings into nested-objects for better structure, but you
* must export a single, top level object called `settings`
*/

// const { tools: {DebugAndLog} } = require("@63klabs/cache-data");

const settings =  {
	"errorExpirationInSeconds": 300,
	"routeExpirationInSeconds": 3600,
	"externalRequestHeadroomInMs": 8000,
	// "someNumSetting": process.env.SOME_SETTING ?? "all" // load environment variables - you should also implement validation
}

module.exports = settings;