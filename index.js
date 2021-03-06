import cors from 'cors';
import conf from './config';
import createCipher from 'crypto';
import createDecipher from 'crypto';
import Database from './lib/Database';
import log from './lib/ErrorHandler';
import ErrorHandler  from './lib/ErrorHandler';
import express from 'express';
import {GitHub, GITHUB_CONNECT } from './lib/GitHub';
import Scheduler from './lib/Scheduler';
import SpeedTracker from './lib/SpeedTracker';
import json from 'body-parser';

// ------------------------------------
// Server
// ------------------------------------

const server = express()

server.use(json())

server.use(cors())

// ------------------------------------
// Scheduler
// ------------------------------------

let scheduler

// ------------------------------------
// GitHub
// ------------------------------------

const github = new GitHub()

github.authenticate(conf.get('githubToken'))

// ------------------------------------
// DB connection
// ------------------------------------

let db = new Database(connection => {
  console.log('(*) Established database connection')

  server.listen(conf.get('port'), () => {
    console.log(`(*) Server listening on port ${conf.get('port')}`)
  })

  scheduler = new Scheduler({
    db: connection,
    remote: github
  })
})

// ------------------------------------
// Endpoint: Test
// ------------------------------------

const testHandler = (req, res) => {
  const blockList = conf.get('blockList').split(',')

  // Abort if user is blocked
  if (blockList.indexOf(req.params.user) !== -1) {
    ErrorHandler.log(`Request blocked for user ${req.params.user}`)

    return res.status(429).send()
  }

  const speedtracker = new SpeedTracker({
    db,
    branch: req.params.branch,
    key: req.query.key,
    remote: github,
    repo: req.params.repo,
    scheduler,
    user: req.params.user
  })

  let profileName = req.params.profile

  console.log('🍌🍌🍌🍌🍌🍌',speedtracker);

  speedtracker.runTest(profileName).then(response => {
    res.send(JSON.stringify(response))
    console.log(response);
  }).catch(err => {
    console.log(err);
    ErrorHandler.log(err)

    res.status(500).send(JSON.stringify(err))
  })
}


// ------------------------------------
// Endpoint: Create new profile
// ------------------------------------
// TEMPLATE
// _default: false,
// name: slug,
// interval: 5,
// parameters: {
//   connectivity: "cable",
//   location: "ec2-eu-west-3:Chrome",
//   url: 'https://lol.com',
//   runs: '2',
//   video: true,
// }

const profileCreator = (res, req) => {
  const { res: response } = res
  const { req: request } = req
  const { isfrontpage, ...settings } = request.body
  const { user, repo, branch } = request.params
  
  const profileSettings = {
    ...settings,
    default: isfrontpage
  }

  const speedtracker = new SpeedTracker({
    db,
    branch: branch,
    key: request.query.key,
    remote: github,
    repo: repo,
    scheduler,
    user: user
  })  

  speedtracker.createProfile(profileSettings).then(callback => {
    console.log(profileSettings)
    const status = callback.meta.status == '201 Created';
    response.status(200).send(JSON.stringify({success: status, callback}))
  }).catch(err => {
    ErrorHandler.log(err)
    console.log(err)
    response.status(500).send(JSON.stringify(err))
  })
}

server.post('/create/:user/:repo/:branch', profileCreator)
server.get('/v1/test/:user/:repo/:branch/:profile', testHandler)
server.post('/v1/test/:user/:repo/:branch/:profile', testHandler)

// ------------------------------------
// Endpoint: Connect
// ------------------------------------

server.get('/v1/connect/:user/:repo', (req, res) => {
  const github = new GitHub(GITHUB_CONNECT)

  github.authenticate(conf.get('githubToken'))

  github.api.users.getRepoInvites({}).then(response => {
    let invitationId
    let invitation = response.some(invitation => {
      if (invitation.repository.full_name === (req.params.user + '/' + req.params.repo)) {
        invitationId = invitation.id

        return true
      }
    })

    if (invitation) {
      return github.api.users.acceptRepoInvite({
        id: invitationId
      })
    } else {
      return Promise.reject()
    }
  }).then(response => {
    res.send('OK!')
  }).catch(err => {
    ErrorHandler.log(err)

    res.status(500).send('Invitation not found.')
  })
})

// ------------------------------------
// Endpoint: Encrypt
// ------------------------------------

server.get('/encrypt/:key/:text?', (req, res) => {
  const key = req.params.key
  const text = req.params.text || req.params.key

  const cipher = createCipher('aes-256-ctr', key)
  let encrypted = cipher.update(decodeURIComponent(text), 'utf8', 'hex')

  encrypted += cipher.final('hex')

  res.send(encrypted)
})

// ------------------------------------
// Endpoint: Decrypt
// ------------------------------------

server.get('/decrypt/:key/:text?', (req, res) => {
  const decipher = createDecipher('aes-256-ctr', req.params.key)
  let decrypted = decipher.update(req.params.text, 'hex', 'utf8')

  decrypted += decipher.final('utf8')

  res.send(decrypted)
})

// ------------------------------------
// Endpoint: Catch all
// ------------------------------------

server.all('*', (req, res) => {
  const response = {
    success: false,
    error: 'INVALID_URL_OR_METHOD'
  }

  res.status(404).send(JSON.stringify(response))
})

// ------------------------------------
// Basic error logging
// ------------------------------------

process.on('unhandledRejection', (reason, promise) => {
  if (reason) {
    ErrorHandler.log(reason)
  }
})
