
require('dotenv').config()
const express = require('express');
const {initDb} = require('./model.mjs');
const { authRouter } = require("./routes/auth_route.mjs");
const { tokenBucket } = require("./middleware/bucket.mjs");

const app = express()

app.use(express.json())

const fallbackport = 80
const port = process.env.PORT==""? fallbackport: process.env.PORT

initDb()

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter)


app.listen(port, () => {
  console.log(`App listening on port ${port}`)
})

