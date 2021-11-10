

import { default as RaidaJS } from "./lib/raidajs.js"

console.log(RaidaJS)

let raidaJS = RaidaJS()
raidaJS.apiEcho(r => { console.log(r) })

