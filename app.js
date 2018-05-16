'use strict'

const express = require('express')
const nunjucks = require('nunjucks')
const os = require('os')
const storage = require('./syncable-storage')

const config = require('./config.json')

const app = express()
nunjucks.configure('views', {
  express: app
})
app.set('view engine', 'njk')

const db = storage(config.db)

app.get('/', (req, res) => {
  db.getMaster().then(masterUrl => {
    res.render('index', {
      bad_url: config.db.local_url.includes('localhost'),
      local_url: config.db.local_url,
      master_url: masterUrl,
      master: !config.db.seed,
      process_conflicts: config.db.process_conflicts,
      interfaces: os.networkInterfaces()
    })
  })
})

app.listen(3000,
  () => console.log('Listening http://localhost:3000/'))
