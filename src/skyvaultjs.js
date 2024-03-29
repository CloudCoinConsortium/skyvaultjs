import axios from 'axios'
import md5 from 'js-md5'
var _ws = require('ws')
import CryptoJS from 'crypto-js'


console.log("V.1.84.0")

import allSettled from 'promise.allsettled'

let _isBrowser = false
if (typeof window !== 'undefined') {
  _isBrowser = true
}


class SkyVaultJS {
  // Contrustor
  constructor(options) {
    this.options = {
      domain: "cloudcoin.global",
      prefix: "raida",
      protocol: "https",
      wsprotocol: "wss",
      forcetcprequest: true,
      timeout: 20000, // ms
      nexttimeout: 5000,
      defaultCoinNn: 1,
      maxFailedRaidas: 5,
      debug: false,
      defaultRaidaForQuery: 7,
      defaultRaidaForBackupQuery: 14,
      ddnsServer: "ddns.cloudcoin.global",
      // max coins to transfer at a time
      maxCoins: 16000,
      maxSendCoins: 3200,
      maxCoinsPerIteraiton: 200,
      minPasswordLength: 8,
      memoMetadataSeparator: "*",
      minPassedNumToBeAuthentic: 14,
      maxFailedNumToBeCounterfeit: 12,
      syncThreshold: 13,
      urlCardTemplate: "https://cloudcoinconsortium.com/img/card.png",
      ...options
    }

    this.pmall = null
    this._raidaServers = []
    this._webSockets = []
    this._totalServers = 25
    this.highestrestime = 0

    this._generateServers()
    this._initAxios()

    this.__authenticResult = "authentic"
    this.__frackedResult = "fracked"
    this.__counterfeitResult = "counterfeit"
    this.__errorResult = "error"

    this._crcTable = null

    this._rarr = {}
  }



  // RAIDA to query for SkyWallet creation
  setDefaultRAIDA(raidaNum) {
    this.options.defaultRaidaForQuery = raidaNum
  }

  // Timeout for requests in milliseconds
  setTimeout(timeout) {
    this.options.timeout = timeout
    this._initAxios()
  }

  // Timeout for requests in milliseconds
  setDomain(domain) {
    this.options.domain = domain
    this._generateServers()
  }

  // Set RAIDA Protocol
  setProtocol(protocol) {
    this.options.protocol = protocol
    this._generateServers()
  }

  // Network number
  setDefaultNetworkNumber(nn) {
    this.options.defaultCoinNn = nn
  }

  // Return the array of raida servers
  getServers() {
    return this._raidaServers
  }

  /*** RAIDA SERVICES API ***/

  // Echo
  async apiEcho(callback = null) {
    let ab = new ArrayBuffer(19 + 5)
    let d = new DataView(ab)
    d.setUint8(5, 0x04)//command echo
    d.setUint8(8, 0x01)//coin id
    d.setUint8(12, 0xAB)// echo
    d.setUint8(13, 0xAB)// echo
    if (this.options.forcetcprequest) d.setUint16(14, 0x02)//tcp body size
    else d.setUint16(14, 0x01)//udp packetnumber
    d.setUint8(22, 0x3e)
    d.setUint8(23, 0x3e) // Trailing chars

    await this.waitForSockets()
    let rqs = this._launchRequests("echo", ab, callback, true, null, null, 8000)
    let rv = {
      status: 'done',
      code: SkyVaultJS.ERR_NO_ERROR,
      onlineServers: 0,
      totalServers: this._totalServers,
      serverStatuses: [],
      details: []
    }

    console.log("waited3")
    let mainPromise = rqs.then(response => {
    console.log("waited4")
      this._parseMainPromise(response, 0, rv, serverResponse => {
        if (serverResponse === "error" || serverResponse === "network")
          return

        let dView = new DataView(serverResponse)
        if (dView.getUint8(2) === 250) {
          rv.serverStatuses[dView.getUint8(0)] = 1
          rv['onlineServers']++;
        }
        else {
          rv.serverStatuses[dView.getUint8(0)] = 0
        }
      })

      return rv
    })

    return mainPromise
  }

  async apiFind(params, callback = null) {
    let coins = []
    if (!Array.isArray(params.coins)) {
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_COIN, "Parameter 'coins' needs to be an array")
    }

    for (let k in params.coins) {
      let coin = params[k]

      if (!this._validateCoin(coin))
        continue

      if (!('an' in coin))
        continue

      if (!('pan' in coin))
        continue


      coins.push(coin)
    }

    if (coins.length < 1) {
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_COIN, "Failed to validate coin")
    }
    if (coins.length > this.options.maxSendCoins) {
      return this._getError("You can't find more than " + this.options.maxSendCoins + " coins at a time")
    }
    let tcpmode = true
    //   if (coins.length >= 40) tcpmode = true


    let challange = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    let chcrc32 = this._crc32(challange, 0, 12)

    let ab, d
    let rqdata = []
    for (let i = 0; i < this._totalServers; i++) {
      ab = new ArrayBuffer(24 + 16 + 35 * coins.length)
      d = new DataView(ab)
      d.setUint8(ab.byteLength - 1, 0x3e);
      d.setUint8(ab.byteLength - 2, 0x3e); // Trailing chars

      d.setUint8(2, i);
      d.setUint8(5, 0x02)//command find
      /*
      if(coin.sn >= 26000 && coin.sn <= 100000){
      d.setUint8(8, 0x00); //coin id
      }else{
      d.setUint8(8, 0x01); //coin id
      */
      d.setUint8(8, 0x01)//coin id
      d.setUint8(12, 0xAB)// echo
      d.setUint8(13, 0xAB)// echo
      if (this.options.forcetcprequest || tcpmode) d.setUint16(14, 18 + 35 * coins.length)//tcp body size
      else d.setUint16(14, 0x01)//udp packetnumber

      d.setUint8(22, 0x3e)
      d.setUint8(23, 0x3e) // Trailing chars
      for (let x = 0; x < 12; x++) {
        d.setUint8(22 + x, challange[x])
      }
      d.setUint32(34, chcrc32)
      coins.forEach((coin, j) => {
        d.setUint32(38 + j * 35, coin.sn << 8)
        for (let x = 0; x < 16; x++) {
          d.setUint8(41 + 35 * j + x, parseInt(coin.an[i].substr(x * 2, 2), 16));
        }
        for (let y = 0; y < 16; y++) {
          d.setUint8(57 + 35 * j + y, parseInt(coin.pan[i].substr(y * 2, 2), 16));
        }
      })

      rqdata.push(ab)
    }

    await this.waitForSockets()
    let rqs = this._launchRequests("find", rqdata, callback, tcpmode)
    let rv = {
      status: 'done',
      code: SkyVaultJS.ERR_NO_ERROR,
      recovered: []

    }
    let rcoins = {}; // Setup the return hash value

    for (let i = 0; i < coins.length; i++) {
      let sn = coins[i].sn;
      rcoins[sn] = {
        sn: sn,
        errors: 0,
        counterfeit: 0,
        authentic: 0,
        pownstring: "",
        result: "unknown"
      }
    }



    let mainPromise = rqs.then(response => {
      this._parseMainPromise(response, 0, rv, serverResponse => {

        if (serverResponse === "error") {
          Object.keys(rcoins).map(sn => {
            rcoins[sn].errors++
            rcoins[sn].pownstring += "e"
          })
          return
        }

        if (serverResponse === "network") {
          Object.keys(rcoins).map(sn => {
            rcoins[sn].errors++
            rcoins[sn].pownstring += "n"
          });
          return
        }
        let sr = new DataView(serverResponse)
        let status = sr.getUint8(2)

        if (status < 208 || status > 211) {
          for (let i = 0; i < coins.length; i++) {
            let sn = coins[i].sn
            rcoins[sn].errors++
            rcoins[sn].pownstring += "e"
          }

          return
        }

      })

      return rv
    })

    return mainPromise
  }

  // Detect
  async apiPown(params, callback = null) {
    if (!Array.isArray(params)) {
      console.error("Invalid input data")
      return null
    }

    let rqdata = this._formRequestData(params)


    await this.waitForSockets()
    // Launch Requests
    let rqs = this._launchRequests("multi_detect", rqdata, callback)

    let rv = this._getGenericMainPromise(rqs, params).then(response => {

      return response
    })


    return rv
  }

  async apiDetect(params, callback = null) {

    if (!Array.isArray(params)) {
      console.error("Invalid input data")
      return null
    }

    let rqdata = this._formRequestData(params, false, 1)


    await this.waitForSockets()
    // Launch Requests
    let rqs = this._launchRequests("multi_detect", rqdata, callback)

    let rv = this._getGenericMainPromise(rqs, params).then(response => {

      return response
    })


    return rv
  }

  // Deletes a statement from the RAIDA
  async apiDeleteRecord(params, callback = null) {
    if (!('coin' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_COIN, "Coin in missing")

    let coin = params['coin']
    if (!this._validateCoin(coin)) {
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_COIN, "Failed to validate coin")
    }


    let challange = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    let chcrc32 = this._crc32(challange, 0, 12)


    let rqdata = [];
    let ab, d;

    for (let i = 0; i < this._totalServers; i++) {
      ab = new ArrayBuffer(24 + 35);
      d = new DataView(ab); //rqdata.push(ab)

      d.setUint8(ab.byteLength - 1, 0x3e);
      d.setUint8(ab.byteLength - 2, 0x3e); // Trailing chars

      d.setUint8(2, i); //raida id

      d.setUint8(5, 131); //command delete statement

      d.setUint8(8, 0x01); //coin id

      d.setUint8(12, 0xAB); // echo

      d.setUint8(13, 0xAB); // echo

      if (this.options.forcetcprequest) d.setUint16(14, 37)//tcp body size
      else d.setUint16(14, 0x01)//udp packetnumber

      //body

      for (let x = 0; x < 12; x++) {
        d.setUint8(22 + x, challange[x])
      }
      d.setUint32(34, chcrc32)

      d.setUint32(38, coin.sn << 8); //rqdata[i].sns.push(coin.sn)

      for (let x = 0; x < 16; x++) {
        d.setUint8(41 + x, parseInt(coin.an[i].substr(x * 2, 2), 16));
      }
      rqdata.push(ab)
    }

    let rv = {
      'code': SkyVaultJS.ERR_NO_ERROR,
      'text': "Deleted successfully"
    }

    let a, e, f
    a = f = e = 0
    await this.waitForSockets()
    let rqs = this._launchRequests("statements/delete", rqdata, callback)
    let mainPromise = rqs.then(response => {
      this._parseMainPromise(response, 0, rv, (serverResponse, rIdx) => {
        if (serverResponse === "error" || serverResponse == "network") {
          e++
          return
        }
        let dView = new DataView(serverResponse);
        if (dView.getUint8(2) == 250) {
          a++
          return
        }
        else {
          f++
          return
        }

        e++
      })
      let result = this._gradeCoin(a, f, e)
      if (!this._validResult(result))
        return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_TOO_FEW_PASSED, "Failed to delete statement. Too many error responses from RAIDA")

      return rv
    })

    return mainPromise

  }

  // Reads statements from the RAIDA
  async apiShowRecords(params, callback = null) {
    if (!('coin' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_COIN, "Coin in missing")

    let coin = params['coin']
    if (!this._validateCoin(coin)) {
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_COIN, "Failed to validate coin")
    }

    let ts = 0
    let yr, mm, dy, num_rows

    if ('start_ts' in params) {
      ts = params['start_ts']
      if (!('month' in ts) || !('year' in ts) || !('day' in ts)) {
        return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_TIMESTAMP, "Invalid Timestamp")
      }
      yr = ts.year
      mm = ts.month
      dy = ts.day
    } else {
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_TIMESTAMP, "Missing Timestamp")
    }
    if ('rows' in params) {
      num_rows = params['rows']
    }
    let challange = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    let chcrc32 = this._crc32(challange, 0, 12)
    let guid = this._generatePan()
    let rqdata = []
    let ab, d;
    for (let i = 0; i < this._totalServers; i++) {
      ab = new ArrayBuffer(80);
      d = new DataView(ab); //rqdata.push(ab)
      d.setUint8(ab.byteLength - 1, 0x3e)
      d.setUint8(ab.byteLength - 2, 0x3e) // Trailing chars

      d.setUint8(2, i); //raida id
      d.setUint8(5, 130); //command show statement
      d.setUint8(8, 0x00); //coin id
      d.setUint8(12, 0xAB); // echo
      d.setUint8(13, 0xAB); // echo
      if (this.options.forcetcprequest) d.setUint16(14, 58)//tcp body size
      else d.setUint16(14, 0x01)//udp packetnumber

      //body
      for (let x = 0; x < 12; x++) {
        d.setUint8(22 + x, challange[x])
      }
      d.setUint32(34, chcrc32)
      d.setUint32(38, coin.sn << 8); //rqdata[i].sns.push(coin.sn)
      for (let x = 0; x < 16; x++) {
        d.setUint8(41 + x, parseInt(coin.an[i].substr(x * 2, 2), 16));
      }
      if (num_rows != null)
        d.setUint8(57, num_rows)//rows
      else {
        d.setUint8(57, 1)
      }
      if (yr > 2000)
        yr = yr - 2000
      d.setUint8(58, yr)//year
      d.setUint8(59, mm)//month
      d.setUint8(60, dy)//day
      switch (i) {
        case 0:
        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
        case 6:
        case 7:
          d.setUint8(61, 0x00)
          break;
        case 8:
        case 9:
        case 10:
        case 11:
        case 12:
        case 13:
        case 14:
        case 15:
          d.setUint8(61, 0x01)
          break;
        case 16:
        case 17:
        case 18:
        case 19:
        case 20:
        case 21:
        case 22:
        case 23:
          d.setUint8(61, 0x11)
          break;
        case 24:
          d.setUint8(61, 0xFF)
          break;
      }
      for (let x = 0; x < 16; x++) {
        d.setUint8(62 + x, parseInt(guid.substr(x * 2, 2), 16));
      }//one time key
      rqdata.push(ab)
    }

    let rv = {
      'code': SkyVaultJS.ERR_NO_ERROR,
      'text': "Records returned",
      'records': [],
      'balance': []

    }

    let e, a, f, n
    e = a = f = n = 0
    let statements = {}
    let serverResponses = []
    await this.waitForSockets()
    let rqs = this._launchRequests("statements/read", rqdata, callback)
    let mainPromise = rqs.then(response => {
      this._parseMainPromise(response, 0, rv, (serverResponse, rIdx) => {
        if (serverResponse === "error" || serverResponse == "network") {
          e++
          serverResponses.push(null)
          return
        }
        let dView = new DataView(serverResponse);

        if (dView.getUint8(2) == 250 || dView.getUint8(2) == 241) {
          if (dView.byteLength < 16) {
            e++
            serverResponses.push(null)
            return
          }
          rv.balance.push(dView.getUint32(12))

          serverResponses.push(serverResponse)
          if (dView.byteLength > 16) {
            let offset = 16
            let nonmemo = 31
            let unread = true
            while (unread) {
              let data = new DataView(serverResponse, offset)
              let key = ""
              for (let r = 0; r < 16; r++) {
                key += data.getUint8(r).toString(16)
              }
              //let key = ldata.statement_id
              if (!(key in statements)) {
                statements[key] = {}
                statements[key]['type'] = data.getUint8(16)
                statements[key]['amount'] = data.getUint32(17)
                statements[key]['balance'] = data.getUint32(21)
                statements[key]['time'] = new Uint8Array(serverResponse, 25 + offset, 6)
                statements[key]['guid'] = key
                statements[key]['mparts'] = []
              }


              let x = 0;
              let memobytes = [];
              //let endcheck = data.getUint16(nonmemo + x);

              while (x < 50) {//endcheck != 0) {
                memobytes.push(data.getUint8(nonmemo + x));
                x++;
                //endcheck = data.getUint16(nonmemo + x);
              }

              statements[key]['mparts'][rIdx] = memobytes;
              offset = offset + nonmemo + x;//+2;
              if (offset == serverResponse.byteLength)
                unread = false
            }
          }

          a++
          return
        }

        if (dView.getUint8(2) == 251 || dView.getUint8(2) == 242) {
          serverResponses.push(null)
          f++
          return
        }

        if (dView.getUint8(2) == 120) {
          n++
        }

        serverResponses.push(null)
        e++
      })

      let result = this._gradeCoin(a, f, e)
      if (n > 20)
        return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_RECORD_NOT_FOUND, "No Statements found");
      /*
              if (!this._validResult(result)){
                let er = this._getErrorCode(SkyVaultJS.ERR_RESPONSE_TOO_FEW_PASSED, "Failed to read statements. Too many error responses from RAIDA");
                this._addDetails(er, serverResponses);
                return er;
              }*/
      for (let statement_id in statements) {
        let item = statements[statement_id]
        //let odata = this._getDataFromObjectMemo(item.mparts)
        //if (odata == null) {
        //console.log("Failed to assemble statement " + statement_id + " Not enough valid responses")
        //continue
        //}

        rv.records.push(item)//(odata)
      }
      /*
            // Fire-and-forget (if neccessary)
            this._syncAdd(serverResponses, "statement_id", "statements/sync/sync_add")
            this._syncDelete(serverResponses, "statement_id", "statements/sync/sync_delete")
      */

      return rv
    })

    return mainPromise;

  }

  // Creates a statement on the RAIDA
  async apiCreateRecord(params, callback = null) {
    if (!('coin' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_COIN, "Coin in missing")

    if (!('amount' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_AMOUNT, "Amount in missing")

    let coin = params['coin']
    if (!this._validateCoin(coin)) {
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_COIN, "Failed to validate coin")
    }

    let guid = this._generatePan()
    if ('guid' in params) {
      guid = params['guid']
      if (!this._validateGuid(guid)) {
        return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_GUID, "Failed to validate GUID")
      }
    }

    let memo = "Transfer from " + coin.sn
    if ('memo' in params)
      memo = params['memo']

    let event_code = "send"
    if ('event_code' in params) {
      event_code = params['event_code']
      if (!this._validateEventCode(event_code)) {
        return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_EVENT_CODE, "Failed to validate Event Code")
      }
    }

    let itype = "self"
    if ('initiator_type' in params) {
      itype = params['initiator_type']
      if (!this._validateInitiatorType(itype)) {
        return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_INITIATOR_TYPE, "Failed to validate Initiator type")
      }
    }

    let iid = "From SN " + coin.sn
    if ('initiator_id' in params)
      iid = params['initiator_id']

    let iimage_url = ""
    if ('initiator_image_url' in params)
      iid = params['initiator_image_url']

    let idescription_url = ""
    if ('initiator_description_url' in params)
      idescription_url = params['initiator_description_url']

    let rqdata = []
    let amount = params.amount
    let tags = this._getStripesMirrorsForObject({
      'guid': guid,
      'memo': memo,
      'amount': amount,
      'initiator_id': iid,
      'initiator_image_url': iimage_url,
      'initiator_description_url': idescription_url,
      'initiator_type': itype
    })
    for (let i = 0; i < this._totalServers; i++) {
      rqdata.push({
        'account_sn': coin.sn,
        'account_an': coin.an[i],
        'transaction_id': guid,
        'version': 0,
        'compression': 0,
        'raid': '110',
        'stripe': tags[i]['stripe'],
        'mirror': tags[i]['mirror1'],
        'mirror2': tags[i]['mirror2']
      })
    }

    let rv = {
      'code': SkyVaultJS.ERR_NO_ERROR,
      'guid': guid,
      'text': "Created successfully"
    }

    let passed = 0
    let a, f, e
    a = f = e = 0
    await this.waitForSockets()
    let rqs = this._launchRequests("statements/create", rqdata, callback, false)
    let mainPromise = rqs.then(response => {
      this._parseMainPromise(response, 0, rv, serverResponse => {
        if (serverResponse === "error" || serverResponse == "network") {
          e++
          return
        }
        if (serverResponse.status == "success") {
          a++
        }
        if (serverResponse.status == "fail") {
          f++
        }
      })

      let result = this._gradeCoin(a, f, e)
      //      if (result == this.__counterfeitResult)
      //        return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_COIN, "The coin is counterfeit")

      if (!this._validResult(result))
        return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_TOO_FEW_PASSED, "Failed to create statement. Too many error responses from RAIDA")

      return rv

    })

    return mainPromise
  }

  async _getDefaultTicket(cc, callback) {
    let response = await this.apiGetticket(cc, callback)
    if (response.status != "done")
      return null

    let rquery = this.options.defaultRaidaForQuery
    let ticket = response.tickets[rquery]
    if (ticket == 'error' || ticket == 'network') {
      rquery = this.options.defaultRaidaForBackupQuery
      ticket = response.tickets[rquery]
      console.log("doing backup tickets")
      if (ticket == 'error' || ticket == 'network') {
        return null
      }
    }

    return [ticket, rquery]
  }

  // Delete DNS
  async apiDeleteSkyWallet(params, callback = null) {

    if (!('coin' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_COIN, "Coin in missing")

    if (!('name' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_DNS_NAME, "DNS Name in missing")

    let coin = params['coin']
    if (!this._validateCoin(coin)) {
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_COIN, "Failed to validate coin")
    }

    let tdata = await this._getDefaultTicket(params['coin'], callback)
    if (tdata == null) {
      return this._getErrorCode(SkyVaultJS.ERR_FAILED_TO_GET_TICKETS, "Failed to get ticket from RAIDA" + this.options.defaultRaidaForQuery + " and backup raida " + this.options.defaultRaidaForBackupQuery)
    }

    if (callback != null)
      callback(0, "deleting_dns")

    let ticket = tdata[0]
    let rquery = tdata[1]
    let name = params['name']

    console.log("got delete ticket " + ticket)
    let protocol = "https://";
    if (this.wsprotocol == "ws")
      protocol = "http://";


    let url = protocol + this.options.ddnsServer + "/service/ddns/ddns_delete.php?"
    url += "sn=" + coin.sn + "&username=" + name + "&raidanumber=" + rquery
    let response = await this._axInstance.get(url)
    if (response.status != 200)
      return this._getErrorCode(SkyVaultJS.ERR_DNS_SERVER_INCORRECT_RESPONSE, "DNSService returned wrong code: " + response.status)

    let data = response.data
    if (!('status' in data))
      return this._getErrorCode(SkyVaultJS.ERR_DNS_SERVER_INCORRECT_RESPONSE, "DNSService returned wrong data. No status found")

    if (data.status != 'success') {
      let msg = data.status
      if ('errors' in data) {
        if (data.errors.length != 0) {
          msg += " " + data.errors[0]['message']
        }
      }
      return this._getErrorCode(SkyVaultJS.ERR_DNS_SERVER_INCORRECT_RESPONSE, "DNSService returned incorrect status: " + msg)
    }

    return {
      // Legacy
      'code': SkyVaultJS.ERR_NO_ERROR,
      'text': "Registered Successfully"
    }

  }

  // Register DNS
  async apiRegisterSkyWallet(params, callback = null) {

    if (!('coin' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_COIN, "Coin in missing")

    if (!('name' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_DNS_NAME, "DNS Name in missing")

    let coin = params['coin']
    if (!this._validateCoin(coin)) {
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_COIN, "Failed to validate coin")
    }

    if (callback != null)
      callback(0, "resolve_dns")

    let name = await this._resolveDNS(params['name'])
    if (name != null) {
      if ('overwrite' in params && params['overwrite'] == true) {
        let rv = await this.apiDeleteSkyWallet(params, callback)
        if (rv.code != SkyVaultJS.ERR_NO_ERROR) {
          return rv
        }
      } else {
        return this._getErrorCode(SkyVaultJS.ERR_DNS_RECORD_ALREADY_EXISTS, "DNS name already exists")
      }
    }

    name = params['name']
    console.log("waited3")
    let rquery = 0

    if (callback != null)
      callback(0, "register_dns")

    let protocol = "https://";
    if (this.wsprotocol == "ws")
      protocol = "http://";

    let url = protocol + this.options.ddnsServer + "/service/ddns/ddns.php?"
    url += "sn=" + coin.sn + "&username=" + name + "&raidanumber=" + rquery
    let response = await this._axInstance.get(url)
    if (response.status != 200)
      return this._getErrorCode(SkyVaultJS.ERR_DNS_SERVER_INCORRECT_RESPONSE, "DNSService returned wrong code: " + response.status)

    let data = response.data
    if (!('status' in data))
      return this._getErrorCode(SkyVaultJS.ERR_DNS_SERVER_INCORRECT_RESPONSE, "DNSService returned wrong data. No status found")

    if (data.status != 'success') {
      let msg = data.status
      if ('errors' in data) {
        if (data.errors.length != 0) {
          msg += " " + data.errors[0]['message']
        }
      }
      return this._getErrorCode(SkyVaultJS.ERR_DNS_SERVER_INCORRECT_RESPONSE, "DNSService returned incorrect status: " + msg)
    }

    return {
      // Legacy
      'status': 'done',

      'code': SkyVaultJS.ERR_NO_ERROR,
      'text': "Registered Successfully"
    }
  }

  // View receipt
  async apiViewreceipt(params, callback = null) {

    let coin = params
    if (!'account' in params || !'tag' in params) {
      return this._getError("Account and Tag required")
    }

    if (params.account < 1 || params.account > 16777216)
      return this._getError("Invalid Account")


    if (!params.tag.match(/^[a-fA-F0-9]{32}$/))
      return this._getError("Invalid Tag UUID")

    let rqdata = []
    for (let i = 0; i < this._totalServers; i++) {
      rqdata.push({
        account: params.account,
        tag: params.tag,
      })
    }
    await this.waitForSockets()
    let rqs = this._launchRequests("view_receipt", rqdata, callback, false)
    let rv = {
      status: 'done',
      code: SkyVaultJS.ERR_NO_ERROR,
      sns: {},
      details: [],
      total: 0
    }
    let mainPromise = rqs.then(response => {
      for (let i = 0; i < response.length; i++) {
        if (typeof (response[i].value) == 'undefined')
          continue

        if (typeof (response[i].value.data) != 'object')
          continue

        response[i].value.data.status = "pass"
      }

      this._parseMainPromise(response, 0, rv, serverResponse => {
        if (typeof (serverResponse) != 'object')
          return

        if ('serial_numbers' in serverResponse) {
          let sns = serverResponse['serial_numbers'].split(',')
          for (let i = 0; i < sns.length; i++) {
            let sn = sns[i].trim()
            if (sn == "")
              continue

            if (!(sn in rv.sns))
              rv.sns[sn] = 0

            rv.sns[sn]++
          }
        }

      })

      rv.sns = Object.keys(rv.sns).filter(item => {
        let a = rv.sns[item]
        let f = this._totalServers - a
        let result = this._gradeCoin(a, f, 0)
        if (this._validResult(result))
          return true

        return false
      })

      for (let sn of rv.sns)
        rv.total++

      return rv

    })

    return mainPromise
  }

  // Get Ticket (no multi)
  async apiGetticket(params, callback = null) {

    let coin = params
    if (!this._validateCoin(coin)) {
      return this._getError("Failed to validate params")
    }

    let rqdata = this._formRequestData([coin], false, 11)
    await this.waitForSockets()
    let rqs = this._launchRequests("get_ticket", rqdata, callback)
    let rv = {
      status: 'done',
      code: SkyVaultJS.ERR_NO_ERROR,
      tickets: []
    }
    let mainPromise = rqs.then(response => {
      this._parseMainPromise(response, 0, rv, (serverResponse, i) => {
        if (serverResponse === "error" || serverResponse == "network") {
          rv.tickets.push("error")
        } else {
          let dView = new DataView(serverResponse)
          let status = dView.getUint8(2)
          let mixed = 0;
          let ms;

          if (status == 243) {
            if (dView.byteLength >= 16)
              ms = dView.getUint8(16 + i / 8);
            else {
              ms = dView.getUint8(12 + i / 8);
            }
            let bitpos = i - 8 * (i / 8);
            mixed = ms >>> bitpos & 1;
          }
          if (status == 250 || status == 241 || status == 243 && mixed == 1)
            rv.tickets.push(dView.getUint32(3))
          else {
            rv.tickets.push("error")
          }
        }
      })

      return rv
    })

    return mainPromise
  }

  // FixFracked
  async apiFixfracked(params, callback = null) {

    let coins = []
    let superfixCoins = []

    // Filter out fracked coins
    for (let k in params) {
      let coin = params[k]

      if (!('pownstring' in coin))
        continue

      if (!('result' in coin))
        continue

      if (coin.result != this.__frackedResult)
        continue

      if (!this._validateCoin(coin))
        continue

      coin.pownArray = coin.pownstring.split("")
      coin.pownstring = ""
      coins.push(coin)
    }

    let rv = {
      status: 'done',
      code: SkyVaultJS.ERR_NO_ERROR,
      totalNotes: coins.length,
      fixedNotes: 0,
      result: {},
    }

    // Round 1
    for (let i = 0; i < this._totalServers; i++) {
      let ctfix = []
      for (let j = 0; j < coins.length; j++) {
        if (coins[j].pownArray[i] == 'a')
          continue;

        ctfix.push(coins[j])
      }

      if (ctfix.length != 0) {
        await this._realFix(0, i, ctfix, callback)
      }
    }

    // Form the result after all fixings are done
    let a, c, e
    for (let i = 0; i < coins.length; i++) {
      a = c = e = 0
      // Go over pownArray
      for (let j = 0; j < coins[i].pownArray.length; j++) {
        if (coins[i].pownArray[j] == 'p')
          a++;
        else if (coins[i].pownArray[j] == 'f')
          c++;
        else
          e++;

        coins[i].pownstring += coins[i].pownArray[j]
        coins[i].errors = e
        coins[i].authentic = a
        coins[i].counterfeit = c
      }

      delete coins[i].pownArray
      delete coins[i].pan
      if (c == 0 && e == 0) {
        coins[i].result = "fixed"
        rv.fixedNotes++
      }

      rv.result[coins[i].sn] = coins[i]
    }

    return rv
  }

  // Get CC by Card Number and CVV
  async apiGetCCByCardData(params) {

    if (!('cardnumber' in params))
      return this._getError("Card Number is not defined")

    if (!('cvv' in params))
      return this._getError("CVV is not defined")

    if (!('username' in params))
      return this._getError("Username is not defined")

    let cardNumber = params['cardnumber']
    let cvv = params['cvv']
    let username = params['username']
    console.log("using credentials: number:", cardNumber, "cvv:", cvv, "username", username);

    if (!this._validateCard(cardNumber, cvv))
      return this._getError("Invalid Card")

    let sn = await this._resolveDNS(username)
    if (sn == null)
      return this._getError("Failed to resolve DNS")

    let part = cardNumber.substring(3, cardNumber.length - 1)
    let ans = []
    for (let i = 0; i < 25; i++) {
      let seed = "" + i + sn + part + cvv
      ans[i] = "" + CryptoJS.MD5(seed)
    }

    let rv = {
      status: 'done',
      'cc': {
        nn: 1,
        sn: sn,
        an: ans
      }
    }

    return rv

  }

  readCCFile(file) {//pass in an arraybuffer
    if (!(file instanceof ArrayBuffer)) {
      return this._getError("file is not passed in as ArrayBuffer")
    }
    let d = new DataView(file)
    let offset = 32
    let eof = false
    let ccs = []
    while (!eof) {

      let ans = []
      let an = ""
      let sn = d.getUint32(offset) >>> 8
      for (let x = 0; x < 25; x++) {
        an = ""
        for (let y = 0; y < 16; y++) {
          let pos = offset + y + (x * 16) + 16
          if (d.getUint8(pos) < 16) an += "0";
          an += d.getUint8(pos).toString(16);
        }
        ans.push(an)
      }
      let cc = {sn: sn, an: ans}
      ccs.push(cc)
      offset += 416
      if (offset >= file.byteLength)
        eof = true
    }



    let rv = {
      'status': 'done',
      'code': 0,
      'cc': ccs
    }

    return rv
  }

  // extract stack from PNG
  async extractStack(params) {

    if (!('template' in params)) {
      return this._getError("Template is not defined")
    }

    let isError = false
    let imgAx = axios.create()
    let response = await imgAx.get(params['template'], {
      responseType: 'arraybuffer'
    }).catch(error => {
      isError = true
    })

    if (isError)
      return this._getError("Failed to load image")

    if (response.status != 200)
      return this._getError("Server returned non-200 HTTP code: " + response.status)

    let arrayBufferData = response.data

    let imgData = new Uint8Array(arrayBufferData)
    let idx = this._basePngChecks(imgData)
    if (typeof (idx) == 'string')
      return this._getError(idx)

    let fu8
    fu8 = imgData.slice(idx + 4)

    let i = 0
    let length
    while (true) {
      length = this._getUint32(fu8, i) - 32
      let signature = String.fromCharCode(fu8[i + 4]) + String.fromCharCode(fu8[i + 5])
        + String.fromCharCode(fu8[i + 6]) + String.fromCharCode(fu8[i + 7])

      if (length == 0) {
        i += 12
        if (i >= fu8.length) {
          return this._getError("CloudCoin was not found")
          break
        }
        continue
      }

      if (signature == 'cLDc') {
        let crcSig = this._getUint32(fu8, i + 40 + length)
        let calcCrc = this._crc32(fu8, i + 4, length + 32)
        /*
        if (crcSig != calcCrc) {
          return this._getError("Corrupted PNG. Invalid Crc32")
        }
*/
        break
      }

      // length + type + crc32 = 12 bytes// +32 == 44
      i += length + 44
      if (i > fu8.length) {
        return this._getError("CloudCoin was not found")
        break
      }

    }

    let data = fu8.slice(i + 40, i + 40 + length)
    let sdata = ""
    let sn
    let an = []
    let cloudcoin = []
    let numcoins = Math.floor(data.length / 416)
    for (let i = 0; i < numcoins; i++) {
      let sn
      let an = []
      sn = this._getUint32(data, i * 416) >>> 8
      for (let y = 0; y < 25; y++) {
        an.push("")
        for (let x = 0; x < 16; x++) {
          if (data[(y + 1) * 16 + x + 416 * i] < 16) an[y] += "0";
          an[y] += data[(y + 1) * 16 + x + 416 * i].toString(16)//((16 + x) + 416*i, parseInt(dcoin.an[y].substr(x * 2, 2), 16));
        }
      }
      cloudcoin.push({"sn": sn, "an": an})
    }
    let rv = {
      'status': 'done',
      'cloudcoin': cloudcoin
    }

    return rv
  }

  async apiFindAddress(sn) {
    let so = sn >>> 16;
    let to = sn >>> 8 & 0xff;
    let lo = sn & 0xff;
    let ip = "1." + so + '.' + to + '.' + lo;

  }

  // Generates a PNG Card
  async apiGenerateCard(params, callback = null) {

    if (!('cardnumber' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_CARD_NUMBER, "Card Number is not defined")

    if (!('cvv' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_CVV, "CVV is not defined")

    if (!('username' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_DNS_NAME, "Username is not defined")

    let username = params['username']
    if (!('expiration_date' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_EXPIRATION_DATE, "Expiration Date is not defined")

    let sn = await this._resolveDNS(username)
    if (sn == null)
      return this._getErrorCode(SkyVaultJS.ERR_DNS_RECORD_NOT_FOUND, "Failed to resolve DNS")

    let cardnumber = params['cardnumber']
    let cvv = params['cvv']
    if (!this._validateCard(cardnumber, cvv))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_CARD, "Invalid Card or CVV")

    let ed = params['expiration_date']
    if (!/^\d{1,2}\/\d{2}/.test(ed))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_EXPIRATION_DATE, "Invalid Expiration Date")


    let cardData = await this.apiGetCCByCardData(params)
    if (cardData.status != 'done')
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_CARD, "Failed to Generate CloudCoin")

    let cc = cardData.cc
    let url = this.options.urlCardTemplate
    if ('url_card_template' in params)
      url = params['url_card_template']

    let response
    try {
      let imgAx = axios.create()
      response = await imgAx.get(url, {
        responseType: 'arraybuffer'
      })
    } catch (e) {
      return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_INVALID_HTTP_RESPONSE, "Failed to get PNG template from " + url)
    }

    if (response.status != 200)
      return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_INVALID_HTTP_RESPONSE, "Invalid Code " + response.status)

    if (response.headers['content-type'] != "image/png")
      return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_INVALID_HTTP_CONTENT_TYPE, "Downloaded template is not a PNG file")

    let data = new Uint8Array(response.data)
    data = "data:image/png;base64," + this._base64ArrayBuffer(data)

    // Draw
    let ip = 0
    ip = "1." + ((cc.sn >> 16) & 0xff) + "." + ((cc.sn >> 8) & 0xff) + "." + ((cc.sn) & 0xff)
    let ddata = await this.apiDrawCardData(data, username, cardnumber, cvv, ed, ip)

    // Embed Stack
    let esparams = {
      coins: [cc],
      template: ddata,
      isid: true,
    }

    let bdata = await this.embedInImage(esparams)
    if ('status' in params && params.status == 'error')
      return this._getErrorCode(SkyVaultJS.ERR_FAILED_TO_EMBED_STACK, "Failed to embed stack")


    let rv = {
      'code': SkyVaultJS.ERR_NO_ERROR,
      'text': 'Card Generated',
      'data': bdata
    }

    return rv

  }

  async apiDrawCardData(data, username, cardnumber, cvv, ed, ip) {
    let c
    try {
      c = await require('canvas')
      if (!c)
        return this._getErrorCode(SkyVaultJS.ERR_NO_CANVAS_MODULE, "Canvas module not found")
    } catch (e) {
      return this._getErrorCode(SkyVaultJS.ERR_NO_CANVAS_MODULE, "Canvas module not found")
    }

    let canvas = c.createCanvas(700, 906)
    let context = canvas.getContext('2d')


    let pm = c.loadImage(data).then(image => {
      context.drawImage(image, 0, 0);
      context.lineWidth = 1;
      context.fillStyle = "#FFFFFF";
      context.lineStyle = "#FFFFFF";
      context.font = "bold 48px 'Overpass Mono'";
      context.fillText(cardnumber, 64, 285);
      context.font = "35px sans-serif";
      context.fillText(ed, 450, 362);
      context.font = "50px sans-serif";
      context.fillText(username, 64, 425);
      context.fillStyle = "#dddddd";
      context.lineStyle = "#dddddd";
      context.font = "bold 17px 'Overpass Mono'";
      context.fillText("Keep these numbers secret. Do not give to merchants.", 64, 320);
      context.lineWidth = 1;
      context.fillStyle = "#000000";
      context.lineStyle = "#000000";
      context.font = "35px sans-serif";
      context.fillText("CVV (Keep Secret): " + cvv, 64, 675);
      context.fillStyle = "#FFFFFF";
      context.lineStyle = "#FFFFFF";
      context.font = "18px sans-serif";
      context.fillText("IP " + ip, 174, 736);

      return canvas.toDataURL()
    })



    return pm
  }

  // embed stack into image
  async embedInImage(params) {

    if (!'template' in params) {
      return this._getError("Template is not defined")
    }

    if (!'coins' in params) {
      return this._getError("Invalid input data. No coins")
    }

    let isid = false
    if ('isid' in params)
      isid = true

    if (!Array.isArray(params['coins'])) {
      return this._getError("Invalid input data. Coins must be an array")
    }

    for (let i in params['coins']) {
      let coin = params['coins'][i]
      if (!this._validateCoin(coin)) {
        return this._getError("Failed to validate coins")
      }
      delete params['coins'][i]['pan']
    }

    let data = {"cloudcoin": params['coins']}
    //data = JSON.stringify(data)

    let coindatabuffer = new ArrayBuffer(416 * data.cloudcoin.length)
    let coindataview = new DataView(coindatabuffer)
    data.cloudcoin.forEach((dcoin, i) => {
      coindataview.setUint32(0 + 416 * i, dcoin.sn << 8)
      for (let y = 0; y < 25; y++) {
        for (let x = 0; x < 16; x++) {
          coindataview.setUint8((y + 1) * 16 + x + 416 * i, parseInt(dcoin.an[y].substr(x * 2, 2), 16));
        }
      }
    });


    let isError = false
    let imgAx = axios.create()
    let response = await imgAx.get(params['template'], {
      responseType: 'arraybuffer'
    }).catch(error => {
      isError = true
    })

    if (isError)
      return this._getError("Failed to load image")

    if (response.status != 200)
      return this._getError("Server returned non-200 HTTP code: " + response.status)

    let arrayBufferData = response.data

    let imgData = new Uint8Array(arrayBufferData)
    let idx = this._basePngChecks(imgData)
    if (typeof (idx) == 'string')
      return this._getError(idx)

    let fu8, lu8, myu8
    fu8 = imgData.slice(0, idx + 4)
    lu8 = imgData.slice(idx + 4)

    let ccLength = 416 * data.cloudcoin.length//data.length//change to reflect new format

    // length + type + crc32 = 12 bytes //+ new format headers(32) = 44
    myu8 = new Uint8Array(ccLength + 44)

    // Length
    this._setUint32(myu8, 0, ccLength + 32)

    // Chunk type cLDc
    myu8[4] = 0x63
    myu8[5] = 0x4c
    myu8[6] = 0x44
    myu8[7] = 0x63

    if (isid) {
      myu8[11] = 0x0
    } else {
      myu8[11] = 0x01
    }

    //let tBuffer = Buffer.from(data)
    // Data
    for (let i = 0; i < ccLength; i++) {
      myu8[i + 40] = coindataview.getUint8(i)//tBuffer.readUInt8(i)
    }

    // Crc32
    let crc32 = this._crc32(myu8, 4, ccLength + 36)//
    this._setUint32(myu8, ccLength + 40, crc32)//add to 8 the rest of the header bytes

    let combined = [...fu8, ...myu8, ...lu8]

    return this._base64ArrayBuffer(combined)
  }

  // Send
  async apiSend(params, callback = null) {
    this._rarr = {}; //this.addSentryError("superError", 19, {'xxx':'yyy'})

    if (!'coins' in params) {
      return this._getError("Invalid input data. No coins");
    }

    if (!Array.isArray(params['coins'])) {
      return this._getError("Invalid input data. Coins must be an array");
    }

    if (!'to' in params) {
      return this._getError("Invalid input data. To is not defined");
    } // To address


    let to = params['to'] + "";

    if (to.match(/^\d+$/) && (to > 0 || to < 16777216)) {} else {
      to = await this._resolveDNS(params['to']);

      if (to == null) {
        return this._getError("Failed to resolve DNS name: " + params.to);
      }
    }

    let amount = 0;
    let amountNotes = 0;

    let tcpmode = true

    for (let i in params.coins) {
      let cc = params.coins[i];
      amount++;
      amountNotes++;
    }
    if (amount > this.options.maxSendCoins) {
      return this._getError("You can't deposit more than " + this.options.maxSendCoins + " coins at a time")
    }
    //   if (amountNotes >= 40) tcpmode = true

    let memo = 'memo' in params ? params['memo'] : "Send";
    let from = "SkyVaultJS";
    let challange = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

    let chcrc32 = this._crc32(challange, 0, 12);
    let guid = this._generatePan();
    let times = new Date(Date.now());
    let tags = this._getObjectMemo(memo, from); // Assemble input data for each Raida Server


    let ab, d;
    let rqdata = [];
    let packetsize = 95;
    packetsize += 22; //header size
    packetsize += 19 * amountNotes;

    for (let i = 0; i < this._totalServers; i++) {
      ab = new ArrayBuffer(packetsize);
      d = new DataView(ab); //rqdata.push(ab)

      d.setUint8(ab.byteLength - 1, 0x3e);
      d.setUint8(ab.byteLength - 2, 0x3e); // Trailing chars

      d.setUint8(2, i); //raida id

      d.setUint8(5, 100); //command deposit

      d.setUint8(8, 0x01); //coin id

      d.setUint8(12, 0xAB); // echo

      d.setUint8(13, 0xAB); // echo

      if (this.options.forcetcprequest || tcpmode) d.setUint16(14, packetsize - 22)//tcp body size
      else d.setUint16(14, 0x01)//udp packetnumber


      for (let x = 0; x < 12; x++) {
        d.setUint8(22 + x, challange[x]);
      }

      d.setUint32(34, chcrc32); //body
      for (let j = 0; j < params['coins'].length; j++) {
        let coin = params['coins'][j];

        if ('an' in coin) {
          for (let x = 0; x < coin.an.length; x++) {
            if (coin.an[x] == null) coin.an[x] = this._generatePan();
          }
        }

        if (!this._validateCoin(coin)) {
          return this._getError("Invalid coin. Idx " + j);
        }
        d.setUint32(38 + j * 19, coin.sn << 8); //rqdata[i].sns.push(coin.sn)

        for (let x = 0; x < 16; x++) {
          d.setUint8(38 + j * 19 + (3 + x), parseInt(coin.an[i].substr(x * 2, 2), 16));
        }
      }

      d.setUint32(38 + amountNotes * 19, to << 8); //owner

      for (let x = 0; x < 16; x++) {
        d.setUint8(41 + amountNotes * 19 + x, parseInt(guid.substr(x * 2, 2), 16));
      } //transaction guid


      d.setUint8(57 + amountNotes * 19, times.getUTCFullYear() - 2000); //year

      d.setUint8(58 + amountNotes * 19, times.getUTCMonth() + 1); //month

      d.setUint8(59 + amountNotes * 19, times.getUTCDate()); //day

      d.setUint8(60 + amountNotes * 19, times.getUTCHours()); //hour

      d.setUint8(61 + amountNotes * 19, times.getUTCMinutes()); //minute

      d.setUint8(62 + amountNotes * 19, times.getUTCSeconds()); //second

      rqdata.push(ab);
    }

    await this.waitForSockets();

    let rqs;

    rqs = this._launchRequests("send", rqdata, callback, tcpmode);

    let rv = this._getGenericMainPromise(rqs, params['coins']).then(result => {
      result.transaction_id = guid;
      if (!('status' in result) || result.status != 'done')
        return result;
      return result;
    });

    let pm = new Promise((resolve, reject) => {
      setTimeout(() => {
        this.apiFixTransferSync()
      }, 500);
    });
    return rv;
  }

  // Receive
  async apiReceive(params, callback = null) {
    let coin = this._getCoinFromParams(params)
    if (coin == null)
      return this._getError("Failed to parse coin from params")
    if (!('amount' in params)) {
      return this._getError("Invalid input data. Amount is required");
    }
    let needsync = false
    let sns = []
    let page = 0
    let gcRqs
    while (params.amount > sns.length) {
      gcRqs = await this._getCoins(coin, page, callback, params.amount)
      if ('code' in gcRqs && gcRqs.code == SkyVaultJS.ERR_COUNTERFEIT_COIN)
        return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_TOO_FEW_PASSED, "The coin is counterfeit")
      if ('code' in gcRqs && gcRqs.code == SkyVaultJS.ERR_NOT_ENOUGH_CLOUDCOINS) {
        console.log("attempted to withdraw: ", params.amount)
        return this._getError("Insufficient balance");
      }

      //remove desynced coins
      for (let sn in gcRqs.coinsPerRaida) {
        let yescount = 0;
        gcRqs.coinsPerRaida[sn].forEach((e, i) => {
          if (e == 'yes') {
            yescount++
          }
        })
        if (sns.includes(sn)) {
          delete gcRqs.coins[sn]
        }
        else if (yescount < 20) {
          needsync = true
          delete gcRqs.coins[sn]
        }
      }

      sns = sns.concat(Object.keys(gcRqs.coins))
      page++
    }



    let rvalues = this._pickCoinsAmountFromArrayWithExtra(sns, params.amount)
    let coinsToReceive = rvalues.coins

    let rqdata = []
    let challange = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    let chcrc32 = this._crc32(challange, 0, 12)
    let nns = new Array(coinsToReceive.length)
    nns.fill(this.options.defaultCoinNn)
    let guid = this._generatePan();
    let times = new Date(Date.now())
    if (coinsToReceive.length > this.options.maxCoins) {
      return this._getError("You can't withdraw more than " + this.options.maxCoins + " coins at a time")
    }
    let tcpmode = true
    //   if (coinsToReceive.length >= 40) tcpmode = true

    let response
    if (coinsToReceive.length > 0) {
      // Assemble input data for each Raida Server
      let ab, d;
      let seed
      if ('seed' in params) {
        seed = params['seed']
      }
      for (let i = 0; i < this._totalServers; i++) {
        if (seed != null)
          coin.pan[i] = md5(i.toString() + seed)
        ab = new ArrayBuffer(35 + (3 * coinsToReceive.length) + 58 + 50 + 5);
        d = new DataView(ab); //

        d.setUint8(ab.byteLength - 1, 0x3e);
        d.setUint8(ab.byteLength - 2, 0x3e); // Trailing chars
        d.setUint8(2, i); //raida id
        d.setUint8(5, 104); //command withdraw
        d.setUint8(8, 0x01); //coin id
        d.setUint8(12, 0xAB); // echo
        d.setUint8(13, 0xAB); // echo
        if (this.options.forcetcprequest || tcpmode) d.setUint16(14, 126 + 3 * coinsToReceive.length)//tcp body size
        else d.setUint16(14, 0x01)//udp packetnumber

        //body
        for (let x = 0; x < 12; x++) {
          d.setUint8(22 + x, challange[x])
        }
        d.setUint32(34, chcrc32)
        d.setUint32(38, coin.sn << 8); //owner

        for (let x = 0; x < 16; x++) {
          d.setUint8(41 + x, parseInt(coin.an[i].substr(x * 2, 2), 16));
        }

        for (let j = 0; j < coinsToReceive.length; j++) d.setUint32(57 + j * 3, coinsToReceive[j] << 8);

        for (let x = 0; x < 16; x++) {
          d.setUint8(57 + coinsToReceive.length * 3 + x, parseInt(coin.pan[i].substr(x * 2, 2), 16));
        } //pan generator


        for (let x = 0; x < 16; x++) {
          d.setUint8(73 + coinsToReceive.length * 3 + x, parseInt(guid.substr(x * 2, 2), 16));
        } //transaction guid
        d.setUint8(89 + coinsToReceive.length * 3, times.getUTCFullYear() - 2000)//year
        d.setUint8(90 + coinsToReceive.length * 3, times.getUTCMonth() + 1)//month
        d.setUint8(91 + coinsToReceive.length * 3, times.getUTCDate())//day
        d.setUint8(92 + coinsToReceive.length * 3, times.getUTCHours())//hour
        d.setUint8(93 + coinsToReceive.length * 3, times.getUTCMinutes())//minute
        d.setUint8(94 + coinsToReceive.length * 3, times.getUTCSeconds())//second

        d.setUint8(95 + coinsToReceive.length * 3, 0);
        rqdata.push(ab)
      } // Launch Requests

      // Launch Requests
      await this.waitForSockets()
      let rqs = this._launchRequests("receive", rqdata, callback, tcpmode)

      let coins = new Array(coinsToReceive.length)
      coinsToReceive.forEach((value, idx) => {
        coins[idx] = {sn: value, nn: this.options.defaultCoinNn}
      })

      response = await this._getGenericMainPromise(rqs, coins)
      response.transaction_id = guid
      response.changeCoinSent = 0
      //response.changeRequired = false
      for (let k in response.result) {
        if (!('an' in response.result[k]))
          response.result[k].an = [];
        for (let i = 0; i < 25; i++) {
          let newpan = md5(i.toString() + response.result[k]['sn'].toString() + coin.pan[i]);
          response.result[k].an[i] = newpan;
        };
      }

      return response
      //} else if (changeCoin === 0) {
      //  return this._getError("No coins to receive")
    } else {
      response = {
        totalNotes: 0, authenticNotes: 0, counterfeitNotes: 0, errorNotes: 0, frackedNotes: 0, result: {}
      }

      return response
    }

    if (needsync) {
      let pm = new Promise((resolve, reject) => {
        setTimeout(() => {
          this.apiFixTransferSync()
        }, 500);
      });
    }

  }

  // Used to pay money to a merchant
  async apiPay(params, callback = null) {
    if (!('sender_name' in params))
      return this._getError("Sender Name is required")

    let sender_address = params.sender_name

    if (!('to' in params))
      return this._getError("To is required")

    let from = sender_address
    if ('from' in params)
      from = params.from
    else
      params.from = from

    let memo = ""
    if ('memo' in params)
      memo = params.memo

    if (!('amount' in params))
      return this._getError("Invalid params. Amount is not defined")

    let guid = ""
    if (!('guid' in params)) {
      guid = this._generatePan()
      params.guid = guid
    } else {
      guid = params.guid
      if (!/^([A-Fa-f0-9]{32})$/.test(guid))
        return this._getError("Invalid GUID format")
    }

    let merchant_address = params.to
    let reportUrl = await this._resolveDNS(merchant_address, "TXT")
    if (reportUrl == null) {
      return this._getError("Receiver doesn't have TXT record in DNS name")
    }

    let senderSn = await this._resolveDNS(sender_address)
    if (senderSn == null) {
      return this._getError("Failed to resolve Sender")
    }

    params.sn = senderSn

    reportUrl = reportUrl.replaceAll("\"", "")
    try {
      let url = new URL(reportUrl)
    } catch (e) {
      return this._getError("Ivalid URL in TXT record")
    }

    let rv = this.apiTransfer(params, callback).then(response => {
      if (response.status == "error")
        return response

      response.guid = guid
      let rAx = axios.create()
      let mParams = {
        'amount': params.amount + "",
        'merchant_address': merchant_address,
        'sender_address': sender_address,
        'guid': guid
      }
      let options = {
        timeout: this.options.timeout
      }
      options.params = mParams


      let rv2 = rAx.get(reportUrl, options).then(response2 => {
        if (!response2 || response2.status != 200) {
          return this._getError("Coins sent, but the Merchant was not notified. HTTP code returned from the Merchant: " + response2.status + ". Remember your GUID and contact the Merchant")
        }

        // Original response from apiTransfer
        return response
      })

      return rv2
    })

    return rv
  }


  // Transfer
  async apiTransfer(params, callback = null) {
    this._rarr = {}

    let coin = this._getCoinFromParams(params)
    if (coin == null)
      return this._getError("Failed to parse coin from params")


    if (!'to' in params) {
      return this._getError("Invalid params. To is not defined")
    }

    let to = await this._resolveDNS(params['to'])
    if (to == null) {
      return this._getError("Failed to resolve DNS name: " + params.to)
    }

    if (!('amount' in params)) {
      return this._getError("Invalid params. Amount is not defined")
    }

    let memo = 'memo' in params ? params['memo'] : "Transfer from SN#" + coin.sn
    let guid

    if (!('guid' in params)) {
      guid = this._generatePan()
      params.guid = guid
    } else {
      guid = params.guid
      if (!this._validateGuid(guid))
        return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_GUID, "Failed to validate GUID")
    }
    let from
    if ('from' in params)
      from = params.from
    else
      from = "SN " + coin.sn

    let tags = this._getObjectMemo(memo, from)
    let needsync = false
    let sns = []
    let page = 0
    let gcRqs
    while (params.amount > sns.length) {
      gcRqs = await this._getCoins(coin, page, callback, params.amount)
      if ('code' in gcRqs && gcRqs.code == SkyVaultJS.ERR_COUNTERFEIT_COIN)
        return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_TOO_FEW_PASSED, "The coin is counterfeit")
      if ('code' in gcRqs && gcRqs.code == SkyVaultJS.ERR_NOT_ENOUGH_CLOUDCOINS) {
        console.log("attempted to transfer: ", params.amount)
        return this._getError("Insufficient balance");
      }

      //remove desynced coins
      for (let sn in gcRqs.coinsPerRaida) {
        let yescount = 0;
        gcRqs.coinsPerRaida[sn].forEach((e, i) => {
          if (e == 'yes') {
            yescount++
          }
        })
        if (sns.includes(sn)) {
          delete gcRqs.coins[sn]
        }
        else if (yescount < 20) {
          needsync = true
          delete gcRqs.coins[sn]
        }
      }

      sns = sns.concat(Object.keys(gcRqs.coins))
      page++
    }

    let rvalues = this._pickCoinsAmountFromArrayWithExtra(sns, params.amount)
    let coinsToSend = rvalues.coins
    if (coinsToSend.length > this.options.maxCoins) {
      return this._getError("You can't transfer more than " + this.options.maxCoins + " notes at a time")
    }

    let response = {}
    response = await this._doTransfer(coin, params.guid, to, tags, coinsToSend, callback)
    // Assemble input data for each Raida Server
    //response.changeCoinSent = changeRequired
    response.code = SkyVaultJS.ERR_NO_ERROR
    if (needsync) {
      let pm = new Promise((resolve, reject) => {
        setTimeout(() => {
          this.apiFixTransferSync()
        }, 500)
      })
    }
    return response
  }


  // NFT TEST CREATE
  async apiNFTTestCreate(params, callback = null) {
    if (!'coins' in params) {
      return this._getError("Invalid input data. No coins");
    }

    if (!Array.isArray(params['coins'])) {
      return this._getError("Invalid input data. Coins must be an array");
    }

    if (params['coins'].length > 13) {
      return this._getError("Invalid input data. can only create 13 coins. add additional coins with 'Add Coins' service");
    }

    if (!'guid' in params) {
      return this._getError("Invalid input data. GUID is not defined");
    }
    if (!'meta' in params) {
      return this._getError("Invalid input data. meta is not defined");
    }
    if (!'data' in params) {
      return this._getError("Invalid input data. data is not defined");
    }

    let rqdata = []
    let challange = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    let chcrc32 = this._crc32(challange, 0, 12)

    let data = params.data;
    let meta = params.meta;

    let datalength = data.length;
    let metalength = meta.length;

    let guid = params.guid;
    let coins = params['coins'];
    if (coins.length > this.options.maxSendCoins) {
      return this._getError("You can't deposit more than " + this.options.maxSendCoins + " coins at a time")
    }
    let tcpmode = true
    //   if (coins.length >= 40) tcpmode = true

    let response
    // Assemble input data for each Raida Server
    let ab, d;
    for (let i = 0; i < this._totalServers; i++) {

      ab = new ArrayBuffer(62 + (19 * coins.length) + datalength + metalength);
      d = new DataView(ab); //

      d.setUint8(ab.byteLength - 1, 0x3e);
      d.setUint8(ab.byteLength - 2, 0x3e); // Trailing chars
      d.setUint8(2, i); //raida id
      d.setUint8(5, 200); //command test create
      d.setUint8(8, 0x02); //coin id
      d.setUint8(12, 0xAB); // echo
      d.setUint8(13, 0xAB); // echo
      if (this.options.forcetcprequest || tcpmode) d.setUint16(14, 40 + (19 * coins.length) + datalength + metalength)//tcp body size
      else d.setUint16(14, 0x01)//udp packetnumber

      //body
      for (let x = 0; x < 12; x++) {
        d.setUint8(22 + x, challange[x])
      }
      d.setUint32(34, chcrc32)

      for (let x = 0; x < 16; x++) {
        d.setUint8(38 + x, parseInt(guid.substr(x * 2, 2), 16));
      }

      for (let j = 0; j < coins.length; j++) {
        let coin = coins[j];

        if (!this._validateCoin(coin)) {
          return this._getError("Invalid coin. Idx " + j);
        }
        d.setUint32(54 + j * 19, coin.sn << 8);

        for (let x = 0; x < 16; x++) {
          d.setUint8(54 + j * 19 + (3 + x), parseInt(coin.an[i].substr(x * 2, 2), 16));
        }
      }

      d.setUint8(54 + 19 * coins.length, 0xAB)
      d.setUint8(55 + 19 * coins.length, 0xCD)
      d.setUint8(56 + 19 * coins.length, 0xEF)

      for (let m = 0; m < metalength; m++) {
        d.setUint8(57 + m, parseInt(meta.substr(m * 2, 2), 16));
      }

      d.setUint8(57 + 19 * coins.length + metalength, 0xAB)
      d.setUint8(58 + 19 * coins.length + metalength, 0xCD)
      d.setUint8(59 + 19 * coins.length + metalength, 0xEF)

      for (let d = 0; d < datalength; d++) {
        d.setUint8(60 + d, parseInt(meta.substr(d * 2, 2), 16));
      }

      rqdata.push(ab)
    } // Launch Requests

    // Launch Requests
    await this.waitForSockets()
    let rqs = this._launchRequests("test create", rqdata, callback, tcpmode)

    let rv = {
      status: 'done',
      code: SkyVaultJS.ERR_NO_ERROR,
      errors: []
    }
    let e = 0;
    let mainPromise = rqs.then(response => {
      this._parseMainPromise(response, 0, rv, (serverResponse, i) => {
        if (serverResponse === "error" || serverResponse == "network") {
          rv.errors[i] = "no response"
          e++;
        } else {
          let dView = new DataView(serverResponse)
          let status = dView.getUint8(2)

          if (status == 51) {
            rv.errors[i] = "coins already have nfts";
            e++;
          }
          if (status == 52) {
            rv.errors[i] = "no data or meta data";
            e++;
          }
          if (status == 53) {
            rv.errors[i] = "too much data for coins submitted";
            e++;
          }
          if (status == 54) {
            rv.errors[i] = "guid is not unique";
            e++;
          }
          if (status == 55) {
            rv.errors[i] = "coins are counterfeit";
            e++;
          }
          if (status == 250 || status == 50) {
            //a++;
          }
          else {
            rv.errors[i] = "raida error code " + status;
            e++;
          }
        }
      })

      if (e > 13) {
        rv.status = "error";
        rv.code = SkyVaultJS.ERR_HAS_ERROR;
      }

      return rv
    })

    return mainPromise
  }

  _getRandomInt(max) {
    return Math.floor(Math.random() * Math.floor(max));
  }

  async _syncOwnersAddDelete(coin, sns, servers, mode) {
    //mode = 0 for add, 2 for delete
    if (!this._validateCoin(coin)) {
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_COIN, "Failed to validate coin")
    }
    if (!Array.isArray(sns)) {
      return this._getError("Invalid input data. Serial Numbers must be an array")
    }

    if (mode != 0 && mode != 2) {
      return this._getError("incorrect value for MODE. must be either 0 or 2");
    }
    if (sns.length > this.options.maxCoins) {
      return this._getError("You can't sync more than " + this.options.maxCoins + " coins at a time")
    }

    let tcpmode = true
    if (sns.length >= 120) tcpmode = true

    let challange = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    let chcrc32 = this._crc32(challange, 0, 12)
    let rqdata = [];
    let ab, d;
    for (let i = 0; i < this._totalServers; i++) {
      ab = new ArrayBuffer(35 + 24 + 3 * sns.length);
      d = new DataView(ab); //rqdata.push(ab)
      // Trailing chars
      d.setUint8(2, i); //raida id
      d.setUint8(5, 150 + mode);//command sync add or delete(if mode = 2)
      d.setUint8(8, 0x01); //coin id
      d.setUint8(12, 0xAB); // echo
      d.setUint8(13, 0xAB); // echo
      if (this.options.forcetcprequest || tcpmode) d.setUint16(14, 37 + 3 * sns.length)//tcp body size
      else d.setUint16(14, 0x01)//udp packetnumber

      //body
      for (let x = 0; x < 12; x++) {
        d.setUint8(22 + x, challange[x])
      }
      d.setUint32(34, chcrc32)
      d.setUint32(38, coin.sn << 8); //rqdata[i].sns.push(coin.sn)
      for (let x = 0; x < 16; x++) {
        d.setUint8(41 + x, parseInt(coin.an[i].substr(x * 2, 2), 16));
      }
      for (let y = 0; y < sns.length; y++) {
        d.setUint32(57 + y * 3, sns[y] << 8)
      }
      d.setUint8(ab.byteLength - 1, 0x3e);
      d.setUint8(ab.byteLength - 2, 0x3e);
      rqdata.push(ab)
    }
    await this.waitForSockets()
    let pm = this._launchRequests("sync/fix_transfer", rqdata, null, tcpmode, servers)

    let modestring = "add";
    if (mode == 2)
      modestring = "delete";

    let rv = {
      status: 'done',
      mode: modestring,
      code: SkyVaultJS.ERR_NO_ERROR,
      res_status_code: 0,
      details: []
    };
    let needFix = false;
    let pownstring = [];
    let mainPromise = pm.then(response => {
      this._parseMainPromise(response, 0, rv, (serverResponse, i) => {
        if (serverResponse === "error" || serverResponse === "network") {
          rv.status = 'error'
          rv.code = SkyVaultJS.ERR_HAS_ERROR
          pownstring[i] = "e"
          return;
        }
        let dView = new DataView(serverResponse);

        rv.res_status_code = dView.getUint8(2)
        if (dView.getUint8(2) == 64) {
          rv.status = "failed authentication (fracked)";
          rv.code = SkyVaultJS.ERR_DETECT_FAILED;
          pownstring[i] = "f";
          needFix = true;
          return;
        }

        if (dView.getUint8(2) != 250 && dView.getUint8(2) != 241) {
          rv.status = "error";
          rv.code = SkyVaultJS.ERR_HAS_ERROR;
          pownstring[i] = "e";
          needFix = true;
          return;
        }
        pownstring[i] = "p";
      });
      if (needFix) {
        for (let p = 0; p < 25; p++) {
          if (pownstring[p] == null)
            pownstring[p] = "p";
        }
        pownstring = pownstring.join("");
        coin.pownstring = pownstring;
        coin.result = this.__frackedResult;
        let fpm = this.apiFixfracked([coin])
      }
      return rv;

    })
    return mainPromise;

  }


  // Merges responses from RAIDA servers
  _mergeResponse(response, addon) {
    if (Object.keys(response).length == 0)
      return addon

    if (addon.status != 'done')
      response.status = addon.status

    response.authenticNotes += addon.authenticNotes
    response.counterfeitNotes += addon.counterfeitNotes
    response.errorNotes += addon.errorNotes
    response.totalNotes += addon.totalNotes
    response.frackedNotes += addon.frackedNotes
    response.details = response.details.concat(addon.details)
    for (let k in addon.result) {
      response.result[k] = addon.result[k]
    }
    //  response.result = Object.assign(response.result, addon.result)

    return response

  }

  // Doing actual transfer
  async _doTransfer(coin, guid, to, tags, coinsToSend, callback) {
    let tcpmode = true
    if (coinsToSend >= 120) tcpmode = true
    let times = new Date(Date.now())
    let challange = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    let chcrc32 = this._crc32(challange, 0, 12)
    let rqdata = []
    let ab, d
    for (let i = 0; i < this._totalServers; i++) {
      ab = new ArrayBuffer(35 + (3 * coinsToSend.length) + 45 + 50 + 5);
      d = new DataView(ab); //rqdata.push(ab)

      d.setUint8(ab.byteLength - 1, 0x3e);
      d.setUint8(ab.byteLength - 2, 0x3e); // Trailing chars
      d.setUint8(2, i); //raida id
      d.setUint8(5, 108); //command transfer
      d.setUint8(8, 0x01); //coin id
      d.setUint8(12, 0xAB); // echo
      d.setUint8(13, 0xAB); // echo
      if (this.options.forcetcprequest || tcpmode) d.setUint16(14, 113 + (3 * coinsToSend.length))//tcp body size
      else d.setUint16(14, 0x01)//udp packetnumber

      for (let x = 0; x < 12; x++) {
        d.setUint8(22 + x, challange[x])
      }
      d.setUint32(34, chcrc32)
      d.setUint32(38, coin.sn << 8); //owner

      for (let x = 0; x < 16; x++) {
        d.setUint8(38 + (3 + x), parseInt(coin.an[i].substr(x * 2, 2), 16));
      }

      for (let j = 0; j < coinsToSend.length; j++) d.setUint32(57 + j * 3, coinsToSend[j] << 8);

      d.setUint32(57 + coinsToSend.length * 3, to << 8);

      for (let x = 0; x < 16; x++) {
        d.setUint8(60 + coinsToSend.length * 3 + x, parseInt(guid.substr(x * 2, 2), 16));
      } //transaction guid
      d.setUint8(76 + coinsToSend.length * 3, times.getUTCFullYear() - 2000)//year
      d.setUint8(77 + coinsToSend.length * 3, times.getUTCMonth() + 1)//month
      d.setUint8(78 + coinsToSend.length * 3, times.getUTCDate())//day
      d.setUint8(79 + coinsToSend.length * 3, times.getUTCHours())//hour
      d.setUint8(80 + coinsToSend.length * 3, times.getUTCMinutes())//minute
      d.setUint8(81 + coinsToSend.length * 3, times.getUTCSeconds())//second

      d.setUint8(82 + coinsToSend.length * 3, 0);//ty


      for (let x = 0; x < tags[i].length; x++) {
        console.log("r=" + i + " x=" + tags[i][x])
        d.setUint8(83 + coinsToSend.length * 3 + x, tags[i].charCodeAt(x));//ty
      }

      let rest = 50 - tags[i].length
      if (rest > 0) {
        console.log("adding rest " + rest)
        for (let x = 0; x < rest; x++) {
          d.setUint8(83 + coinsToSend.length * 3 + tags[i].length + x, 0)
        }
      }

      console.log("i=" + i + " l=" + tags[i].length)

      rqdata.push(ab);
    }

    //    console.log("stop now")
    //  return null

    // Launch Requests
    await this.waitForSockets()
    let rqs = this._launchRequests("transfer", rqdata, callback, tcpmode)

    let coins = new Array(coinsToSend.length)
    coinsToSend.forEach((value, idx) => {
      coins[idx] = {sn: value, nn: this.options.defaultCoinNn}
    })

    let response = await this._getGenericBriefMainPromise(rqs, coins)
    response.transaction_id = guid
    return response
  }

  async apiFixTransferSync(coin, showncoins = null, callback = null) {
    return this.apiFixTransferGeneric(coin, showncoins, callback)
  }

  async apiFixTransfer(coin, showncoins = null, callback = null) {
    return this.apiFixTransferGeneric(coin, showncoins, callback)
  }

  async apiFixTransferGeneric(coin, showcoin = null, callback) {

    if (typeof (coin) != "object")
      return this._getError("Failed to validate input args")

    if (showcoin == null)
      showcoin = await this._getCoins(coin, () => {})
    if (showcoin.code != 0) {
      return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_TOO_FEW_PASSED, "The coin is counterfeit");
    }

    let details = []
    for (let sn in showcoin.coinsPerRaida) {
      let nocount = 0;
      let yescount = 0;
      let l = []
      let g = []
      showcoin.coinsPerRaida[sn].forEach((e, i) => {
        if (e == 'no' || e == 'unknown') {
          nocount++
          l.push(i)
        } else if (e == 'yes') {
          yescount++
          g.push(i)
        }
      })
      if (nocount > 0 && nocount < 10) {
        console.log("adding ", sn, "to coin", coin.sn);
        details.push(await this._syncOwnersAddDelete(coin, [sn], l, 0));
      }
      if (yescount > 0 && yescount < 10) {
        console.log("deleting ", sn, "to coin", coin.sn);
        details.push(await this._syncOwnersAddDelete(coin, [sn], g, 2));
      }
    }



    let rv = {
      "status": "done",
      "code": 0,
      "details": details
    }
    return rv
  }
  _getRandom(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1) + min); //The maximum is inclusive and the minimum is inclusive
  }
  // Get Free Coin
  async apiGetFreeCoin(sn = null, an = null, callback = null) {
    if (sn == null) {
      sn = this._getRandom(26000, 100000);
    }
    if (an != null && !Array.isArray(an)) {
      return this._getError("Invalid input data. Authenticity Numbers must be an array")
    }
    let bufferlength = 24 + 19;
    if (an != null)
      bufferlength += 16;
    //let url = this.options.freeCoinURL
    let ab, d;
    let rqdata = [];
    let challange = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    let chcrc32 = this._crc32(challange, 0, 12)
    for (let i = 0; i < this._totalServers; i++) {
      ab = new ArrayBuffer(bufferlength);
      d = new DataView(ab);
      // Trailing chars

      d.setUint8(2, i); //raida id

      if (an != null) d.setUint8(5, 31);

      else d.setUint8(5, 30); //command free id

      d.setUint8(8, 0x00); //coin id

      d.setUint8(12, 0xAB); // echo

      d.setUint8(13, 0xAB); // echo
      if (this.options.forcetcprequest || bufferlength - 22 > 1440) d.setUint16(14, bufferlength - 22)//tcp body size
      else d.setUint16(14, 0x01)//udp packetnumber

      for (let x = 0; x < 12; x++) {
        d.setUint8(22 + x, challange[x])
      }
      d.setUint32(34, chcrc32)
      d.setUint32(38, sn << 8);
      if (an != null) {
        for (let x = 0; x < 16; x++) {
          d.setUint8(41 + x, parseInt(an[i].substr(x * 2, 2), 16));
        }
      }

      d.setUint8(ab.byteLength - 1, 0x3e);
      d.setUint8(ab.byteLength - 2, 0x3e);
      rqdata.push(ab);
    }
    //let response
    let rv = {
      status: 'done',
      code: SkyVaultJS.ERR_NO_ERROR,
      cc: {
        sn: sn,
        an: []
      }
    };
    let e, a, n = 0;
    await this.waitForSockets()
    let rqs = await this._launchRequests("free_id", rqdata, callback).then(response => {
      this._parseMainPromise(response, 0, rv, (response, rIdx) => {
        if (response == "network" || response == "error") {
          //rv = this._getError("Failed to get free coin");
          n++;
          return;
        }

        if (response.byteLength < 12) {
          //rv = this._getError("Failed to parse respense from FreeCoin Server");

          return;
        }

        let dView = new DataView(response);
        let status = dView.getUint8(2);

        if (status == 40) {
          //rv = this._getError("SN already in use");
          a++;
          return;
        }

        if (status != 250) {
          //rv = this._getError("error code:" + status);
          e++;
          return;
        }

        let data = new DataView(response, 12);
        let newan = "";

        if (an == null) {
          for (let r = 0; r < 16; r++) {
            if (data.getUint8(r) < 16) newan += "0";
            newan += data.getUint8(r).toString(16);
          } //let key = ldata.statement_id

          rv.cc.an[rIdx] = newan;
        } else {
          rv.cc.an = an;
        }
      });

      return rv;
    });

    return rqs
  }


  async apiShowCoins(coin, page = 0, callback = null) {
    if (!this._validateCoin(coin)) {
      return this._getError("Failed to validate params")
    }

    return this._getCoins(coin, page, callback)
  }

  async apiShowCoinsAsArray(coin, callback) {
    if (!this._validateCoin(coin)) {
      return this._getError("Failed to validate params")
    }

    let d = await this._getCoins(coin, callback)
    if ('code' in d && d.code == SkyVaultJS.ERR_COUNTERFEIT_COIN)
      return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_TOO_FEW_PASSED, "The coin is counterfeit")

    let coins = d.coins

    let a = []
    for (let sn in coins) {
      a.push({
        'sn': sn,
      })
    }

    d.coins = a
    return d
  }

  // Recovers a SkyWallet
  async apiRecoverIDCoin(params, callback) {
    if (!('paycoin' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_COIN, "PayCoin in missing")

    let coin = params['paycoin']
    if (!this._validateCoin(coin))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_COIN, "Failed to validate paycoin")

    if (!('skywallet_name' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_DNS_NAME, "Skywallet Name is missing")

    if (!('email' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_EMAIL, "Email is missing")

    let email = params['email']
    let username = params['skywallet_name']
    let sn = await this._resolveDNS(username)
    if (sn == null)
      return this._getErrorCode(SkyVaultJS.ERR_DNS_RECORD_NOT_FOUND, "Failed to resolve SkyWallet")

    let rqdata = []
    for (let i = 0; i < this._totalServers; i++) {
      rqdata.push({
        sn: coin.sn,
        an: coin.an[i],
        sns: [sn],
        email: email,
      })
    }

    let rv = {
      code: SkyVaultJS.ERR_NO_ERROR,
      text: "Recovery Request has been sent"
    }

    let a, f, e
    a = f = e = 0
    await this.waitForSockets()
    let rqs = this._launchRequests("recover_by_email", rqdata, callback, false)
    let mainPromise = rqs.then(response => {
      this._parseMainPromise(response, 0, rv, serverResponse => {
        if (serverResponse === "error" || serverResponse == "network") {
          e++
          return
        }
        if (serverResponse.status == "success") {
          a++
        }
        if (serverResponse.status == "fail") {
          f++
        }
      })

      let result = this._gradeCoin(a, f, e)
      if (!this._validResult(result))
        return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_TOO_FEW_PASSED, "Failed to send request. Too many error responses from RAIDA")

      return rv

    })

    return mainPromise
  }

  // Shows Balance
  async apiShowBalance(coin, callback) {
    if (!coin) return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_COIN, "Coin in missing");
    if (!this._validateCoin(coin)) return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_COIN, "Failed to validate coin");
    await this.waitForSockets()
    let rqdata = [];
    let challange = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    let chcrc32 = this._crc32(challange, 0, 12)

    let ab, d;
    for (let i = 0; i < this._totalServers; i++) {
      ab = new ArrayBuffer(35 + 19 + 5);
      d = new DataView(ab);
      d.setUint8(ab.byteLength - 1, 0x3e);
      d.setUint8(ab.byteLength - 2, 0x3e); // Trailing chars
      d.setUint8(2, i) //raida id
      d.setUint8(5, 110);//command ballance
      d.setUint8(8, 0x00);//coin id
      d.setUint8(12, 0xAB);// echo
      d.setUint8(13, 0xAB);// echo
      if (this.options.forcetcprequest) d.setUint16(14, 37)//tcp body size
      else d.setUint16(14, 0x01)//udp packetnumber


      for (let x = 0; x < 12; x++) {
        d.setUint8(22 + x, challange[x])
      }
      d.setUint32(34, chcrc32)
      d.setUint32(38, coin.sn << 8)
      for (let x = 0; x < 16; x++) {
        d.setUint8(38 + (3 + x), parseInt(coin.an[i].substr(x * 2, 2), 16))
      }
      rqdata.push(ab)
    }
    console.log("sending balance request", rqdata);
    let rv = {
      code: SkyVaultJS.ERR_NO_ERROR,
      balances: [],
      balance: 0,
      balancesPerRaida: [],
      raidaStatuses: [],
      triedToFix: false,
      fixedCoin: false,
    };

    for (let i = 0; i < this._totalServers; i++) {
      rv.raidaStatuses[i] = "u";
      rv.balances[i] = 0;
    }

    let balances = {};
    let ra, re, rf;
    ra = re = rf = 0;
    await this.waitForSockets()
    let rqs = this._launchRequests("show_transfer_balance", rqdata, callback).then(response => {
      console.log("main response")
      console.log(response)
      this._parseMainPromise(response, 0, rv, (response, rIdx) => {
        console.log("response r " + rIdx)
        console.log(response)
        if (response == "network") {
          rv.raidaStatuses[rIdx] = "n";
          rv.balancesPerRaida[rIdx] = null;
          re++;
          return;
        }

        if (response == "error") {
          console.log("baddd1")
          rv.raidaStatuses[rIdx] = "e";
          rv.balancesPerRaida[rIdx] = null;
          re++;
          return;
        }

        if (response.byteLength < 12) {
          console.log("baddd")
          rv.raidaStatuses[rIdx] = "e";
          rv.balancesPerRaida[rIdx] = null;
          re++;
          return;
        }
        let dView = new DataView(response);
        let status = dView.getUint8(2);
        if (status == 251 || status == 242) {
          rv.raidaStatuses[rIdx] = "f";
          rv.balancesPerRaida[rIdx] = null;
          rf++;
          return;
        }

        if (status != 250 && status != 241) {
          rv.raidaStatuses[rIdx] = "e";
          rv.balancesPerRaida[rIdx] = null;
          console.log("error in raida", rIdx, ", error code:", status);
          re++;
          return;
        }
        if (response.byteLength != 16) {
          rv.raidaStatuses[rIdx] = "f";
          rv.balancesPerRaida[rIdx] = 0;

          rf++;
          return;
        }

        rv.raidaStatuses[rIdx] = "p";
        let b = 0
        if (response.byteLength == 16)
          b = dView.getUint32(12);
        rv.balancesPerRaida[rIdx] = b;
        if (!(b in balances)) {
          balances[b] = 0;
        }

        balances[b]++;
        ra++;
      }); // Check if Fracked


      let needFix = false;

      console.log("ra=" + ra + " rf=" + rf + " re=" + re)
      let rresult = this._gradeCoin(ra, rf, re);

      if (rresult == this.__frackedResult) {
        needFix = true;
      }

      let max = 0;
      let balance = -1;

      for (let k in balances) {
        if (max < balances[k]) {
          max = balances[k];
          balance = k;
        }
      }

      let a = max;
      let f = 25 - a;

      console.log("result " + a + " f="+ f)
      let result = this._gradeCoin(a, f, 0);
      console.log("result " + result)

      if (!this._validResult(result)) balance = -1;

      if (rresult == this.__counterfeitResult) {
        return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_TOO_FEW_PASSED, "The coin is counterfeit");
      }

      rv.balance = balance;
      rv.balances = balances;
      rv.raidaStatuses = rv.raidaStatuses.join("");
      if (needFix) {
        rv.triedToFix = true;
        coin.pownstring = rv.raidaStatuses;
        coin.result = this.__frackedResult;
        this.apiFixfracked([coin])
        //  return fpm;
      }

      return rv;
    });
    let pm = new Promise((resolve, reject) => {
      setTimeout(() => {
        this.apiFixTransferSync()
      }, 500);
    });
    return rqs;
  }

  // Resolves a SkyWallet
  async apiResolveSkyWallet(hostname) {
    let sn = await this._resolveDNS(hostname)
    if (sn == null)
      return this._getErrorCode(SkyVaultJS.ERR_DNS_RECORD_NOT_FOUND, "Failed to resolve SkyWallet")

    let rv = {
      'code': SkyVaultJS.ERR_NO_ERROR,
      'sn': sn
    }

    return rv
  }

  // Health Check
  async apiHealthCheck(params, callback = null) {
    if (!('coin' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_COIN, "Coin in missing")

    let coin = params['coin']
    if (!this._validateCoin(coin))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_COIN, "Failed to validate coin")

    let rv = {
      'code': SkyVaultJS.ERR_NO_ERROR,
      'text': "HealthCheck Completed",
      'balances': [],
      'balance': -1,
      'show_balances': [],
      'sns': []
    }

    let lrv = await this.apiShowBalance(coin, callback)
    if (('code' in lrv) && lrv.code == SkyVaultJS.ERR_NO_ERROR) {
      rv.balances = lrv.balancesPerRaida
      rv.balance = lrv.balance
    }

    lrv = await this.apiShowCoins(coin, callback)
    // Check if the coins is counterfeit
    if ('code' in lrv && lrv.code == SkyVaultJS.ERR_COUNTERFEIT_COIN)
      return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_TOO_FEW_PASSED, "The coin is counterfeit")

    if (('code' in lrv) && lrv.code == SkyVaultJS.ERR_NO_ERROR) {
      rv.sns = lrv.coinsPerRaida
    }

    lrv = await this._getCoinsWithContentBalance(coin, callback)
    if (('code' in lrv) && lrv.code == SkyVaultJS.ERR_NO_ERROR) {
      rv.show_balances = lrv.balancesPerRaida
    }


    return rv

  }

  /*** INTERNAL FUNCTIONS. Use witch caution ***/
  async _resolveDNS(hostname, type = null) {
    let r = await this._resolveCloudFlareDNS(hostname, type)
    if (r == null) {
      r = await this._resolveGoogleDNS(hostname, type)
    }

    return r
  }

  async _resolveCloudFlareDNS(hostname, type = null) {
    let dnsAx = axios.create({
      headers: {
        'Accept': 'application/dns-json'
      }
    })

    let url = "https://cloudflare-dns.com/dns-query?name=" + hostname
    if (type != null)
      url += "&type=" + type

    let response
    try {
      response = await dnsAx.get(url)
    } catch (e) {
      console.log("Error querying CloudFlare DNS: " + e)
      return null
    }
    if (!('data' in response)) {
      console.error("Invalid response from CloudFlare DNS")
      return null
    }

    let data = response.data
    if (!('Status' in data)) {
      console.error("Invalid data from CloudFlare DNS")
      return null
    }

    if (data.Status != 0) {
      console.error("Failed to resolve DNS name. Wrong response from CloudFlare DNS:" + data.Status)
      return null
    }

    if (!('Answer' in data)) {
      console.error("Invalid data from CloudFlare DNS")
      return null
    }

    let reply = data.Answer[0]
    if (type == null || type == "A") {
      if (reply.type !== 1) {
        console.error("Wrong response from CloudFlare DNS:" + data.Status)
        return null
      }

      let arecord = reply.data
      let parts = arecord.split('.')

      let sn = parts[1] << 16 | parts[2] << 8 | parts[3]

      return sn
    } else {
      return reply.data
    }
  }

  async _resolveGoogleDNS(hostname, type = null) {
    let dnsAx = axios.create()

    let url = "https://dns.google/resolve?name=" + hostname
    if (type != null)
      url += "&type=" + type

    let response = await dnsAx.get(url)
    if (!('data' in response)) {
      console.error("Invalid response from Google DNS")
      return null
    }

    let data = response.data
    if (!('Status' in data)) {
      console.error("Invalid data from Google DNS")
      return null
    }

    if (data.Status !== 0) {
      console.error("Failed to resolve DNS name. Wrong response from Google DNS:" + data.Status)
      return null
    }

    if (!('Answer' in data)) {
      console.error("Invalid data from Google DNS")
      return null
    }


    let reply = data.Answer[0]
    if (type == null || type == "A") {
      if (reply.type !== 1) {
        console.error("Wrong response from Google DNS:" + data.Status)
        return null
      }

      let arecord = reply.data
      let parts = arecord.split('.')

      let sn = parts[1] << 16 | parts[2] << 8 | parts[3]

      return sn
    } else {
      return reply.data
    }
  }

  // Gets envelopes with Content
  async _getCoinsWithContentBalance(coin, callback) {
    let rqdata = []

    // Assemble input data for each Raida Server
    for (let i = 0; i < this._totalServers; i++) {
      rqdata.push({
        sn: coin.sn,
        nn: coin.nn,
        an: coin.an[i],
        pan: coin.an[i],
        content: "1"
      })
    }
    let rv = {
      code: SkyVaultJS.ERR_NO_ERROR,
      balancesPerRaida: []
    }
    await this.waitForSockets()
    let rqs = this._launchRequests("show", rqdata, callback, false).then(response => {
      this._parseMainPromise(response, 0, rv, (response, rIdx) => {
        if (response == "network" || response == "error")
          return

        if (!('status' in response))
          return


        if (response.status !== "pass")
          return


        if (!('contents' in response))
          return

        let contents = response.contents
        rv.balancesPerRaida[rIdx] = 0
        for (let i = 0; i < contents.length; i++) {
          let item = contents[i]
          if (!('amount' in item))
            continue

          let amount = 0
          try {
            amount = parseInt(item.amount)
          } catch (e) {}


          rv.balancesPerRaida[rIdx] += amount
        }
      })

      return rv
    })

    return rqs
  }

  async _getCoins(coin, page = 0, callback = null, amount = 0) {
    let rqdata = []
    let challange = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    let chcrc32 = this._crc32(challange, 0, 12)
    // Assemble input data for each Raida Server
    //
    //
    let idx = Math.ceil((amount * 2) / 1000)
    if (idx < 1) {
      idx = 1
    }
    if (idx > 255) {
      idx = 255
    }

    //
    console.log("get coins " + idx)
    console.log(coin)
    let ab, d;
    for (let i = 0; i < this._totalServers; i++) {
      ab = new ArrayBuffer(36 + 20 + 5);
      d = new DataView(ab);
      d.setUint8(ab.byteLength - 1, 0x3e);
      d.setUint8(ab.byteLength - 2, 0x3e); // Trailing chars
      d.setUint8(2, i) //raida id
      d.setUint8(5, 114);//show coins by denomination
      d.setUint8(8, 0x01);//coin id
      d.setUint8(12, 0xAB);// echo
      d.setUint8(13, 0xAB);// echo
      if (this.options.forcetcprequest) d.setUint16(14, 39)//tcp body size
      else d.setUint16(14, 0x01)//udp packetnumber

      //d.setUint8(ab.byteLength - 3, 1)//biggest returned denomination
      d.setUint8(ab.byteLength - 3, idx)//biggest returned denomination
      d.setUint32(38, coin.sn << 8)
      for (let x = 0; x < 12; x++) {
        d.setUint8(22 + x, challange[x])
      }
      d.setUint32(34, chcrc32)
      for (let x = 0; x < 16; x++) {
        d.setUint8(38 + (3 + x), parseInt(coin.an[i].substr(x * 2, 2), 16))
      }
      d.setUint8(58, page)
      rqdata.push(ab)
    }
    let rv = {
      code: SkyVaultJS.ERR_NO_ERROR,
      coins: {},
      coinsPerRaida: {},
      details: []
    }

    let skipRaidas = []
    let a, f, e, p
    a = f = e = p = 0
    await this.waitForSockets()
    let rqs = this._launchRequests("show", rqdata, callback).then(response => {
      this._parseMainPromise(response, 0, rv, (response, rIdx) => {
        if (response == "network" || response == "error") {
          skipRaidas.push(rIdx)
          e++
          return
        }

        if ((response.byteLength < 12)) {
          skipRaidas.push(rIdx)
          e++
          return
        }
        let dView = new DataView(response);
        let status = dView.getUint8(2);
        if (status == 251) {
          skipRaidas.push(rIdx)
          f++
          return
        }

        if (status == 66) {
          console.log("page error")
          skipRaidas.push(rIdx)
          p++
          e++
          return
        }

        if (status != 250) {
          console.log("get coin error code:", status, "on raida", rIdx);
          skipRaidas.push(rIdx)
          e++
          return
        }

        a++
        let coinsplit = new DataView(response, 12)
        let amount = Math.floor(coinsplit.byteLength / 3)
        let coins = new ArrayBuffer(coinsplit.byteLength + 1)
        let coinsView = new DataView(coins)
        for (let x = 0; x < coins.byteLength - 1; x++)
          coinsView.setUint8(x, coinsplit.getUint8(x))
        for (let i = 0; i < amount; i++) {
          let key = coinsView.getUint32(i * 3) >>> 8
          if (!(key in rv.coins)) {
            rv.coins[key] = {
              passed: 0
            }
            rv.coinsPerRaida[key] = []
            for (let j = 0; j < this._totalServers; j++)
              rv.coinsPerRaida[key][j] = "no"
          }

          rv.coinsPerRaida[key][rIdx] = "yes"
          rv.coins[key].passed++
        }
      })

      // Fail only if counterfeit. Other errors are fine
      let result = this._gradeCoin(a, f, e)
      if (p > 20)
        return this._getErrorCode(SkyVaultJS.ERR_NOT_ENOUGH_CLOUDCOINS, "no coins in wallet on ths page")

      if (result == this.__counterfeitResult)
        return this._getErrorCode(SkyVaultJS.ERR_COUNTERFEIT_COIN, "Counterfeit coins")
      //if (!this._validResult(result))
      //  return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_TOO_FEW_PASSED, "Failed to get coins. Too many error responses from RAIDA")

      let nrv = {code: SkyVaultJS.ERR_NO_ERROR, coins: {}}
      nrv.coinsPerRaida = rv.coinsPerRaida
      for (let f = 0; f < skipRaidas.length; f++) {
        let frIdx = skipRaidas[f]
        for (let sn in rv.coinsPerRaida) {
          rv.coinsPerRaida[sn][frIdx] = "unknown"
        }
      }
      for (let sn in rv.coins) {
        let a = rv.coins[sn].passed
        let f = 25 - a
        let result = this._gradeCoin(a, f, 0)
        if (this._validResult(result)) {
          nrv.coins[sn] = {
          }
        }
      }


      return nrv
    })

    return rqs
  }

  // Doing internal fix
  async _realFix(round, raidaIdx, coins, callback = null) {
    let rqdata, triad, rqs, resultData;
    if (coins.length > this.options.maxSendCoins) {
      return this._getError("You can't fix more than " + this.options.maxSendCoins + " coins at a time")
    }
    let tcpmode = false
    if (coins.length >= 40) tcpmode = true

    rqdata = this._formRequestData(coins, false, 11);
    await this.waitForSockets()
    rqs = this._launchRequests("multi_get_ticket", rqdata, callback, tcpmode);
    resultData = await this._getGenericMainPromise(rqs, coins, (a, c, e) => {
      if (a > 12) return this.__authenticResult;
      return this.__counterfeitResult;
    });

    let challange = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    let chcrc32 = this._crc32(challange, 0, 12)
    let ab = new ArrayBuffer(24 + 116 + 19 * coins.length);
    let d = new DataView(ab);
    d.setUint8(ab.byteLength - 1, 0x3e);
    d.setUint8(ab.byteLength - 2, 0x3e); // Trailing chars

    d.setUint8(2, raidaIdx); //raida id

    d.setUint8(5, 50); //command fix

    if (coins[0].sn >= 26000 && coins[0].sn <= 100000) {
      d.setUint8(8, 0x00); //coin id
    } else {
      d.setUint8(8, 0x01); //coin id
    }

    d.setUint8(12, 0xAB); // echo

    d.setUint8(13, 0xAB); // echo

    if (this.options.forcetcprequest || tcpmode) d.setUint16(14, 118 + 19 * coins.length)//tcp body size
    else d.setUint16(14, 0x01)//udp packetnumber


    for (let x = 0; x < 12; x++) {
      d.setUint8(22 + x, challange[x])
    }
    d.setUint32(34, chcrc32)

    let i = 0;

    for (let sn in resultData['result']) {
      let coin = resultData['result'][sn];
      d.setUint32(38 + i * 19, coin.sn << 8);
      for (let x = 0; x < 16; x++) {
        d.setUint8(41 + 19 * i + x, parseInt(coin.an[raidaIdx].substr(x * 2, 2), 16));
      }
      i++;
    }
    //console.log("ticket ", resultData['result'][coins[0].sn].tickets);
    for (let j = 0; j < 25; j++) {

      if ('tickets' in resultData.result[coins[0].sn] && j != raidaIdx) d.setUint32(38 + 19 * coins.length + j * 4, resultData['result'][coins[0].sn].tickets[j]); else {
        d.setUint32(38 + 19 * coins.length + j * 4, 0);
      }
    } // exec fix fracked

    //console.log(d);
    await this.waitForSockets()
    rqs = this._launchRequests("multi_fix", ab, callback, tcpmode, [raidaIdx]);
    resultData = await this._getGenericMainPromise(rqs, coins, (a, c, e) => {
      if (a == 1 && c == 0 && e == 0) return this.__authenticResult;
      return this.__counterfeitResult;
    });

    resultData = resultData['result'];
    let cfixed = 0;

    for (let i = 0; i < coins.length; i++) {
      let sn = coins[i].sn;
      if (!(sn in resultData)) continue;
      let coinResult = resultData[sn].result;
      if (coinResult != this.__authenticResult) continue;
      /*
      let newpan = (0, _jsMd.default)(i.toString() + sn.toString() + coins[0].pan[raidaIdx]);
      coins[i].an[raidaIdx] = newpan;
      */
      coins[i].pownArray[raidaIdx] = 'p';
      cfixed++;
    } //  if (cfixed == coins.length)
    //break
    //}

  }


  _formRequestData(params, pan = true, command = 0) {
    let rqdata = []
    let amount = params.length
    let bodylength
    if (pan)
      bodylength = 35
    else {
      bodylength = 19
    }
    let challange = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

    let chcrc32 = this._crc32(challange, 0, 12);
    // Assemble input data for each Raida Server
    for (let i = 0; i < this._totalServers; i++) {
      let ab = new ArrayBuffer(35 + (bodylength * amount) + 5)
      let d = new DataView(ab)
      d.setUint8(ab.byteLength - 1, 0x3e)
      d.setUint8(ab.byteLength - 2, 0x3e) // Trailing chars
      //rqdata.push(ab)
      for (let x = 0; x < 12; x++) {
        d.setUint8(22 + x, challange[x]);
      }

      d.setUint32(34, chcrc32);
      for (let j = 0; j < amount; j++) {
        let coin = params[j]
        if ('an' in coin) {
          for (let x = 0; x < coin.an.length; x++) {
            if (coin.an[x] == null)
              coin.an[x] = this._generatePan()
          }
        }

        if (!this._validateCoin(coin)) {
          console.error("Invalid coin. Coin index: " + j)
          return null
        }

        //header
        d.setUint8(2, i) //raida id
        //d.setUint8(3, 0x00) //shard id
        d.setUint8(5, command)//command
        d.setUint8(5, command); //command
        if (coin.sn >= 26000 && coin.sn <= 100000) {
          d.setUint8(8, 0x00); //coin id
        } else {
          d.setUint8(8, 0x01); //coin id
        }
        d.setUint8(12, 0xAB)// echo
        d.setUint8(13, 0xAB)// echo
        if (this.options.forcetcprequest || amount >= 40) d.setUint16(14, 18 + (bodylength * amount))//tcp body size
        else d.setUint16(14, 0x01)//udp packetnumber



        //body
        d.setUint32(38 + (j * bodylength), coin.sn << 8)//rqdata[i].sns.push(coin.sn)
        for (let x = 0; x < 16; x++) {
          d.setUint8(38 + (j * bodylength) + (3 + x), parseInt(coin.an[i].substr(x * 2, 2), 16))
          if (pan)
            d.setUint8(38 + (j * bodylength) + (19 + x), parseInt(coin.pan[i].substr(x * 2, 2), 16))
        }//rqdata[i].ans.push(coin.an[i])
        //rqdata[i].pans.push(coin.pan[i])

      }
      rqdata.push(ab)
    }

    return rqdata
  }

  _getGenericBriefMainPromise(rqs, coins) {
    // Parse the response from all RAIDA servers
    let mainPromise = rqs.then(response => {
      // Return value
      let rv = {
        status: "done",
        totalNotes: coins.length,
        authenticNotes: 0,
        counterfeitNotes: 0,
        errorNotes: 0,
        frackedNotes: 0,
        result: [],
        details: [],
        tickets: []
      }

      // Return value
      let rcoins = {}

      // Setup the return hash value
      for (let i = 0; i < coins.length; i++) {
        let sn = coins[i].sn
        rcoins[sn] = {
          nn: coins[i].nn,
          sn: sn,
          errors: 0,
          counterfeit: 0,
          authentic: 0,
          pownstring: "",
          result: "unknown",
          message: new Array(this._totalServers)
        }

        if (typeof (coins[i].pan) != 'undefined')
          rcoins[sn].an = coins[i].pan
      }

      // Collect responses
      this._parseMainPromise(response, 0, rv, (serverResponse, raidaIdx) => {
        if (serverResponse === "error") {
          Object.keys(rcoins).map(sn => {
            rcoins[sn].errors++;
            rcoins[sn].pownstring += "e"
          })
          return
        }

        if (serverResponse === "network") {
          Object.keys(rcoins).map(sn => {
            rcoins[sn].errors++;
            rcoins[sn].pownstring += "n"
          })
          return
        }

        let sr = new DataView(serverResponse)

        let status = sr.getUint8(2)
        if (status < 241) {
          for (let i = 0; i < coins.length; i++) {
            let sn = coins[i].sn
            rcoins[sn].errors++
            rcoins[sn].pownstring += "e"
          }
          return
        }
        /*
                if ('ticket' in sr) {
                  rv.tickets[raidaIdx] = sr.ticket
                }
        *///implement with superfix

        //let s = sr.status
        if (status == '241') {
          for (let i = 0; i < coins.length; i++) {
            let sn = coins[i].sn
            rcoins[sn].authentic++
            rcoins[sn].pownstring += "p"
          }
          return
        }

        if (status == '242') {
          this._addCoinsToRarr(raidaIdx, coins)
          for (let i = 0; i < coins.length; i++) {
            let sn = coins[i].sn
            rcoins[sn].counterfeit++
            rcoins[sn].pownstring += "f"
          }
          return
        }
        //no mixed bit in response right now
        /*
                if (sr.status == 'mixed') {
                  let message = sr.message
                  let vals = message.split(',')
                  if (vals.length != coins.length) {
                    console.log("Invalid size: " + vals.length + ", coins size: " + coins.length)
                    for (let i = 0; i < coins.length; i++) {
                      let sn = coins[i].sn
                      rcoins[sn].errors++
                      rcoins[sn].pownstring += "e"
                    }
                    return
                  }

                  for (let x = 0; x < vals.length; x++) {
                    let vs = vals[x]
                    let sn = coins[x].sn
                    if (vs == 'pass') {
                      rcoins[sn].authentic++
                      rcoins[sn].pownstring += "p"
                    } else if (vs == 'fail') {
                      this._addCoinToRarr(raidaIdx, coins[x])
                      rcoins[sn].counterfeit++
                      rcoins[sn].pownstring += "f"
                    } else {
                      rcoins[sn].errors++
                      rcoins[sn].pownstring += "e"
                    }
                  }


                  //for (let i = 0; i < coins.length; i++) {
                  //  let sn = coins[i].sn
                  //  rcoins[sn].counterfeit = this._totalServers
                  //  rcoins[sn].pownstring = "f".repeat(this._totalServers)
                  //}
                  return
                }*/

        // General error
        for (let i = 0; i < coins.length; i++) {
          let sn = coins[i].sn
          rcoins[sn].errors++
          rcoins[sn].pownstring += "e"
        }

        return

      })

      // Detect the result of each coin
      Object.keys(rcoins).map(sn => {
        rcoins[sn].result = this._gradeCoin(rcoins[sn].authentic, rcoins[sn].counterfeit, rcoins[sn].errors, this)
        switch (rcoins[sn].result) {
          case this.__authenticResult:
            rv.authenticNotes++
            break
          case this.__counterfeitResult:
            rv.counterfeitNotes++
            break
          case this.__frackedResult:
            rv.frackedNotes++
            break
          default:
            rv.errorNotes++
            break
        }
      })

      rv.result = rcoins
      return rv
    })

    return mainPromise
  }

  _getGenericMainPromise(rqs, coins, gradeFunction = null) {
    // Parse the response from all RAIDA servers
    let mainPromise = rqs.then(response => {
      // Return value
      let rv = {
        status: "done",
        code: SkyVaultJS.ERR_NO_ERROR,
        totalNotes: coins.length,
        authenticNotes: 0,
        counterfeitNotes: 0,
        errorNotes: 0,
        frackedNotes: 0,
        transaction_id: "",
        result: [],
        details: []
      }

      // Return value
      let rcoins = {}

      // Setup the return hash value
      for (let i = 0; i < coins.length; i++) {
        let sn = coins[i].sn

        rcoins[sn] = {
          nn: coins[i].nn,
          sn: sn,
          errors: 0,
          counterfeit: 0,
          authentic: 0,
          pownstring: "",
          result: "unknown",
          message: new Array(this._totalServers)
        }

        if (typeof (coins[i].pan) != 'undefined')
          rcoins[sn].an = coins[i].pan
      }

      // Collect responses
      this._parseMainPromise(response, 0, rv, (serverResponse, raidaIdx) => {
        if (serverResponse === "error") {
          Object.keys(rcoins).map(sn => {
            rcoins[sn].errors++;
            rcoins[sn].pownstring += "e"
          })
          return
        }
        if (serverResponse === "network") {
          Object.keys(rcoins).map(sn => {
            rcoins[sn].errors++;
            rcoins[sn].pownstring += "n"
          })
          return
        }

        let sr = new DataView(serverResponse)
        // The order in input and output data is the same
        for (let i = 0; i < coins.length; i++) {
          let sn = coins[i].sn
          // serverResponse[i]
          let status = sr.getUint8(2)
          if (status < 241) {
            rcoins[sn].errors++;
            rcoins[sn].pownstring += "e"
            continue
          }
          let mixed = 0
          let ms
          if (status == 243) {
            if (sr.byteLength >= 20)
              ms = sr.getUint8(Math.floor(20 + (i / 8)))
            else if (sr.byteLength >= 16) {
              ms = sr.getUint8(Math.floor(16 + (i / 8)))
            } else {
              ms = sr.getUint8(Math.floor(12 + (i / 8)))
            }
            let bitpos = i - (8 * Math.floor(i / 8))
            mixed = (ms >>> bitpos) & 1
          }

          if (status == 250 || status == 241 || (status == 243 && mixed == 1)) {//sr.status == 'pass') {
            rcoins[sn].authentic++;
            rcoins[sn].pownstring += "p"
            if (!('tickets' in rcoins[sn]))
              rcoins[sn].tickets = []
            if (sr.byteLength >= 16)
              rcoins[sn].tickets[raidaIdx] = sr.getUint32(12)
          } else if (status == 242 || status == 251 || (status == 243 && mixed == 0)) {
            rcoins[sn].counterfeit++;
            rcoins[sn].pownstring += "f"
          }
        }
      })

      // Detect the result of each coin
      Object.keys(rcoins).map(sn => {
        if (gradeFunction == null) {
          rcoins[sn].result = this._gradeCoin(rcoins[sn].authentic,
            rcoins[sn].counterfeit, rcoins[sn].errors, this)
        } else {
          rcoins[sn].result = gradeFunction(rcoins[sn].authentic,
            rcoins[sn].counterfeit, rcoins[sn].errors, this)
        }

        switch (rcoins[sn].result) {
          case this.__authenticResult:
            rv.authenticNotes++
            break
          case this.__counterfeitResult:
            rv.counterfeitNotes++
            break
          case this.__frackedResult:
            rv.frackedNotes++
            break
          default:
            rv.errorNotes++
            break
        }
      })

      rv.result = rcoins

      return rv
    })

    return mainPromise
  }

  _gradeCoin(a, f, e) {
    if (a >= this.options.minPassedNumToBeAuthentic) {
      if (f > 0) {
        return this.__frackedResult
      } else {
        return this.__authenticResult
      }
    } else if (f >= this.options.maxFailedNumToBeCounterfeit) {
      return this.__counterfeitResult
    } else {
      return this.__errorResult
    }
  }

  _getCoinFromParams(params) {
    let coin = {
      sn: 0,
      nn: this.options.defaultCoinNn,
      an: []
    }

    console.log(params)
    if (typeof (params) !== 'object') {
      console.error("Invalid input data")
      return null
    }

    for (let k in coin) {
      if (k in params)
        coin[k] = params[k]
    }

    console.log(params)
    if (!this._validateCoin(coin))
      return null

    return coin
  }


  _generatePan() {
    let s = ""
    let rand, i = 0

    while (i < 32) {
      rand = Math.floor((Math.random() * 16));
      rand = rand.toString(16)
      s += rand
      i++
    }

    return s
  }

  _parseMainPromise(response, arrayLength, rv, callback) {
    console.log("parsing " + arrayLength)
    console.log(response)
    for (let i = 0; i < response.length; i++) {
      let serverResponse

      console.log("rrr" + i)
      console.log(response[i])
      if (response[i].status != 'fulfilled' || response[i].value == undefined) {
        this._addDetails(rv)
        callback("network", i)
        continue
      }

      //     serverResponse = response[i].value.data
      serverResponse = response[i].value

      console.log(serverResponse)
      //console.log('response from server ', dView.getUint8(0));
      //console.log("status code ", dView.getUint8(2))
      if (arrayLength == 0) {
        if (typeof (serverResponse) != 'object' || serverResponse.byteLength < 12) {
          console.error("Invalid response from RAIDA: " + i + ". No header/not binary")
          this._addDetails(rv)
          callback("error", i)
          continue
        }
      } else {
        if (!Array.isArray(serverResponse)) {
          console.error("Expected array from RAIDA: " + i)
          this._addDetails(rv)
          callback("error", i)
          continue
        }

        if (serverResponse.length != arrayLength) {
          console.error("Invalid length returned from RAIDA: " + i
            + ". Expected: " + arrayLength + ", got " + serverResponse.length)
          this._addDetails(rv)
          callback("error", i)
          continue
        }
      }

      callback(serverResponse, i)
      this._addDetails(rv, serverResponse)
    }
  }

  _addDetails(rv, serverResponse = null) {
    if (this.options.debug) {
      if (!('details' in rv)) {
        rv['details'] = []
      }
      rv['details'].push(serverResponse)
    }
  }

  _wsConnect(data, i, st, tcp = false, timeout = 10000) {
    let thiz = this
/*
    if (this._webSockets[i] == null || data == null) {
      return new Promise((res, rej) => {
        rej()
      })
    }
*/
    let dv = new DataView(data)
    return new Promise(function (res, rej) {
 //     thiz._webSockets[i].binaryType = "arraybuffer";
      dv.setUint8(2, i);

      let returned = false
      console.log("Data to raida " + i)
      let v = ""
      for (let p = 0; p < dv.byteLength; p++) {
        v += "" + dv.getUint8(p) + " "
      }
      if (tcp) {
        let socket;
        if (_isBrowser) socket = new WebSocket(thiz._raidaServers[i] + ":9999"); else {
          socket = new _ws(thiz._raidaServers[i] + ":9999");
        }
        socket.binaryType = "arraybuffer";
        socket.onopen = e => {
          console.log("sending tcp ", i, Date.now() - st);
          dv.setUint8(2, i);
          socket.send(data);
        };
        socket.onmessage = e => {
          let restime = Date.now() - st;
          console.log("recieving tcp ", i, restime);
          if (restime > thiz.highestrestime)
            thiz.highestrestime = restime;
          res(e);
          socket.close(1000);
          returned = true
        };
        socket.onerror = e => {
          console.log("tcp ws error: ", e.message);
          rej(e);
          socket.close();
          returned = true
        };
        setTimeout(function() {
          if (!returned) {
            console.log("failed to wait for raida" + i + ". Timeout. Terminating")
            rej("timeout");
          }
        }, timeout);
      } else {
        /*
        thiz._webSockets[i].onmessage = e => {
          let restime = Date.now() - st;
          if (restime > thiz.highestrestime)
            thiz.highestrestime = restime;

          console.log("received r" + i)
          console.log(e)

          res(e);
        };

        thiz._webSockets[i].onclose = e => {
          console.log("ws closed: ", e.message);
          rej(e);
        }

        thiz._webSockets[i].onerror = e => {
          console.log("ws error: ", e.message);
          rej(e);
        };

        console.log("SENDING r " + i)
        thiz._webSockets[i].send(data);
        */
      }
    });
  }

  _launchRequests(url, params = null, callback = null, tcpmode = true, servers = null, data = null, timeout = 10000) {
    if (params == null) params = {};
    let iteratedServersIdxs;

    console.log("Launching " + url)
    console.log(params)

    if (servers != null) {
      iteratedServersIdxs = servers;
    } else {
      iteratedServersIdxs = [...Array(this._totalServers).keys()];
    }

    let thiz = this
    //   let tm = new Promise((res, rej) => {
    let st = Date.now();

    let rparams = []
    if (typeof params === 'object' && Array.isArray(params)) {
      for (let i = 0; i < this._totalServers; i++) {
        rparams[i] = params[i]
      }
    } else {
      for (let i = 0; i < this._totalServers; i++) {
        rparams[i] = params
      }
    }

    let pms = []

    for (let i = 0; i < iteratedServersIdxs.length; i++) {
      let ridx = iteratedServersIdxs[i];

      (function (ridx) {
        let pm = thiz._wsConnect(rparams[ridx], ridx, st, tcpmode, timeout).then(response => {
          if (callback != null) {
            callback(ridx, url, data)
          }

          return response.data
        }).catch(error => {
          console.log("error. Raida" + ridx)
          if (typeof (error) != undefined) {
            console.log(error)
          }
          return null
        })

        pms.push(pm)
      })(ridx)
    }

    let allDone = allSettled(pms)

    console.log("Requests to " + url + " finished")

    return allDone

  }


  _initAxios() {
    this._axInstance = axios.create({
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })
    this._axInstance.defaults.timeout = this.options.timeout

  }

  // Generate the array of RAIDA server URLs
  _generateServers() {
    if (this.options.wsprotocol == "wss") {
      this._raidaServers[0] = this.options.wsprotocol + "://ebc0-99a2-92e-10420.skyvault.cc";
      this._raidaServers[1] = this.options.wsprotocol + "://ebc2-4555a2-92e-10422.skyvault.cc";
      this._raidaServers[2] = this.options.wsprotocol + "://ebc4-9aes2-92e-10424.skyvault.cc";
      this._raidaServers[3] = this.options.wsprotocol + "://ebc6-13a2-92e-10426.skyvault.cc";
      this._raidaServers[4] = this.options.wsprotocol + "://ebc8-11a2-92e-10428.skyvault.cc";
      this._raidaServers[5] = this.options.wsprotocol + "://ebc10-56a2-92e-104210.skyvault.cc";
      this._raidaServers[6] = this.options.wsprotocol + "://ebc12-88a2-92e-10412.skyvault.cc";
      this._raidaServers[7] = this.options.wsprotocol + "://ebc14-90a2-92e-10414.skyvault.cc";
      this._raidaServers[8] = this.options.wsprotocol + "://ebc16-66a2-92e-10416.skyvault.cc";
      this._raidaServers[9] = this.options.wsprotocol + "://ebc18-231a2-92e-10418.skyvault.cc";
      this._raidaServers[10] = this.options.wsprotocol + "://ebc20-13489-92e-10420.skyvault.cc";
      this._raidaServers[11] = this.options.wsprotocol + "://ebc22-kka2-92e-10422.skyvault.cc";
      this._raidaServers[12] = this.options.wsprotocol + "://ebc24-mnna2-92e-10444.skyvault.cc";
      this._raidaServers[13] = this.options.wsprotocol + "://ebc26-uuia2-92e-10426.skyvault.cc";
      this._raidaServers[14] = this.options.wsprotocol + "://ebc28-eera2-92e-10428.skyvault.cc";
      this._raidaServers[15] = this.options.wsprotocol + "://ebc30-zxda2-92e-10430.skyvault.cc";
      this._raidaServers[16] = this.options.wsprotocol + "://ebc32-wera2-92e-10432.skyvault.cc";
      this._raidaServers[17] = this.options.wsprotocol + "://ebc34-34oa2-92e-10434.skyvault.cc";
      this._raidaServers[18] = this.options.wsprotocol + "://ebc36-mhha2-92e-10436.skyvault.cc";
      this._raidaServers[19] = this.options.wsprotocol + "://ebc38-qqra2-92e-10438.skyvault.cc";
      this._raidaServers[20] = this.options.wsprotocol + "://ebc40-bhta2-92e-10440.skyvault.cc";
      this._raidaServers[21] = this.options.wsprotocol + "://ebc42-nkla2-92e-10442.skyvault.cc";
      this._raidaServers[22] = this.options.wsprotocol + "://cbe88-3i0a2-63e-21233.skyvault.cc";
      this._raidaServers[23] = this.options.wsprotocol + "://8c9dhe-6au3f-e19-78433.skyvault.cc";
      this._raidaServers[24] = this.options.wsprotocol + "://ebc48-adea2-92e-10448.skyvault.cc";
    }
    else {
      this._raidaServers[0] = this.options.wsprotocol + "://87.120.8.249";
      this._raidaServers[1] = this.options.wsprotocol + "://23.106.122.6";
      this._raidaServers[2] = this.options.wsprotocol + "://172.105.176.86";
      this._raidaServers[3] = this.options.wsprotocol + "://85.195.82.169";
      this._raidaServers[4] = this.options.wsprotocol + "://198.244.135.236";
      this._raidaServers[5] = this.options.wsprotocol + "://88.119.174.101";
      this._raidaServers[6] = this.options.wsprotocol + "://209.141.52.193";
      this._raidaServers[7] = this.options.wsprotocol + "://179.43.175.35";
      this._raidaServers[8] = this.options.wsprotocol + "://104.161.32.116";
      this._raidaServers[9] = this.options.wsprotocol + "://66.172.11.25";
      this._raidaServers[10] = this.options.wsprotocol + "://194.29.186.69";
      this._raidaServers[11] = this.options.wsprotocol + "://168.235.69.182";
      this._raidaServers[12] = this.options.wsprotocol + "://185.118.164.19";
      this._raidaServers[13] = this.options.wsprotocol + "://167.88.15.117";
      this._raidaServers[14] = this.options.wsprotocol + "://135.148.11.160";
      this._raidaServers[15] = this.options.wsprotocol + "://66.29.143.85";
      this._raidaServers[16] = this.options.wsprotocol + "://185.99.133.110";
      this._raidaServers[17] = this.options.wsprotocol + "://104.168.162.230";
      this._raidaServers[18] = this.options.wsprotocol + "://170.75.170.4";
      this._raidaServers[19] = this.options.wsprotocol + "://185.215.227.31";
      this._raidaServers[20] = this.options.wsprotocol + "://51.222.229.205";
      this._raidaServers[21] = this.options.wsprotocol + "://31.192.107.132";
      this._raidaServers[22] = this.options.wsprotocol + "://180.235.135.143";
      this._raidaServers[23] = this.options.wsprotocol + "://213.59.119.96";
      this._raidaServers[24] = this.options.wsprotocol + "://147.182.249.132";
    }
  }


  // No need to implement it so far. All sockets will be created upon a request
  async waitForSockets() {
    return 
  }



  closeSockets() {
    for (let i = 0; i < this._webSockets.length; i++) {
      if (this._webSockets[i] != null) {
        this._webSockets[i].close(1000);
      }
    }
  }


  // Check if the coin is valid
  _validateCoin(coin) {
    if (typeof (coin) !== 'object')
      return false;

    if (!('sn' in coin))
      return false;

    if (!('an' in coin))
      return false;

    if (typeof (coin.an) != 'object' || !Array.isArray(coin.an))
      return false

    if ('pan' in coin) {
      if (typeof (coin.pan) != 'object' || !Array.isArray(coin.pan))
        return false

      if (coin.pan.length != coin.an.length)
        return false
    } else {
      coin.pan = [...coin.an]
    }

    if (coin.an.length != this._totalServers)
      return false;

    if (!('nn' in coin))
      coin.nn = this.options.defaultCoinNn

    if (coin.sn < 1 || coin.sn > 16777216)
      return false

    if (coin.an.some(elem => !elem.match(/^[a-fA-F0-9]{32}$/)))
      return false

    return true
  }

  // Validate GUID
  _validateGuid(guid) {
    guid = "" + guid

    return guid.match(/^[a-fA-F0-9]{32}$/)
  }

  // Validate Event Code
  _validateEventCode(event_code) {
    return ["send", "receive", "transfer_out", "transfer_in", "break", "break_in_bank", "join", "join_in_bank", "unknown"].includes(event_code)
  }

  // Validate Initiator type
  _validateInitiatorType(itype) {
    return ['self', 'other_know', 'other_anonymous', 'unknown'].includes(itype)
  }

  // Put message toghether
  _assembleMessage(mparts) {
    let cs = 0, length

    // Determine the chunk size
    for (let i = 0; i < this._totalServers; i++) {
      if (mparts[i] == null)
        continue

      cs = mparts[i]['stripe'].length
      break
    }

    // Failed to determine the chunk size
    if (cs == 0)
      return null

    let collected = []
    for (let i = 0; i < this._totalServers; i++) {
      if (mparts[i] == null || typeof (mparts[i]) == 'undefined')
        continue

      if (!mparts[i]['stripe'] || !mparts[i]['mirror1'] || !mparts[i]['mirror2'])
        continue

      let cidx0 = i
      let cidx1 = i + 3
      let cidx2 = i + 6

      if (cidx1 >= this._totalServers)
        cidx1 -= this._totalServers

      if (cidx2 >= this._totalServers)
        cidx2 -= this._totalServers

      collected[cidx0] = mparts[i]['stripe']
      collected[cidx1] = mparts[i]['mirror1']
      collected[cidx2] = mparts[i]['mirror2']
    }

    let msg = []
    for (let i = 0; i < this._totalServers; i++) {
      if (!collected[i]) {
        console.log("Failed to assemble message. Chunk #" + i + " wasn't found on stripe and mirrors")
        return null
      }

      let totalStr = collected[i].split('')
      for (let j = 0; j < totalStr.length; j++) {
        let offset = i + j * this._totalServers
        msg[offset] = totalStr[j]
      }
    }

    // Check if the message is full
    for (let i = 0; i < msg.length; i++) {
      if (typeof (msg[i]) == 'undefined') {
        return null
      }
    }

    // Join the string together
    msg = msg.join('')

    // Trim pads at the end
    msg = msg.replace(/-+$/g, '');

    return msg
  }

  _getDataFromObjectMemo(mparts) {
    let data = this._assembleMessage(mparts)
    if (data == null)
      return null

    try {
      data = this._b64DecodeUnicode(data)
    } catch (e) {
      console.log("Failed to decode strange message: " + data)
      return null
    }

    data = this._parseINIString(data)
    if (data == null) {
      console.log("Failed to parse INI: " + data)
      return null
    }

    if (!('general' in data)) {
      console.log("No general section in INI")
      return null
    }

    return data['general']
  }

  _getStripesMirrorsForObject(obj) {
    let str = "[general]\n"

    let date = Math.floor(Date.now() / 1000)

    str += "date=" + date + "\n"
    for (let key in obj) {
      str += key + "=" + obj[key] + "\n"
    }

    str = this._b64EncodeUnicode(str)
    let data = this._splitMessage(str)

    return data
  }

  _getNFTStringForObject(obj, data, proofdata) {
    let str = "[general]\n"
    for (let key in obj) {
      str += key + "=" + obj[key] + "\n"
    }

    let mstr = this._b64EncodeUnicode(str)
    let finalStr = mstr + this.options.nftMetadataSeparator + data
    if (proofdata != null)
      finalStr += this.options.nftMetadataSeparator + proofdata

    console.log(finalStr)
    let fdata = this._splitMessage(finalStr)

    return fdata

  }

  _getNFTObjectFromString(mparts) {
    let data = this._assembleMessage(mparts)
    if (data == null)
      return null

    let vals = data.split(this.options.nftMetadataSeparator)
    if (vals.length != 2 && vals.length != 3)
      return null

    let metadata
    try {
      metadata = this._b64DecodeUnicode(vals[0])
    } catch (e) {
      console.log("Failed to decode strange message: " + vals[0])
      return null
    }

    data = this._parseINIString(metadata)
    if (data == null) {
      console.log("Failed to parse INI: " + data)
      return null
    }

    if (!('general' in data)) {
      console.log("No general section in INI")
      return null
    }

    let rv = {
      'metadata': data['general'],
      'data': vals[1]
    }

    if (vals.length == 3) {
      rv.proofdata = vals[2]
    }

    return rv
  }

  _getStripesMirrorsForObjectMemo(memo, from) {
    let str = ""
    str += "sender_address=" + from + "\n"
    str += "memo=" + memo + ""

    str = this._b64EncodeUnicode(str)
    let data = this._splitMessage(str)

    return data
  }

  _getObjectMemo(memo, from) {
    let data = this._getStripesMirrorsForObjectMemo(memo, from)

    let d = []
    let ms = this.options.memoMetadataSeparator
    for (let i = 0; i < this._totalServers; i++) {
      d[i] = data[i]['stripe'] + ms + data[i]['mirror1'] + ms + data[i]['mirror2']
    }

    return d
  }



  _splitMessage(message) {
    // Pad the message to have it multily of 25
    let pads = message.length % this._totalServers
    if (pads > 0)
      for (let i = 0; i < (this._totalServers - pads); i++)
        message += "-"
    // Break the message
    let cs = message.split('')

    // Init array
    let nrmessage = []
    for (let i = 0; i < this._totalServers; i++) {
      nrmessage[i] = {
        'stripe': "",
        'mirror1': "",
        'mirror2': ""
      }
    }

    // Go over the message
    for (let i = 0; i < cs.length; i++) {
      // Raida index
      let ridx = i % this._totalServers

      // Chunk indexes
      let cidx0 = i + 3
      let cidx1 = i + 6
      if (cidx0 >= cs.length)
        cidx0 -= cs.length

      if (cidx1 >= cs.length)
        cidx1 -= cs.length

      // Fill the message with three chunks
      nrmessage[ridx]['stripe'] += cs[i]
    }

    for (let i = 0; i < this._totalServers; i++) {
      let cidx0 = i + 3
      let cidx1 = i + 6
      if (cidx0 >= this._totalServers)
        cidx0 -= this._totalServers

      if (cidx1 >= this._totalServers)
        cidx1 -= this._totalServers

      nrmessage[i]['mirror1'] += nrmessage[cidx0]['stripe']
      nrmessage[i]['mirror2'] += nrmessage[cidx1]['stripe']
    }

    return nrmessage
  }

  // Base64 utils
  _b64EncodeUnicode(str) {
    let output
    if (_isBrowser) {
      output = btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,
        function toSolidBytes(match, p1) {
          return String.fromCharCode('0x' + p1);
        }
      ))
    } else {
      output = Buffer.from(str).toString('base64')
    }

    return output
  }

  _b64DecodeUnicode(str) {
    let output

    if (_isBrowser) {
      output = decodeURIComponent(atob(str).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
    } else {
      output = Buffer.from(str, 'base64').toString('utf-8')
    }

    return output
  }

  _calcAmount(sns) {
    let total = 0
    for (let i = 0; i < sns.length; i++)
      total++

    return total
  }

  _pickCoinsAmountFromArrayWithExtra(coins, amount) {
    let coinsPicked = []
    for (let j = 0; j < coins.length; j++) {
      if (j == amount)
        break

      coinsPicked.push(coins[j])
    }

    return {coins: coinsPicked};
  }

  _validateCard(cardnumber, cvv) {
    if (!cardnumber.match(/^\d{16}$/))
      return false

    if (!cvv.match(/^\d+$/))
      return false

    if (!cardnumber.startsWith("401"))
      return false

    let total = 0;
    let precardNumber = cardnumber.substring(0, cardnumber.length - 1)
    let reverse = precardNumber.split("").reverse().join("")
    for (let i = 0; i < reverse.length; i++) {
      let num = parseInt(reverse.charAt(i))
      if ((i + 3) % 2) {
        num *= 2
        if (num > 9)
          num -= 9
      }
      total += num;
    }

    let remainder = cardnumber.substring(cardnumber.length - 1)
    let calcRemainder = 10 - (total % 10)
    if (calcRemainder == 10)
      calcRemainder = 0

    if (calcRemainder != remainder)
      return false

    return true
  }

  _addCoinsToRarr(raidaIdx, coins) {
    for (let i = 0; i < coins.length; i++) {
      this._addCoinToRarr(raidaIdx, coins[i])
    }
  }

  _addCoinToRarr(raidaIdx, coin) {
    if (!(raidaIdx in this._rarr))
      this._rarr[raidaIdx] = []

    this._rarr[raidaIdx].push(coin.sn)
  }

  // Error return
  _getError(msg) {
    return {
      'status': 'error',
      'errorText': msg
    }
  }

  // Error Code Return
  _getErrorCode(code, msg) {
    return {
      // Legacy
      'status': 'error',
      'errorText': msg,

      'code': code,
      'text': msg
    }
  }

  // network byte order
  _getUint32(data, offset) {
    let a = (data[offset] << 24 | data[offset + 1] << 16 |
      data[offset + 2] << 8 | data[offset + 3])

    return a >>> 0
  }

  // network byte order
  _setUint32(data, offset, value) {
    data[offset] = (value >> 24) & 0xff
    data[offset + 1] = (value >> 16) & 0xff
    data[offset + 2] = (value >> 8) & 0xff
    data[offset + 3] = (value) & 0xff
  }

  // initCrc
  _initCrcTable() {
    let c
    this._crcTable = []
    for (let i = 0; i < 256; i++) {
      c = i
      for (let k = 0; k < 8; k++) {
        c = ((c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1));
      }
      this._crcTable[i] = c
    }
  }

  // calc crc32
  _crc32(data, offset, length) {
    if (this._crcTable == null)
      this._initCrcTable()

    let crc = 0 ^ (-1)
    for (let i = 0; i < length; i++) {
      crc = (crc >>> 8) ^ this._crcTable[(crc ^ data[offset + i]) & 0xff]
    }

    return (crc ^ (-1)) >>> 0;
  }

  _base64ArrayBuffer(bytes) {
    let base64 = ''
    let encodings = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

    let byteLength = bytes.length
    let byteRemainder = byteLength % 3
    let mainLength = byteLength - byteRemainder

    let a, b, c, d
    let chunk

    // Main loop deals with bytes in chunks of 3
    for (let i = 0; i < mainLength; i = i + 3) {
      // Combine the three bytes into a single integer
      chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]

      // Use bitmasks to extract 6-bit segments from the triplet
      a = (chunk & 16515072) >> 18
      b = (chunk & 258048) >> 12
      c = (chunk & 4032) >> 6
      d = chunk & 63

      // Convert the raw binary segments to the appropriate ASCII encoding
      base64 += encodings[a] + encodings[b] + encodings[c] + encodings[d]
    }

    // Deal with the remaining bytes and padding
    if (byteRemainder == 1) {
      chunk = bytes[mainLength]
      a = (chunk & 252) >> 2

      // Set the 4 least significant bits to zero
      b = (chunk & 3) << 4
      base64 += encodings[a] + encodings[b] + '=='
    } else if (byteRemainder == 2) {
      chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1]

      a = (chunk & 64512) >> 10
      b = (chunk & 1008) >> 4

      // Set the 2 least significant bits to zero
      c = (chunk & 15) << 2
      base64 += encodings[a] + encodings[b] + encodings[c] + '='
    }

    return base64
  }

  _basePngChecks(imgData) {
    if (imgData[0] != 0x89 && imgData[1] != 0x50 && imgData[2] != 0x4e && imgData[3] != 0x47
      && imgData[4] != 0x0d && imgData[5] != 0x0a && imgData[6] != 0x1a && imgData[7] != 0x0a) {
      return "Invalid PNG signature"
    }

    let chunkLength = this._getUint32(imgData, 8)
    let headerSig = this._getUint32(imgData, 12)
    if (headerSig != 0x49484452) {
      return "Invalid PNG header"
    }

    let idx = 16 + chunkLength
    let crcSig = this._getUint32(imgData, idx)
    let calcCrc = this._crc32(imgData, 12, chunkLength + 4)
    if (crcSig != calcCrc) {
      return "Invalid PNG crc32 checksum"
    }

    return idx

  }

  _validResult(result) {
    return result == this.__authenticResult || result == this.__frackedResult
  }

  // Parse INI string and return Object
  _parseINIString(data) {
    var regex = {
      section: /^\s*\[\s*([^\]]*)\s*\]\s*$/,
      param: /^\s*([^=]+?)\s*=\s*(.*?)\s*$/,
      comment: /^\s*;.*$/
    }

    var value = {}
    var lines = data.split(/[\r\n]+/)
    var section = null

    lines.forEach(function (line) {
      if (regex.comment.test(line)) {
        return;
      } else if (regex.param.test(line)) {
        var match = line.match(regex.param);
        if (section) {
          value[section][match[1]] = match[2];
        } else {
          value[match[1]] = match[2];
        }
      } else if (regex.section.test(line)) {
        var match = line.match(regex.section);
        value[match[1]] = {};
        section = match[1];
      } else if (line.length == 0 && section) {
        section = null;
      }
    })

    return value;
  }

  // Collects hashData from ServerResponses. Auxillary function that goes through each response and tries to find common elements and their counts (an element might be a serial number or a GUID of a statement
  _collectHdata(serverResponses, targetKey, level = 1) {
    let hashData = {}
    for (let raidaIdx = 0; raidaIdx < serverResponses.length; raidaIdx++) {
      let serverResponse = serverResponses[raidaIdx]
      if (!serverResponse)
        continue

      if (level == 1) {
        let item = serverResponse.data
        let key = item[targetKey]
        if (typeof (key) == 'undefined')
          continue

        if (!(key in hashData))
          hashData[key] = {}

        hashData[key][raidaIdx] = item
      } else if (level == 2) {
        for (let j = 0; j < serverResponse.data.length; j++) {
          let item = serverResponse.data[j]
          if (typeof (item) == 'undefined')
            continue

          let key = item[targetKey]
          if (!(key in hashData))
            hashData[key] = {}

          hashData[key][raidaIdx] = item
        }
      }
    }

    return hashData
  }

  // Adds records by analyzing serverResponses. The function uses 'key' to find a group_by key. Then it will do 'fcall' call
  _syncAdd(serverResponses, key, fcall) {
    let unavailable = 0
    let servers = []
    for (let v = 0; v < serverResponses.length; v++) {
      if (!serverResponses[v]) {
        unavailable++
      }
    }

    // Check if we need to call fix_groups
    let hashData = this._collectHdata(serverResponses, key, 2)
    let drqdata = []
    for (let eid in hashData) {
      let quorum = Object.keys(hashData[eid]).length

      // We believe that RAIDA servers that don't respond have our data
      quorum += unavailable
      if (quorum < this.options.syncThreshold || quorum == this._totalServers)
        continue

      let varr = Object.keys(hashData[eid])
      for (let r = 0; r < this._totalServers; r++) {
        if (varr.includes("" + r))
          continue

        servers.push(parseInt(r))
      }

      drqdata.push(eid)
    }

    // Make them uniq
    servers = servers.filter((v, i, a) => a.indexOf(v) === i)

    if (drqdata.length > 0) {
      let lrqdata = []
      for (let i = 0; i < this._totalServers; i++) {
        lrqdata.push({
          guid: drqdata
        })
      }

      // Don't need to wait for result
      this._launchRequests(fcall, lrqdata, 'GET', () => {}, false, servers)
    }
  }

  // Deletes records by analyzing serverResponses. The function uses 'key' to find a group_by key. Then it will do 'fcall' call
  _syncDelete(serverResponses, key, fcall) {
    let unavailable = 0
    let servers = []
    for (let v = 0; v < serverResponses.length; v++) {
      if (!serverResponses[v]) {
        unavailable++
      }
    }

    // Check if we need to call fix_groups
    let hashData = this._collectHdata(serverResponses, key, 2)
    let drqdata = []
    for (let eid in hashData) {
      let quorum = Object.keys(hashData[eid]).length

      // We believe that RAIDA servers that don't respond have our data
      quorum += unavailable
      if (quorum >= this.options.syncThreshold)
        continue

      let varr = Object.keys(hashData[eid])
      for (let r = 0; r < this._totalServers; r++) {
        if (varr.includes("" + r)) {
          servers.push(parseInt(r))
          continue
        }
      }

      drqdata.push(eid)
    }

    // Make them uniq
    servers = servers.filter((v, i, a) => a.indexOf(v) === i)

    if (drqdata.length > 0) {
      let lrqdata = []
      for (let i = 0; i < this._totalServers; i++) {
        lrqdata.push({
          guid: drqdata
        })
      }

      // Don't need to wait for result
      this._launchRequests(fcall, lrqdata, () => {}, false, servers)
    }
  }
}

// Error Codes
SkyVaultJS.ERR_NO_ERROR = 0x0

// Params
SkyVaultJS.ERR_PARAM_MISSING_COIN = 0x1001
SkyVaultJS.ERR_PARAM_INVALID_COIN = 0x1002
SkyVaultJS.ERR_PARAM_MISSING_GUID = 0x1003
SkyVaultJS.ERR_PARAM_INVALID_GUID = 0x1004
SkyVaultJS.ERR_PARAM_MISSING_AMOUNT = 0x1005
SkyVaultJS.ERR_PARAM_INVALID_AMOUNT = 0x1006
SkyVaultJS.ERR_PARAM_INVALID_EVENT_CODE = 0x1007
SkyVaultJS.ERR_PARAM_INVALID_INITIATOR_TYPE = 0x1008
SkyVaultJS.ERR_PARAM_INVALID_TIMESTAMP = 0x1009
SkyVaultJS.ERR_PARAM_MISSING_DATA = 0x1010
SkyVaultJS.ERR_PARAM_INVALID_DATA = 0x1011
SkyVaultJS.ERR_PARAM_MISSING_FILENAME = 0x1012
SkyVaultJS.ERR_PARAM_UNSUPPORTED_NFT_PROTOCOL = 0x1013
SkyVaultJS.ERR_PARAM_MISSING_METADATA = 0x1014
SkyVaultJS.ERR_PARAM_NFT_MISSING_ID_PROOF = 0x1015
SkyVaultJS.ERR_PARAM_NFT_SIZE_IS_TOO_BIG = 0x1016
SkyVaultJS.ERR_PARAM_BILLPAY_MISSING_PAYDATA = 0x1017
SkyVaultJS.ERR_PARAM_BILLPAY_INVALID_PAYDATA = 0x1018
SkyVaultJS.ERR_PARAM_BILLPAY_PAYDATA_INVALID_METHOD = 0x1019
SkyVaultJS.ERR_PARAM_BILLPAY_PAYDATA_INVALID_FILE_FORMAT = 0x1020
SkyVaultJS.ERR_PARAM_BILLPAY_PAYDATA_INVALID_AMOUNT = 0x1021
SkyVaultJS.ERR_PARAM_BILLPAY_PAYDATA_INVALID_STATUS = 0x1022
SkyVaultJS.ERR_PARAM_BILLPAY_PAYDATA_DUPLICATED_VALUE = 0x1023
SkyVaultJS.ERR_PARAM_BILLPAY_EMPTY_PAYDATA = 0x1024
SkyVaultJS.ERR_PARAM_MISSING_DNS_NAME = 0x1025
SkyVaultJS.ERR_PARAM_MISSING_CARD_NUMBER = 0x1026
SkyVaultJS.ERR_PARAM_INVALID_CARD = 0x1027
SkyVaultJS.ERR_PARAM_MISSING_CVV = 0x1028
SkyVaultJS.ERR_PARAM_MISSING_EXPIRATION_DATE = 0x1029
SkyVaultJS.ERR_PARAM_INVALID_EXPIRATION_DATE = 0x1030
SkyVaultJS.ERR_PARAM_MISSING_EMAIL = 0x1031

// Response
SkyVaultJS.ERR_RESPONSE_TOO_FEW_PASSED = 0x2001
SkyVaultJS.ERR_RESPONSE_FAILED_TO_BUILD_MESSAGE_FROM_CHUNKS = 0x2002
SkyVaultJS.ERR_RESPONSE_RECORD_NOT_FOUND = 0x2003
SkyVaultJS.ERR_FAILED_TO_EMBED_STACK = 0x2004

// Funds
SkyVaultJS.ERR_NOT_ENOUGH_CLOUDCOINS = 0x4001

// Network
SkyVaultJS.ERR_DNS_RECORD_NOT_FOUND = 0x5001
SkyVaultJS.ERR_FAILED_TO_GET_TICKETS = 0x5002
SkyVaultJS.ERR_DNS_RECORD_ALREADY_EXISTS = 0x5003
SkyVaultJS.ERR_DNS_SERVER_INCORRECT_RESPONSE = 0x5004
SkyVaultJS.ERR_RESPONSE_INVALID_HTTP_RESPONSE = 0x5005
SkyVaultJS.ERR_RESPONSE_INVALID_HTTP_CONTENT_TYPE = 0x5006

// Billpay
SkyVaultJS.ERR_BILLPAY_SENT_PARTIALLY = 0x6001

// Modules
SkyVaultJS.ERR_NO_CANVAS_MODULE = 0x7001

// Detect Failed
SkyVaultJS.ERR_DETECT_FAILED = 0x8001
SkyVaultJS.ERR_COUNTERFEIT_COIN = 0x8002
SkyVaultJS.ERR_NETWORK_ERROR_COIN = 0x8002
SkyVaultJS.ERR_FAILED_TO_FIX = 0x8003

// NFT
SkyVaultJS.ERR_FAILED_TO_CREATE_TOKENS = 0x9001

// Request partly succeced
SkyVaultJS.ERR_HAS_ERROR = 0x9101

// Export to the Window Object if we are in browser
if (_isBrowser) {
  window.SkyVaultJS = SkyVaultJS
}

// ES6 export
export default SkyVaultJS

// Es5 export
//module.exports = SkyVaultJS
