const { generateKeyPairSync } = require("crypto");
const fs = require("fs");
const path = require("path");

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

const privPem = privateKey.export({ type: "pkcs8", format: "pem" });
const pubPem = publicKey.export({ type: "spki", format: "pem" });

// Escape newlines for single-line .env value
const privEscaped = privPem.replace(/\r?\n/g, "\\n");
const pubEscaped = pubPem.replace(/\r?\n/g, "\\n");

const envPath = path.join(__dirname, "..", ".env");
let env = fs.readFileSync(envPath, "utf8");
env = env.replace('JWT_PRIVATE_KEY=""', `JWT_PRIVATE_KEY="${privEscaped}"`);
env = env.replace('JWT_PUBLIC_KEY=""', `JWT_PUBLIC_KEY="${pubEscaped}"`);
fs.writeFileSync(envPath, env);
console.log("JWT RS256 keys injected into .env");
