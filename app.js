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

// Parse body
app.use(express.urlencoded({extended: true}))

// Static files
app.use('/bootstrap',
  express.static('node_modules/bootstrap/dist'))
app.use('/jquery',
  express.static('node_modules/jquery/dist'))
app.use('/popper.js',
  express.static('node_modules/popper.js/dist'))

const db = storage(config.db)

app.get('/', async function (req, res) {
  const list = await db.list()
  const masterUrl = await db.getMaster()

  res.render('index', {
    bad_url: config.db.local_url.includes('localhost'),
    list: list,
    master_url: masterUrl,
    master: !config.db.seed,
    process_conflicts: config.db.process_conflicts,
    interfaces: os.networkInterfaces()
  })
})

app.get('/create', (req, res) => {
  res.render('create')
})

app.post('/saveCreated', (req, res) => {
  const doc = {
    ...req.body,
    entered: req.body.entered === 'on',
    vip: req.body.vip === 'on'
  }
  db.create(doc).then(r => res.json(r))
})

app.listen(3000,
  () => console.log('Listening http://localhost:3000/'))
