require(`dotenv`).config();
const express = require(`express`);
const Sentry = require(`@sentry/node`);

const path = require(`path`);
const favicon = require(`serve-favicon`);
const bodyParser = require(`body-parser`);

const index = require(`./routes/index`);
const users = require(`./routes/users`);
const docwatch = require(`./routes/docwatch`);
const serverstatus = require(`./routes/serverstatus`);

const app = express();
if (process.env?.SENTRY_DSN) {
	Sentry.init({ dsn: process.env.SENTRY_DSN });
	app.use(Sentry.Handlers.requestHandler());
	app.use(Sentry.Handlers.errorHandler());
}

const appRoot = require(`app-root-path`);
const projectName = require(`project-name`);

const logJS = process.env?.DOCKER_LOGGER_PATH ?? `${appRoot}/utils/logger`;
const logsDir = process.env?.DOCKER_LOG_PATH ?? `${appRoot}/logs`;
const logFile = `${logsDir}/${projectName()}`;
const logger = require(logJS)(logFile);

logger.info(`Logs path ${logFile}`);
logger.info(`Logger Docker path test ${process.env?.DOCKER_LOGGER_PATH}`);
logger.info(`Log Docker path test ${process.env?.DOCKER_LOG_PATH}`);

app.use(
	require(`morgan`)(`tiny`, {
		stream: { write: (message) => logger.info(message.trim()) },
	})
);

app.disable(`x-powered-by`);
logger.info(`Favicon at ${path.join(__dirname, `public`, `favicon.ico`)}`);
app.use(favicon(path.join(__dirname, `public`, `favicon.ico`)));

// view engine setup
app.set(`views`, path.join(__dirname, `views`));
app.set(`view engine`, `hbs`);

app.use(bodyParser.json({ limit: `10mb` }));
app.use(bodyParser.urlencoded({ extended: false }));
// app.use(forceSSL);
app.use(express.static(path.join(__dirname, `public`)));

app.use(`/`, index);
app.use(`/users`, users);
app.use(`/docwatch`, docwatch);

// error handler
app.use(function (err, req, res, next) {
	// set locals, only providing error in development
	res.locals.message = err.message;
	res.locals.error = req.app.get(`env`) === `development` ? err : {};

	console.error(err.stack);

	// render the error page
	res.status(err.status || 500);
	res.render(`error`);
});

app.get(`/robots.txt`, function (req, res) {
	res.type(`text/plain`);
	res.send(`User-agent: *\nDisallow: /`);
});

app.use(function onError(err, req, res, next) {
	// The error id is attached to `res.sentry` to be returned
	// and optionally displayed to the user for support.
	res.statusCode = 500;
	res.end(res?.sentry + `\n`);
});

app.use(function (err, req, res, next) {
	console.error(err.stack);
	res.status(500).send(`Something broke!`);
});

app.use(function (req, res, next) {
	res.status(404).send(`Sorry can't find that. Go away.`);
});

logger.info(`Launching app server.`);

module.exports = app;
