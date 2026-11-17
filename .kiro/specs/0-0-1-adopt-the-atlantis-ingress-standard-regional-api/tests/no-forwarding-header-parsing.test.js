/**
 * Source scan: the function code must not read forwarding headers or the raw
 * API Gateway source IP. The client address comes only from @63klabs/cache-data.
 *
 * Requirements: 3.3, 13.7
 *
 * Every non-test .js file under the function directory is read (node_modules,
 * tests, and coverage directories are skipped at any depth). Block and line
 * comments are removed, then the remaining text is lower-cased and checked.
 * No file is allow-listed.
 *
 * How the checks are scoped:
 *
 * - The plain names (x-forwarded-for, cloudfront-viewer-address, x-real-ip,
 *   x-atlantis-origin-secret) are matched as substrings, in any context.
 * - The name "forwarded" is a common word, so it is matched only where it is a
 *   header name: a string whose whole content is "forwarded" ('forwarded',
 *   "forwarded", `forwarded`), a property access named exactly `.forwarded`, or
 *   a destructuring of `forwarded` out of a headers object. Identifiers such as
 *   `forwardedFor` or text such as "forwarded to the controller" do not match.
 * - identity.sourceIp is matched as a property path (dot, optional chaining, or
 *   bracket access), with optional whitespace.
 *
 * A header name built at run time (for example by concatenating strings) cannot
 * be found by a text scan. That limit is accepted; the guard and routes code is
 * small enough to review for it.
 */

const fs = require("fs");
const path = require("path");

const paths = require("./helpers/paths");

const EXCLUDED_DIRECTORY_NAMES = new Set(["node_modules", "tests", "coverage"]);

/**
 * Forbidden patterns, applied to comment-stripped, lower-cased text.
 * Each entry has a label for the failure message and a regular expression.
 */
const FORBIDDEN_PATTERNS = [
	{ label: "x-forwarded-for", pattern: /x-forwarded-for/ },
	{ label: "cloudfront-viewer-address", pattern: /cloudfront-viewer-address/ },
	{ label: "x-real-ip", pattern: /x-real-ip/ },
	{ label: "x-atlantis-origin-secret", pattern: /x-atlantis-origin-secret/ },
	{ label: "forwarded (header name, quoted)", pattern: /(["'`])\s*forwarded\s*\1/ },
	{ label: "forwarded (header name, property access)", pattern: /\.\s*forwarded(?![\w$])/ },
	{ label: "forwarded (header name, destructured from headers)", pattern: /(?<![\w$.])forwarded(?![\w$])[^;=]*\}\s*=\s*[\w$.?\s]*headers/ },
	{ label: "identity.sourceip (property path)", pattern: /identity\s*\??\.\s*sourceip/ },
	{ label: "identity.sourceip (bracket access)", pattern: /identity\s*\??\.?\s*\[\s*["'`]sourceip/ }
];

// A "/" after one of these characters starts a regular expression literal, not a division
const REGEX_PRECEDING_CHARACTERS = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
const REGEX_PRECEDING_KEYWORDS = /(?:^|[^\w$])(?:return|typeof|case|in|of|delete|void|throw|new|else|do)\s*$/;

/**
 * Remove block and line comments from JavaScript source.
 *
 * The scan is a small state machine, so a "//" or "/*" inside a string, a
 * template literal, or a regular expression literal is kept as code. This
 * matters because a plain regular-expression strip would treat the "//" in
 * "https://example.com" as the start of a comment and hide whatever follows it
 * on the same line.
 *
 * @param {string} source JavaScript source text
 * @returns {string} The source with comments replaced by a single space (block) or nothing (line)
 */
function stripComments(source) {
	const length = source.length;
	let output = "";
	let index = 0;
	let lastSignificant = "";

	while (index < length) {
		const character = source[index];
		const nextCharacter = source[index + 1];

		// Line comment: drop to the end of the line, keep the newline
		if (character === "/" && nextCharacter === "/") {
			while (index < length && source[index] !== "\n") {
				index++;
			}
			continue;
		}

		// Block comment: drop through the closing marker
		if (character === "/" && nextCharacter === "*") {
			const end = source.indexOf("*/", index + 2);
			index = end === -1 ? length : end + 2;
			output += " ";
			continue;
		}

		// String or template literal: copy unchanged
		if (character === "\"" || character === "'" || character === "`") {
			let end = index + 1;
			while (end < length) {
				if (source[end] === "\\") {
					end += 2;
				} else if (source[end] === character) {
					break;
				} else if (character !== "`" && source[end] === "\n") {
					break;
				} else {
					end++;
				}
			}
			output += source.slice(index, end + 1);
			index = end + 1;
			lastSignificant = character;
			continue;
		}

		// Regular expression literal: copy unchanged
		if (character === "/" && (REGEX_PRECEDING_CHARACTERS.has(lastSignificant) || REGEX_PRECEDING_KEYWORDS.test(output))) {
			let end = index + 1;
			let isInClass = false;
			while (end < length) {
				const current = source[end];
				if (current === "\\") {
					end += 2;
					continue;
				}
				if (current === "\n") {
					break;
				}
				if (current === "[") {
					isInClass = true;
				} else if (current === "]") {
					isInClass = false;
				} else if (current === "/" && !isInClass) {
					break;
				}
				end++;
			}
			output += source.slice(index, end + 1);
			index = end + 1;
			lastSignificant = "/";
			continue;
		}

		output += character;
		if (!/\s/.test(character)) {
			lastSignificant = character;
		}
		index++;
	}

	return output;
}

/**
 * Find every forbidden pattern in source text.
 *
 * @param {string} source JavaScript source text
 * @returns {string[]} Labels of the patterns that matched (empty when clean)
 */
function findForbidden(source) {
	const text = stripComments(source).toLowerCase();
	return FORBIDDEN_PATTERNS
		.filter(({ pattern }) => pattern.test(text))
		.map(({ label }) => label);
}

/**
 * Collect every .js file under a directory, skipping excluded directory names at any depth.
 *
 * @param {string} directory Absolute directory path
 * @returns {string[]} Absolute file paths, sorted
 */
function collectJavaScriptFiles(directory) {
	const files = [];
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const fullPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			if (!EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
				files.push(...collectJavaScriptFiles(fullPath));
			}
		} else if (entry.isFile() && entry.name.endsWith(".js")) {
			files.push(fullPath);
		}
	}
	return files.sort();
}

/**
 * @param {string} absolutePath Absolute file path under the function directory
 * @returns {string} Path relative to the function directory, with forward slashes
 */
function toRelative(absolutePath) {
	return path.relative(paths.functionDir, absolutePath).split(path.sep).join("/");
}

const SCANNED_FILES = collectJavaScriptFiles(paths.functionDir);
const SCANNED_RELATIVE_PATHS = SCANNED_FILES.map(toRelative);

describe("no forwarding header parsing in the function code", () => {

	test("the scan covers a non-empty list of files that includes the routes and the guard", () => {
		expect(SCANNED_FILES.length).toBeGreaterThan(0);
		expect(SCANNED_RELATIVE_PATHS).toContain("routes/index.js");
		expect(SCANNED_RELATIVE_PATHS).toContain("utils/ingress-guard.js");
	});

	test("no scanned file contains node_modules, tests, or coverage paths", () => {
		const excluded = SCANNED_RELATIVE_PATHS.filter((relativePath) =>
			relativePath.split("/").some((segment) => EXCLUDED_DIRECTORY_NAMES.has(segment))
		);
		expect(excluded).toEqual([]);
	});

	test("no file reads a forwarding header, the origin secret header, or identity.sourceIp", () => {
		const violations = [];
		for (const file of SCANNED_FILES) {
			const labels = findForbidden(fs.readFileSync(file, "utf8"));
			for (const label of labels) {
				violations.push(`${toRelative(file)}: ${label}`);
			}
		}
		expect(violations).toEqual([]);
	});
});

describe("scan helpers (so the check above cannot pass by missing a match)", () => {

	describe("stripComments", () => {
		test("removes line and block comments", () => {
			const stripped = stripComments("a(); // x-forwarded-for\n/* x-real-ip\n*/ b();");
			expect(stripped).not.toMatch(/x-forwarded-for|x-real-ip/);
			expect(stripped).toContain("a();");
			expect(stripped).toContain("b();");
		});

		test("keeps a // inside a string, so a match after a URL is not hidden", () => {
			const source = "const u = \"https://example.com\"; const h = headers[\"X-Forwarded-For\"];";
			expect(stripComments(source)).toContain("X-Forwarded-For");
			expect(findForbidden(source)).toContain("x-forwarded-for");
		});

		test("keeps a // inside a template literal and a single-quoted string", () => {
			expect(findForbidden("const a = `https://x.test/${id}`; h['x-real-ip'];")).toContain("x-real-ip");
			expect(findForbidden("const a = 'http://x.test'; h['x-real-ip'];")).toContain("x-real-ip");
		});

		test("keeps a // inside a regular expression literal", () => {
			expect(findForbidden("const r = /https?:\\/\\/|\\/\\//; h['x-real-ip'];")).toContain("x-real-ip");
			expect(findForbidden("const r = /[/]\\//; h['x-real-ip'];")).toContain("x-real-ip");
		});

		test("treats a quote inside a comment as text, not as a string start", () => {
			const source = "// don't\nconst h = headers['x-real-ip'];";
			expect(findForbidden(source)).toContain("x-real-ip");
		});

		test("treats a division as a division", () => {
			expect(findForbidden("const a = b / c; const d = e / f; h['x-real-ip'];")).toContain("x-real-ip");
		});
	});

	describe("findForbidden", () => {
		test.each([
			["x-forwarded-for", "headers['X-Forwarded-For']"],
			["cloudfront-viewer-address", "headers[\"CloudFront-Viewer-Address\"]"],
			["x-real-ip", "headers['X-Real-IP']"],
			["x-atlantis-origin-secret", "headers['X-Atlantis-Origin-Secret']"],
			["forwarded (header name, quoted)", "headers['Forwarded']"],
			["forwarded (header name, property access)", "headers.Forwarded"],
			["forwarded (header name, destructured from headers)", "const { forwarded } = event.headers;"],
			["identity.sourceip (property path)", "event.requestContext.identity.sourceIp"],
			["identity.sourceip (property path)", "event.requestContext.identity?.sourceIp"],
			["identity.sourceip (bracket access)", "event.requestContext.identity['sourceIp']"]
		])("detects %s in %s", (label, source) => {
			expect(findForbidden(source)).toContain(label);
		});

		test.each([
			"const forwardedFor = 1;",
			"const forwarded = 1;",
			"obj.forwardedFor = 2;",
			"const message = 'request forwarded to the controller';",
			"// headers['Forwarded'] is not read here",
			"/* identity.sourceIp */ const ok = true;",
			"const { sourceIp } = clientRequest.getClientIp();"
		])("does not flag %s", (source) => {
			expect(findForbidden(source)).toEqual([]);
		});
	});
});
