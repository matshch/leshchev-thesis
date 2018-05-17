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

function myNano (url) {
  const couch = nano({
    requestDefaults: {
      jar: false,
      timeout: 3000
    },
    url: url
  })

  // Promisify all
  Promise.promisifyAll(couch)
  if (couch.db) {
    Promise.promisifyAll(couch.db)

    // Promisify even use
    const oldUse = couch.use
    const newUse = dbName => {
      const obj = oldUse(dbName)
      Promise.promisifyAll(obj)
      return obj
    }
    couch.scope = newUse
    couch.use = newUse
    couch.db.scope = newUse
    couch.db.use = newUse
  }

  return couch
}

function updateReplication (couch, local, target, name) {
  const nodesDb = name + '/$nodes'
  const repDb = name + '/_replicator'

  const replicator = couch.use(repDb)

  return new Promise((resolve, reject) => {
    // Recreate replicator database
    doAndIgnore(couch.db.destroyAsync(repDb)).then(() => {
      couch.db.createAsync(repDb).then(() => {
        if (!target) {
          resolve()
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

function merge (a, b) {
  const res = JSON.parse(JSON.stringify(a))
  if (res._conflicts) {
    delete res._conflicts
  }
  const keys = new Set(
    Object.keys(a.$times).concat(Object.keys(b.$times)))

  for (const key of keys) {
    if (a.$times[key] === b.$times[key]) {
      continue
    } else if (a.$times[key] === undefined) {
      res[key] = b[key]
      res.$times[key] = b.$times[key]
    } else if (b.$times[key] === undefined) {
      res[key] = a[key]
      res.$times[key] = a.$times[key]
    } else if (a.$times[key] < b.$times[key]) {
      res[key] = b[key]
      res.$times[key] = b.$times[key]
    } else {
      res[key] = a[key]
      res.$times[key] = a.$times[key]
    }
  }

  return res
}

function mergeAll (list) {
  if (list.length === 1) {
    return list[0]
  } else {
    const head = list[0]
    const tail = list.slice(1)
    return tail.reduce(merge, head)
  }
}

function prepareMergeResult (doc, revs) {
  doc._rev = revs[0]
  const docs = [doc].concat(revs.slice(1).map(r => ({
    _id: doc._id,
    _rev: r,
    _deleted: true
  })))
  return {
    docs: docs
  }
}

exports = module.exports = config => {
  const nodesDb = config.name + '/$nodes'
  const repDb = config.name + '/_replicator'

  const schUrl = '_scheduler/docs/' +
    encodeURIComponent(repDb) + '/'

  // Create connection objects
  const couch = myNano(config.local_url)
  const db = couch.use(config.name)
  const nodes = couch.use(nodesDb)
  // const replicator = couch.use(repDb)

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

  if (config.seed) {
    // Replicate from seed
    updateReplication(couch, config.local_url,
      config.seed, config.name).then(() =>
      setTimeout(checkReplication, config.keep_alive)
    )
  } else {
    console.warn(
      'No seed configured, so no replication enabled.')
  }

  let currentMaster = config.seed

  function reselectMaster () {
    // Prepare list of applicable masters
    return nodes.listAsync({include_docs: true}).then(res => {
      return res.rows
        .map(e => e.doc)
        .filter(e => e._id !== config.uuid)
        .sort((a, b) => (a.priority - b.priority ||
          ((a._id < b._id) ? -1
            : ((a._id > b._id) ? 1 : 0))))
    }).then(list => {
      if (list.some(e => e.url === config.seed)) {
        return list
      } else {
        return [
          {
            url: config.seed
          },
          ...list
        ]
      }
    }).then(async function (list) {
      for (const node of list) {
        const t = await myNano(node.url).use(nodesDb)
          .infoAsync().reflect()
        if (t.isFulfilled()) {
          if (node.url === currentMaster) {
            setTimeout(checkReplication,
              config.keep_alive)
            return
          }
          console.log('Found new master', node.url)
          currentMaster = node.url
          updateReplication(couch, config.local_url,
            node.url, config.name).then(() =>
            setTimeout(checkReplication,
              config.keep_alive)
          )
          return
        }
      }
      console.warn('No masters found, will try later')
      updateReplication(couch, config.local_url,
        undefined, config.name).then(() =>
        setTimeout(checkReplication,
          config.retry_master)
      )
    })
  }

  // Check replication status
  let lastReselect = new Date()
  function checkReplication () {
    if (!currentMaster) {
      reselectMaster().then(() => {
        lastReselect = new Date()
      })
      return
    }

    const pullNodes = couch.requestAsync(schUrl + PULL_NODES)
    const pushNodes = couch.requestAsync(schUrl + PUSH_NODES)
    const pullDb = couch.requestAsync(schUrl + PULL_DB)
    const pushDb = couch.requestAsync(schUrl + PUSH_DB)

    const remote = pullNodes.then(
      e => myNano(e.source).infoAsync().reflect())

    Promise.join(pullNodes, pushNodes, pullDb, pushDb, remote,
      (pullNodes, pushNodes, pullDb, pushDb, remote) => {
        const goodState = state =>
          state === 'running' || state === null
        if (!goodState(pullNodes.state) ||
          !goodState(pushNodes.state) ||
          !goodState(pullDb.state) ||
          !goodState(pushDb.state) ||
          remote.isRejected()) {
          console.warn('Troubles with', pullDb.source)

          currentMaster = undefined
          reselectMaster().then(() => {
            lastReselect = new Date()
          })
        } else {
          // All good
          if ((new Date() - lastReselect) <
            config.retry_master) {
            setTimeout(checkReplication, config.keep_alive)
          } else {
            // Maybe we need new master
            reselectMaster().then(() => {
              lastReselect = new Date()
            })
          }
        }
      })
  }

  function getAllRevs (id, revs) {
    return Promise.map(revs, r => db.getAsync(id, {rev: r}))
  }

  async function fixIt (doc) {
    while (doc._conflicts !== undefined) {
      const revs = [doc._rev, ...doc._conflicts]
      const confs = await getAllRevs(doc._id, doc._conflicts)
      const best = mergeAll([doc, ...confs])
      await db.bulkAsync(prepareMergeResult(best, revs))
      doc = await db.getAsync(doc._id, {conflicts: true})
    }
    return doc
  }

  // Passing CRUD operations
  return {
    create: doc => {
      const keys = Object.keys(doc)
      const now = new Date().valueOf()
      doc.$times = {}
      for (const key of keys) {
        doc.$times[key] = now
      }
      return db.insertAsync(doc)
    },
    get: async function (id) {
      let result = await db.getAsync(id, {conflicts: true})
      return fixIt(result)
    },
    update: async function (doc, orig) {
      const keys = new Set(
        Object.keys(doc).concat(Object.keys(orig)))
      keys.delete('$times')
      const now = new Date().valueOf()

      doc._id = orig._id
      doc._rev = orig._rev
      doc.$times = orig.$times

      for (const key of keys) {
        if (doc[key] !== orig[key]) {
          // Maybe it is just not values?..
          if (JSON.stringify(doc[key]) !==
            JSON.stringify(orig[key])) {
            doc.$times[key] = now
          }
        }
      }

      try {
        const result = await db.insertAsync(doc)
        return result
      } catch (e) {
        if (e.error !== 'conflict') {
          throw e
        }
        while (true) {
          let res = await db.getAsync(doc._id,
            {conflicts: true})
          let revs = [res._rev]
          let confs = [res]
          if (res._conflicts) {
            revs = [res._rev, ...res._conflicts]
            const confsToAdd = await getAllRevs(doc._id,
              res._conflicts)
            confs = [res, ...confsToAdd]
          }
          const best = mergeAll([doc, ...confs])
          res = await db.bulkAsync(prepareMergeResult(best,
            revs))
          if (res[0].ok) {
            return res[0]
          }
        }
      }
    },
    delete: async function (id, rev) {
      let result
      try {
        result = await db.destroyAsync(id, rev)
      } catch (e) {}
      while (true) {
        try {
          const obj = await db.getAsync(id, {conflicts: true})
          let revs = [obj._rev]
          if (obj._conflicts) {
            revs = [...revs, ...obj._conflicts]
          }
          const res = await db.bulkAsync({
            docs: revs.map(r => ({
              _id: id,
              _rev: r,
              _deleted: true
            }))
          })
          result = res[0]
        } catch (e) {
          if (e.error === 'not_found') {
            return result
          } else {
            throw e
          }
        }
      }
    },
    list: () => db.listAsync({
      include_docs: true,
      conflicts: true
    }).then(res => res.rows.map(e => e.doc))
      .then(list => Promise.map(list, fixIt)),
    getMaster: () => Promise.resolve(currentMaster)
  }
}
