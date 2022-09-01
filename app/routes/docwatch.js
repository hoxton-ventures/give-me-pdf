var express = require(`express`);
var router = express.Router();
require(`dotenv`).config();

const { createLogger, format, transports, winston } = require(`winston`);
const { combine, timestamp, printf } = format;
const appRoot = require(`app-root-path`);
const projectName = require(`project-name`);

const logJS = (process.env?.DOCKER_LOGGER_PATH ?? `${appRoot}/utils/logger`);
const logsDir = (process.env?.DOCKER_LOG_PATH ?? `${appRoot}/logs`);
const logFile = `${logsDir}/${projectName()}`;
const logger = require(logJS)(`${logFile}`); 

// Require controller modules.
var docwatch_controller = require(`../controllers/docwatchController`);

/* GET home page. */
router.get(`/`, function(req, res, next) {
	logger.info(`Index hit to doc endpoint with http get`);
	res.render(`index`, { title: `Docsend Downloader`, body: `Running, waiting for input...` });
});

router.post(`/`, docwatch_controller.docwatch_add);

module.exports = router;
