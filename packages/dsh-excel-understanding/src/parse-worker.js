import { parentPort, workerData } from 'node:worker_threads'
import { parseWorkbook } from './parser.js'
try { parentPort.postMessage({ ok: true, value: parseWorkbook(workerData) }) }
catch (error) { parentPort.postMessage({ ok: false, error: error.message }) }
