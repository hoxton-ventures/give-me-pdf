// Load module
require(`dotenv`).config();
var mysql = require(`mysql2/promise`);
// Initialize pool
const pool = mysql.createPool({
	host: process.env.DB_HOST,
	user: process.env.DB_USER,
	password: process.env.DB_PASS,
	database: `docsend`,
	connectionLimit: 5,
});

module.exports = pool;