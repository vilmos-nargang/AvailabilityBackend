const express = require('express')
const app = express()
const fallbackport= 80
const port = process.env.PORT==""? fallbackport: process.env.PORT

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})

/*

*/