/*jshint esversion: 6 */
require(`dotenv`).config();
const fuzz = require(`fuzzball`);
const unidecode = require(`unidecode-plus`);
const decode = require(`unescape`);
const _ = require(`lodash`);
//const sanitizeHtml = require(`sanitize-html`);
const appRoot = require(`app-root-path`);
const projectName = require(`project-name`);
const { getDocsend } = require(`${appRoot}/utils/docsend.js`);
const Pushover = require(`pushover-js`).Pushover;
const nodemailer = require(`nodemailer`);
const { unlinkSync, existsSync } = require(`fs`);

const logJS = (process.env?.DOCKER_LOGGER_PATH ?? `${appRoot}/utils/logger`);
const logsDir = (process.env?.DOCKER_LOG_PATH ?? `${appRoot}/logs`);
const logFile = `${logsDir}/${projectName()}`;
const logger = require(logJS)(`${logFile}`); 

const pushover_user = process.env?.PUSHOVER_USER ?? `null`;
const pushover_token = process.env?.PUSHOVER_API_KEY ?? `null`;

function cleanText(text) {
	if (text) {
		text = decodeURIComponent(text);
		text = unidecode(text);
		text = text.replace(/&#..;/g, ``);
		text = text.replace(/'/g, ``);
		text = text.replace(/\\/g, ``);
		return text;
	}
	return ``;
}

exports.docwatch_add = async function (req, res) {
	try {
		res.send(`docwatch_add`);
		const body = req.body;
		var ret = ``;
		if (body?.envelope?.to?.match(`docsend@`)){
			ret = await fetch_return_docsend(body);
		} else ret = await fetch_to_crm(body);
		return ret;
	} catch (error) {
		logger.error(`Error in add ${error}`);
	}
};

function crunchbaseFilter(domain) {
	if (
		domain &&
		domain.match(`crunchbase.com/organization`)
	)
		return true;
	return false;
}

function linkedinFilter(domain) {
	if (domain && domain.match(`linkedin.com/company`))
		return true;
	return false;
}

function dealroomFilter(domain) {
	if (domain && domain.match(`dealroom.co/`))
		return true;
	return false;
}

function filterDomains(domain) {
	//common junk domains
	if (domain && domain.match(`crunchbase.com`)) return false;
	if (domain && domain.match(`w3.org`)) return false;
	if (domain && domain.match(`sidekickopen90`)) return false;
	if (domain && domain.match(`superhuman.com`)) return false;
	if (domain && domain.match(`google.com/maps`)) return false;
	if (domain && domain.match(`amazemeet.com`)) return false;
	if (domain && domain.match(`btconnect`)) return false;
	if (domain && domain.match(`btinternet`)) return false;
	if (domain && domain.match(`facebook`)) return false;
	if (domain && domain.match(`cbinsights.com`)) return false;
	if (domain && domain.match(`zoom.us`)) return false;
	if (domain && domain.match(`gmail.com`)) return false;
	if (domain && domain.match(`calendly`)) return false;
	if (domain && domain.match(`docsend`)) return false;
	if (domain && domain.match(`appspot`)) return false;
	if (domain && domain.match(`linkedin`)) return false;
	if (domain && domain.match(`twitter.com`)) return false;

	return true;
}

async function send_mail(transporter, body, subject, recipient, from = process.env?.DEFAULT_FROM_EMAIL, references = ``, attachment = ``) {
	const mail_obj = {
		from, // sender address
		to: recipient, // list of receivers
		subject, // Subject line
		text: body, // plain text body
		references,
		// html: "<b>Hello world?</b>", // html body
	};
	if (attachment) mail_obj.attachments = [{ path: attachment }];
	return await transporter.sendMail(mail_obj);
}

function clean_email(email){
	if (email){
		try {
			if (email.indexOf(`<`) > -1){
				email = email.split(`<`)[1].split(`>`)[0];
			}
		} catch (err){
			logger.error(`Error in clean_email ${err}`);
			return email;
		}
		return email;
	}
	return null;
}

async function fetch_return_docsend(body){
	const transporter = nodemailer.createTransport({
		host: process.env.SMTP_SERVER,
		port: parseInt(process.env.SMTP_PORT),
		secure: false, 
		requireTLS: true,
		auth: {
			user: process.env.SMTP_USERNAME, 
			pass: process.env.SMTP_PASSWORD, 
		},
		logger: false
	});

	const body_plain = body?.plain;
	const body_html = body?.html;
	var docsendFetchUrl = ``;
	var docsendPassword = ``;
	var subject = body?.headers?.subject;
	logger.info(`Subject line: ${subject}`);

	var email_to = clean_email(body?.headers?.to);
	var email_from = clean_email(body?.headers?.from);

	logger.info(`Email to: ${email_to} email from: ${email_from}`);
	
	let return_address = process.env?.DEFAULT_FROM_EMAIL;
	if (email_to.match(process.env?.COMPANY_DOMAIN))
		return_address = email_to;
	else if (email_from.match(process.env?.COMPANY_DOMAIN))
		return_address = email_from;

	const message_id = body?.headers?.message_id;

	try{
		docsendFetchUrl = get_docsend_url(body_html);
		const body_plain_clean = clean_email_text(body_plain);
		docsendPassword = get_docsend_password(body_plain_clean);
		const subjectFilename = get_subject_as_filename(subject);

		let docsendPdf = ``;
		let docsendPdfFilename = ``;
		let fileSize = 0;

		try {
			if (docsendFetchUrl) {
				[docsendPdf, docsendPdfFilename, fileSize] = await getDocsend(docsendFetchUrl, subjectFilename, email_from, docsendPassword, false);
			} else {
				logger.info(`No docsend url found. Sending failure email to ${return_address}`);
				const downloaded_text = `No docsend url found in the email - please resend with the link pulled out up top `;
				await send_mail(transporter, downloaded_text + `\n\n` + body_plain_clean, subject, return_address, process.env?.DEFAULT_FROM_EMAIL, message_id, ``);
				throw `Failed to download, aborting`;
			}
		} catch (e) {
			logger.error(`Failed to fetch docsend. Sending failure email to ${return_address}`, e);
			const downloaded_text = `Server failure - possible bad docsend link or weird authentication issue, check link and password  `;
			await send_mail(transporter, downloaded_text + `\n\n` + body_plain_clean, subject, return_address, process.env?.DEFAULT_FROM_EMAIL, message_id, ``);
			throw `Failed to download, aborting`;
		}

		logger.info(`Local filesize ${fileSize}`);
		logger.info(`Local filename ${docsendPdfFilename}`);
		// Check feasible filesize
		if (fileSize < 1888){
			logger.error(`Failed to fetch docsend. Not a feasible filesize (${(fileSize/1024/1024).toFixed(2)}MB). Sending failure email to ${return_address}`);
			const downloaded_text = `Server failure - possible bad docsend link or weird authentication issue, check link and password.\n
			Not a feasible filesize (${(fileSize/1024/1024).toFixed(2)}MB)\n`;
			await send_mail(transporter, downloaded_text + `\n\n` + body_plain_clean, subject, return_address, process.env?.DEFAULT_FROM_EMAIL, message_id, ``);
			throw `Not a feasible filesize (${(fileSize/1024/1024).toFixed(2)}MB), erroring out`;
		}

		let downloaded_text = `PDF attached below (${(fileSize/1024/1024).toFixed(2)}MB) and saved to Hoxton library: ${docsendPdf}\n`;

		logger.info(`Does file still exist? ${existsSync(docsendPdfFilename)}`);
		if ((fileSize/1024/1024) > 20) {
			logger.error(`Filesize over 20MB - ${(fileSize/1024/1024).toFixed(2)}MB`);
			downloaded_text += `PDF over 20MB - ${(fileSize/1024/1024).toFixed(2)}MB - attachment may have failed\n`;
		}
		try {
			await send_mail(transporter, downloaded_text + `\n\n` + body_plain_clean, subject, return_address, `Hoxton Deals <hoxtonventures.com@robk.com>`, message_id, docsendPdfFilename);
		} catch(err){
			logger.error(`Failed to send mail. Filesize was ${(fileSize/1024/1024).toFixed(2)}MB`, err);
		}
		try {
			if (docsendPdfFilename && existsSync(docsendPdfFilename)) {
				unlinkSync(docsendPdfFilename);
			} 
		} catch (err){
			logger.error(`Failed to delete docsend file`, err);
		}
		
	} catch (err){
		console.log(err);
	}
}

function get_docsend_password(body){
	const passwordRegex = new RegExp(/.*docsend.com\/view.{2,25}?[P|p](?:assword|ass|asscode|wd)[\s\:\n\r]{0,3}(\w*)/igms);
	const passwordFirstRegex = new RegExp(/[P|p](?:assword|ass|asscode|wd)[\s\:\n\r\w\/]{1,40}(.*docsend.com\/view.*)\b/imgs);

	var docsendPassword = body.match(passwordRegex);
	
	if (!docsendPassword) {
		docsendPassword = body.match(passwordFirstRegex);
	}

	if (docsendPassword && docsendPassword[ 1 ]) {
		docsendPassword = docsendPassword[ 1 ];
		docsendPassword = docsendPassword.trim();
		logger.info(`Docsend password found - ${docsendPassword}`);
	}
	return docsendPassword;
}

function clean_email_text(body){
	body = decodeURIComponent(body);
	const find_line_split = new RegExp(/<\\r\\n/ig);  // Probably unnecessary
	const find_line_split2 = new RegExp(/<\r\n/ig);
	const find_line_split3 = new RegExp(/\r\n>/ig);
	body = body.replace(find_line_split, `<`); // Probably unnecessary
	body = body.replace(find_line_split2, `<`);
	body = body.replace(find_line_split3, `>`);
	body = body.replace(/\\r\\n/ig, `\n`); // Probably unnecessary
	body = body.replace(/\s?<mailto.*?>/ig, ``);
	return body;
}

function get_docsend_url(body_html){
	const link_regex = new RegExp(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?!&//=]*)/gi);
	const docsend_regex = new RegExp(/docsend.com\/view\/\w\w\w/ig);

	const result_arr = body_html.match(link_regex);
	var link_set = new Set();
	var docsendFetchUrl = ``;

	if (result_arr) {
		for (const link of result_arr) {
			if (link) {
				link_set.add(link);
				if (link.match(docsend_regex)) {
					docsendFetchUrl = link;
				}
			}
		}
	}
	return docsendFetchUrl;
}

function get_link_set(body_html){
	const link_regex = new RegExp(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?!&//=]*)/gi);
	const result_arr = body_html.match(link_regex);
	var link_set = new Set();
	//var docsendFetchUrl = ``;

	if (result_arr) {
		for (const link of result_arr) {
			if (link) {
				link_set.add(link);
			}
		}
	}
	return link_set;
}

function get_email_domain_set(body_html){
	const link2_regex = new RegExp(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi);
	const result2_arr = body_html.match(link2_regex);
	var email_domain_set = new Set();
	if (result2_arr) {
		for (const link of result2_arr) {
			email_domain_set.add(link.split(`@`).pop());
		}
	}
	return email_domain_set;
}

function clean_subject_line(subject){
	if (subject) {
		subject = cleanText(subject);
		subject = subject.replace(/^Deals?:/i, ``); //strip deal prefix
		subject = subject.replace(/Fwd?:?/i, ``); // strip fwd
		subject = subject.replace(/Re:/i, ``); // strip RE
		subject = subject.trim();
	}
	return subject;
}

function get_subject_as_filename(subject){
	if (subject) {
		subject = clean_subject_line(subject);
		subject = subject.replace(/[^a-z0-9]/gi, `_`);
		subject = subject.substring(0,35);
	} else subject = `no_filename`;
	return subject;
}

async function fetch_to_crm(body) {
	var body_html = body.html;
	const body_plain = body.plain;
	var body_plain_clean = ``;
	var docsendPassword = ``;
	var docsendFetchUrl = ``;
	var link_set = new Set();
	var email_domain_set = new Set();
	var deal = {};

	var subject = body?.headers?.subject;
	logger.info(`Subject: ${subject}`);

	var email_to = body?.envelope?.to;
	var email_from = body?.envelope?.from;

	logger.info(`Email to: ${email_to}, email from: ${email_from}`);

	try {
		docsendFetchUrl = get_docsend_url(body_html);
		link_set = get_link_set(body_html);
		body_plain_clean = clean_email_text(body_plain);
		docsendPassword = get_docsend_password(body_plain_clean);
		email_domain_set = get_email_domain_set(body_html);
	} catch (err) {
		logger.error(`Error parsing body text`, err);
		return;
	}

	var owner = `username`; // DEFAULT
	// CRM OWNER ID

	subject = clean_subject_line(subject);
	const subjectFilename = get_subject_as_filename(subject);

	let docsendPdf, docsendPdfFilename  = ``;
	let fileSize = 0;
	try {
		if (docsendFetchUrl) {
			[docsendPdf, docsendPdfFilename, fileSize] = await getDocsend(docsendFetchUrl, subjectFilename, email_from, docsendPassword, true);
		}
	} catch (e) {
		logger.error(`Failed to fetch docsend ${e.message} `, e);
	}

	var hashtags = [];

	if (subject.indexOf(`#`) !== -1) {
		hashtags = subject.match(/#[A-Za-z\s0-9\.]*[^#]/g);
		const location = subject.indexOf(`#`);
		subject = subject.substring(0, location);
	}
	logger.info(`Tags: ${JSON.stringify(hashtags)}`);

	var deal_name = subject;

	deal.party = {};

	var party = {};

	party.name = deal_name;
	party.owner = owner;
	logger.info(`Deal name ${deal_name}`);

	if (hashtags && hashtags.length > 0) {
		var cleanHashtags = hashtags //new Array.from(new Set(flatten(hashtags)))
			.map((x) => x.replace(`#`, ``).trim());
		party.tags = [];
		for (const hashtag of cleanHashtags) {
			party.tags.push({ name: hashtag });
		}
	}

	var destinationArr = email_to.match(/crm@.*/);
	var destination = ``;
	if (destinationArr && destinationArr.length > 0 && destinationArr?.[ 1 ]) {
		destination = destinationArr?.[ 1 ];
		destination = destination.trim();
	}

	if (
		destination &&
		destination.match(/^crm/) 
	) {
		party.type = `organisation`;
		logger.info(`Type org set for is ${destination}`);

		party.fields = [];
		party.fields.push({ definition: { id: 'Type' }, value: `Deal` });

	} else logger.info(`Not to crm@domain - abort`);

	var candidateDomains = [];
	var candidateEmails = [];

	var candidateLinks = [ ...link_set ];

	var crunchbaseLink = candidateLinks.filter(crunchbaseFilter).toString();
	var dealroomLink = candidateLinks.filter(dealroomFilter).toString();
	var linkedinLink = candidateLinks.filter(linkedinFilter).toString();

	if (crunchbaseLink) {
		party.fields.push({
			definition: { id: 'Crunchbase' },
			value: crunchbaseLink,
		});
		logger.info(
			`Crunchbase link is ${crunchbaseLink}`
		);
	}

	if (dealroomLink) {
		party.fields.push({
			definition: { id: 'Dealroom' },
			value: dealroomLink,
		});
		logger.info(`Dealroom link is ${dealroomLink}`);
	}

	if (linkedinLink) {
		if (!Array.isArray(party.websites)) {
			party.websites = [];
		}
		party.websites.push({
			service: `LINKED_IN`,
			address: linkedinLink,
		});
		logger.info(`Linkedin link is ${JSON.stringify(linkedinLink)}`);
	}

	candidateDomains = candidateLinks.filter(filterDomains);
	candidateEmails = [ ...email_domain_set ];

	if (candidateEmails && candidateEmails.length > 0) {
		for (const i of candidateEmails) {
			let exists = 0;
			for (const j of candidateDomains) {
				if (i.match(j)) {
					exists = 1;
				}
			}
			if (exists === 0) candidateDomains.push(i);
		}
	} else logger.info(`No emails found`);

	var uniqueDomains = _.flatten(candidateDomains).filter(filterDomains);
	uniqueDomains = _.uniq(uniqueDomains);

	logger.info(JSON.stringify(uniqueDomains));

	var bestDomain = ``;
	let bestEmailDomain = ``;
	let candidateDomain = ``;
	let candidateEmailDomain = ``;
	let ratio = ``;

	if (uniqueDomains !== null && uniqueDomains.length > 0) {
		let bestScore = 0;
		for (const domain of uniqueDomains) {
			ratio =
				fuzz.ratio(domain, deal_name) +
				fuzz.partial_ratio(deal_name, domain);

			if (ratio > bestScore) {
				candidateDomain = domain;
				candidateEmailDomain = domain.split(`://`).pop();
				candidateEmailDomain = candidateEmailDomain.split(`www.`).pop();
				candidateEmailDomain = candidateEmailDomain.split(`/`)[ 0 ]; // remove trailing slash
				bestScore = ratio;
				logger.info(`${candidateDomain} score ${ratio}`);
			}
		}

		if (docsendPdf) {
			body_plain_clean = `Attached Docsend presentation: ${docsendPdf} (filesize: ${(fileSize/1024/1024).toFixed(2)}MB)\n\r\n` 
			+ body_plain_clean;
		} else if (docsendFetchUrl && docsendPdfFilename==``) {
			body_plain_clean += `Docsend was found but error in downloading.\n`;
		}

		if (bestScore > 125) {
			bestDomain = candidateDomain;
			bestEmailDomain = candidateEmailDomain;
			bestDomain = bestDomain.replace(/^\/\//, ``); // replace double slash start? why

			if (!Array.isArray(party.websites)) party.websites = [];
			if (!bestDomain.match(/^http.*/))
				bestDomain = `https://${bestDomain}`;
			party.websites.push({
				service: `URL`,
				address: bestDomain,
			});
			logger.info(`Best domain for ${party.name} is ${bestDomain}`);
			logger.info(
				`Best email domain for ${party.name} is ${bestEmailDomain}`
			);
			if (bestEmailDomain) {
				party.fields.push({
					definition: { id: 'EMAIL_DOMAIN' },
					value: bestEmailDomain,
				});
			}
			if (bestDomain) {
				body_plain_clean = `Best guess for company website: ${bestDomain}\n\r\n` + body_plain_clean;
			}
		}
	} else logger.info(`No candidate domains found`);

	party.attachments = body.attachments;
	party.note = body_plain_clean;
	party.owner = owner;

	var nameSearchOpts = {
		filter: {
			conditions: [
				{
					field: `name`,
					operator: `is`,
					value: party.name,
				},
			],
		},
	};
	logger.info(`Adding parsed names`);
	const names = findNamesAndEmails(body_plain_clean, bestEmailDomain);
	const searchResult = await crmSearchByFilter(nameSearchOpts, 1, 2);
	if (searchResult && searchResult.parties && searchResult.parties[ 0 ]) {
		logger.info(`Found in CRM - adding Note`);
		var crmId = searchResult.parties[ 0 ].id;
		logger.info(`CRM Id is ${crmId}`);
		try {
			// CRM SPECIFIC LOGIC REQUIRED
			// await updateCompany(party, crmId);
			// const crmParty = searchResult.parties[ 0 ];
			// CRM SPECIFIC LOGIC REQUIRED
			//await enrichCompany(party, crmParty);
			if (names && names.size > 0)
				await addPeople(names, bestDomain, crmId);			
		} catch (err){
			if (pushover_user){
				const push_message = new Pushover(pushover_user,pushover_token);
				await push_message.send(`Error in Dealwatch updating company`, `${err} ${err.stack}`);
			}
		}
	} else {
		logger.info(`Not yet found in CRM - adding deal`);
		// CRM SPECIFIC LOGIC REQUIRED
		//try {
			// var res2 = await addCompany(party);
			// if (res2) {
			// 	logger.info(`New CRM Id is ${res2.party.id}. Enriching...`);
			// 	await enrichCompany(party, res2.party);
			// 	if (names && names.size > 0)
			// 		await addPeople(names, bestDomain, res2.party.id);
			// }
		// } catch (err) {
		// 	logger.error(`Error adding company: ${err} ${err.stack}`);
		// 	const push_message = new Pushover(pushover_user,pushover_token);
		// 	await push_message.send(`Error in Dealwatch adding new company ${err} ${err.stack}`);
		// }

	}
	return;
}

async function addPeople(namesSet, bestDomain, crmId) {
	if (crmId) {
		logger.info(`Adding ${namesSet.size} people`);
		const namesArr = [...namesSet];
		for (const name of namesArr) {
			logger.info(`Adding person ${name.email}`);
			// CRM SPECIFIC LOGIC REQUIRED
			//await addPerson(name, crmId);
		}
	}
	return;
}

function makePayload(service, address) {
	const newParty = {};
	newParty.party = {};
	newParty.party.websites = [];
	newParty.party.websites.push({
		service: service,
		address: address,
	});
	return newParty;
}

async function enrichCompany(party, crmParty) {
	//logger.info(`Entering enrichCompany`);
	let linkedin_url = ``;
	let Url = ``;
	let cbUrl = ``;
	let drUrl = ``;
	let crmDescriptionExists = false;
	let newParty = {};

	if (crmParty.websites && crmParty.websites.length > 0) {
		for (const site of crmParty.websites) {
			if (site.address && site.service == `URL` && !Url) {
				Url = site.address;
				//Url = getBaseUrl(Url);
			} else if (site.address && site.service == `LINKED_IN`) {
				linkedin_url = site.address;
				//linkedin_url = await cleanLinkedinUrl(linkedin_url, crmParty.id);
			}
		}
	}

	if (crmParty.about && crmParty.about.length > 10) {
		crmDescriptionExists = true;
	} else {
		crmDescriptionExists = false;
	}

	if (party.fields && party.fields.length > 0) {
		for (const field of party.fields) {
			if (field.value && field.definition.id == 'CRUNCHBASE') {
				cbUrl = field.value;
				logger.info(`CB url found ${cbUrl}`);
			}
			if (field.value && field.definition.id == 'DEALROOM') {
				drUrl = field.value;
				logger.info(`DR url found ${drUrl}`);
			}
		}
	}

	if (crmParty.fields && crmParty.fields.length > 0) {
		for (const field of crmParty.fields) {
			if (field.value && field.definition.id == 'CRUNCHBASE') {
				cbUrl = field.value;
				logger.info(`CB url found ${cbUrl}`);
			}
			if (field.value && field.definition.id == 'DEALROOM') {
				drUrl = field.value;
				logger.info(`DR url found ${drUrl}`);
			}
		}
	}

	if (drUrl != `` && linkedin_url == ``) {
		logger.info(
			`${crmParty.id} No linkedinUrl found in CRM. Trying to find from DR`
		);
		const drRegex = /.*dealroom.co\/companies\/(.*)/i;
		if (drUrl.match(drRegex) && drUrl.match(drRegex)[ 1 ]) {
			const drSlug = drUrl.match(drRegex)[ 1 ];
			//logger.info(`${party.name} DR slug ${drSlug}`);

			// // DEALROOM SPECIFIC LOGIC REQUIRED
			// dealroom = await queryDealroomBySlug(drSlug);
			// if (dealroom.id) {
			// 	if (dealroom.linkedin_url) {
			// 		const linkedinUrl = cleanLinkedinUrl(
			// 			dealroom.linkedin_url,
			// 			crmParty.id
			// 		);
			// 		if (linkedinUrl.match(`linkedin.com/company`)) {
			// 			const newPayload = makePayload(`LINKED_IN`, linkedin_url);
			// 			await crmPartyUpdate({
			// 				id: crmParty.id,
			// 				payload: newPayload,
			// 			});
			// 			logger.info(
			// 				`${crmParty.id}: added LI URL from Dealroom ${linkedin_url}`
			// 			);
			// 		} else
			// 			logger.error(
			// 				`${crmParty.id}: bad LI URL from Dealroom ${linkedin_url}`
			// 			);
			// 	}
			// }
		} else logger.error(`Slug not found for ${drUrl}`);
	}

	if (cbUrl && cbUrl.length > 5 && linkedin_url == ``) {
		logger.info(
			`${crmParty.id} No linkedin_url found in CRM. Trying to find from CB`
		);
		logger.info(`linkedin URL length ${linkedin_url.length}`);

		let cbPermalink = cbUrl
			.replace(/(^\w+:|^)\/\//, ``)
			.replace(/^www.crunchbase.com\/organization\//, ``);
		cbPermalink = cbPermalink.split(`/`)[ 0 ];
		// CRUNCHBASE ACCESS REQUIRED
		const json = null; // await queryCrunchbasePermalink(cbPermalink);
		logger.info(`Json returned by CB`);

		if (
			json &&
			json.properties &&
			json.properties.linkedin &&
			json.properties.linkedin.value
		) {
			// Check if linkedin found
			logger.info(`Linkedin value found in CB ${json?.properties?.linkedin?.value}`);
			linkedin_url = json?.properties?.linkedin?.value;
			logger.info(`${crmParty.id}: cleaned LI URL ${linkedin_url}`);
			newParty = makePayload(`LINKED_IN`, linkedin_url);
			// CRM SPECIFIC LOGIC REQUIRED
			// await crmPartyUpdate({
			// 	id: crmParty.id,
			// 	payload: newParty,
			// });
			logger.info(`Added ${linkedin_url} from CB ${cbPermalink}`);
		} else logger.warn(`No linkedin found in CB JSON ${JSON.stringify(json.properties.linkedin)}`);

		if (json && json.properties && json.properties.website_url && !Url) {
			const homepage_url = json.properties.website_url;
			newParty = makePayload(`URL`, homepage_url);
			// CRM SPECIFIC LOGIC REQUIRED
			// await crmPartyUpdate({
			// 	id: crmParty.id,
			// 	payload: newParty,
			// });
			logger.info(`Added ${homepage_url} from CB ${cbPermalink}`);
		}
		if (
			json &&
			json.properties &&
			(json.properties.description ||
				json.properties.short_description) &&
			crmDescriptionExists == false &&
			(json.properties.description?.length > 0 ||
				json.properties.short_description?.length > 0)
		) {
			const property = json.properties;
			let cBdescription = ``;
			if (
				property.short_description &&
				property.short_description.length > 0
			) {
				cBdescription = property.short_description;
			} else if (
				property.description &&
				property.description.length > 0
			) {
				cBdescription = property.description;
			}
			if (cBdescription.length > 0) {
				cBdescription = cleanText(cBdescription);
				newParty = {};
				newParty.party = {};
				newParty.party.about = cBdescription;
				// CRM SPECIFIC LOGIC REQUIRED
				// await crmPartyUpdate({
				// 	id: crmParty.id,
				// 	payload: newParty,
				// });
				crmDescriptionExists = true;
				logger.info(
					`${party.name}: added description from CB to CRM`
				);
			} else logger.info(`${party.name}: No description found in cb`);
		} else logger.error(`${party.name} CB link looks bad ${cbUrl}`);
		if (linkedin_url !== ``) {
			logger.info(`Added Linkedin URL ${linkedin_url}`);
		}
	} 
	logger.info(`Enrich complete`);
	return;
}

function findNamesAndEmails(body_plain, candidateEmailDomain = ``) {
	try {
		body_plain = decode(body_plain);
		body_plain = body_plain.replace(/\\r\\n/ig, `\n`); // 17 Nov Plain
		body_plain = body_plain.replace(/\s?<mailto.*?>/ig, ``);
		const body_plain_arr = body_plain.split(`\n`);
		const line_match_prefix_regex = new RegExp(/.*(?:From:|To:|Cc:|\sAM[\s|,]|\sPM[\s|,]|\s\d\d:\d\d,|:\d\d\s(?:[A-Z]{3}?\s)?)(.*)/i);

		if (body_plain_arr) {
			const email_matches = new Set();
			for (const line of body_plain_arr) {
				if (line.match(line_match_prefix_regex) && line.match(line_match_prefix_regex)[ 1 ]) {
					let line_match = line.match(line_match_prefix_regex)[ 1 ];
					let email_array = [];
					if (line_match.match(`@`)) {
						if (line_match.match(`;`)) {
							email_array = line_match.split(`;`);
							for (const email of email_array) {
								email_matches.add(email.trim());
							}
							continue;
						}
						const at_count = line_match.indexOf(`@`);
						const comma_count = line_match.indexOf(`,`);
						if (at_count < comma_count) {
							email_array = line_match.split(`>,`);
							for (let email of email_array) {
								if (!email.match(`>`)) email = email + `>`;
								email_matches.add(email.trim());
							}
							continue;
						}
						line_match = line_match.split(`>`)[ 0 ] + `>`;
						email_matches.add(line_match.trim());
					}
				}
			}
			const email_objects = new Set();
			for (const email of email_matches) {
				const email_array = email.split(`<`);
				const email_obj = {};
				if (Array.isArray(email_array) && email_array.length > 1) {
					email_obj.email = email_array[ 1 ].replace(`>`, ``);
					email_obj.firstName = ``;
					email_obj.lastName = ``;
					const email_name_arr = email_array[ 0 ].split(` `);
					if (email_name_arr && email_name_arr.length == 1) {
						email_obj.lastName = email_name_arr[ 0 ].trim().replace(/[^A-Z]$/i, ``);
						email_obj.firstName = email_name_arr[ 0 ].trim().replace(/^[^A-Z]/i, ``);
					} else if (email_name_arr && email.match(`,`)) {
						const comma_index = email.indexOf(`,`);
						const end_index = email.indexOf(`<`);
						email_obj.firstName = email.slice(comma_index + 1, end_index);
						email_obj.firstName = email_obj.firstName.trim().replace(/^[^A-Z]/i, ``);
						email_obj.lastName = email.slice(0, comma_index);
						email_obj.lastName = email_obj.lastName.trim().replace(/[^A-Z]$/i, ``);
					} else {
						email_obj.firstName = email_name_arr[ 0 ].trim().replace(/^[^A-Z]/i, ``);
						email_obj.lastName = email_name_arr.slice(1, email_name_arr.length - 1).join(` `);
						email_obj.lastName = email_obj.lastName.trim().replace(/[^A-Z]$/i, ``);
					}
					if (email_obj.email && email_obj.firstName && email_obj.lastName) email_objects.add(email_obj);
				} else logger.info(`Failed to split email array on ${email}`);
			}
			logger.info(`Email objects found: ${email_objects.size}`);
			const returned_email_objects = new Set();
			for (const email of email_objects) {
				if (candidateEmailDomain && email.email.match(candidateEmailDomain)) {
					returned_email_objects.add(email);
					logger.info(`Good email by domain ${candidateEmailDomain}: ${email.email}`);
				} else {
					const domain = email.email.split(`@`).pop();
					if (domain && filterDomains(domain)) {
						logger.info(`Good email by split but not match, filtered ${domain}: ${email.email}`);
					} else logger.info(`Filtered out by domain ${candidateEmailDomain}: ${email.firstName} ${email.lastName} <${email.email}>`);
				}
			}
			return returned_email_objects;
		}
	} catch (e) {
		logger.error(`Error in findNamesAndEmails `, e);
	}
}

async function updateCompany(party, id) {
	try {
		logger.info(`Update company ${id}`);
		var content = ``;
		if (party.attachments && party.attachments.length > 0) {
			logger.info(`${party.attachments.length} attachments found`);
			for (const attachment of party.attachments) {
				if (attachment.size > 20000) {
					logger.info(`Adding ${attachment.file_name}`);
					content += `${attachment.url} ==> ${attachment.file_name}\n`;
				}
			}
		}
		content += party.note;
		logger.info(`Party owner ${party.owner}`);
		// CRM SPECIFIC LOGIC REQUIRED
		// const createRes = await crmCreateEntry({
		// 	entry: {
		// 		type: `note`,
		// 		party: {
		// 			id: parseInt(id),
		// 		},
		// 		creator: {
		// 			id: parseInt(party.owner),
		// 		},
		// 		content: content,
		// 	},
		// });
		//return createRes;
	} catch (e) {
		logger.error(`Error in updateCompany ${e}`, e);
	}
}

async function addCompany(party) {
// CRM SPECIFIC LOGIC REQUIRED
}
async function crmSearchByFilter(name, crmId) {
	// CRM SPECIFIC LOGIC REQUIRED
	}

async function addPerson(name, crmId) {
// CRM SPECIFIC LOGIC REQUIRED
}
