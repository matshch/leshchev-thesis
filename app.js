'use strict'

const express = require('express')
const nunjucks = require('nunjucks')
const storage = require('./syncable-storage')

const app = express()
nunjucks.configure('views', {
  express: app
})
app.set('view engine', 'njk')

app.get('/', (req, res) => {
  storage()
  res.render('index')
})

app.listen(3000,
  () => console.log('Listening http://localhost:3000/'))
