const config = {
	projectName: `Docsend Download App`,
	secret: process.env?.SECRET_APP_KEY,
	signUpEnabled: false,
	authToken: {
		expiresInMinutes: 2000,
		expirable: false,
	},
	changePwdToken: {
		expiresInMinutes: 1500,
	},
	dealWatchScheduler: {
		hh: 7,
		mm: 0,
		ss: 0,
		interval: 1000 * 60 * 60 * 24,
	},
	cachingIntervals: {
		companies: 1000 * 60 * 30, // 30 mins
	},
	pageSize: 10,
	monthOffset: 12,

	huginnWebhookURL: null,
};

module.exports = config;
