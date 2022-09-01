/*cjshint esversion: 6 */
/*eslint no-useless-escape: "warn"*/
require(`dotenv`).config();
require(`puppeteer-core`);
const sizeOf = require(`buffer-image-size`);
const DEBUG = 0;
// DEBUG STATES
// 1 = VERBOSE LOGGING
// 2 = TEST WITH ONE PERSON SHUNT
const puppeteer = require(`puppeteer-extra`);
const mysql = require(`mysql2/promise`);
const moment = require(`moment`);
const axios = require(`axios`).default;
const fs = require(`fs`);
const PDFDocument = require(`pdfkit`);
const { S3Client, PutObjectCommand } = require(`@aws-sdk/client-s3`);

const appRoot = require(`app-root-path`);
const projectName = require(`project-name`);
const logJS = process.env.DOCKER_LOGGER_PATH || `${appRoot}/utils/logger`;
const logsDir = process.env.DOCKER_LOG_PATH || `${appRoot}/logs`;
const logFile = `${logsDir}/${projectName()}.log`;
const logger = require(logJS)(`${logFile}`);
logger.info(`Docsend: Logging Docsend at ${logFile}`);

require(`events`).EventEmitter.defaultMaxListeners = 30;
process.setMaxListeners(30);

const captcha_api_key = process.env.CAPTCHA_API_KEY || 0;

const TAKE_SCREENSHOTS = process.env.TAKE_SCREENSHOTS || 0;
const AWS_BUCKET = process.env.AWS_BUCKET || null;
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || null;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || null;
const AWS_REGION = process.env.AWS_REGION || null;
const REGION = AWS_REGION || null;

const { getDocsend, pushPDFtoS3 } = require(`./utils/docsend.js`);

async function wait(ms) {
	return new Promise(resolve => setTimeout(() => resolve(), ms));
}

async function getBrowser() {
	puppeteer.defaultArgs({
		userDataDir: `/browserless-cache`,
	});
	return puppeteer.connect({
		browserWSEndpoint: `ws://browserless:3000`,
	});
}

async function createPage(browser) {
	try {
		const page = await browser.newPage();
		await page.setUserAgent(
			`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.138 Safari/537.36`
		);
		await page.setExtraHTTPHeaders({
			"Accept-Language": `en-US,en;q=0.9`,
			"Referer": `https://docsend.com/`,
			"Upgrade-Insecure-Requests": `1`,
			"sec-ch-ua-platform": `Windows`,
			"sec-ch-ua-platform-version": `10`,
		});

		await page.setViewport({
			width: 1280,
			height: 800,
		});
		return page;
	} catch (e) {
		logger.error(`Docsend: Failed create page `, e);
	}
}

async function main() {
	const docsendUrl =  ``;
	await getDocsend(docsendUrl, `New Deck`, `example@example.com`);
	process.exit();
}

main();