const winston = require(`winston`);
require(`winston-daily-rotate-file`);
const { format } = winston;
const { printf, errors } = format;
const projectName = require(`project-name`);

const logFormat = printf(info => {
	// This will customize the Error Message
	if (info instanceof Error) {
		return `${new Date().toISOString()}: ${info.level}: ${info.message})`;
	}

	return `${new Date().toISOString()}: ${info.level}: ${info.message}`;
});

const opts = {
	format: winston.format.combine(
		logFormat,
		winston.format.colorize({ all: false }),
		errors({ stack: true })
	),
	datePattern: `YYYY-MM-DD`,
	handleExceptions: true,
	json: false,
	zippedArchive: true,
	maxSize: `20m`,
	maxFiles: `7d`,
};

const logger = function(filename) {
	opts.filename = `${filename}-%DATE%.log`;
	return winston.createLogger({
		transports: [
			new winston.transports.Console({
				format: winston.format.combine(
					logFormat,
					winston.format.colorize({ all: true }),
					// winston.format.simple(),
					errors({ stack: true })
				),
				handleExceptions: true,
				json: false,
				timestamp: true,
			}),
			new winston.transports.File({
				filename: `${filename}.log`,
				format: winston.format.combine(
					logFormat,
					winston.format.colorize({ all: false }),
					errors({ stack: true })
				),
				level: `info`,
				handleExceptions: true,
				json: false,
				maxsize: 10242880, // 10MB
				maxFiles: 5,
			}),
			new winston.transports.DailyRotateFile(opts),
		],
		exitOnError: false,
	});
};

module.exports = logger;