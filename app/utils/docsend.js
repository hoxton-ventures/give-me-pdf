/*cjshint esversion: 6 */
/*eslint no-useless-escape: "warn"*/
require(`dotenv`).config();
const sizeOf = require(`buffer-image-size`);
const DEBUG = process.env?.DEBUG ?? 0;
const TAKE_SCREENSHOTS = process.env?.TAKE_SCREENSHOTS ?? 0;
// DEBUG STATES
// 1 = VERBOSE LOGGING
// 2 = TEST WITH ONE PERSON SHUNT
const puppeteer = require(`puppeteer-extra`);

const axios = require(`axios`).default;
const fs = require(`fs`);
const PDFDocument = require(`pdfkit`);
const { S3Client, PutObjectCommand } = require(`@aws-sdk/client-s3`);

const appRoot = require(`app-root-path`);
const projectName = require(`project-name`);
const logJS = process.env?.DOCKER_LOGGER_PATH ?? `${appRoot}/utils/logger`;
const logsDir = process.env?.DOCKER_LOG_PATH ?? `${appRoot}/logs`;
const logFile = `${logsDir}/${projectName()}`;
const logger = require(logJS)(logFile);
logger.info(`Docsend: Logging Docsend at ${logFile}`);

require(`events`).EventEmitter.defaultMaxListeners = 30;
process.setMaxListeners(30);

const AWS_BUCKET = process.env?.AWS_BUCKET ?? null;
const AWS_ACCESS_KEY_ID=process.env?.AWS_ACCESS_KEY_ID ?? null;
const AWS_SECRET_ACCESS_KEY=process.env?.AWS_SECRET_ACCESS_KEY ?? null;
const AWS_REGION = process.env?.AWS_REGION ?? null;

function wait(ms) {
	return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

async function getBrowser() {
	try {
		puppeteer.defaultArgs({
			userDataDir: `/browserless-cache`,
		});
		return puppeteer.connect({
			browserWSEndpoint: process.env.CHROME_SOCKET_PORT,
		});
	} catch (err) {
		logger.error(`First puppeteer start failed: ${err}`);
		try {
			puppeteer.defaultArgs({
				userDataDir: `/browserless-cache`,
			});
			return puppeteer.connect({
				browserWSEndpoint: process.env.CHROME_SOCKET_PORT,
			});
		} catch (err) {
			logger.error(`Second puppeteer start failed: ${err}`);
			throw `Can't start puppeteer`;
		}
	}
}

async function createPage(browser) {
	try {
		const page = await browser.newPage({defaultViewport: null});
		await page.setUserAgent(
			`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.138 Safari/537.36`
		);
		await page.setExtraHTTPHeaders({
			"Accept-Language": `en-US,en;q=0.9`,
			Referer: `https://docsend.com/`,
			"sec-ch-ua-platform": `Windows`,
			"sec-ch-ua-platform-version": `10`,
		});

		return page;
	} catch (e) {
		logger.error(`Docsend: Failed create page `, e);
	}
}

async function getLinkFromEmail() {
	logger.info(`Waiting 30 seconds for email to come in...`);
	await wait(30000);
	const server_url = ``;
	const res = await fetch(server_url);
	const data = await res.json();
	const link_regex = new RegExp(
		/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?!&//=]*)/gi
	);

	for (const post of data.items) {
		// ITERATE ARRAY UNTIL MOST RECENT ITEM WITH MATCHING post.to ADDRESS
		// address should be something-automation@cmi.hoxtonventures.com
		if (
			post?.to?.indexOf(`automation`) !== -1 ||
      post?.from?.indexOf(`docsend`) !== -1
		) {
			const plain = post?.plain;
			const match_arr = plain.match(link_regex);
			for (const link of match_arr) {
				if (link.indexOf(`presentation_users`) > -1) {
					logger.info(`Docsend: Retrieved two factor link ${link}`);
					return link;
				}
			}
		}
	}
	return null;
	// returns success/failure
}

async function gotoRetry(page, targetUrl, options, maxRetry = 5) {
	let tryGoto = false;
	//console.log(`TargetURL: ${targetUrl}`);
	for (let retry = 1; retry <= maxRetry; retry += 1) {
		tryGoto = await page
			.goto(targetUrl, options)
			.then(async (response) => {
				try {
					const response_json = await response.json();
					return response_json;
				} catch (err) {
					logger.error(`In retry, failed JSON parse, looping again...`);
				}
			})
			.catch((e) => {
				this.logger.error(`ERR [gotoRetry]:`, e.message);
				return false;
			});
		if (tryGoto !== false) break;
	}
	if (tryGoto === false) {
		throw `Failed crawl despite retries`;
	}
	return tryGoto;
}

exports.gotoRetry = gotoRetry;

async function getDocsend(
	docsendUrl,
	filename = `docsend-deck`,
	username = `me@example.com`,
	password = null,
	deleteAttachment = true 
	// delete attachment from server after S3 upload or save for attachment to email
) {
	let PDFname = ``;
	// Check running dockerized
	if (process.env?.DOCKER_LOG_PATH) PDFname = `/PDF/${filename}.pdf`;
	else PDFname = `./${filename}.pdf`;
	logger.info(
		`Fetching ${filename} with ${username} (optional pass: ${password}) - ${docsendUrl}`
	);
	const stream = fs.createWriteStream(PDFname);
	stream.on(`error`, (e) => {
		logger.error(`Filestream error `, e);
	});
	const doc = new PDFDocument({
		layout: `landscape`,
		size: `A4`,
		margin: 0,
		autoFirstPage: false,
	}); //size:'A4',
	doc.pipe(stream);

	const getImageAsBlob = async (url) => {
		return await axios({
			method: `GET`,
			url: `${url}`,
			redirect: `follow`,
			responseType: `arraybuffer`,
			headers: {
				"Accept-Language": `en-US,en;q=0.9`,
				Referer: `https://docsend.com/`,
				"User-Agent": `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36`,
				"sec-ch-ua-platform": `Windows`,
				"sec-ch-ua-platform-version": `10`,
				Accept: `image/webp,image/apng,image/*,*/*;q=0.8`,
			},
		})
			.then(async (response) => {
				wait(5000);
				return await Buffer.from(await response.data, `base64`);
			})
			.catch((e) => {
				logger.error(
					`Docsend: error fetching slide deck images with Axios. ${e.message}`
				);
			});
	};

	const addSlideToPDF = async (imageUrl) => {
		await getImageAsBlob(imageUrl).then(async (data) => {
			const img = await data;
			const dim = sizeOf(img);
			if (dim.width > 300) {
				doc.addPage({ size: [dim.width, dim.height] });
				doc.image(img, 0, 0);
			} else {
				logger.error(`Image ${imageUrl} is too small to add to PDF`);
			}
		});
	};

	const getSlides = async () => {
		for (let i = 1; i <= numSlides; i++) {
			const url = metadataEndpoint + String(i);
			logger.info(`Getting URL ${i} of ${numSlides} ${url}`);
			const gotoTry = await gotoRetry(
				page,
				url,
				{ waitUntil: `networkidle0` },
				3
			);
			const imageUrl = gotoTry?.imageUrl;
			if (imageUrl) {
				await addSlideToPDF(imageUrl);
			}
		}
	};

	const buildPdf = async () => {
		const filePrefix = new Date().getTime();
		const awsName = filePrefix + `-` + filename + `.pdf`;
		await wait(2000);
		doc.end();

		stream.on(`finish`, async () => {
			logger.info(`Docsend: Finished writing PDF to fs`);
		});
		return awsName;
	};

	logger.info(`Docsend: starting scraper`);
	const browser = await getBrowser();
	var page = ``;
	try {
		page = await createPage(browser);
	} catch (err) {
		logger.error(`Docsend: error creating page ${err}`);
		logger.error(`${err.message} ${err.stack}`);
	}
	let headers = {};
	page.on(`request`, (req) => {
		headers = req.headers();
	});

	try {
		await page.goto(docsendUrl, {
			waitUntil: [`networkidle2`, `load`, `domcontentloaded`],
			timeout: 15000,
		});
		await wait(5000);
	} catch (err) {
		if (err.name === `TimeoutError`) {
			logger.error(`Docsend: Puppeteer TimeoutError detected`);
		} else {
			logger.error(`Docsend: Initial pageload failed ${docsendUrl} `, err);
			throw `Failed loading puppeteer - puppeteer error`;
		}
	}

	//Reload to deal with bad cache scenario on recrawl, only needed
	//on multiple sequential tries
	try {
		await page.reload({ waitUntil: [`networkidle0`, `domcontentloaded`] });
	} catch (err) {
		if (err.name === `TimeoutError`) {
			logger.error(`Page reload: Puppeteer TimeoutError detected`);
		} else {
			logger.error(`Page reload: failed `, err);
			throw `Page reload failed - puppeteer error`;
		}
	}

	if (process.env?.TAKE_SCREENSHOTS === 1)
		await page.screenshot({ path: `./ds-screenshot0-first-page.png` });

	const email_or_password = async () =>
		await page.evaluate(() => {
			let count = 0;
			if (document.querySelector(`*`).innerText.match(/Email/)) {
				count++;
			}
			if (document.querySelector(`*`).innerText.match(/Password/i)) {
				count++;
			}
			return count;
		});

	const userIsAuthenticated = async () =>
		await page.evaluate(() => {
			//If prompt doesn't exist, user has entered their email address to access slide deck.
			if (document.getElementById(`prompt`) === null) {
				return true;
			} else {
				return false;
			}
		});

	var is_authenticated = await userIsAuthenticated();
	const login_status = await email_or_password();
	if (login_status === 1) {
		logger.info(`Email entry required without password`);
	} else if (login_status === 2) {
		logger.info(`Email entry required with password`);
	}
	if (DEBUG === 1)
		console.log(`Requires email or password? ${is_authenticated}`);
	if (process.env?.TAKE_SCREENSHOTS === 1)
		await page.screenshot({ path: `./ds-screenshot1-auth-check.png` });

	var numSlides = await page.evaluate(
		() =>
			document
				.getElementsByClassName(`page-label`)[0]
				?.innerHTML?.split(` `)?.[0]
	);
	numSlides = parseInt(numSlides);
	logger.info(`Docsend: number of slides is ${numSlides}`);

	const passcodeProtected = await page.evaluate(() => {
		const el = document.querySelector(`#link_auth_form_passcode`);
		return el ? true : false;
	});

	logger.info(`Docsend: Passcode protected? ${passcodeProtected}`);

	if (is_authenticated === false) {
		logger.warn(
			`Docsend: Needs auth - trying email ${username} / password optional ${password}`
		);
		const searchBox = await page.$(`#link_auth_form_email`);
		if (searchBox) {
			await searchBox.click({ clickCount: 3 });
			await searchBox.press(`Backspace`);
			await page.type(`#link_auth_form_email`, username, {});
		}
		if (passcodeProtected && password !== null) {
			await page.type(`#link_auth_form_passcode`, password, {});
		}
		if (searchBox) {
			logger.info(`Clicking Enter`);
			await searchBox.press(`Enter`);
			await page.keyboard.press(`Tab`);
			await page.keyboard.press(`Enter`);
		} else {
			logger.info(`Didn't find searchbox, trying enter again`);
			await page.keyboard.press(`Enter`);
		}
		await wait(10000);
		if (process.env?.TAKE_SCREENSHOTS === 1)
			await page.screenshot({ path: `./ds-screenshot2-after-wait.png` });

    //Reload for cached login cases
		try {
			await page.reload({ waitUntil: [`networkidle0`, `domcontentloaded`] });
		} catch (err) {
			//let errorJson = JSON.stringify(err);
			if (err.name === `TimeoutError`) {
				logger.error(`Page reload 2: Puppeteer TimeoutError detected`);
			} else {
				//console.log(`${err.name} detected`);
				logger.error(`Page reload: failed `, err);
				throw `Page reload 2 failed - puppeteer error`;
			}
		}
		if (process.env?.TAKE_SCREENSHOTS === 1)
			await page.screenshot({ path: `./ds-screenshot2-after-reload.png` });

		is_authenticated = await userIsAuthenticated();
		logger.info(`Post email auth done? ${is_authenticated}`);
	}

	await wait(7000);

	const check_two_factor = async () => {
		return await page.evaluate(async () => {
			if (
				document.querySelector(`*`).innerText.match(/do not have permission/)
			) {
				return false;
			} else if (
				document.querySelector(`*`).innerText.match(/emailed a link to access/)
			) {
				return true;
			} else return document.querySelector(`*`).innerText;
		});
	};

	const twoFactor = await check_two_factor();

	if (is_authenticated === false && twoFactor === false) {
		logger.info(`Incomplete Docsend or failed two factor`);
		return null;
	} else if (twoFactor === true) {
		logger.info(`Docsend: Two factor auth done`);
		if (process.env?.TAKE_SCREENSHOTS === 1)
			await page.screenshot({ path: `./ds-screenshot3-2-factor-wait.png` });
		const recrawlLink = await getLinkFromEmail();
		return await getDocsend(
			recrawlLink,
			filename,
			username,
			password,
			deleteAttachment
		);
	}
	// if twoFactor is true, then it is a recrawl link and delete the file

	/* ------------------------------------------------- */
	/* POST LOGIN */
	/* ------------------------------------------------- */

	const baseUrl = await page.evaluate(() => window.location.href);
	logger.info(`Docsend: Base URL ${baseUrl}`);

	const metadataEndpoint =
    baseUrl.charAt(baseUrl.length - 1) == `/`
    	? baseUrl + `page_data/`
    	: baseUrl + `/page_data/`;
	let awsName = ``;
	await getSlides();
	awsName = await buildPdf();
	await wait(3000);
	let fileSize = 0;
	if (awsName) fileSize = await pushPDFtoS3(awsName, PDFname);
	await wait(3000);
	if (awsName && PDFname && deleteAttachment) {
		await fs.unlinkSync(PDFname);
		logger.info(`Deleted temp file ${PDFname}`);
	}
	await page.close();
	await browser.disconnect();
	if (awsName)
		awsName = process.env.AMAZON_PUBLIC_URL_PREFIX + awsName;
	return [awsName, PDFname, fileSize];
}

exports.getDocsend = getDocsend;

async function pushPDFtoS3(awsName, PDFname) {
	logger.info(`Docsend: Uploading to s3 ${awsName}...`);
	const fileContent = await fs.readFileSync(PDFname);
	logger.info(
		`Docsend: PDF size ` + (fileContent.length / 1024 / 1024).toFixed(2) + `MB`
	);

	var params = {
		Key: awsName,
		Body: fileContent,
		Bucket: AWS_BUCKET,
		ContentType: `application/pdf`,
		ACL: `public-read`,
	};
	// Create Amazon S3 service object.
	const s3 = new S3Client({ region: AWS_REGION });
	await wait(2000);
	try {
		//console.log(`Trying upload...`);
		const response = await s3.send(new PutObjectCommand(params));
		await wait(5000);
		logger.info(`AWS Response ${response?.[`$metadata`]?.httpStatusCode}`);
		logger.info(
			`Uploaded to S3 ${process.env?.AMAZON_PUBLIC_URL_PREFIX}${awsName}`
		);
		return fileContent.length;
	} catch (err) {
		logger.error(`Docsend: Error in S3 upload ${err}`);
	}
}
exports.pushPDFtoS3 = pushPDFtoS3;
