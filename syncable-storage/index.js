'use strict'

const nano = require('nano')
const Promise = require('bluebird')

function doAndIgnore(promise) {
  return new Promise((resolve, reject) => {
    promise.then(resolve).catch(() => resolve())
  })
}

exports = module.exports = (config) => {
  const nodesDb = config.name + '/$nodes'
  const repDb = config.name + '/_replicator'

  const sched = '_scheduler/docs/' + encodeURIComponent(repDb)

  // Create connection objects
  const couch = nano(config.local_url)
  const db = couch.use(config.name)
  const nodes = couch.use(nodesDb)
  const replicator = couch.use(repDb)

  // Turn everything in promises
  Promise.promisifyAll(couch)
  Promise.promisifyAll(couch.db)
  Promise.promisifyAll(nodes)
  Promise.promisifyAll(replicator)

  // Create replicatable databases
  const prom1 = doAndIgnore(couch.db.createAsync(config.name))
  const prom2 =
    doAndIgnore(couch.db.createAsync(nodesDb))

  // Recreate replicator database
  doAndIgnore(couch.db.destroyAsync(repDb)).then(() => {
    const prom3 = couch.db.createAsync(repDb)
    Promise.join(prom1, prom2, prom3, () => {
      console.log('Databases created')
      if (!config.seed) {
        console.warn(
          'No seed configured, so no replication enabled.')
        return
      }
      // Everything is ready
      const nodesDbUri = encodeURIComponent(nodesDb)

      replicator.insertAsync({
        source: config.seed + '/' + nodesDbUri,
        target: config.local_url + '/' + nodesDbUri,
        continuous: true
      }, 'pull_nodes').then(console.log)
      replicator.insertAsync({
        source: config.local_url + '/' + nodesDbUri,
        target: config.seed + '/' + nodesDbUri,
        continuous: true
      }, 'push_nodes').then(console.log)
      replicator.insertAsync({
        source: config.seed + '/' + config.name,
        target: config.local_url + '/' + config.name,
        continuous: true
      }, 'pull_db').then(console.log)
      replicator.insertAsync({
        source: config.local_url + '/' + config.name,
        target: config.seed + '/' + config.name,
        continuous: true
      }, 'push_db').then(console.log)
    })
  })

  // Passing CRUD operations
  return {
    create: (doc) => console.log('Creating doc: ', doc),
    get: (id) => console.log('Getting ', id),
    update: (doc) => console.log('Updating doc: ', doc),
    delete: (id, rev) => console.log('Removing ', id),
    list: () => console.log('Getting full list'),
  }
}
