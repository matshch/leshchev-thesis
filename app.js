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
app.use('/chart.js',
  express.static('node_modules/chart.js/dist'))
app.use('/jquery',
  express.static('node_modules/jquery/dist'))
app.use('/popper.js',
  express.static('node_modules/popper.js/dist'))

const db = storage(config.db)
const localUrl = config.local_url ?
  config.local_url.replace(/\/$/, "") :
  "http://localhost:5984"

app.get('/', async function (req, res) {
  const list = await db.list()
  const masterUrl = await db.getMaster()

  res.render('index', {
    bad_url: config.db.my_url.includes('localhost'),
    local_url: localUrl,
    list: list,
    master_url: masterUrl,
    master: !config.db.seed,
    process_conflicts: config.db.process_conflicts,
    interfaces: os.networkInterfaces()
  })
})

app.get('/get/:id', async function (req, res) {
  const doc = await db.get(req.params.id)
  res.render('get', {
    ...doc,
    local_url: localUrl,
    $original: doc
  })
})

app.get('/create', (req, res) => {
  res.render('create', {
    local_url: localUrl
  })
})

app.post('/saveCreated', (req, res) => {
  const doc = {
    ...req.body,
    entered: req.body.entered === 'on',
    vip: req.body.vip === 'on'
  }
  db.create(doc).then(r => res.redirect('/'))
})

app.post('/saveChanged', (req, res) => {
  const doc = {
    ...req.body,
    entered: req.body.entered === 'on',
    vip: req.body.vip === 'on'
  }
  const orig = JSON.parse(doc.$original)
  delete doc.$original
  db.update(doc, orig).then(r => res.redirect('/'))
})

app.post('/delete', (req, res) => {
  const orig = JSON.parse(req.body.$original)
  db.delete(orig._id, orig._rev).then(r => res.redirect('/'))
})

app.listen(3000,
  () => console.log('Listening http://localhost:3000/'))
