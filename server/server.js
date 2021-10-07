import express from 'express'
import path from 'path'
import cors from 'cors'
import sockjs from 'sockjs'
import { renderToStaticNodeStream } from 'react-dom/server'
import React from 'react'
import axios from 'axios'
import cookieParser from 'cookie-parser'
import config from './config'
import Html from '../client/html'

require('colors')
const { writeFile, readFile, unlink, stat } = require('fs').promises

let Root
try {
  // eslint-disable-next-line import/no-unresolved
  Root = require('../dist/assets/js/ssr/root.bundle').default
} catch {
  console.log('SSR not found. Please run "yarn run build:ssr"'.red)
}

let connections = []

const port = process.env.PORT || 8090
const server = express()

const headers = (req, res, next) => {
  res.set('x-skillcrucial-user', 'ad0b9843-8e27-4a0e-bca9-6b4a57fd1763')
  res.set('Access-Control-Expose-Headers', 'X-SKILLCRUCIAL-USER')
  next()
}

const middleware = [
  cors(),
  express.static(path.resolve(__dirname, '../dist/assets')),
  express.urlencoded({ limit: '50mb', extended: true, parameterLimit: 50000 }),
  express.json({ limit: '50mb', extended: true }),
  cookieParser(),
  headers
]

middleware.forEach((it) => server.use(it))

const filePath = `${__dirname}/users.json`
const url = 'https://jsonplaceholder.typicode.com/users'

const getData = async (link) => {
  const result = await axios(link).then(({ data }) => data)
  return result
}

const getFileContent = (pathToFile) => readFile(pathToFile, { encoding: 'utf8' })
  .then(text => JSON.parse(text))
  .catch(async () => {
    const users = await getData(url)
    writeFile(pathToFile, JSON.stringify(users), 'utf8')
    return users
  })


server.get('/api/v1/users', async (req, res) => {
  res.json(await getFileContent(filePath))
})

server.post('/api/v1/users', async (req, res) => {
  let userList = await getFileContent(filePath)
  const maxId = userList.reduce((acc, rec) => {
    return rec.id > (acc.id || 0) ? rec.id : acc.id
  }, {})
  const newUser = { ...req.body, id: maxId + 1 }
  userList = [...userList, newUser]
  await writeFile(filePath, JSON.stringify(userList), 'utf8')

  res.json({ status: 'success', id: newUser.id })
})

server.patch('/api/v1/users/:userId', async (req, res) => {
  const { userId } = req.params
  const data = req.body
  const updatedUser = { ...data, id: userId} 
  const userList = await getFileContent(filePath)
  const updatedList = userList.map(obj => (obj.id === +userId) ? {...obj, ...updatedUser} : obj)
  await writeFile(filePath, JSON.stringify(updatedList), 'utf8')
  res.json(updatedList)
})

server.delete('/api/v1/users/:userId', async (req, res) => {
  const { userId } = req.params
  const userList = await getFileContent(filePath)
  const updatedList = userList.filter(obj => obj.id !== +userId)
  writeFile(filePath, JSON.stringify(updatedList), 'utf8')
  res.json({ status: 'success', id: userId })
})

server.delete('/api/v1/users/', (req, res) => {
  stat(filePath)  
    .then(() => {
      unlink(filePath)
      res.json({ status: 'success' })
    })  
    .catch(err => {
      console.log(err)
      res.json({ status: 'No such file' })
    })
})

server.use('/api/', (req, res) => {
  res.status(404)
  res.end()
})

const [htmlStart, htmlEnd] = Html({
  body: 'separator',
  title: 'Skillcrucial'
}).split('separator')

server.get('/', (req, res) => {
  const appStream = renderToStaticNodeStream(<Root location={req.url} context={{}} />)
  res.write(htmlStart)
  appStream.pipe(res, { end: false })
  appStream.on('end', () => {
    res.write(htmlEnd)
    res.end()
  })
})

server.get('/*', (req, res) => {
  const appStream = renderToStaticNodeStream(<Root location={req.url} context={{}} />)
  res.write(htmlStart)
  appStream.pipe(res, { end: false })
  appStream.on('end', () => {
    res.write(htmlEnd)
    res.end()
  })
})

const app = server.listen(port)

if (config.isSocketsEnabled) {
  const echo = sockjs.createServer()
  echo.on('connection', (conn) => {
    connections.push(conn)
    conn.on('data', async () => { })

    conn.on('close', () => {
      connections = connections.filter((c) => c.readyState !== 3)
    })
  })
  echo.installHandlers(app, { prefix: '/ws' })
}
console.log(`Serving at http://localhost:${port}`)
