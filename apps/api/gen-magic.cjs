const jwt = require("jsonwebtoken");
const token = jwt.sign(
  {
    cid: "e6d0a73a-8c74-4455-9409-c726a8d33533",
    pid: "00000000-0000-0000-0000-000000000003",
    tid: "b7b59cc6-afb1-4e39-977e-0767a50e0662",
    type: "magic_link"
  },
  process.env.JWT_SECRET || "s3cr3t-m3d1r3n0v4-2026-production-key",
  { algorithm: "HS256", expiresIn: "24h" }
);
console.log("\nURL de prueba:");
console.log("http://localhost:3000/booking/" + token + "\n");


