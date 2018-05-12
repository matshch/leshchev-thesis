'use strict'

const express = require('express')
const nunjucks = require('nunjucks')
const storage = require('./syncable-storage')

const config = require('./config.json')

const app = express()
nunjucks.configure('views', {
  express: app
})
app.set('view engine', 'njk')

app.get('/', (req, res) => {
  storage(config.db)
  res.render('index')
})

app.listen(3000,
  () => console.log('Listening http://localhost:3000/'))
