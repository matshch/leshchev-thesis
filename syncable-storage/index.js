'use strict'

const nano = require('nano')
const Promise = require('bluebird')

const PULL_NODES = 'pull_nodes'
const PUSH_NODES = 'push_nodes'
const PULL_DB = 'pull_db'
const PUSH_DB = 'push_db'

function doAndIgnore (promise) {
  return new Promise((resolve, reject) => {
    promise.then(resolve).catch(() => resolve())
  })
}

function updateReplication (couch, local, target, name) {
  const nodesDb = name + '/$nodes'
  const repDb = name + '/_replicator'

  const replicator = couch.use(repDb)
  Promise.promisifyAll(replicator)

  return new Promise((resolve, reject) => {
    // Recreate replicator database
    doAndIgnore(couch.db.destroyAsync(repDb)).then(() => {
      couch.db.createAsync(repDb).then(() => {
        if (!target) {
          console.warn(
            'No seed configured, so no replication enabled.')
          return
        }
        // Everything is ready
        const nodesDbUri = encodeURIComponent(nodesDb)

        const pullNodes = replicator.insertAsync({
          source: target + '/' + nodesDbUri,
          target: local + '/' + nodesDbUri,
          continuous: true
        }, PULL_NODES)
        const pushNodes = replicator.insertAsync({
          source: local + '/' + nodesDbUri,
          target: target + '/' + nodesDbUri,
          continuous: true
        }, PUSH_NODES)
        const pullDb = replicator.insertAsync({
          source: target + '/' + name,
          target: local + '/' + name,
          continuous: true
        }, PULL_DB)
        const pushDb = replicator.insertAsync({
          source: local + '/' + name,
          target: target + '/' + name,
          continuous: true
        }, PUSH_DB)

        Promise.join(pullNodes, pushNodes, pullDb, pushDb,
          () => resolve())
      })
    })
  })
}

exports = module.exports = config => {
  const nodesDb = config.name + '/$nodes'
  const repDb = config.name + '/_replicator'

  const schUrl = '_scheduler/docs/' +
    encodeURIComponent(repDb) + '/'

  // Create connection objects
  const couch = nano(config.local_url)
  const db = couch.use(config.name)
  const nodes = couch.use(nodesDb)
  // const replicator = couch.use(repDb)

  // Turn everything in promises
  Promise.promisifyAll(couch)
  Promise.promisifyAll(couch.db)
  Promise.promisifyAll(nodes)
  // Promise.promisifyAll(replicator)

  // Create replicatable databases
  doAndIgnore(couch.db.createAsync(config.name))
  doAndIgnore(couch.db.createAsync(nodesDb)).then(() => {
    // Write our information
    const iAm = {
      _id: config.uuid,
      url: config.local_url,
      priority: config.priority
    }
    nodes.getAsync(config.uuid).then(doc => {
      iAm._rev = doc._rev
      nodes.insertAsync(iAm)
    }).catch(() => {
      nodes.insertAsync(iAm)
    })
  })

  // Replicate from seed
  updateReplication(couch, config.local_url,
    config.seed, config.name).then(() => {
    setTimeout(checkReplication, config.keep_alive)
  })

  // Check replication status
  function checkReplication () {
    const pullNodes = couch.requestAsync(schUrl + PULL_NODES)
    const pushNodes = couch.requestAsync(schUrl + PUSH_NODES)
    const pullDb = couch.requestAsync(schUrl + PULL_DB)
    const pushDb = couch.requestAsync(schUrl + PUSH_DB)

    Promise.join(pullNodes, pushNodes, pullDb, pushDb,
      (pullNodes, pushNodes, pullDb, pushDb) => {
        const goodState = 'running'
        if (pullNodes.state !== goodState ||
          pushNodes.state !== goodState ||
          pullDb.state !== goodState ||
          pushDb.state !== goodState) {
          console.warn('Troubles with ', pullDb.source)
          console.warn(pullNodes.info, pushNodes.info,
            pullDb.info, pushDb.info)

          nodes.listAsync({include_docs: true}).then(res => {
            return res.rows
              .map(e => e.doc)
              .filter(e => e._id !== config.uuid)
              .sort((a, b) => a.priority - b.priority)
          }).then(console.log)

          // nano(config.local_url).use(nodesDb).info(console.log)
        } else {
          // All good
          setTimeout(checkReplication, config.keep_alive)
        }
      })
  }

  // Passing CRUD operations
  return {
    create: doc => console.log('Creating doc: ', doc),
    get: id => console.log('Getting ', id),
    update: doc => console.log('Updating doc: ', doc),
    delete: (id, rev) => console.log('Removing ', id),
    list: () => console.log('Getting full list')
  }
}
