import { tools } from "@63klabs/cache-data";

import path from 'path';
import { fileURLToPath } from 'url';

import { readFile } from 'fs/promises';

import { expect } from "chai";

import validations from '../config/validations.js';


console.log(`Testing Against Node version ${tools.nodeVerMajor} (${tools.nodeVer})`);
if (tools.nodeVerMajor < 22) {
	console.log("Node version is too low, skipping tests");
	process.exit(0);
}
if (tools.nodeVerMajor < 22) {
	console.warn("Upgrade your Lambda function to use Node v22 or higher");
}

console.log(`Node ${tools.AWS.NODE_VER} MAJOR ${tools.AWS.NODE_VER_MAJOR} MINOR ${tools.AWS.NODE_VER_MINOR} PATCH ${tools.AWS.NODE_VER_PATCH} MAJOR MINOR ${tools.AWS.NODE_VER_MAJOR_MINOR} SDK ${tools.AWS.SDK_VER} REGION ${tools.AWS.REGION} V2 ${tools.AWS.SDK_V2} V3 ${tools.AWS.SDK_V3}`, tools.AWS.nodeVersionArray);
console.log(`tools.AWS.INFO`, tools.AWS.INFO);

/* ****************************************************************************
 * Validations
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Test validations from config/validations.js', () => {

	describe('validations.parameters.pathParameters.statusCode', () => {

		let statusCodes;

		before(async () => {
			try {
				const filePath = path.join(__dirname, '..', 'data', 'statusCodes.json');
				const fileContent = await readFile(filePath, 'utf8');
				statusCodes = JSON.parse(fileContent);
			} catch (error) {
				console.error('Error loading statusCodes.json:', error);
				throw error; // Re-throw to fail the test setup if file can't be loaded
			}
		});

		it('should validate all entries in statusCodes.json', () => {
			statusCodes.forEach(code => {
				expect(validations.parameters.pathParameters.code(code.code), `Status code ${code.code} should be valid`).to.be.true;
			});
		});

		it('should reject invalid org codes', () => {
			const invalidCodes = ['', '123', 'ABCD', 'A1', '1A', 'AAA'];
			invalidCodes.forEach(code => {
				expect(validations.parameters.pathParameters.code(code), `Status code ${code} should be invalid`).to.be.false;
			});
		});

		it('should validate status code format', () => {
			statusCodes.forEach(code => {
				expect(code.code).to.match(/^[a-z]*$/);
			});
		});

		it('should ensure all status codes are unique', () => {
			const statusCodeValues = statusCodes.map(code => code.code);
			const uniqueCodes = new Set(statusCodeValues);
			expect(uniqueCodes.size).to.equal(statusCodes.length);
		});

		it('should validate a manually submitted org code', () => {
			const orgCode = 'hidden'
			expect(validations.parameters.pathParameters.code(orgCode), `Status code ${orgCode} should be valid`).to.be.true;
		});

		it('should reject a manually submitted org code', () => {
			const orgCode = 'blah_blah_not_valid'
			expect(validations.parameters.pathParameters.code(orgCode), `Status code ${orgCode} should not be valid`).to.be.false;
		});
	});

	describe('validations.parameters.pathParameters.gamePrimaryId', () => {
		it('should validate a valid game ID', () => {
			const gamePrimaryId = '6';
			expect(validations.parameters.pathParameters.id(gamePrimaryId)).to.be.true;
		});

		it('should reject an invalid game ID', () => {
			const gamePrimaryId = 'invalid_game_id';
			expect(validations.parameters.pathParameters.id(gamePrimaryId)).to.be.false;
		});
		
		it('should reject an invalid game ID based on negative value', () => {
			const gamePrimaryId = '-1';
			expect(validations.parameters.pathParameters.id(gamePrimaryId)).to.be.false;
		});

		it('should reject an invalid game ID based on length (too long)', () => {
			const gamePrimaryId = '102';
			expect(validations.parameters.pathParameters.id(gamePrimaryId)).to.be.false;
		});

	})
});

