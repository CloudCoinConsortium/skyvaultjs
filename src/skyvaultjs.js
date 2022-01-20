import axios from 'axios'
import md5 from 'js-md5'
var _ws = require('ws')
import qs from 'qs'
import CryptoJS from 'crypto-js'


import * as Sentry from "@sentry/browser";
import { Integrations } from "@sentry/tracing";

import {version} from '../package.json';

import allSettled from 'promise.allsettled'

let _isBrowser = false
if (typeof window !== 'undefined') {
  _isBrowser = true
}


class SkyVaultJS {
  // Contrustor
  constructor(options) {
    this.options = {
      domain : "cloudcoin.global",
      prefix : "raida",
      protocol: "https",
      wsprotocol: "wss",
      timeout: 10000, // ms
      defaultCoinNn: 1,
      maxFailedRaidas: 5,
      changeMakerId: 2,
      debug: false,
      defaultRaidaForQuery: 7,
      defaultRaidaForBackupQuery: 14,
      ddnsServer: "209.205.66.11",
      // max coins to transfer at a time
      maxCoins: 20000,
      maxCoinsPerIteraiton: 200,
      minPasswordLength: 8,
      memoMetadataSeparator: "*",
      nftMetadataSeparator: "*",
      minPassedNumToBeAuthentic: 14,
      maxFailedNumToBeCounterfeit: 12,
      syncThreshold: 13,
      freeCoinURL: "https://cloudcoin.global/freecoin.php",
      maxNFTSize: 6000000,
      billpayKey: "billpay",
      urlCardTemplate: "https://cloudcoinconsortium.com/img/card.png",
      sentryDSN: null
    , ...options}

    this._raidaServers = []
    this._activeServers = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24]
    this._totalServers = 25
    this._generateServers()
    this._initAxios()

    this.__authenticResult = "authentic"
    this.__frackedResult = "fracked"
    this.__counterfeitResult = "counterfeit"
    this.__errorResult = "error"

    this._initNeighbours()

    this._crcTable = null

    this._rarr = {}

    this.requestId = this._generatePan()

    if (this.options.sentryDSN)
      this.initSentry()

  }



  // Init Sentry
  initSentry() {
    Sentry.init({
      dsn: this.options.sentryDSN,
      integrations: [
        new Integrations.BrowserTracing({
          tracingOrigins: ["localhost", /^\//, /raida.+\.cloudcoin\.global/]
        }),
      ],
      release: "skyvaultjs@" + version,
      normalizeDepth: 10,
      sendDefaultPii: true,
      environment: "production",
      maxBreadcrumbs: 2000,
      autoSessionTracking: true,
      beforeBreadcrumb (breadcrumb, hint) {
        if (breadcrumb.category === 'console')
          return null

        if (breadcrumb.category === 'xhr') {
          breadcrumb.data.responseText = hint.xhr.responseText
        }
        return breadcrumb;
      },

      beforeSend(event, hint) {
        return event
      },

      tracesSampleRate: 1.0
    })

    let rqId = this.requestId
    Sentry.configureScope(function(scope) {
      scope.setTag("raida", "empty")
      scope.setTag("requestID", rqId)
    })


    Sentry.setContext("Request", {
      "raidaJSRequestID" : rqId
    })


    /*
    Sentry.withScope(function(scope) {
      console.log("CAPTURE")
      scope.setTag("raida", "14")
      scope.setLevel("warning")
      Sentry.captureException(new Error("my error"))
    })

      Sentry.captureMessage("Hello")
    */
  }

  addBreadCrumb(msg, data = null) {
    if (!this.options.sentryDSN)
      return

    Sentry.addBreadcrumb({
      category: 'custom',
      message: msg,
      level: 'info',
      type: 'user',
      data: {'rjsdata' : JSON.stringify(data) }
    });
  }

  addBreadCrumbEntry(msg, data = null) {
    if (!this.options.sentryDSN)
      return

    Sentry.addBreadcrumb({
      category: 'entry',
      message: msg,
      level: 'info',
      type: 'user',
      data: {'rjsdata' : JSON.stringify(data) }
    });
  }

  addBreadCrumbReturn(msg, data = null) {
    if (!this.options.sentryDSN)
      return

    Sentry.addBreadcrumb({
      category: 'return',
      message: msg,
      level: 'info',
      type: 'user',
      data: {'rjsdata' : JSON.stringify(data) }
    });
  }


  addBreadCrumbError(msg) {
    if (!this.options.sentryDSN)
      return

    Sentry.addBreadcrumb({
      category: 'custom',
      message: msg,
      level: 'error',
      type: 'user'
    });
  }

  addSentryError(msg, raida = "unknown", data = null) {
    if (!this.options.sentryDSN)
      return

    this.addBreadCrumbError("Reporting Error. RequestID " + this.requestId)
    Sentry.withScope(function(scope) {
      scope.setLevel("error")
      scope.setTag("raida", raida)
      scope.setExtra("raidaServer", raida)
      scope.setExtra("data", JSON.stringify(data))
      Sentry.captureException(new Error(msg))
    })
  }

  // Get denomination
  getDenomination(sn) {
    /*
    if (sn < 1)
      return 0

    if (sn < 2097153)
      return 1

    if (sn < 4194305)
      return 5

    if (sn < 6291457)
      return 25

    if (sn < 14680065)
      return 100

    if (sn < 16777217)
      return 250
*/
    return 1
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
    this._activeServers = []
    this.addBreadCrumbEntry("apiEcho")
let ab = new ArrayBuffer(19 + 5)
let d = new DataView(ab)
d.setUint8(5, 0x04)//command echo
d.setUint8(8, 0x01)//coin id
d.setUint8(12, 0xAB)// echo
d.setUint8(13, 0xAB)// echo
d.setUint8(15, 0x01)//udp number//udp number
d.setUint8(22, 0x3e)
  d.setUint8(23, 0x3e) // Trailing chars

    let rqs = this._launchRequests("echo", ab, callback)
    let rv = {
      status: 'done',
      code : SkyVaultJS.ERR_NO_ERROR,
      onlineServers : 0,
      totalServers: this._totalServers,
      serverStatuses: [],
      details : []
    }

    let mainPromise = rqs.then(response => {
      this._parseMainPromise(response, 0, rv, serverResponse => {

        if (serverResponse === "error" || serverResponse === "network")
          return
        let dView = new DataView(serverResponse)
        if (dView.getUint8(2) === 250){
          rv.serverStatuses[dView.getUint8(0)] = 1
          rv['onlineServers']++;
          this._activeServers.push(dView.getUint8(0))
        }
        else{
          rv.serverStatuses[dView.getUint8(0)] = 0
        }
      })

      this.addBreadCrumbReturn("apiEcho", rv)

      return rv
    })

    return mainPromise
  }

  // Detect
async  apiPown(params, callback = null) {
    this.addBreadCrumbEntry("apiDetect", params)

    if (!Array.isArray(params)) {
      console.error("Invalid input data")
      return null
    }

    let rqdata = this._formRequestData(params)



    // Launch Requests
    let rqs = this._launchRequests("multi_detect", rqdata, callback)

    let rv = this._getGenericMainPromise(rqs, params).then(response => {
      this.addBreadCrumbReturn("apiDetect", response)

      return response
    })


    return rv
  }

  async  apiDetect(params, callback = null) {
      this.addBreadCrumbEntry("apiDetect", params)

      if (!Array.isArray(params)) {
        console.error("Invalid input data")
        return null
      }

      let rqdata = this._formRequestData(params, false, 1)



      // Launch Requests
      let rqs = this._launchRequests("multi_detect", rqdata, callback)

      let rv = this._getGenericMainPromise(rqs, params).then(response => {
        this.addBreadCrumbReturn("apiDetect", response)

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


          let challange = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];


          let rqdata = [];
          let ab, d;

          for (let i = 0; i < this._totalServers; i++) {
            ab = new ArrayBuffer(24+35);
            d = new DataView(ab); //rqdata.push(ab)

            d.setUint8(ab.byteLength - 1, 0x3e);
            d.setUint8(ab.byteLength - 2, 0x3e); // Trailing chars

            d.setUint8(2, i); //raida id

            d.setUint8(5, 131); //command delete statement

            d.setUint8(8, 0x01); //coin id

            d.setUint8(12, 0xAB); // echo

            d.setUint8(13, 0xAB); // echo

            d.setUint8(15, 0x01); //udp number
            //body

            for (let x = 0; x < 16; x++) {
              d.setUint8(22 + x, challange[x]);
            }

            d.setUint32(38, coin.sn << 8); //rqdata[i].sns.push(coin.sn)

            for (let x = 0; x < 16; x++) {
              d.setUint8(41 + x, parseInt(coin.an[x].substr(x * 2, 2), 16));
            }
            rqdata.push(ab)
          }

    let rv = {
      'code' : SkyVaultJS.ERR_NO_ERROR,
      'text' : "Deleted successfully"
    }

    let a, e, f
    a = f = e = 0
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
    }else{
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_TIMESTAMP, "Missing Timestamp")
    }
    if('rows' in params){
      num_rows = params['rows']
    }
let challange = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16];
let guid = this._generatePan()
    let rqdata = []
    let ab, d;
    for (let i = 0; i < this._totalServers; i++) {
      ab = new ArrayBuffer(80);
      d = new DataView(ab); //rqdata.push(ab)
			d.setUint8(ab.byteLength -1, 0x3e)
				d.setUint8(ab.byteLength -2, 0x3e) // Trailing chars

        d.setUint8(2, i); //raida id
        d.setUint8(5, 130); //command show statement
        d.setUint8(8, 0x00); //coin id
        d.setUint8(12, 0xAB); // echo
        d.setUint8(13, 0xAB); // echo
        d.setUint8(15, 0x01);//udp number
        //body
        for (let x = 0; x < 16; x++) {
          d.setUint8(22 + x, challange[x]);
        }
        d.setUint32(38, coin.sn << 8); //rqdata[i].sns.push(coin.sn)
        for (let x = 0; x < 16; x++) {
          d.setUint8(41 + x, parseInt(coin.an[x].substr(x * 2, 2), 16));
        }
        if(num_rows != null)
        d.setUint8(57, num_rows)//rows
        else {
          d.setUint8(57, 1)
        }
        if(yr > 2000)
          yr = yr - 2000
        d.setUint8(58, yr)//year
        d.setUint8(59, mm)//month
        d.setUint8(60, dy)//day
        switch(i){
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

    /*
    for (let i = 0; i < this._totalServers; i++) {
      rqdata.push({
        'sn' : coin.sn,
        'an' : coin.an[i],
        'return' : 'all',
        'start_date': ts
      })
    }*/

    let rv = {
      'code' : SkyVaultJS.ERR_NO_ERROR,
      'text' : "Records returned",
      'records' : [],
      'balance': []

    }

    let e, a, f, n
    e = a = f = n = 0
    let statements = {}
    let serverResponses = []
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


          /*
          if (!Array.isArray(data)) {
            e++
            serverResponses.push(null)
            return
          }
*/
          serverResponses.push(serverResponse)
          if(dView.byteLength > 16){
let offset = 16
let nonmemo= 31
let unread = true
while(unread){
let data = new DataView(serverResponse, offset)
          let mparts = []
          let key = ""
          let memosize = 0
           for (let r = 0; r < 16; r++) {
             key += data.getUint8(r).toString(16)
           }
            //let key = ldata.statement_id
            if (!(key in statements)) {
              statements[key] = {}
              statements[key]['type'] = data.getUint8(16)
              statements[key]['amount'] = data.getUint32(17)
              statements[key]['balance'] = data.getUint32(21)
              statements[key]['time'] = new Uint8Array(serverResponse,25+offset,6)
              statements[key]['guid'] = key
              statements[key]['mparts'] = []
            }


            let x = 0;
            let memobytes = [];
            //let endcheck = data.getUint16(nonmemo + x);

            while (x < 50){//endcheck != 0) {
              memobytes.push(data.getUint8(nonmemo + x));
              x++;
              //endcheck = data.getUint16(nonmemo + x);
            }

            statements[key]['mparts'][rIdx] = memobytes;
            offset = offset + nonmemo + x;//+2;
            if(offset == serverResponse.byteLength)
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

        if(dView.getUint8(2) == 120){
          n++
        }

        serverResponses.push(null)
        e++
      })

      let result = this._gradeCoin(a, f, e)
      if(n > 20)
        return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_RECORD_NOT_FOUND, "No Statements found");
        if (!this._validResult(result)){
          let er = this._getErrorCode(SkyVaultJS.ERR_RESPONSE_TOO_FEW_PASSED, "Failed to read statements. Too many error responses from RAIDA");
          this._addDetails(er, serverResponses);
          return er;
        }
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
    this.addBreadCrumbEntry("apiCreateRecord", params)
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
      'guid' : guid,
      'memo' : memo,
      'amount' : amount,
      'initiator_id' : iid,
      'initiator_image_url' : iimage_url,
      'initiator_description_url' : idescription_url,
      'initiator_type' : itype
    })
    for (let i = 0; i < this._totalServers; i++) {
      rqdata.push({
        'account_sn' : coin.sn,
        'account_an' : coin.an[i],
        'transaction_id': guid,
        'version': 0,
        'compression' : 0,
        'raid' : '110',
        'stripe' : tags[i]['stripe'],
        'mirror' : tags[i]['mirror1'],
        'mirror2' : tags[i]['mirror2']
      })
    }

    let rv = {
      'code' : SkyVaultJS.ERR_NO_ERROR,
      'guid' : guid,
      'text' : "Created successfully"
    }

    let passed = 0
    let a, f, e
    a = f = e = 0
    let rqs = this._launchRequests("statements/create", rqdata, 'GET', callback)
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

    this.addBreadCrumbReturn("apiCreateStatement", rv)

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
    this.addBreadCrumbEntry("apiDeleteSkyWallet", params)

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

    let url =  "https://" + this.options.ddnsServer + "/service/ddns/ddns_delete_nv.php?"
    url += "sn=" + coin.sn + "&username=" + name  + "&raidanumber=" + rquery
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

    this.addBreadCrumbReturn("apiDeleteSkyWallet", "done")
    return {
      // Legacy
      'code' : SkyVaultJS.ERR_NO_ERROR,
      'text' : "Registered Successfully"
    }

  }

  // Register DNS
  async apiRegisterSkyWallet(params, callback = null) {
    this.addBreadCrumbEntry("apiRegisterSkyWallet", params)

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
/*
    let tdata = await this._getDefaultTicket(params['coin'], callback)
    if (tdata == null) {
        return this._getErrorCode(SkyVaultJS.ERR_FAILED_TO_GET_TICKETS, "Failed to get ticket from RAIDA" + this.options.defaultRaidaForQuery + " and backup raida " + this.options.defaultRaidaForBackupQuery)
    }

    let ticket = tdata[0]
    let rquery = tdata[1]

    console.log("got ticket " + ticket)
*/
    let rquery = 0

    if (callback != null)
      callback(0, "register_dns")

    let url =  "http://" + this.options.ddnsServer + "/service/ddns/ddns_nv.php?"
    url += "sn=" + coin.sn + "&username=" + name  + "&raidanumber=" + rquery
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

    this.addBreadCrumbReturn("apiRegisterSkyWallet", "done")
    return {
      // Legacy
      'status' : 'done',

      'code' : SkyVaultJS.ERR_NO_ERROR,
      'text' : "Registered Successfully"
    }
  }

  // View receipt
  async apiViewreceipt(params, callback = null) {
    this.addBreadCrumbEntry("apiViewReceipt", params)

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

    let rqs = this._launchRequests("view_receipt", rqdata, 'GET', callback)
    let rv = {
      status : 'done',
      code: SkyVaultJS.ERR_NO_ERROR,
      sns : {},
      details : [],
      total : 0
    }
    let mainPromise = rqs.then(response => {
      for (let i = 0; i < response.length; i++) {
        if (typeof(response[i].value) == 'undefined')
          continue

        if (typeof(response[i].value.data) != 'object')
          continue

        response[i].value.data.status = "pass"
      }

      this._parseMainPromise(response, 0, rv, serverResponse => {
        if (typeof(serverResponse) != 'object')
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
        rv.total += this.getDenomination(sn)

      return rv

    })

    return mainPromise
  }

  // Get Ticket (no multi)
  async apiGetticket(params, callback = null) {
    this.addBreadCrumbEntry("apiGetTicket", params)

    let coin = params
    if (!this._validateCoin(coin)) {
      return this._getError("Failed to validate params")
    }
/*
    let rqdata = []
    for (let i = 0; i < this._totalServers; i++) {
      rqdata.push({
        sn: coin.sn,
        nn: coin.nn,
        an: coin.an[i],
        pan: coin.pan[i],
        denomination: this.getDenomination(coin.sn),
      })
    }*/
    let rqdata = this._formRequestData([coin], false, 11)

    let rqs = this._launchRequests("get_ticket", rqdata, callback)
    let rv = {
      status : 'done',
      code: SkyVaultJS.ERR_NO_ERROR,
      tickets : []
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
          if(status == 250 || status == 241 || status == 243 && mixed == 1)
          rv.tickets.push(dView.getUint32(3))
          else{
            rv.tickets.push("error")
          }
        }
      })

      return rv
    })

    return mainPromise
  }

  // SuperFix
  /*
  async _realSuperFix(rIdx, coins, callback = null) {
    let rqdata = this._formRequestData(coins)

    let rv = {
      'fixedcoins' : []
    }

    rqs = this._launchRequests("multi_detect", rqdata, callback)
    let resultData = await this._getGenericBriefMainPromise(rqs, coins)
    console.log("mdata")
    console.log(resultData)
    if (resultData.status != "done") {
      rv.notfixed = coins.length
      return rv
    }

    if (!('tickets' in resultData)) {
      return rv
    }

    console.log(resultData)
    let sns = []
    let pans = []
    let tickets = []
    for (let sn in resultData['result']) {
      let coin = resultData['result'][sn]
      if (coin.result != this.__frackedResult) {
        continue
      }

      sns.push(coin.sn)
      pans.push(coin.an[rIdx])
    }

    if (sns.length == 0)
      return rv

    for (let i = 0; i < this._totalServers; i++) {
      let ticket = resultData.tickets[i]

      if (!ticket || i == rIdx) {
        tickets[i] = false
        continue
      }

      tickets[i] = ticket
    }

    rqdata = []
    for (let i = 0; i < this._totalServers; i++) {
      rqdata[i] = {
        'sn' : sns,
        'pan' : pans,
        'r' : tickets
      }
    }

    let a, f, e
    a = f = e = 0
    console.log("Doing sfix")
    console.log(rqdata)
    let rqs = this._launchRequests("super_fix", rqdata, 'GET', callback, [rIdx])
    let sfixResultData = await this._getGenericBriefMainPromise(rqs, coins)
    if (sfixResultData.status != "done") {
      return rv
    }

    for (let sn in sfixResultData.result) {
      let result = sfixResultData.result[sn]

      if (result.authentic == 1) {
        rv.fixedcoins.push(sn)
      }
    }

    return rv
  }
*/
  // FixFracked
  async apiFixfracked(params, callback = null) {
    this.addBreadCrumbEntry("apiFixFracked", params)

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
/*
      let fc = 0
      let needSuperfix = false
      for (let x = 0; x < this._totalServers; x++) {
        if (coin.pownArray[x] == 'f') {
          fc++
          if (fc == 5) {
            superfixCoins.push(coin)
            needSuperfix = true
            break
          }
          //coin.an[x] = this._generatePan()
          //coin.pan[x] = coin.an[x]
        } else {
          fc = 0
        }
      }

      if (needSuperfix)
        continue
*/
      coins.push(coin)
    }

    let rv = {
      status: 'done',
      code: SkyVaultJS.ERR_NO_ERROR,
      totalNotes: coins.length,
      fixedNotes: 0,
      result : {},
    }
/*
    // Coins for Superfix. Very slow.
    if (superfixCoins.length > 0) {
      for (let i = 0; i < this._totalServers; i++) {
        let ctfix = []
        for (let j = 0; j < superfixCoins.length; j++) {
          if (superfixCoins[j].pownArray[i] != 'f')
            continue;

          ctfix.push(superfixCoins[j])
        }

        if (ctfix.length != 0) {
          // Doing SuperFix
          let srv = await this._realSuperFix(i, ctfix, callback)

          for (let v = 0; v < srv.fixedcoins.length; v++) {
            let sn = srv.fixedcoins[v]
            // Find coin by SN
            for (let c = 0; c < superfixCoins.length; c++) {
              if (superfixCoins[c].sn == sn) {
                superfixCoins[c].an[i] = superfixCoins[c].pan[i]
                superfixCoins[c].pownArray[i] = 'p'
              }
            }
          }
        }
      }
    }
*/
    // Round 1
    for (let i = 0; i < this._totalServers; i++) {
      let ctfix = []
      for (let j = 0; j < coins.length; j++) {
        if (coins[j].pownArray[i] != 'f')
          continue;

        ctfix.push(coins[j])
      }

      if (ctfix.length != 0) {
        await this._realFix(0, i, ctfix, callback)
      }
    }

    // Round 2
    for (let i = this._totalServers - 1; i >= 0; i--) {
      let ctfix = []
      for (let j = 0; j < coins.length; j++) {
        if (coins[j].pownArray[i] != 'f')
          continue;

        ctfix.push(coins[j])
      }
      if (ctfix.length != 0) {
        await this._realFix(1, i, coins, callback)
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

    // Append SuperFix results
    for (let i = 0; i < superfixCoins.length; i++) {
      a = c = e = 0
      // Go over pownArray
      for (let j = 0; j < superfixCoins[i].pownArray.length; j++) {
        if (superfixCoins[i].pownArray[j] == 'p')
          a++;
        else if (superfixCoins[i].pownArray[j] == 'f')
          c++;
        else
          e++;

        superfixCoins[i].pownstring += superfixCoins[i].pownArray[j]
        superfixCoins[i].errors = e
        superfixCoins[i].authentic = a
        superfixCoins[i].counterfeit = c
      }

      delete superfixCoins[i].pownArray
      delete superfixCoins[i].pan
      if (c == 0 && e == 0) {
        superfixCoins[i].result = "fixed"
        rv.fixedNotes++
      }

      rv.result[superfixCoins[i].sn] = superfixCoins[i]
    }


    this.addBreadCrumbReturn("apiFixFracked", rv)
    return rv
  }

  // Get CC by Card Number and CVV
  async apiGetCCByCardData(params) {
    this.addBreadCrumbEntry("apiGetCCByCardData", params)

    if (!('cardnumber' in params))
      return this._getError("Card Number is not defined")

    if (!('cvv' in params))
      return this._getError("CVV is not defined")

    if (!('username' in params))
      return this._getError("Username is not defined")

    let cardNumber = params['cardnumber']
    let cvv = params['cvv']
    let username = params['username']
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
      'cc' : {
        nn: 1,
        sn: sn,
        an: ans
      }
    }

    this.addBreadCrumbReturn("apiGetCCByCardData", rv)
    return rv

  }

  // Greates a CloudCoin by Username, Password and Email
  async apiCreateCCForRegistration(params) {
    this.addBreadCrumbEntry("apiCreateCCForRegistration", params)

    if (!('sn' in params))
      return this._getError("SN is not defined")

    if (!('password' in params))
      return this._getError("Password is not defined")


    let password = params['password']
    //let email = params['email']
    if (password.length < this.options.minPasswordLength)
      return this._getError("Password length must be at least 16 characters")

    let sn = params['sn']
    let finalStr = ""
    let tStr = "" + CryptoJS.MD5(password)
    let tChars = tStr.split('');
    for (let c = 0; c < tChars.length; c++) {
      let cs = parseInt(tChars[c], 16)
      finalStr += cs
    }

     // Generating rand and pin from the password
    const rand = finalStr.slice(0, 12);
    const pin = finalStr.slice(12, 16);
    const pans = [];
    for (let i = 0; i < 25; i++) {
      const seed = '' + i + sn + rand + pin;
      const p = '' + CryptoJS.MD5(seed);

      const p0 = p.substring(0, 24);
      let component = '' + sn + '' + i;
      component = '' + CryptoJS.MD5(component);
      const p1 = component.substring(0, 8);
      pans[i] = p0 + p1;
    }

    const grv = {
      "status": "done",
      "pans" : pans,
      "rand" : rand,
      "cvv" : pin
    };

    this.addBreadCrumbReturn("apiCreateCCForRegistration", grv)

    return grv;
  }

  // Get CC by username and Password
  async apiGetCCByUsernameAndPassword(params) {
    this.addBreadCrumbEntry("apiGetCCByUsernameAndPassword", params)

    if (!('username' in params))
      return this._getError("Username is not defined")

    if (!('password' in params))
      return this._getError("Password is not defined")

    let username = params['username']
    let password = params['password']
    if (password.length < this.options.minPasswordLength)
      return this._getError("Password length must be at least 16 characters")

    let name = await this._resolveDNS(username)
    if (name == null)
      return this._getError("Failed to resolve DNS")

    let sn = name
    let finalStr = ""
    let tStr = "" + CryptoJS.MD5(password)
    let tChars = tStr.split('');
    for (let c = 0; c < tChars.length; c++) {
      let cs = parseInt(tChars[c], 16)
      finalStr += cs
    }

    // Generating rand and pin from the password
    let rand = finalStr.slice(0, 12)
    let pin = finalStr.slice(12, 16)
    let pans = []
    for (let i = 0; i < this._totalServers; i++) {
      let seed = "" + i + sn + rand + pin

      const p0 = p.substring(0, 24);
      let component = '' + sn + '' + i;
      component = '' + CryptoJS.MD5(component);
      const p1 = component.substring(0, 8);
      pans[i] = p0 + p1;



      //pans[i] = "" + CryptoJS.MD5(seed)
    }

    let cc = {
      'sn' : sn,
      'nn' : 1,
      'an' : pans
    }

    let rvFinal = {
      'status' : 'done',
      'cc' : cc
    }

    this.addBreadCrumbReturn("apiGetCCByUsernameAndPassword", rvFinal)

    return rvFinal

  }

  async apiLoginByUsernameAndPassword(params){
    let cred = await this.apiGetCCByUsernameAndPassword(params)

    let rv =
      {
        'status' : 'unknown',
        'cc' : cred.cc
      }
      let detect = await this.apiDetect([cred.cc])
      rv.details = detect
      if(detect.details.authenticNotes > 0 || detect.details.frackedNotes > 0)
        rv.status = 'success'
      else
        rv.status = 'failure'

  }

 readCCFile(file){//pass in an arraybuffer
  this.addBreadCrumbEntry("apiReadCCFile")
  if (!(file instanceof ArrayBuffer)) {
    return this._getError("file is not passed in as ArrayBuffer")
  }
  let d = new DataView(file)
let offset = 32
let eof = false
let ccs = []
while(!eof){

  let ans = []
  let an = ""
  let sn = d.getUint32(offset) >>>8
  for(let x = 0; x < 25; x++){
    an = ""
    for(let y = 0; y < 16; y++){
      let pos = offset + y + (x * 16) + 16
      if (d.getUint8(pos) < 16) an += "0";
      an += d.getUint8(pos).toString(16);
    }
    ans.push(an)
  }
  let cc = {sn:sn,an:ans}
  ccs.push(cc)
  offset += 416
  if(offset>= file.byteLength)
  eof = true
}



  let rv = {
    'status' : 'done',
    'code' : 0,
    'cc': ccs
  }

  return rv
}

  // extract stack from PNG
  async extractStack(params) {
    this.addBreadCrumbEntry("apiExtractStack", params)

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
    if (typeof(idx) == 'string')
      return this._getError(idx)

    let fu8
    fu8 = imgData.slice(idx + 4)

    let i = 0
    let length
    while (true) {
      length = this._getUint32(fu8, i)
      let signature = String.fromCharCode(fu8[i + 4]) +  String.fromCharCode(fu8[i + 5])
        + String.fromCharCode(fu8[i + 6]) +  String.fromCharCode(fu8[i + 7])

      if (length == 0) {
        i += 12
        if (i >= fu8.length) {
          return this._getError("CloudCoin was not found")
          break
        }
        continue
      }

      if (signature == 'cLDc') {
        let crcSig = this._getUint32(fu8, i + 8 + length)
        let calcCrc = this._crc32(fu8, i + 4, length + 4)
        if (crcSig != calcCrc) {
          return this._getError("Corrupted PNG. Invalid Crc32")
        }

        break
      }

      // length + type + crc32 = 12 bytes
      i += length + 12
      if (i > fu8.length) {
        return this._getError("CloudCoin was not found")
        break
      }

    }

    let data = fu8.slice(i + 8, i + 8 + length)
    let sdata = ""
    for (let i = 0; i < data.length; i++)
      sdata += String.fromCharCode(data[i])

    let o
    try {
      o = JSON.parse(sdata)
    } catch(e) {
      return this._getError("Failed to parse CloudCoin JSON")
    }

    let rv = {
      'status' : 'done',
      ...o
    }

    return rv
  }

  async apiFindAddress(sn) {
    let so = sn >>> 16;
    let to = sn >>> 8 & 0xff;
    let lo = sn & 0xff;
    let ip = "1." + so + '.' + to + '.' + lo;

  }

  // Restore Card
  async apiRestoreCard(params, callback = null) {
    if (!('username' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_DNS_NAME, "Username is not defined")

    let username = params['username']
    let sn = await this._resolveDNS(username)
    if (sn == null)
      return this._getErrorCode(SkyVaultJS.ERR_DNS_RECORD_NOT_FOUND, "Failed to resolve SkyWallet")

    params.sn = sn
    let rv = await this.apiCreateCCForRegistration(params)
    if (rv.status != "done")
      return rv

    let precardNumber = "401" + rv.rand
    let reverse = precardNumber.split("").reverse().join("");
    let total = 0;
    for (let i = 0; i < reverse.length; i++) {
      let num = parseInt(reverse.charAt(i))
      if ((i + 3) % 2) {
        num *= 2
        if (num > 9)
          num -= 9
      }

      total += num;
    }

    let remainder = 10 - (total % 10);
    if (remainder == 10)
      remainder = 0

    let cardNumber = precardNumber + remainder
    if (!this._validateCard(cardNumber, rv.cvv))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_CARD, "Invalid Card")

    let fiveYearsFromNow = new Date();
    fiveYearsFromNow.setFullYear(fiveYearsFromNow.getUTCFullYear() + 5);
    let month = fiveYearsFromNow.getUTCMonth() + 1;
    if (month < 10)
      month = "0" + month

    let year = fiveYearsFromNow.getUTCFullYear().toString().substr(-2);
    let ed = month + '/' + year

    let data = {
      'cardnumber' : cardNumber,
      'cvv': rv.cvv,
      'username' : username,
      'expiration_date' : ed
    }

    let res = await this.apiGenerateCard(data, callback)
    if (res.code != SkyVaultJS.ERR_NO_ERROR)
      return res

    rv = {
      'code' : SkyVaultJS.ERR_NO_ERROR,
      'cardnumber' : cardNumber,
      'cvv': rv.cvv,
      'expiration_date': ed,
      'data': ''
    }


    return rv

  }

  // Generates a PNG Card
  async apiGenerateCard(params, callback = null) {
    this.addBreadCrumbEntry("apiGenerateCard", params)

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
      template: ddata
    }

    let bdata = await this.embedInImage(esparams)
    if ('status' in params && params.status == 'error')
      return this._getErrorCode(SkyVaultJS.ERR_FAILED_TO_EMBED_STACK, "Failed to embed stack")


    let rv = {
      'code' : SkyVaultJS.ERR_NO_ERROR,
      'text' : 'Card Generated',
      'data' : bdata
    }

    return rv

  }

  async apiDrawCardData(data, username, cardnumber, cvv, ed, ip) {
    let c
    try {
      c  = await require('canvas')
      if (!c)
        return this._getErrorCode(SkyVaultJS.ERR_NO_CANVAS_MODULE, "Canvas module not found")
    } catch(e) {
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
      context.fillText( "CVV (Keep Secret): " + cvv, 64, 675);
      context.fillStyle = "#FFFFFF";
      context.lineStyle = "#FFFFFF";
      context.font = "18px sans-serif";
      context.fillText( "IP " + ip, 174, 736);

      return canvas.toDataURL()
    })



    return pm
  }

  // embed stack into image
  async embedInImage(params) {
    this.addBreadCrumbEntry("apiEmbedInImage", params)

    if (!'template' in params) {
      return this._getError("Template is not defined")
    }

    if (!'coins' in params) {
      return this._getError("Invalid input data. No coins")
    }

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
    let data = { "cloudcoin" : params['coins'] }
    data = JSON.stringify(data)

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
    if (typeof(idx) == 'string')
      return this._getError(idx)

    let fu8, lu8, myu8
    fu8 = imgData.slice(0, idx + 4)
    lu8 = imgData.slice(idx + 4)

    let ccLength = data.length

    // length + type + crc32 = 12 bytes
    myu8 = new Uint8Array(ccLength + 12)

    // Length
    this._setUint32(myu8, 0, ccLength)

    // Chunk type cLDc
    myu8[4] = 0x63
    myu8[5] = 0x4c
    myu8[6] = 0x44
    myu8[7] = 0x63

    let tBuffer = Buffer.from(data)
    // Data
    for (let i = 0; i < ccLength; i++) {
      myu8[i + 8] = tBuffer.readUInt8(i)
    }

    // Crc32
    let crc32 = this._crc32(myu8, 4, ccLength + 4)
    this._setUint32(myu8, ccLength + 8, crc32)

    let combined = [...fu8, ...myu8, ...lu8]

    return this._base64ArrayBuffer(combined)
  }

  // Send
  async apiSend(params, callback = null) {
    this.addBreadCrumbEntry("apiSend", params)

    this._rarr = {}
    //this.addSentryError("superError", 19, {'xxx':'yyy'})

    if (!'coins' in params) {
      return this._getError("Invalid input data. No coins")
    }

    if (!Array.isArray(params['coins'])) {
      return this._getError("Invalid input data. Coins must be an array")
    }

    if (!'to' in params) {
      return this._getError("Invalid input data. To is not defined")
    }

    // To address
    let to = params['to'] + ""
    if (to.match(/^\d+$/) && (to > 0 || to < 16777216)) {

    } else {
      to = await this._resolveDNS(params['to'])
      if (to == null) {
        return this._getError("Failed to resolve DNS name: " + params.to)
      }
    }

    let amount = 0;
		let amountNotes = 0;

    for (let i in params.coins) {
      let cc = params.coins[i];
      amount += this.getDenomination(cc.sn);
			amountNotes++;
    }

    let rqdata = []
    let memo = 'memo' in params ? params['memo'] : "Send"
    let from = "SkyVaultJS"

    let guid = this._generatePan()
    let times = new Date(Date.now());
    let tags = this._getObjectMemo(guid, memo, amount, from)
    // Assemble input data for each Raida Server
    let ab, d;
    for (let i = 0; i < this._totalServers; i++) {
      ab = new ArrayBuffer(35 + (19 * amountNotes) + 27 + 50 + 5);
      d = new DataView(ab); //rqdata.push(ab)
			d.setUint8(ab.byteLength -1, 0x3e)
				d.setUint8(ab.byteLength -2, 0x3e) // Trailing chars

      for (let j = 0; j < params['coins'].length; j++) {
        let coin = params['coins'][j]
        if ('an' in coin) {
          for (let x = 0; x < coin.an.length; x++) {
            if (coin.an[x] == null)
              coin.an[x] = this._generatePan()
          }
        }

        if (!this._validateCoin(coin)) {
          return this._getError("Invalid coin. Idx " + j)
        }
        d.setUint8(2, i); //raida id
        d.setUint8(5, 100); //command deposit
        d.setUint8(8, 0x01); //coin id
        d.setUint8(12, 0xAB); // echo
        d.setUint8(13, 0xAB); // echo
        d.setUint8(15, 0x01);//udp number
        //body
        d.setUint32(38 + (j * 19), coin.sn << 8); //rqdata[i].sns.push(coin.sn)

        for (let x = 0; x < 16; x++) {
          d.setUint8(38 + (j * 19) + (3 + x), parseInt(coin.an[i].substr(x * 2, 2), 16));
        }

      }
      d.setUint32(38 + (amountNotes * 19), to << 8)//owner
      for (let x = 0; x < 16; x++) {
        d.setUint8(41 + (amountNotes * 19) + x, parseInt(guid.substr(x * 2, 2), 16));
      }//transaction guid

      d.setUint8(57 + amountNotes * 19, times.getUTCFullYear() - 2000)//year
      d.setUint8(58 + amountNotes * 19, times.getUTCMonth())//month
      d.setUint8(59 + amountNotes * 19, times.getUTCDate())//day
      d.setUint8(60 + amountNotes * 19, times.getUTCHours())//hour
      d.setUint8(61 + amountNotes * 19, times.getUTCMinutes())//minute
      d.setUint8(62 + amountNotes * 19, times.getUTCSeconds())//second

      rqdata.push(ab)
    }

    // Launch Requests
    let rqs = this._launchRequests("send", rqdata, callback)
    let rv = this._getGenericMainPromise(rqs, params['coins']).then(result => {
      result.transaction_id = guid
      if (!('status' in result) || result.status != 'done')
        return result

/*
      let sns = []
      for (let sn in result.result) {
        let cr = result.result[sn]
        if (cr.result == this.__errorResult) {
          console.log("adding to send again " +sn)
          sns.push(sn)
        }
      }

      // Need to call SendAgain
      if (sns.length > 0) {
        console.log("Need to call sendagain")
        let nrqdata = []
        for (let i = 0; i < this._totalServers; i++) {
          nrqdata.push({
            b : 't',
            sns: [],
            nns: [],
            ans: [],
            pans: [],
            dn: [],
            to_sn: to,
            tag: tags[i]
          })
          for (let j = 0; j < params['coins'].length; j++) {
            let coin = params['coins'][j]

            if (!sns.includes(coin.sn))
              continue

            nrqdata[i].sns.push(coin.sn)
            nrqdata[i].nns.push(coin.nn)
            nrqdata[i].ans.push(coin.an[i])
            nrqdata[i].pans.push(coin.pan[i])
            nrqdata[i].denomination.push(this.getDenomination(coin.sn))
          }
        }

        let rqs = this._launchRequests("sendagain", nrqdata, 'POST', callback)
        let coins = new Array(sns.length)
        sns.forEach((value, idx) => {
          coins[idx] = { sn: value, nn: this.options.defaultCoinNn }
        })

        let response = this._getGenericBriefMainPromise(rqs, coins).then(response => {
          // Merging results from 'send' and 'send_again'
          result.errorNotes -= sns.length
          result.authenticNotes += response.authenticNotes
          result.counterfeitNotes += response.counterfeitNotes
          result.frackedNotes += response.frackedNotes
          result.errorNotes += response.errorNotes

          for (let sn in response.result) {
            result.result[sn] = response.result[sn]
          }

          this.addBreadCrumbReturn("apiSend", result)
          return result
        })

        return response
      }*/

      this.addBreadCrumbReturn("apiSend", result)
      return result
    })

    let pm = new Promise((resolve, reject) => {
      setTimeout(() => {
        //this._fixTransfer()
      }, 500)
    })

    return rv
  }

  // Receive
  async apiReceive(params, callback = null) {
    this.addBreadCrumbEntry("apiReceive", params)

    let coin = this._getCoinFromParams(params)
    if (coin == null)
      return this._getError("Failed to parse coin from params")

/*
    let changeMakerId = this.options.changeMakerId
    if ('changeMakerId' in params) {
      changeMakerId = params['changeMakerId']
    }
*/
    let gcRqs = await this._getCoins(coin, callback)
    if ('code' in gcRqs && gcRqs.code == SkyVaultJS.ERR_COUNTERFEIT_COIN)
        return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_TOO_FEW_PASSED, "The coin is counterfeit")

    let sns = Object.keys(gcRqs.coins)

    if (!('amount' in params)) {
      params.amount = this._calcAmount(sns)
    }

    if (params.amount > this._calcAmount(sns)) {
      return this._getError("Not enough coins")
    }

    let rvalues = this._pickCoinsAmountFromArrayWithExtra(sns, params.amount)
    let coinsToReceive = rvalues.coins
    /*
    let changeCoin = rvalues.extra

    let changeRequired
    if (changeCoin !== 0) {
      let csns = await this.apiBreakInBank(rvalues.extra, coin, callback)
      if (csns.length == 0) {
        return  this._getError("Failed to break in bank")
      }

      coinsToReceive = coinsToReceive.concat(csns)

      // extra will tell us if we need change
      rvalues = this._pickCoinsAmountFromArrayWithExtra(coinsToReceive, params.amount)
      coinsToReceive = rvalues.coins
      changeCoin = rvalues.extra
      if (changeCoin !== 0) {
        return  this._getError("Failed to pick coins after break in bank")
      }

      changeRequired = true
    } else {
      changeRequired = false
    }
    */

    let rqdata = []
    let challange = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16];
    let nns = new Array(coinsToReceive.length)
    nns.fill(this.options.defaultCoinNn)
    let guid = this._generatePan();
    let times = new Date(Date.now())

    let response
    if (coinsToReceive.length > 0) {
      // Assemble input data for each Raida Server
      let ab, d;
      let seed
      if('seed' in params){
        seed = params['seed']
      }
      for (let i = 0; i < this._totalServers; i++) {
        if(seed != null)
        coin.pan[i] = md5(i.toString()+seed)
        ab = new ArrayBuffer(35 + (3 * coinsToReceive.length) + 58 + 50 + 5);
        d = new DataView(ab); //

        d.setUint8(ab.byteLength - 1, 0x3e);
        d.setUint8(ab.byteLength - 2, 0x3e); // Trailing chars
          d.setUint8(2, i); //raida id
          d.setUint8(5, 104); //command withdraw
          d.setUint8(8, 0x01); //coin id
          d.setUint8(12, 0xAB); // echo
          d.setUint8(13, 0xAB); // echo
          d.setUint8(15, 0x01)//udp number; //udp number
          //body
          for (let x = 0; x < 16; x++) {
            d.setUint8(22 + x, challange[x]);
          }
          d.setUint32(38, coin.sn << 8); //owner

          for (let x = 0; x < 16; x++) {
            d.setUint8(41 +  x, parseInt(coin.an[i].substr(x * 2, 2), 16));
          }

          for (let j = 0; j < coinsToReceive.length; j++) d.setUint32(57 + j * 3, coinsToReceive[j] << 8);

          for (let x = 0; x < 16; x++) {
            d.setUint8(57 + coinsToReceive.length * 3 + x, parseInt(coin.pan[i].substr(x * 2, 2), 16));
          } //pan generator


          for (let x = 0; x < 16; x++) {
            d.setUint8(73 + coinsToReceive.length * 3 + x, parseInt(guid.substr(x * 2, 2), 16));
          } //transaction guid
          d.setUint8(89 + coinsToReceive.length * 3, times.getUTCFullYear() - 2000)//year
          d.setUint8(90 + coinsToReceive.length * 3, times.getUTCMonth())//month
          d.setUint8(91 + coinsToReceive.length * 3, times.getUTCDate())//day
          d.setUint8(92 + coinsToReceive.length * 3, times.getUTCHours())//hour
          d.setUint8(93 + coinsToReceive.length * 3, times.getUTCMinutes())//minute
          d.setUint8(94 + coinsToReceive.length * 3, times.getUTCSeconds())//second

          d.setUint8(95 + coinsToReceive.length * 3, 1);
          rqdata.push(ab)
      } // Launch Requests

      // Launch Requests
      let rqs = this._launchRequests("receive", rqdata, callback)

      let coins = new Array(coinsToReceive.length)
      coinsToReceive.forEach((value, idx) => {
        coins[idx] = { sn: value, nn: this.options.defaultCoinNn }
      })

      response = await this._getGenericMainPromise(rqs, coins)
      response.transaction_id = guid
      response.changeCoinSent = 0
      //response.changeRequired = false
      for (let k in response.result) {
        if(!('an' in response.result[k]))
        response.result[k].an = [];
        for (let i = 0; i < 25; i++){
        let newpan = md5(i.toString() + response.result[k]['sn'].toString() + coin.pan[i]);
        response.result[k].an[i] = newpan;
      };
      }

      this.addBreadCrumbReturn("apiReceive", response)
      return response
    //} else if (changeCoin === 0) {
    //  return this._getError("No coins to receive")
    } else {
      response = {
        totalNotes: 0, authenticNotes: 0, counterfeitNotes: 0, errorNotes: 0, frackedNotes: 0, result: {}
      }

      this.addBreadCrumbReturn("apiReceive", response)
      return response
    }

  }


  // BreakInBank
  async apiBreakInBank(extraSn, idcc, callback) {
    this.addBreadCrumbEntry("apiBreakInBank", {'extraSn' : extraSn, 'idcc' : idcc})

    let csns = []

    let scResponse = await this.showChange({
      nn: this.options.defaultCoinNn,
      sn: this.options.changeMakerId,
      denomination: this.getDenomination(extraSn)
    }, callback)

    let d100s = Object.keys(scResponse.d100)
    let d25s = Object.keys(scResponse.d25)
    let d5s = Object.keys(scResponse.d5)
    let d1s = Object.keys(scResponse.d1)

    let vsns
    switch (this.getDenomination(extraSn)) {
      case 250:
        vsns = this._get250E(d100s, d25s, d5s, d1s)
        break;
      case 100:
        vsns = this._get100E(d25s, d5s, d1s)
        break;
      case 25:
        vsns = this._get25B(d5s, d1s)
        break;
      case 5:
        vsns = this._getA(d1s, 5)
        break;
      default:
        console.log("Failed to get denomination for coin " + extraSn)
        return csns
    }

    // Assemble input data for each Raida Server
    let rqdata = []

    let ab, d;
		for (let i = 0; i < this._totalServers; i++) {
		ab = new ArrayBuffer(35 + 19 +6 + (3*vsns.length) + 5);
		d = new DataView(ab);
		 // Trailing chars
			d.setUint8(2, i) //raida id
			d.setUint8(5, 123);//command break in bank
			d.setUint8(8, 0x00);//coin id
			d.setUint8(12, 0xAB);// echo
			d.setUint8(13, 0xAB);// echo
			d.setUint8(15, 0x01)//udp number;//udp number
			d.setUint32(38, idcc.sn<<8)
			for (let x = 0; x < 16; x++) {
				d.setUint8(38+(3+x), parseInt(idcc.an[i].substr(x*2, 2), 16))
			}
      d.setUint32(57, extraSn<<8)
      d.setUint32(60, this.options.changeMakerId<<8)
      for (let j = 0; j < vsns.length; j++) {
        d.setUint32(63 + j * 3, vsns[j] << 8);
      }
      d.setUint8(ab.byteLength -1, 0x3e);
  			d.setUint8(ab.byteLength -2, 0x3e);
			rqdata.push(ab)
		}

    let response = await this._launchRequests("break_in_bank", rqdata, callback)
    let p = 0
    let rv = await this._parseMainPromise(response, 0, {}, response => {
      if (response == "error" || response == "network")
        return
        let dView = new DataView(response);
        if (dView.getUint8(2) === 250) {
        p++
      }
    })

    if (p >= 17) {
      this.addBreadCrumbReturn("apiBreakInBank", vsns)
      return vsns
    }

    console.log("Not enough positive responses from RAIDA: " + p)
    return []

  }

  // Used to pay money to a merchant
  async apiPay(params, callback = null) {
    this.addBreadCrumbEntry("apiPay", params)

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

    let meta = ""
    meta += "from = \"" + from + "\"\n"
    meta += "message = \"" + memo + "\"\n"
    meta = btoa(meta)

    params.memo = guid

    let rv = this.apiTransfer(params, callback).then(response => {
      if (response.status == "error")
        return response

      response.guid = guid
      let rAx = axios.create()
      let mParams = {
        'merchant_skywallet' : merchant_address,
        'sender_skywallet': sender_address,
        'meta' : meta,
        'guid' : guid
      }
      let options = {
        timeout : this.options.timeout
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


  // BillPay
  async apiBillPay(params, callback = null) {
    this.addBreadCrumbEntry("apiBillPay", params)

    if (!('coin' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_COIN, "Coin is missing")

    let coin = params['coin']
    if (!this._validateCoin(coin))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_COIN, "Failed to validate coin")

    let guid = this._generatePan()
    if ('guid' in params) {
      guid = params['guid']
      if (!this._validateGuid(guid)) {
        return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_GUID, "Failed to validate GUID")
      }
    }

    let paydata = {}
    let v = this._getBillPayCachedObject(guid)
    if (v != null) {
      paydata = v
    } else {
      if (!('paydata' in params))
        return this._getErrorCode(SkyVaultJS.ERR_PARAM_BILLPAY_MISSING_PAYDATA, "Paydata is missing")

      let id = this.genene
      if (!('paydata' in params))
        return this._getErrorCode(SkyVaultJS.ERR_PARAM_BILLPAY_MISSING_PAYDATA, "Paydata is missing")

      let paydataArray = params.paydata.split("\n")
      for (let i = 0; i < paydataArray.length; i++) {
        let item = paydataArray[i]
        let line = i + 1

        let els = item.split(",")
        let method = els[0].trim()
        let fformat = els[1].trim()
        if (method != "TransferToSkywallet")
          return this._getErrorCode(SkyVaultJS.ERR_PARAM_BILLPAY_PAYDATA_INVALID_METHOD, "Invalid method. Line " + line)

        if (fformat != "stack")
          return this._getErrorCode(SkyVaultJS.ERR_PARAM_BILLPAY_PAYDATA_INVALID_FILE_FORMAT, "Only stack format supported. Line " + line)


        let amount = els[2].trim()
        if (!Number.isInteger(amount))
          return this._getErrorCode(SkyVaultJS.ERR_PARAM_BILLPAY_PAYDATA_INVALID_AMOUNT, "Incorrect Amount. Line " + line)

        try {
          amount = parseInt(amount)
        } catch (e) {
          return this._getErrorCode(SkyVaultJS.ERR_PARAM_BILLPAY_PAYDATA_INVALID_AMOUNT, "Incorrect Amount. Line " + line)
        }

        let d1 = els[3].trim()
        let d5 = els[4].trim()
        let d25 = els[5].trim()
        let d100 = els[6].trim()
        let d250 = els[7].trim()

        if (amount < 0 || d1 != 0 || d5 != 0 || d25 != 0 || d100 != 0 || d250 != 0) {
          return this._getErrorCode(SkyVaultJS.ERR_PARAM_BILLPAY_PAYDATA_INVALID_AMOUNT, "Incorrect Amount. Amount must be positive and Denominations must be zero. Line " + line)
        }

        let to = els[8].trim()
        let memo = els[9].trim()
        let state = els[11].trim()
        if (state != "ready" && state != "skip")
          return this._getErrorCode(SkyVaultJS.ERR_PARAM_BILLPAY_PAYDATA_INVALID_STATUS, "Invalid status. Line " + line)

        if (to in paydata)
          return this._getErrorCode(SkyVaultJS.ERR_PARAM_BILLPAY_PAYDATA_DUPLICATED_VALUE, "Duplicated value for " + to + ". Line " + line)

        paydata[to] = {
          'amount' : amount,
          'state' : state,
          'memo' : memo
        }
      }
    }

    let ok, errors

    let rv = {
      code: SkyVaultJS.ERR_NO_ERROR,
      amount: 0,
      recipients: [],
      guid: guid
    }

    for (let to in paydata) {
      let item = paydata[to]
      let recipient = {
        "address" : to,
        "status" : "ready"
      }
      let state = item.state
      if (state == "skip" || state == "sent") {
        recipient.status = state
        rv.recipients.push(recipient)
        continue
      }

      let params = {
        'sn' : coin.sn,
        'an' : coin.an,
        'to' : to,
        'amount' : item.amount,
        'memo' : item.memo
      }

      let lrv = await this.apiTransfer(params, callback)
      if (lrv.status == "error") {
        recipient.status = "error"
        recipient.message = lrv.errorText
        paydata[to].state = "ready"
        rv.recipients.push(recipient)
        rv.code = SkyVaultJS.ERR_BILLPAY_SENT_PARTIALLY
        continue
      }

      paydata[to].state = "sent"
      recipient.status = "sent"
      recipient.message = "Success"
      rv.amount += item.amount
      rv.recipients.push(recipient)
    }

    this._saveBillPayCachedObject(guid, paydata)
    return rv

  }

  apiBillPayList(params) {
    if (!('guid' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_GUID, "GUID is required")

    let guid = params.guid
    if (!this._validateGuid(guid))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_GUID, "Failed to validate GUID")

    let obj = this._getBillPayCachedObject(guid)
    if (obj == null)
      return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_RECORD_NOT_FOUND, "BillPay List not found")

    let rv = {
      code: SkyVaultJS.ERR_NO_ERROR,
      amount: 0,
      amounttotal: 0,
      guid: guid,
      recipients: []
    }

    rv.recipients = obj
    for (let to in obj) {
      let item = obj[to]
      if (item.state == "sent")
        rv.amount += item.amount

      rv.amounttotal += item.amount
    }


    return rv
  }

  _saveBillPayCachedObject(guid, paydata) {
    let key = this.options.billpayKey
    let v = localStorage.getItem(key)
    if (v == null)
      return

    let obj = null
    try {
      obj = JSON.parse(v)
    } catch(e) {
      return null
    }

    obj[guid] = paydata

    v = JSON.stringify(obj)
    console.log(v)

    localStorage.setItem(key, v)
  }

  _getBillPayCachedObject(guid) {
    let key = this.options.billpayKey

    let v = localStorage.getItem(key)
    if (v == null) {
      let obj = JSON.stringify({})
      localStorage.setItem(key, obj)
      return null
    }

    let obj = null
    try {
      obj = JSON.parse(v)
    } catch(e) {
      return null
    }

    if (!(guid in obj))
      return null

    return obj[guid]
  }

  // Transfer
  async apiTransfer(params, callback = null) {
    this.addBreadCrumbEntry("apiTransfer", params)

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
/*

    let changeMakerId = this.options.changeMakerId
    if ('changeMakerId' in params) {
      changeMakerId = params['changeMakerId']
    }
*/
    if (!('amount' in params)) {
      return this._getError("Invalid params. Amount is not defined")
    }

    let memo = 'memo' in params ? params['memo'] : "Transfer from SN#" + coin.sn
    let guid
    if (!('guid' in params)) {
      guid = this._generatePan()
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

    let tags = this._getObjectMemo(guid, memo, params.amount, from)

    let gcRqs = await this._getCoins(coin, callback)
    if ('code' in gcRqs && gcRqs.code == SkyVaultJS.ERR_COUNTERFEIT_COIN)
        return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_TOO_FEW_PASSED, "The coin is counterfeit")

    let sns = Object.keys(gcRqs.coins)
    let nns = new Array(sns.length)
    nns.fill(this.options.defaultCoinNn)
    if (params.amount > this._calcAmount(sns)) {
      return  this._getError("Not enough cloudcoins")
    }

    let rvalues = this._pickCoinsAmountFromArrayWithExtra(sns, params.amount)
    let coinsToSend = rvalues.coins
    //let changeCoin = rvalues.extra
    if (coinsToSend.length > this.options.maxCoins) {
      return  this._getError("You can't transfer more than " + this.options.maxCoins + " notes at a time")
    }
/*
    let changeRequired
    if (changeCoin !== 0) {
      let csns = await this.apiBreakInBank(rvalues.extra, coin, callback)
      if (csns.length == 0) {
        return  this._getError("Failed to break in bank")
      }

      coinsToSend = coinsToSend.concat(csns)
      rvalues = this._pickCoinsAmountFromArrayWithExtra(coinsToSend, params.amount)
      coinsToSend = rvalues.coins
      changeCoin = rvalues.extra
      if (changeCoin !== 0) {
        return  this._getError("Failed to pick coins after break in bank")
      }
      if (coinsToSend.length > this.options.maxCoins) {
        return  this._getError("You can't transfer more than " + this.options.maxCoins + " notes at a time")
      }

      changeRequired = true
    } else {
      changeRequired = false
    }
    */
    let batch = this.options.maxCoinsPerIteraiton

    let iterations = Math.floor(coinsToSend.length / batch)

    let localCoinsToSend
    let b = 0
    let response = {}
    for (; b < iterations; b++) {
      from = b * batch
      let tol = from + batch
      localCoinsToSend = coinsToSend.slice(from,tol)
      let lr = await this._doTransfer(coin, to, tags, localCoinsToSend, callback, b)
      response = this._mergeResponse(response, lr)
    }

    from = b * batch
    if (from < coinsToSend.length) {
      let tol = coinsToSend.length
      localCoinsToSend = coinsToSend.slice(from,tol)
      let lr = await this._doTransfer(coin, to, tags, localCoinsToSend, callback, iterations)
      response = this._mergeResponse(response, lr)

    }

    // Assemble input data for each Raida Server
    //response.changeCoinSent = changeRequired
    response.code = SkyVaultJS.ERR_NO_ERROR

    let pm = new Promise((resolve, reject) => {
      setTimeout(() => {
        //this._fixTransfer()
      }, 500)
    })

    this.addBreadCrumbReturn("apiTransfer", response)
    return response
  }

  _getRandomInt(max) {
    return Math.floor(Math.random() * Math.floor(max));
  }

  async _fixTransfer() {
    this.addBreadCrumbEntry("_fixTransfer")

    let corner = this._getRandomInt(4) + 1

    let rqdata = new Array(this._totalServers)
    let servers = []
    for (let raidaIdx in this._rarr) {
      let sns = this._rarr[raidaIdx]
      rqdata[raidaIdx] = {
        'corner' : corner,
        'sn' : sns
      }

      servers.push(raidaIdx)
    }

    let pm = this._launchRequests("sync/fix_transfer", rqdata, 'GET', () => {}, servers)

    return pm

  }

  async _syncOwnersAddDelete(coin, sns, servers, mode){
//mode = 0 for add, 2 for delete
    if (!this._validateCoin(coin)) {
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_COIN, "Failed to validate coin")
}
      if (!Array.isArray(sns)) {
        return this._getError("Invalid input data. Serial Numbers must be an array")
      }

      let challange = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
      let rqdata = [];
      let ab, d;
      for (let i = 0; i < this._totalServers; i++) {
          ab = new ArrayBuffer(35 + 24 + 3* sns.length );
          d = new DataView(ab); //rqdata.push(ab)
           // Trailing chars
          d.setUint8(2, i); //raida id
          d.setUint8(5, 150 + mode);//command sync add or delete(if mode = 2)
          d.setUint8(8, 0x01); //coin id
          d.setUint8(12, 0xAB); // echo
          d.setUint8(13, 0xAB); // echo
          d.setUint8(15, 0x01); //udp number
                //body
          for (let x = 0; x < 16; x++) {
            d.setUint8(22 + x, challange[x]);
          }
          d.setUint32(38, coin.sn << 8); //rqdata[i].sns.push(coin.sn)
          for (let x = 0; x < 16; x++) {
            d.setUint8(41 + x, parseInt(coin.an[x].substr(x * 2, 2), 16));
          }
          for(let y = 0; y <sns.length; y++){
            d.setUint32(57 + y *3,sns[y] << 8)
          }
          d.setUint8(ab.byteLength - 1, 0x3e);
          d.setUint8(ab.byteLength - 2, 0x3e);
          rqdata.push(ab)
        }
        let pm = this._launchRequests("sync/fix_transfer", rqdata,  null, servers)


            let rv = {
              status: 'done',
              code: SkyVaultJS.ERR_NO_ERROR,
              res_status_code: 0,
              details: []
            };
            let mainPromise = pm.then(response => {
              this._parseMainPromise(response, 0, rv, serverResponse => {
                if (serverResponse === "error" || serverResponse === "network"){
                  rv.status = 'error'
                  rv.code = SkyVaultJS.ERR_HAS_ERROR
                  return;
                }
                let dView = new DataView(serverResponse);

                rv.res_status_code = dView.getUint8(2)
                if (dView.getUint8(2) != 250) {
                  rv.code = SkyVaultJS.ERR_HAS_ERROR
                }
              });

              this.addBreadCrumbReturn("apiFixTransfer", rv);
              return rv;
            });
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
  async _doTransfer(coin, to, tags, coinsToSend, callback, iteration) {
    this.addBreadCrumbEntry("_doTransfer")
let guid = this._generatePan()
let times = new Date(Date.now())
let challange = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16];
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
              d.setUint8(15, 0x01)//udp number; //udp number
              for (let x = 0; x < 16; x++) {
                d.setUint8(22 + x, challange[x]);
              }
              d.setUint32(38, coin.sn << 8); //owner

              for (let x = 0; x < 16; x++) {
                d.setUint8(38 + (3 + x), parseInt(coin.an[i].substr(x * 2, 2), 16));
              }

              for (let j = 0; j < coinsToSend.length; j++) d.setUint32(57 + j * 3, coinsToSend[j] << 8);

              d.setUint32(57 + coinsToSend.length * 3,to <<8);

              for (let x = 0; x < 16; x++) {
                d.setUint8(60 + coinsToSend.length * 3 + x, parseInt(guid.substr(x * 2, 2), 16));
              } //transaction guid
              d.setUint8(76 + coinsToSend.length * 3, times.getUTCFullYear() - 2000)//year
              d.setUint8(77 + coinsToSend.length * 3, times.getUTCMonth())//month
              d.setUint8(78 + coinsToSend.length * 3, times.getUTCDate())//day
              d.setUint8(79 + coinsToSend.length * 3, times.getUTCHours())//hour
              d.setUint8(80 + coinsToSend.length * 3, times.getUTCMinutes())//minute
              d.setUint8(81 + coinsToSend.length * 3, times.getUTCSeconds())//second

              d.setUint8(83 + coinsToSend.length * 3,3);//ty

            rqdata.push(ab);
          }

    // Launch Requests
    let rqs = this._launchRequests("transfer", rqdata, callback, iteration)

    let coins = new Array(coinsToSend.length)
    coinsToSend.forEach((value, idx) => {
      coins[idx] = { sn: value, nn: this.options.defaultCoinNn }
    })

    let response = await this._getGenericBriefMainPromise(rqs, coins)
    this.addBreadCrumbReturn("_doTransfer", response)
    response.transaction_id = guid
    return response
  }

  async showChange(params, callback = null) {
    this.addBreadCrumbEntry("showChange", params)

    let { sn, nn, denomination } = params
    let rqdata = []
    let seed = this._generatePan().substring(0, 8)
    let ab, d;
  		for (let i = 0; i < this._totalServers; i++) {
  		ab = new ArrayBuffer(35 + 4 + 5);
  		d = new DataView(ab);
  		d.setUint8(ab.byteLength -1, 0x3e);
  			d.setUint8(ab.byteLength -2, 0x3e); // Trailing chars
  			d.setUint8(2, i) //raida id
  			d.setUint8(5, 116);//command show change
  			d.setUint8(8, 0x00);//coin id
  			d.setUint8(12, 0xAB);// echo
  			d.setUint8(13, 0xAB);// echo
  			d.setUint8(15, 0x01)//udp number;//udp number
  			d.setUint32(38, sn<<8)
  			d.setUint8(41, denomination)
  			rqdata.push(ab)
  		}

    let nrv = { d1 : {}, d5 : {}, d25 : {}, d100 : {}}
    let rqs = this._launchRequests("show_change", rqdata, callback).then(response => {
      this._parseMainPromise(response, 0, nrv, response => {
        if (response === "error" || response === "network")
          return
        let dView = new DataView(response)
        let status = dView.getUint8(2);
        if (status !== 250) {
          return
        }
        let dView2 = new DataView(response, 12)

        if (dView2.byteLength < 3)
          return
          let key, dem;
          let d1 = [];
          let d5 = [];
          let d25 = [];
          let d100 = [];
          for (let i = 0; i < coins.byteLength / 3; i++) {
            key = coins.getUint32(i * 3) >>> 8;
            switch (this.getDenomination(key)) {
              case 100:
                d100.push(key)
                break;
              case 25:
                d25.push(key)
                break;
              case 5:
                d5.push(key)
                break;
                case 1:
                  d1.push(key)
                  break;
            }
}


        for (let i = 0; i < d1.length; i++) {
          if (!(d1[i] in nrv.d1)) nrv.d1[d1[i]] = 0
          nrv.d1[d1[i]]++
        }

        for (let i = 0; i < d5.length; i++) {
          if (!(d5[i] in nrv.d5)) nrv.d5[d5[i]] = 0
          nrv.d5[d5[i]]++
        }

        for (let i = 0; i < d25.length; i++) {
          if (!(d25[i] in nrv.d25)) nrv.d25[d25[i]] = 0
          nrv.d25[d25[i]]++
        }

        for (let i = 0; i < d100.length; i++) {
          if (!(d100[i] in nrv.d100)) nrv.d100[d100[i]] = 0
          nrv.d100[d100[i]]++
        }
      })

      let mnrv = { d1 : {}, d5 : {}, d25 : {}, d100 : {}}
      for (let sn in nrv.d1) {
        let a = nrv.d1[sn]
        let f = this._totalServers - a
        let result = this._gradeCoin(a, f, 0)
        if (this._validResult(result)) {
          mnrv.d1[sn] = sn
        }
      }

      for (let sn in nrv.d5) {
        let a = nrv.d5[sn]
        let f = this._totalServers - a
        let result = this._gradeCoin(a, f, 0)
        if (this._validResult(result)) {
          mnrv.d5[sn] = sn
        }
      }

      for (let sn in nrv.d25) {
        let a = nrv.d25[sn]
        let f = this._totalServers - a
        let result = this._gradeCoin(a, f, 0)
        if (this._validResult(result)) {
          mnrv.d25[sn] = sn
        }
      }

      for (let sn in nrv.d100) {
        let a = nrv.d100[sn]
        let f = this._totalServers - a
        let result = this._gradeCoin(a, f, 0)
        if (this._validResult(result)) {
          mnrv.d100[sn] = nrv.d100[sn]
        }
      }

      this.addBreadCrumbReturn("showChange", mnrv)
      return mnrv
    })

    return rqs
  }

  async apiFixTransferSync(coin, callback) {
    this.addBreadCrumbEntry("apiFixTransferSync", coinsPerRaida)
    return this.apiFixTransferGeneric(coinsPerRaida, true, callback)
  }

  async apiFixTransfer(coin, callback) {
    this.addBreadCrumbEntry("apiFixTransfer", coinsPerRaida)
    return this.apiFixTransferGeneric(coinsPerRaida, false, callback)
  }

  async apiFixTransferGeneric(coin, sync, callback) {
    this.addBreadCrumbEntry("apiFixTransferGeneric", coinsPerRaida)

    if (typeof(coin) != "object")
      return this._getError("Failed to validate input args")

    let is_add = 2//1 = add, 0= delete, 2 = not sure
    let bal = await this.apiShowBalance(coin, callback)
    let lower = []
    let greater = []
    for (let k = 0; k < this._totalServers; k++) {
      if(bal.balancesPerRaida[k] < bal.balance && bal.balancesPerRaida[k] != null)
        lower.push[k]
      else if (bal.balancesPerRaida[k] = bal.balance) {
        greater.push[k]
      }
    }
    if (lower.length <= 12)
      is_add = 1
    else if (greater.length <= 12)
      is_add = 0

let sns = []
    if(is_add = 1){
      let pivot = greater[0]
      let missing1s, missing5s, missing25s, missing100s, missing250s = 0
for (let l in lower){
missing1s = bal.denominations[pivot][1] - bal.denominations[l][1]
missing5s = bal.denominations[pivot][5] - bal.denominations[l][5]
missing25s = bal.denominations[pivot][25] - bal.denominations[l][25]
missing100s = bal.denominations[pivot][100] - bal.denominations[l][100]
missing250s = bal.denominations[pivot][250] - bal.denominations[l][250]
if(missing1s > 0){
  let showcoin = this._getShowCoinsByDenomination(coin, 1, ()=>{})
  for(let sn in showcoin.coinsPerRaida)
    if(showcoin.coinsPerRaida[sn][l] = 'no')
      sns.push(sn)
}
if(missing100s > 0){
  let showcoin = this._getShowCoinsByDenomination(coin, 100, ()=>{})
  for(let sn in showcoin.coinsPerRaida)
    if(showcoin.coinsPerRaida[sn][l] = 'no')
      sns.push(sn)
}
if(missing5s > 0){
  let showcoin = this._getShowCoinsByDenomination(coin, 5, ()=>{})
  for(let sn in showcoin.coinsPerRaida)
    if(showcoin.coinsPerRaida[sn][l] = 'no')
      sns.push(sn)
}
if(missing25s > 0){
  let showcoin = this._getShowCoinsByDenomination(coin, 25, ()=>{})
  for(let sn in showcoin.coinsPerRaida)
    if(showcoin.coinsPerRaida[sn][l] = 'no')
      sns.push(sn)
}
if(missing250s > 0){
  let showcoin = this._getShowCoinsByDenomination(coin, 250, ()=>{})
  for(let sn in showcoin.coinsPerRaida)
    if(showcoin.coinsPerRaida[sn][l] = 'no')
      sns.push(sn)
}

this._syncOwnersAddDelete(coin, sns, [l], 0)
}



    }else if(is_add = 0){
let pivot = lower[0]
for (let g in greater){
missing1s = bal.denominations[g][1] - bal.denominations[pivot][1]
missing5s = bal.denominations[g][5] - bal.denominations[pivot][5]
missing25s = bal.denominations[g][25] - bal.denominations[pivot][25]
missing100s = bal.denominations[g][100] - bal.denominations[pivot][100]
missing250s = bal.denominations[g][250] - bal.denominations[pivot][250]
if(missing1s > 0){
  let showcoin = this._getShowCoinsByDenomination(coin, 1, ()=>{})
  for(let sn in showcoin.coinsPerRaida)
    if(showcoin.coinsPerRaida[sn][l] = 'yes')
      sns.push(sn)
}
if(missing100s > 0){
  let showcoin = this._getShowCoinsByDenomination(coin, 100, ()=>{})
  for(let sn in showcoin.coinsPerRaida)
    if(showcoin.coinsPerRaida[sn][l] = 'yes')
      sns.push(sn)
}
if(missing5s > 0){
  let showcoin = this._getShowCoinsByDenomination(coin, 5, ()=>{})
  for(let sn in showcoin.coinsPerRaida)
    if(showcoin.coinsPerRaida[sn][l] = 'yes')
      sns.push(sn)
}
if(missing25s > 0){
  let showcoin = this._getShowCoinsByDenomination(coin, 25, ()=>{})
  for(let sn in showcoin.coinsPerRaida)
    if(showcoin.coinsPerRaida[sn][l] = 'yes')
      sns.push(sn)
}
if(missing250s > 0){
  let showcoin = this._getShowCoinsByDenomination(coin, 250, ()=>{})
  for(let sn in showcoin.coinsPerRaida)
    if(showcoin.coinsPerRaida[sn][l] = 'yes')
      sns.push(sn)
}
this._syncOwnersAddDelete(coin, sns, [g], 2)
}

    }

/*
    let rqdata = []
    for (let k in coinsPerRaida) {
      let rs = coinsPerRaida[k]
      let yes = 0
      let no = 0
      let yraidas = []
      let nraidas = []
      for (let i = 0; i < rs.length; i++) {
        if (rs[i] == "yes") {
          yes++
          yraidas.push(i)
          continue
        }
        if (rs[i] == "no") {
          no++
          nraidas.push(i)
          continue
        }
      }
      if (yes + no < this._totalServers - this.options.maxFailedRaidas) {
        // No fix. a lot of network errors
        continue
      }
      if (yes != 0 && no != 0) {
        let raidas = []
        if (yes == no) {
          // Don't know what to do
          console.log("Coin " + k + " has equal votes from all raida servers")
          continue
        }
        if (yes > no) {
          raidas = nraidas
        } else {
          raidas = yraidas
        }
        // Will fix coin on raida servers
        for (let r = 0; r < raidas.length; r++) {
          let rIdx = raidas[r]
          if (!(rIdx in rqdata)) {
            rqdata[rIdx] = {
              sn : []
            }
            if (sync) {
              rqdata[rIdx]['sync'] = "true"
            }
          }
          // Will not add more than
          if (rqdata[rIdx].sn.length >= this.options.maxCoinsPerIteraiton)
            continue
          rqdata[rIdx].sn.push(k)
        }
      }
    }
    let servers = Object.keys(rqdata)
    let rv = {
      "status":"done"
    }
    let rqs = this._launchRequests("sync/fix_transfer", rqdata, 'GET', callback, servers).then(response => {
      return rv
    })
    return rqs
    */
  }
   _getRandom(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1) + min); //The maximum is inclusive and the minimum is inclusive
  }
  // Get Free Coin
  async apiGetFreeCoin(sn = null, an = null, callback = null) {
    if(sn == null){
      sn = this._getRandom(26000, 100000);
    }
    if (an != null && !Array.isArray(an)) {
      return this._getError("Invalid input data. Authenticity Numbers must be an array")
    }
    let bufferlength = 24+19;
    if(an != null)
    bufferlength += 16;
    //let url = this.options.freeCoinURL
    let ab, d;
    let rqdata = [];
let challange = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    for (let i = 0; i < this._totalServers; i++) {
      ab = new ArrayBuffer(bufferlength);
      d = new DataView(ab);
       // Trailing chars

      d.setUint8(2, i); //raida id

      if(an != null) d.setUint8(5, 31);

      else d.setUint8(5, 30); //command free id

      d.setUint8(8, 0x00); //coin id

      d.setUint8(12, 0xAB); // echo

      d.setUint8(13, 0xAB); // echo

      d.setUint8(15, 0x01); //udp number;//udp number
      for (let x = 0; x < 16; x++) {
        d.setUint8(22 + x, challange[x]);
      }
      d.setUint32(38, sn << 8);
      if(an != null){
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
      status : 'done',
      code: SkyVaultJS.ERR_NO_ERROR,
      cc:{
        sn: sn,
        an: []
      }
    };
    let e, a, n = 0;
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

        if(an == null){
        for (let r = 0; r < 16; r++) {
          if (data.getUint8(r) < 16) newan += "0";
          newan += data.getUint8(r).toString(16);
        } //let key = ldata.statement_id

        rv.cc.an[rIdx] = newan;
      }else{
        rv.cc.an = an;
      }
      });

      return rv;
    });

    return rqs
  }


  async apiShowCoins(coin, callback=null) {
    this.addBreadCrumbEntry("apiShowCoins", coin)

    if (!this._validateCoin(coin)) {
      return this._getError("Failed to validate params")
    }

    return this._getCoins(coin, callback)
  }

  async apiShowCoinsAsArray(coin, callback) {
    this.addBreadCrumbEntry("apiShowCoinsArray", coin)

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
        'denomination': coins[sn]
      })
    }

    d.coins = a
    return d
  }

  // Recovers a SkyWallet
  async apiRecoverIDCoin(params, callback) {
    this.addBreadCrumbEntry("apiRecoverIDCoin", params)
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
    let rqs = this._launchRequests("recover_by_email", rqdata, 'GET', callback)
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

    this.addBreadCrumbReturn("apiRecoverIDCoin", rv)

    return mainPromise
  }

  // Shows Balance
  async apiShowBalance(coin, callback) {
    this.addBreadCrumbEntry("apiShowBalance", coin);
    if (!coin) return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_COIN, "Coin in missing");
    if (!this._validateCoin(coin)) return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_COIN, "Failed to validate coin");
    let rqdata = [];
/*
    for (let i = 0; i < this._totalServers; i++) {
      rqdata.push({
        sn: coin.sn,
        nn: coin.nn,
        an: coin.an[i],
        pan: coin.an[i],
        denomination: this.getDenomination(coin.sn)
      });
    }*/
		let ab, d;
		for (let i = 0; i < this._totalServers; i++) {
		ab = new ArrayBuffer(35 + 19 + 5);
		d = new DataView(ab);
		d.setUint8(ab.byteLength -1, 0x3e);
			d.setUint8(ab.byteLength -2, 0x3e); // Trailing chars
			d.setUint8(2, i) //raida id
			d.setUint8(5, 110);//command ballance
			d.setUint8(8, 0x00);//coin id
			d.setUint8(12, 0xAB);// echo
			d.setUint8(13, 0xAB);// echo
			d.setUint8(15, 0x01)//udp number;//udp number
			d.setUint32(38, coin.sn<<8)
			for (let x = 0; x < 16; x++) {
				d.setUint8(38+(3+x), parseInt(coin.an[i].substr(x*2, 2), 16))
			}
			rqdata.push(ab)
		}

    let rv = {
      code: SkyVaultJS.ERR_NO_ERROR,
      balances: [],
      balance: 0,
      balancesPerRaida: [],
      raidaStatuses: [],
      triedToFix: false,
      fixedCoin: false,
      //denominations: []
    };

    for (let i = 0; i < this._totalServers; i++) {
      rv.raidaStatuses[i] = "u";
      rv.balances[i] = 0;
    }

    let balances = {};
    let ra, re, rf;
    ra = re = rf = 0;

    let rqs = this._launchRequests("show_transfer_balance", rqdata, callback).then(response => {
      this._parseMainPromise(response, 0, rv, (response, rIdx) => {
        if (response == "network") {
          rv.raidaStatuses[rIdx] = "n";
          rv.balancesPerRaida[rIdx] = null;
          //rv.denominations[rIdx] = null;
          re++;
          return;
        }

        if (response == "error") {
          rv.raidaStatuses[rIdx] = "e";
          rv.balancesPerRaida[rIdx] = null;
          //rv.denominations[rIdx] = null;
          re++;
          return;
        }

        if (response.byteLength < 12) {
          rv.raidaStatuses[rIdx] = "e";
          rv.balancesPerRaida[rIdx] = null;
          //rv.denominations[rIdx] = null;
          re++;
          return;
        }
let dView = new DataView(response);
let status = dView.getUint8(2);
        if (status == 251 || response.byteLength < 13) {
          rv.raidaStatuses[rIdx] = "f";
          rv.balancesPerRaida[rIdx] = null;
          //rv.denominations[rIdx] = null;
          rf++;
          return;
        }

        if (status != 250) {
          rv.raidaStatuses[rIdx] = "e";
          rv.balancesPerRaida[rIdx] = null;
          //rv.denominations[rIdx] = null;
          re++;
          return;
        }

        rv.raidaStatuses[rIdx] = "p";
        let b = dView.getUint32(12);
        rv.balancesPerRaida[rIdx] = b;
        /*
        let dsplit = new DataView(response, 16)
        let denom = new ArrayBuffer(dsplit.byteLength + 1)
        let denomView = new DataView(denom)
        for(let x = 0; x < denom.byteLength -1; x++)
          denomView.setUint8(x,dsplit.getUint8(x))
        let den_ob = {
          1: 0,
          5: 0,
          25: 0,
          100: 0,
          250: 0
        }
        den_ob[250] = denomView.getUint32(0) >>> 8
        den_ob[100] = denomView.getUint32(3) >>> 8
        den_ob[25] = denomView.getUint32(6) >>> 8
        den_ob[5] = denomView.getUint32(9) >>> 8
        den_ob[1] = denomView.getUint32(12) >>> 8

        rv.denominations[rIdx] = den_ob;
*/
        if (!(b in balances)) {
          balances[b] = 0;
        }

        balances[b]++;
        ra++;
      }); // Check if Fracked


      let needFix = false;

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
      let f = this._activeServers.length - a;

      let result = this._gradeCoin(a, f, 0);

      if (!this._validResult(result)) balance = -1;

      if (result == this.__counterfeitResult) {
        return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_TOO_FEW_PASSED, "The coin is counterfeit");
      }

      rv.balance = balance;
      rv.balances = balances;
      rv.raidaStatuses = rv.raidaStatuses.join("");
      let thiz = this;

      if (Object.keys(balances).length > 1) {
        let fnpm = async function () {
          let response = await thiz.apiShowCoins(coin, callback);
          if (!('code' in response) || response.code != SkyVaultJS.ERR_NO_ERROR) return rv;
          let h = {};
          let iters = thiz.options.maxCoinsPerIteraiton;

          for (let k in response.coinsPerRaida) {
            h[k] = response.coinsPerRaida[k];
            iters++;

            if (iters >= thiz.options.maxCoinsPerIteraiton) {
              //await thiz.apiFixTransferSync(response.coinsPerRaida);
              h = {};
              iters = 0;
            }
          }

          if (needFix) {
            rv.triedToFix = true;
            coin.pownstring = rv.raidaStatuses;
            coin.result = thiz.__frackedResult;
            let fresponse = await thiz.apiFixfracked([coin], callback);
            if (fresponse.status != 'done') return rv;

            if (fresponse.fixedNotes == 1) {
              rv.fixedCoin = true;
            }
          }
        }().then(response => {
          return rv;
        });

        return fnpm;
      }

      if (needFix) {
        rv.triedToFix = true;
        coin.pownstring = rv.raidaStatuses;
        coin.result = this.__frackedResult;
        let fpm = this.apiFixfracked([coin], callback).then(response => {
          if (response.status != 'done') return rv;

          if (response.fixedNotes == 1) {
            rv.fixedCoin = true;
          }

          return rv;
        });
        return fpm;
      }

      this.addBreadCrumbReturn("apiShowBalance", rv);
      return rv;
    });

    return rqs;
  }

  // Resolves a SkyWallet
  async apiResolveSkyWallet(hostname) {
    let sn = await this._resolveDNS(hostname)
    if (sn == null)
      return this._getErrorCode(SkyVaultJS.ERR_DNS_RECORD_NOT_FOUND, "Failed to resolve SkyWallet")

    let rv = {
      'code' : SkyVaultJS.ERR_NO_ERROR,
      'sn' : sn
    }

    return rv
  }

  // Health Check
  async apiHealthCheck(params, callback = null) {
    this.addBreadCrumbEntry("apiHealthCheck", params)
    if (!('coin' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_COIN, "Coin in missing")

    let coin = params['coin']
    if (!this._validateCoin(coin))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_COIN, "Failed to validate coin")

    let rv = {
      'code' : SkyVaultJS.ERR_NO_ERROR,
      'text' : "HealthCheck Completed",
      'balances' : [],
      'balance' : -1,
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

  // Check in coins have NFT
  async apiNFTExists(params, callback = null) {
    this.addBreadCrumbEntry("apiNFTExists")

    if (!('coins' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_COIN, "Coins are missing")

    let coins = params.coins
    if (coins.length > this.options.maxCoinsPerIteraiton)
        return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_COIN, "Too many coins in stack. Max number of coins is: " + this.options.maxCoinsPerIteraiton)

    for (let i = 0; i < coins.length; i++) {
      let coin = coins[i]
      if (!this._validateCoin(coin))
        return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_COIN, "Failed to validate coins")
    }

    let rqdata = []
    for (let i = 0; i < this._totalServers; i++) {
      rqdata.push({
        sn: [],
        an: []
      })
      for (let j = 0; j < coins.length; j++) {
        let coin = coins[j]
        rqdata[i].sn.push(coin.sn)
        rqdata[i].an.push(coin.an[i])
      }
    }

    let rv = {
      'code' : SkyVaultJS.ERR_NO_ERROR,
      'text' : "Data returned",
      'results': {}
    }

    let a, f, e
    a = f = e = 0


    let results = {}
    let rqs = this._launchRequests("nft/has_nft", rqdata, 'GET', callback)
    let mainPromise = rqs.then(response => {
      this._parseMainPromise(response, 0, rv, serverResponse => {
        if (serverResponse === "error" || serverResponse == "network") {
          e++
          return
        }
        if (serverResponse.status == "fail") {
          f++
          return
        }

        if (serverResponse.status == "success") {
         let message = serverResponse.message
          let vals = message.split(",")
          if (vals.length != coins.length) {
            e++
            return
          }

          for (let c = 0; c < vals.length; c++) {
            let cc = coins[c]
            let sn = cc.sn
            if (!(sn in results)) {
              results[sn] = 0
            }

            if (vals[c] === "true") {
              results[sn]++
            }
          }

          a++
          return
        }

        e++
      })

      console.log("DONE")
      console.log(results)

      let result = this._gradeCoin(a, f, e)
      if (!this._validResult(result))
        return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_TOO_FEW_PASSED, "Failed to get NFT tokens. Too many error responses from RAIDA")


      let fresults = {}
      for (let sn in results) {
        let total = results[sn]
        if (total >= this.options.minPassedNumToBeAuthentic) {
          fresults[sn] = true
        } else {
          fresults[sn] = false
        }
      }
      console.log("DONE2")
      console.log(fresults)

      rv.results = fresults

      return rv

    })

    this.addBreadCrumbReturn("apiNFTInsert", rv)

    return mainPromise
  }

  // Multi Insert
  async apiNFTMultiInsert(params, callback = null) {
    this.addBreadCrumbEntry("apiNFTMultiInsert")

    if (!('coins' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_COIN, "Coins are missing")


    if (!('data' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_DATA, "Data is missing")

    let coins = params.coins
    if (coins.length > this.options.maxCoinsPerIteraiton)
        return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_COIN, "Too many coins in stack. Max number of coins is: " + this.options.maxCoinsPerIteraiton)

    for (let i = 0; i < coins.length; i++) {
      let coin = coins[i]
      if (!this._validateCoin(coin))
        return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_COIN, "Failed to validate coins")
    }

    // Doing detect
    let detect = await this.apiDetect(coins, callback)
    if (detect.code != SkyVaultJS.ERR_NO_ERROR)
        return this._getErrorCode(SkyVaultJS.ERR_DETECT_FAILED, "Failed to do multi_detect")

    if (detect.counterfeitNotes > 0) {
        return this._getErrorCode(SkyVaultJS.ERR_COUNTERFEIT_COIN, "There is at least one counterfeit coin in the Stack. Stop doing anything")
    }

    if (detect.errorNotes > 0) {
        return this._getErrorCode(SkyVaultJS.ERR_NETWORK_ERROR_COIN, "There was an error during multi_detect. Stop doing anything")
    }

    if (detect.frackedNotes > 0) {
      let fresult = await this.apiFixfracked(detect.result, callback)
      if (fresult.code != SkyVaultJS.ERR_NO_ERROR)
          return this._getErrorCode(SkyVaultJS.ERR_FAILED_TO_FIX, "Failed to fix coins")

      for (let sn in detect.result) {
        let cc = detect.result[sn]
        if (cc.counterfeit > 2) {
          return this._getErrorCode(SkyVaultJS.ERR_FAILED_TO_FIX, "Failed to fix coins. Coin " + cc.sn + " still has more than two countefeit responses")
        }
      }
    }

    let success = 0
    let failed = 0

    delete params.coins
    for (let i = 0; i < coins.length; i++) {
      let coin = coins[i]
      params.coin = coin

      let nftresult = await this.apiNFTInsert(params, callback)
      if (nftresult.code != SkyVaultJS.ERR_NO_ERROR) {
        failed++
      } else {
        success++
      }
    }

    let code
    let msg
    if (failed > 0) {
      if (success == 0) {
          return this._getErrorCode(SkyVaultJS.ERR_FAILED_TO_CREATE_TOKENS, "Failed to create all tokens")
      }

      code = SkyVaultJS.ERR_HAS_ERROR
      msg = "Not all tokens have been created"
    } else {
      code = SkyVaultJS.ERR_NO_ERROR
      msg = "Tokens created"
    }

    let rv = {
      'code' : code,
      'text' : msg,
      'tokensCreated': success,
      'tokensFailed': failed,
    }

    return rv
  }

  // Create NFT
  async apiNFTInsert(params, callback = null) {
    this.addBreadCrumbEntry("apiNFTInsert", rv)

    let size = 0

    if (!('coin' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_COIN, "Coin is missing")

    if (!('data' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_DATA, "Data is missing")

    if (!('metadata' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_METADATA, "MetaData is missing")

    let metadata = params.metadata
    if (!('filename' in metadata))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_METADATA, "Filename is missing")

    let filename = metadata.filename
    let proofmimetype = "image/jpeg"
    let mimetype = "application/octet-stream"
    if ('mimetype' in metadata)
      mimetype = metadata.mimetype

    let coin = params['coin']
    if (!this._validateCoin(coin))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_COIN, "Failed to validate coin")

    let protocol = 0
    if ('protocol' in params)
      protocol = params.protocol

    if (protocol != 0 && protocol != 1)
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_UNSUPPORTED_NFT_PROTOCOL, "Unsupported NFT Protocol")

    size += params.data.length
    if (size == 0) {
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_BILLPAY_EMPTY_PAYDATA, "Data is empty")
    }
    let proofdata = null
    if (protocol == 1) {
      if (!('proofdata' in params))
        return this._getErrorCode(SkyVaultJS.ERR_PARAM_NFT_MISSING_ID_PROOF, "ID Proof Picture is missing")

      if ('proofmimetype' in metadata)
        proofmimetype = metadata.proofmimetype

      proofdata = params.proofdata
      size += proofdata.length
    }

    if (size > this.options.maxNFTSize)
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_NFT_SIZE_IS_TOO_BIG, "The size of picture and ID proof is too big")

    let title = ""
    let description = ""
    if ('title' in metadata)
      title = metadata.title

    if ('description' in metadata)
      description = metadata.description

    let obj = {
      'filename' : filename,
      'mimetype' : mimetype,
      'proofmimetype' : proofmimetype,
      'title' : title,
      'description' : description
    }

    let rqdata = []
    let tags = this._getNFTStringForObject(obj, params.data, proofdata)
    for (let i = 0; i < this._totalServers; i++) {
      rqdata.push({
        'sn' : coin.sn,
        'an' : coin.an[i],
        'protocol': protocol,
        'stripe' : tags[i]['stripe'],
        'mirror' : tags[i]['mirror1'],
        'mirror2' : tags[i]['mirror2']
      })
    }

    let rv = {
      'code' : SkyVaultJS.ERR_NO_ERROR,
      'text' : "Created successfully"
    }

    let a, f, e
    a = f = e = 0
    let rqs = this._launchRequests("nft/insert", rqdata, 'POST', callback)
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
        return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_TOO_FEW_PASSED, "Failed to create NFT token. Too many error responses from RAIDA")

      return rv

    })

    this.addBreadCrumbReturn("apiNFTInsert", rv)

    return mainPromise
  }

  // Delete NFT
  async apiNFTDelete(params, callback = null) {
    this.addBreadCrumbEntry("apiNFTDelete", rv)

    let size = 0

    if (!('coin' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_COIN, "Coin is missing")

    let coin = params['coin']
    if (!this._validateCoin(coin))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_COIN, "Failed to validate coin")

    let rqdata = []
    for (let i = 0; i < this._totalServers; i++) {
      rqdata.push({
        'sn' : coin.sn,
        'an' : coin.an[i]
      })
    }

    let rv = {
      'code' : SkyVaultJS.ERR_NO_ERROR,
      'text' : "Deleted successfully"
    }

    let a, f, e
    a = f = e = 0
    let rqs = this._launchRequests("nft/delete", rqdata, 'GET', callback)
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
        return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_TOO_FEW_PASSED, "Failed to delete NFT token. Too many error responses from RAIDA")

      return rv
    })

    this.addBreadCrumbReturn("apiNFTDelete", rv)

    return mainPromise
  }

  // Read NFT
  async apiNFTRead(params, callback = null) {
    this.addBreadCrumbEntry("apiNFTRead", rv)

    if (!('coin' in params))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_MISSING_COIN, "Coin is missing")

    let coin = params['coin']
    if (!this._validateCoin(coin))
      return this._getErrorCode(SkyVaultJS.ERR_PARAM_INVALID_COIN, "Failed to validate coin")

    let rqdata = []
    for (let i = 0; i < this._totalServers; i++) {
      rqdata.push({
        'sn' : coin.sn,
        'an' : coin.an[i],
      })
    }

    let rv = {
      'code' : SkyVaultJS.ERR_NO_ERROR,
      'text' : "NFT downloaded successfully",
      'data' : null,
      'protocol' : 0,
      'metadata' : {}
    }

    let a, f, e
    a = f = e = 0
    let mparts = []
    for (let i = 0; i < this._totalServers; i++)
        mparts[i] = null

    let rqs = this._launchRequests("nft/read", rqdata, 'GET', callback)
    let mainPromise = rqs.then(response => {
      this._parseMainPromise(response, 0, rv, (serverResponse, rIdx) => {
          console.log("SR")
        console.log(serverResponse)
        if (serverResponse === "error" || serverResponse == "network") {
          e++
          return
        }

        if (serverResponse.status == "success") {
          console.log("SUCCESS")
          if (!('stripe' in serverResponse) || !('mirror' in serverResponse) || !('mirror2' in serverResponse))  {
            e++
            return
          }

          mparts[rIdx] = {
            'stripe' : serverResponse.stripe,
            'mirror1' : serverResponse.mirror,
            'mirror2' : serverResponse.mirror2,
          }

          a++
        }

        if (serverResponse.status == "fail") {
          f++
        }
      })
      let result = this._gradeCoin(a, f, e)
      if (!this._validResult(result))
        return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_TOO_FEW_PASSED, "Failed to download NFT token. Too many error responses from RAIDA")

      let odata = this._getNFTObjectFromString(mparts)
      if (odata == null) {
        return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_FAILED_TO_BUILD_MESSAGE_FROM_CHUNKS, "Failed to build message from RAIDA chunks. Some are missing")
      }

      rv.metadata = odata.metadata
      rv.data = odata.data
      if ('proofdata' in odata) {
        rv.proofdata = odata.proofdata
        rv.protocol = 1
      }


      return rv

    })

    this.addBreadCrumbReturn("apiNFTInsert", rv)

    return mainPromise
  }

  /*** INTERNAL FUNCTIONS. Use witch caution ***/
  async _resolveDNS(hostname, type = null) {
    this.addBreadCrumbEntry("_resolveDNS", hostname)

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
        denomination: this.getDenomination(coin.sn),
        content: "1"
      })
    }
    let rv = {
      code: SkyVaultJS.ERR_NO_ERROR,
      balancesPerRaida: []
    }

    let rqs = this._launchRequests("show", rqdata, 'GET', callback).then(response => {
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
          } catch (e) { }


          rv.balancesPerRaida[rIdx] += amount
        }
      })

      return rv
    })

    return rqs
  }
/*
  async _getCoins(coin, callback) {
    let rqdata = []

    // Assemble input data for each Raida Server
    let ab, d;
		for (let i = 0; i < this._totalServers; i++) {
		ab = new ArrayBuffer(36 + 19 + 5);
		d = new DataView(ab);
		d.setUint8(ab.byteLength -1, 0x3e);
			d.setUint8(ab.byteLength -2, 0x3e); // Trailing chars
			d.setUint8(2, i) //raida id
			d.setUint8(5, 112);//show register
			d.setUint8(8, 0x01);//coin id
			d.setUint8(12, 0xAB);// echo
			d.setUint8(13, 0xAB);// echo
			d.setUint8(15, 0x01)//udp number;//udp number
      d.setUint8(ab.byteLength -3, 251)//biggest returned denomination
			d.setUint32(38, coin.sn<<8)
			for (let x = 0; x < 16; x++) {
				d.setUint8(38+(3+x), parseInt(coin.an[i].substr(x*2, 2), 16))
			}
			rqdata.push(ab)
		}
    let rv = {
      code: SkyVaultJS.ERR_NO_ERROR,
      coins: {},
      coinsPerRaida: {}
    }

    let skipRaidas = []
    let a, f, e
    a = f = e = 0
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

        if (status != 250) {
          skipRaidas.push(rIdx)
          e++
          return
        }

        a++
        let coinsplit = new DataView(response, 12)
        let amount = coinsplit.byteLength/3
        let coins = new ArrayBuffer(coinsplit.byteLength + 1)
        let coinsView = new DataView(coins)
        for(let x = 0; x < coins.byteLength -1; x++)
          coinsView.setUint8(x,coinsplit.getUint8(x))
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
      if (result == this.__counterfeitResult)
        return this._getErrorCode(SkyVaultJS.ERR_COUNTERFEIT_COIN, "Counterfeit coins")
      //if (!this._validResult(result))
      //  return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_TOO_FEW_PASSED, "Failed to get coins. Too many error responses from RAIDA")

      let nrv = { code: SkyVaultJS.ERR_NO_ERROR, coins: {} }
      nrv.coinsPerRaida = rv.coinsPerRaida
      for (let f = 0; f < skipRaidas.length; f++) {
        let frIdx = skipRaidas[f]
        for (let sn in rv.coinsPerRaida) {
          rv.coinsPerRaida[sn][frIdx] = "unknown"
        }
      }
      for (let sn in rv.coins) {
        let a = rv.coins[sn].passed
        let f = this._totalServers - a
        let result = this._gradeCoin(a, f, 0)
        if (this._validResult(result)) {
          nrv.coins[sn] = {
            denomination: this.getDenomination(sn)
          }
        }
      }


      return nrv
    })

    return rqs
  }
*/

    async _getCoins(coin, callback=null){//ByDenomination(coin, denomination, callback) {
      let rqdata = []

      // Assemble input data for each Raida Server
      let ab, d;
  		for (let i = 0; i < this._totalServers; i++) {
  		ab = new ArrayBuffer(36 + 20 + 5);
  		d = new DataView(ab);
  		d.setUint8(ab.byteLength -1, 0x3e);
  			d.setUint8(ab.byteLength -2, 0x3e); // Trailing chars
  			d.setUint8(2, i) //raida id
  			d.setUint8(5, 114);//show register
  			d.setUint8(8, 0x01);//coin id
  			d.setUint8(12, 0xAB);// echo
  			d.setUint8(13, 0xAB);// echo
  			d.setUint8(15, 0x01)//udp number;//udp number
        d.setUint8(ab.byteLength -3, 250)//biggest returned denomination
  			d.setUint32(38, coin.sn<<8)
  			for (let x = 0; x < 16; x++) {
  				d.setUint8(38+(3+x), parseInt(coin.an[i].substr(x*2, 2), 16))
  			}
        //d.setUint8(57, denomination)
        d.setUint8(58, 0)
  			rqdata.push(ab)
  		}
      let rv = {
        code: SkyVaultJS.ERR_NO_ERROR,
        coins: {},
        coinsPerRaida: {}
      }

      let skipRaidas = []
      let a, f, e
      a = f = e = 0
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

          if (status != 250) {
            skipRaidas.push(rIdx)
            e++
            return
          }

          a++
          let coinsplit = new DataView(response, 12)
          let amount = coinsplit.byteLength/3
          let coins = new ArrayBuffer(coinsplit.byteLength + 1)
          let coinsView = new DataView(coins)
          for(let x = 0; x < coins.byteLength -1; x++)
            coinsView.setUint8(x,coinsplit.getUint8(x))
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
        if (result == this.__counterfeitResult)
          return this._getErrorCode(SkyVaultJS.ERR_COUNTERFEIT_COIN, "Counterfeit coins")
        //if (!this._validResult(result))
        //  return this._getErrorCode(SkyVaultJS.ERR_RESPONSE_TOO_FEW_PASSED, "Failed to get coins. Too many error responses from RAIDA")

        let nrv = { code: SkyVaultJS.ERR_NO_ERROR, coins: {} }
        nrv.coinsPerRaida = rv.coinsPerRaida
        for (let f = 0; f < skipRaidas.length; f++) {
          let frIdx = skipRaidas[f]
          for (let sn in rv.coinsPerRaida) {
            rv.coinsPerRaida[sn][frIdx] = "unknown"
          }
        }
        for (let sn in rv.coins) {
          let a = rv.coins[sn].passed
          let f = this._totalServers - a
          let result = this._gradeCoin(a, f, 0)
          if (this._validResult(result)) {
            nrv.coins[sn] = {
              denomination: this.getDenomination(sn)
            }
          }
        }


        return nrv
      })

      return rqs
    }

  // Doing internal fix
  async _realFix(round, raidaIdx, coins, callback = null) {
    let rqdata, triad, rqs, resultData
    //for (let corner = 0; corner < 4; corner++) {
      //triad = this._trustedTriads[raidaIdx][corner]

      rqdata = this._formRequestData(coins, false, 11)
      rqs = this._launchRequests("multi_get_ticket", rqdata,  callback)
      resultData = await this._getGenericMainPromise(rqs, coins, (a, c, e) => {
        if (a > 12)
          return this.__authenticResult

        return this.__counterfeitResult
      })

      let ab = new ArrayBuffer(19+16+16+(4*25)+(3*coins.length)+5)
      let d = new DataView(ab)
      d.setUint8(ab.byteLength -1, 0x3e);
        d.setUint8(ab.byteLength -2, 0x3e); // Trailing chars
        d.setUint8(2, raidaIdx) //raida id
        d.setUint8(5, 3);//command fix
        d.setUint8(8, 0x01);//coin id
        d.setUint8(12, 0xAB);// echo
        d.setUint8(13, 0xAB);// echo
        d.setUint8(15, 0x01)//udp number;//udp number

        for (let x = 0; x < 16; x++) {
          d.setUint8(38 + (3*coins.length) + x, parseInt(coins[0].pan[raidaIdx].substr(x * 2, 2), 16));
        }

      let i = 0
      for (let sn in resultData['result']) {
        let coin = resultData['result'][sn]
        d.setUint32(38 + (i * 3), coin.sn << 8)
        i++
      }
for(let j = 0; j < 25; j++){
  if ('tickets' in resultData.result[coins[0].sn])
  d.setUint32(38 + (3*coins.length) + 16 +(j*4), resultData['result'][coins[0].sn].tickets[i])
  else {
    d.setUint32(38 + (3*coins.length) + 16+(j*4), 0)
  }
}


      // exec fix fracked
      rqs = this._launchRequests("multi_fix", ab, callback, [raidaIdx])
      resultData = await this._getGenericMainPromise(rqs, coins, (a, c, e) => {
        if (a == 1 && c == 0 && e == 0)
          return this.__authenticResult

        return this.__counterfeitResult
      })

      resultData = resultData['result']

      let cfixed = 0
      for (let i = 0; i < coins.length; i++) {
        let sn = coins[i].sn

        if (!(sn in resultData))
          continue

        let coinResult = resultData[sn].result
        if (coinResult !=  this.__authenticResult)
          continue

        let newpan = md5(i.toString()+sn.toString()+coins[0].pan[raidaIdx])
        coins[i].an[raidaIdx] = newpan
        coins[i].pownArray[raidaIdx] = 'p'

        cfixed++
      }

    //  if (cfixed == coins.length)
        //break
    //}
  }


  _formRequestData(params, pan=true, command=0) {
    let rqdata = []
    let amount = params.length
    let bodylength
    if(pan)
    bodylength=35
    else {
      bodylength = 19
    }

    // Assemble input data for each Raida Server
    for (let i = 0; i < this._totalServers; i++) {
      let ab = new ArrayBuffer(35 + (bodylength*amount) +5)
      let d = new DataView(ab)
      d.setUint8(ab.byteLength -1, 0x3e)
				d.setUint8(ab.byteLength -2, 0x3e) // Trailing chars
      //rqdata.push(ab)
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
        if(coin.sn >= 26000 && coin.sn <= 100000){
        d.setUint8(8, 0x00); //coin id
        }else{
        d.setUint8(8, 0x01); //coin id
        }
        d.setUint8(12, 0xAB)// echo
        d.setUint8(13, 0xAB)// echo
        d.setUint8(15, 0x01)//udp number//udp number

        //body
        d.setUint32(38+(j*bodylength), coin.sn<<8)//rqdata[i].sns.push(coin.sn)
        for (let x = 0; x < 16; x++) {
          d.setUint8(38+(j*bodylength)+(3+x), parseInt(coin.an[i].substr(x*2, 2), 16))
          if(pan)
          d.setUint8(38+(j*bodylength)+(19+x), parseInt(coin.pan[i].substr(x*2, 2), 16))
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
        result : [],
        details : [],
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
          denomination: this.getDenomination(sn),
          errors: 0,
          counterfeit: 0,
          authentic: 0,
          pownstring: "",
          result: "unknown",
          message: new Array(this._totalServers)
        }

        if (typeof(coins[i].pan) != 'undefined')
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

        let sr =new DataView(serverResponse)

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
        switch(rcoins[sn].result) {
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
        result : [],
        details : []
      }

      // Return value
      let rcoins = {}

      // Setup the return hash value
      for (let i = 0; i < coins.length; i++) {
        let sn = coins[i].sn

        rcoins[sn] = {
          nn: coins[i].nn,
          sn: sn,
          denomination: this.getDenomination(sn),
          errors: 0,
          counterfeit: 0,
          authentic: 0,
          pownstring: "",
          result: "unknown",
          message: new Array(this._totalServers)
        }

        if (typeof(coins[i].pan) != 'undefined')
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

        let sr =new DataView(serverResponse)
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
          if(status == 243){
            if(sr.byteLength >= 20)
            ms = sr.getUint8(Math.floor(20 +(i/8)))
            else if(sr.byteLength >= 16){
            ms = sr.getUint8(Math.floor(16 +(i/8)))
          }else {
              ms = sr.getUint8(Math.floor(12 +(i/8)))
            }
            let bitpos = i - (8*Math.floor(i/8))
            mixed = (ms >>> bitpos) & 1
          }

          if (status == 250 || status == 241 ||(status == 243 && mixed == 1)) {//sr.status == 'pass') {
            rcoins[sn].authentic++;
            rcoins[sn].pownstring += "p"
            if (!('tickets' in rcoins[sn]))
              rcoins[sn].tickets = []
            if(sr.byteLength >= 16)
            rcoins[sn].tickets[raidaIdx] = sr.getUint32(3)
          } else if (status == 242 || status == 251||(status == 243 && mixed == 0)) {
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

        switch(rcoins[sn].result) {
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
    if (a + f + e != this._activeServers.length)
      return this.__errorResult


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

    if (typeof(params) !== 'object') {
      console.error("Invalid input data")
      return null
    }

    for (let k in coin) {
      if (k in params)
        coin[k] = params[k]
    }

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
    for (let i = 0; i < response.length; i++) {
      let serverResponse
      let dView

      if (response[i].status != 'fulfilled') {
        this._addDetails(rv)
        this.addSentryError("Network Error with RAIDA", i, response[i])
        callback("network", i)
        continue
      }

      serverResponse = response[i].value.data

      //console.log('response from server ', dView.getUint8(0));
      //console.log("status code ", dView.getUint8(2))
      if (arrayLength == 0) {
        if (typeof(serverResponse) != 'object' || serverResponse.byteLength < 12) {
          console.error("Invalid response from RAIDA: " + i +". No header/not binary")
          this.addSentryError("Invalid Response. No header/not binary", i, serverResponse)
          this._addDetails(rv)
          callback("error", i)
          continue
        }
      } else {
        if (!Array.isArray(serverResponse)) {
          console.error("Expected array from RAIDA: " + i)
          this.addSentryError("Expected to receive Array from RAIDA. But got something else", i, serverResponse)
          this._addDetails(rv)
          callback("error", i)
          continue
        }

        if (serverResponse.length != arrayLength) {
          console.error("Invalid length returned from RAIDA: " + i
            + ". Expected: " + arrayLength +", got " + serverResponse.length)
          this.addSentryError("Invalid length returned from RAIDA. Expected " + arrayLength + ", got " + serverResponse.length, i, serverResponse)
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

    _wsConnect(url, data, i, timeout = 10000) {
      let reject = true;
      let dv = new DataView(data);
      if(this._activeServers.includes(i))
        reject = false;
        if(!reject || dv.getUint8(5) == 0x04){
      return new Promise(function (res, rej) {
        let socket;
        setTimeout(() => rej('timeout'), timeout);
        if (_isBrowser) socket = new WebSocket(url);else {
          socket = new _ws(url);
        }
        socket.binaryType = "arraybuffer";

        socket.onopen = e => {
          //let dv = new DataView(data);
          dv.setUint8(2, i);
          socket.send(data);
        };

        socket.onmessage = e => {
          //console.log("recieved message from ", i)
          res(e);
          socket.close(1000);
        };

        socket.onerror = e => {
          console.log("ws error: ", e.message);
          rej(e);
          socket.close();
        };
      });
    }else{
      return new Promise((res, rej)=>{rej()});
    }

    }

  _launchRequests(url, params = null, callback = null, servers = null, data = null) {
    if (params == null)
      params = {}

    let pms = []

    let iteratedServers, iteratedServersIdxs
    if (servers != null) {
      iteratedServers = []
      for (let i = 0; i < servers.length; i++) {
        iteratedServers.push(this._raidaServers[servers[i]])
      }
      iteratedServersIdxs = servers
    } else {
      iteratedServers = this._raidaServers
      iteratedServersIdxs = [...Array(this._totalServers).keys()]
    }

    for (let i = 0; i < iteratedServers.length; i++) {
      let raidaIdx = iteratedServersIdxs[i]
      let rq = iteratedServers[i]// + "/service/" + url

      let pm
      let options = {
        timeout : this.options.timeout
      }

      let rparams
      if ( typeof(params) === 'object' && Array.isArray(params)) {
        rparams = params[raidaIdx]
      }
      else{
        rparams = params

}
  pm = this._wsConnect(rq, rparams, raidaIdx, options.timeout);

/*
      if (method == 'GET') {
        options.params = rparams
        pm = this._axInstance.get(rq, options)
      } else {
        this.addBreadCrumb("POST " + rq, rparams)
        pm = this._axInstance.post(rq, qs.stringify(rparams), options)
      }
*/

      pm.then(response => {
        if (callback != null)
          callback(raidaIdx, url, data)

        return response.data
      }).catch(error => {
        if (error.response) {
          console.error("Invalid server response from RAIDA" + i + ": " + error.response.status)
          this.addSentryError("Invalid response from RAIDA", i, error)
        } else {
          console.error("Failed to get a respose from RAIDA" + i)
          this.addSentryError("Failed to get any response from RAIDA", i, error)
        }

        return null
      })

      pms.push(pm)
    }

    return allSettled(pms)
  }

  _initAxios() {
    this._axInstance = axios.create({
      headers: {
        'Content-Type' : 'application/x-www-form-urlencoded'
      }
    })
    this._axInstance.defaults.timeout = this.options.timeout

  }

  // Generate the array of RAIDA server URLs
  _generateServers() {
    /*
    for (let i = 0; i < this._totalServers; i++)
      this._raidaServers[i] = this.options.protocol + "://" + this.options.prefix
        + i + "." +this.options.domain
    */
    if(this.options.wsprotocol == "wss"){
      this._raidaServers[0] = this.options.wsprotocol + "://ebc0-99a2-92e-10420.skyvault.cc:8888";
      this._raidaServers[1] = this.options.wsprotocol + "://ebc2-4555a2-92e-10422.skyvault.cc:8888";
      this._raidaServers[2] = this.options.wsprotocol + "://ebc4-9aes2-92e-10424.skyvault.cc:8888";
      this._raidaServers[3] = this.options.wsprotocol + "://ebc6-13a2-92e-10426.skyvault.cc:8888";
      this._raidaServers[4] = this.options.wsprotocol + "://ebc8-11a2-92e-10428.skyvault.cc:8888";
      this._raidaServers[5] = this.options.wsprotocol + "://ebc10-56a2-92e-104210.skyvault.cc:8888";
      this._raidaServers[6] = this.options.wsprotocol + "://ebc12-88a2-92e-10412.skyvault.cc:8888";
      this._raidaServers[7] = this.options.wsprotocol + "://ebc14-90a2-92e-10414.skyvault.cc:8888";
      this._raidaServers[8] = this.options.wsprotocol + "://ebc16-66a2-92e-10416.skyvault.cc:8888";
      this._raidaServers[9] = this.options.wsprotocol + "://ebc18-231a2-92e-10418.skyvault.cc:8888";
      this._raidaServers[10] = this.options.wsprotocol + "://ebc20-13489-92e-10420.skyvault.cc:8888";
      this._raidaServers[11] = this.options.wsprotocol + "://ebc22-kka2-92e-10422.skyvault.cc:8888";
      this._raidaServers[12] = this.options.wsprotocol + "://ebc24-mnna2-92e-10444.skyvault.cc:8888";
      this._raidaServers[13] = this.options.wsprotocol + "://ebc26-uuia2-92e-10426.skyvault.cc:8888";
      this._raidaServers[14] = this.options.wsprotocol + "://ebc28-eera2-92e-10428.skyvault.cc:8888";
      this._raidaServers[15] = this.options.wsprotocol + "://ebc30-zxda2-92e-10430.skyvault.cc:8888";
      this._raidaServers[16] = this.options.wsprotocol + "://ebc32-wera2-92e-10432.skyvault.cc:8888";
      this._raidaServers[17] = this.options.wsprotocol + "://ebc34-34oa2-92e-10434.skyvault.cc:8888";
      this._raidaServers[18] = this.options.wsprotocol + "://ebc36-mhha2-92e-10436.skyvault.cc:8888";
      this._raidaServers[19] = this.options.wsprotocol + "://ebc38-qqra2-92e-10438.skyvault.cc:8888";
      this._raidaServers[20] = this.options.wsprotocol + "://ebc40-bhta2-92e-10440.skyvault.cc:8888";
      this._raidaServers[21] = this.options.wsprotocol + "://ebc42-nkla2-92e-10442.skyvault.cc:8888";
      this._raidaServers[22] = this.options.wsprotocol + "://cbe88-3i0a2-63e-21233.skyvault.cc:8888";
      this._raidaServers[23] = this.options.wsprotocol + "://7cbdbe-2arbf-e29-64401.skyvault.cc:8888";
      this._raidaServers[24] = this.options.wsprotocol + "://ebc48-adea2-92e-10448.skyvault.cc:8888";
    }
    else{
    this._raidaServers[0] = this.options.wsprotocol + "://87.120.8.249:8888";
    this._raidaServers[1] = this.options.wsprotocol + "://23.106.122.6:8888";
    this._raidaServers[2] = this.options.wsprotocol + "://172.105.176.86:8888";
    this._raidaServers[3] = this.options.wsprotocol + "://85.195.82.169:8888";
    this._raidaServers[4] = this.options.wsprotocol + "://198.244.135.236:8888";
    this._raidaServers[5] = this.options.wsprotocol + "://88.119.174.101:8888";
    this._raidaServers[6] = this.options.wsprotocol + "://209.141.52.193:8888";
    this._raidaServers[7] = this.options.wsprotocol + "://179.43.175.35:8888";
    this._raidaServers[8] = this.options.wsprotocol + "://104.161.32.116:8888";
    this._raidaServers[9] = this.options.wsprotocol + "://66.172.11.25:8888";
    this._raidaServers[10] = this.options.wsprotocol + "://194.29.186.69:8888";
    this._raidaServers[11] = this.options.wsprotocol + "://168.235.69.182:8888";
    this._raidaServers[12] = this.options.wsprotocol + "://185.118.164.19:8888";
    this._raidaServers[13] = this.options.wsprotocol + "://167.88.15.117:8888";
    this._raidaServers[14] = this.options.wsprotocol + "://23.29.115.137:8888";
    this._raidaServers[15] = this.options.wsprotocol + "://66.29.143.85:8888";
    this._raidaServers[16] = this.options.wsprotocol + "://185.99.133.110:8888";
    this._raidaServers[17] = this.options.wsprotocol + "://104.168.162.230:8888";
    this._raidaServers[18] = this.options.wsprotocol + "://170.75.170.4:8888";
    this._raidaServers[19] = this.options.wsprotocol + "://185.215.227.31:8888";
    this._raidaServers[20] = this.options.wsprotocol + "://51.222.229.205:8888";
    this._raidaServers[21] = this.options.wsprotocol + "://31.192.107.132:8888";
    this._raidaServers[22] = this.options.wsprotocol + "://180.235.135.143:8888";
    this._raidaServers[23] = this.options.wsprotocol + "://80.233.134.148:8888";
    this._raidaServers[24] = this.options.wsprotocol + "://147.182.249.132:8888";
  }
  }

  // Check if the coin is valid
  _validateCoin(coin) {
    if (typeof(coin) !== 'object')
      return false;

    if (!('sn' in coin))
      return false;

    if (!('an' in coin))
      return false;

    if (typeof(coin.an) != 'object' || !Array.isArray(coin.an))
      return false

    if ('pan' in coin) {
      if (typeof(coin.pan) != 'object' || !Array.isArray(coin.pan))
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
      if (mparts[i] == null || typeof(mparts[i]) == 'undefined')
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
      if (typeof(msg[i]) == 'undefined') {
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

    let rv =  {
      'metadata' : data['general'],
      'data' : vals[1]
    }

    if (vals.length == 3) {
      rv.proofdata = vals[2]
    }

    return rv
  }

  _getStripesMirrorsForObjectMemo(guid, memo, amount, from) {
    let str = "[general]\n"

    let date = Math.floor(Date.now() / 1000)

    str += "date=" + date + "\n"
    str += "guid=" + guid + "\n"
    str += "from=" + from + "\n"
    str += "amount=" + amount + "\n"
    str += "description=" + memo + "\n"

    str = this._b64EncodeUnicode(str)
    let data = this._splitMessage(str)

    return data
  }

  _getObjectMemo(guid, memo, amount, from) {
    let data = this._getStripesMirrorsForObjectMemo(guid, memo, amount, from)

    let d = []
    let ms = this.options.memoMetadataSeparator
    for (let i = 0; i < this._totalServers; i++) {
      d[i] = memo + ms + guid + ms + data[i]['stripe'] + ms + data[i]['mirror1'] + ms + data[i]['mirror2']
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
        'stripe' : "",
        'mirror1' : "",
        'mirror2' : ""
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
      output = decodeURIComponent(atob(str).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
    } else {
      output = Buffer.from(str, 'base64').toString('utf-8')
    }

    return output
  }

  // Neighbour table
  _getNeighbour(raidaIdx, offset) {
    let result = raidaIdx + offset

    if (result < 0)
      result += this._totalServers

    if (result >= this._totalServers)
      result -= this._totalServers

    return result
  }

  _initNeighbours() {
    let sideSize

    sideSize = Math.sqrt(this._totalServers)
    if (sideSize * sideSize != this._totalServers) {
      console.error("Invalid RAIDA dimensions")
      return
    }

    let trustedServers = Array(this._totalServers)
    let trustedTriads =  Array(this._totalServers)
    for (let i = 0; i < this._totalServers; i++) {
      trustedServers[i] = []

      trustedServers[i][0] = this._getNeighbour(i, -sideSize - 1)
      trustedServers[i][1] = this._getNeighbour(i, -sideSize)
      trustedServers[i][2] = this._getNeighbour(i, -sideSize + 1)
      trustedServers[i][3] = this._getNeighbour(i, -1)
      trustedServers[i][4] = this._getNeighbour(i, 1)
      trustedServers[i][5] = this._getNeighbour(i, sideSize - 1)
      trustedServers[i][6] = this._getNeighbour(i, sideSize)
      trustedServers[i][7] = this._getNeighbour(i, sideSize + 1)

      trustedTriads[i] = Array(4)
      trustedTriads[i][0] = [ trustedServers[i][0], trustedServers[i][1], trustedServers[i][3], trustedServers[i][7] ]
      trustedTriads[i][1] = [ trustedServers[i][1], trustedServers[i][2], trustedServers[i][4], trustedServers[i][5] ]
      trustedTriads[i][2] = [ trustedServers[i][3], trustedServers[i][5], trustedServers[i][6], trustedServers[i][2] ]
      trustedTriads[i][3] = [ trustedServers[i][4], trustedServers[i][6], trustedServers[i][7], trustedServers[i][0] ]
    }

    this._trustedTriads = trustedTriads
  }

  _getA(a, cnt) {
    let i, j
    let sns = Array(cnt)

    for (i = 0, j = 0; i < sns.length; i++) {
      if (a[i] == 0)
        continue;

      sns[j] = a[i]
      a[i] = 0
      j++

      if (j == cnt)
        break
    }

    if (j != cnt)
      return null

    return sns
  }

  _get25B(sb, ss) {
    let sns, rsns
    rsns = Array(9)

    sns = this._getA(sb, 4)
    if (sns == null)
      return null
    for (let i = 0; i < 4; i++)
      rsns[i] = sns[i]

    sns = this._getA(ss, 5)
    if (sns == null)
      return null
    for (let i = 0; i < 5; i++)
      rsns[i + 4] = sns[i]

    return rsns
  }

  _get100E(sb, ss, sss) {
    let sns, rsns
    rsns = Array(12)

    sns = this._getA(sb, 3)
    if (sns == null)
      return null

    for (let i = 0; i < 3; i++)
      rsns[i] = sns[i]

    sns = this._getA(ss, 4)
    if (sns == null)
      return null

    for (let i = 0; i < 4; i++)
      rsns[i + 3] = sns[i]

    sns = this._getA(sss, 5)
    if (sns == null)
      return null

    for (let i = 0; i < 5; i++)
      rsns[i + 7] = sns[i]

    return rsns
  }

  _get250E(sb, ss, sss, ssss) {
    let sns, rsns
    rsns = new Array(12)

    sns = this._getA(sb, 2)
    if (sns == null)
      return null
    for (let i = 0; i < 2; i++)
      rsns[i] = sns[i]

    sns = this._getA(ss, 1)
    if (sns == null)
      return null
    rsns[2] = sns[0]

    sns = this._getA(sss, 4)
    if (sns == null)
      return null
    for (let i = 0; i < 4; i++)
      rsns[i + 3] = sns[i]

    sns = this._getA(ssss, 5)
    if (sns == null)
      return null
    for (let i = 0; i < 5; i++)
      rsns[i + 7] = sns[i]

    return rsns
  }

  _calcAmount(sns) {
    let total = 0
    for (let i = 0; i < sns.length; i++)
      total += this.getDenomination(sns[i])

    return total
  }

  _countCoinsFromArray(coins) {
    let totals = new Array(6);
    totals.fill(0)

    for (let i = 0; i < coins.length; i++) {
      let denomination = this.getDenomination(coins[i]);
      if (denomination == 1)
        totals[0]++;
      else if (denomination == 5)
        totals[1]++;
      else if (denomination == 25)
        totals[2]++;
      else if (denomination == 100)
        totals[3]++;
      else if (denomination == 250)
        totals[4]++
      else
        continue;

      totals[5] += denomination;
    }

    return totals;
  }

  _getExpCoins(amount, totals, loose) {
    let savedAmount = amount;

    if (amount > totals[6]) {
      console.error("Not enough coins")
      return null;
    }

    if (amount < 0)
      return null;

    let exp_1, exp_5, exp_25, exp_100, exp_250
    exp_1 = exp_5 = exp_25 = exp_100 = exp_250 = 0
    for (let i = 0; i < 2; i++) {
      exp_1 = exp_5 = exp_25 = exp_100 = 0
      if (i == 0 && amount >= 250 && totals[4] > 0) {
        exp_250 = (Math.floor(amount / 250) < (totals[4])) ? Math.floor(amount / 250) : (totals[4])
        amount -= (exp_250 * 250);
      }

      if (amount >= 100 && totals[3] > 0) {
        exp_100 = (Math.floor(amount / 100) < (totals[3])) ? Math.floor(amount / 100) : (totals[3])
        amount -= (exp_100 * 100);
      }

      if (amount >= 25 && totals[2] > 0) {
        exp_25 = (Math.floor(amount / 25) < (totals[2])) ? Math.floor(amount / 25) : (totals[2])
        amount -= (exp_25 * 25);
      }

      if (amount >= 5 && totals[1] > 0) {
        exp_5 = (Math.floor(amount / 5) < (totals[1])) ? Math.floor(amount / 5) : (totals[1])
        amount -= (exp_5 * 5);
      }

      if (amount >= 1 && totals[0] > 0) {
        exp_1 = (amount < (totals[0])) ? amount : (totals[0])
        amount -= (exp_1);
      }

      if (amount == 0)
        break;

      if (i == 1 || exp_250 == 0) {
        if (loose)
          break;

        return null;
      }

      exp_250--
      amount = savedAmount - exp_250 * 250
    }

    let rv = new Array(5)
    rv[0] = exp_1
    rv[1] = exp_5
    rv[2] = exp_25
    rv[3] = exp_100
    rv[4] = exp_250

    return rv
  }


  _pickCoinsAmountFromArrayWithExtra(coins, amount) {
    let totals, exps
    let collected, rest
    let denomination
    let coinsPicked = []

    totals = this._countCoinsFromArray(coins)
    exps = this._getExpCoins(amount, totals, true)

    collected = rest = 0
    for (let i = 0; i < coins.length; i++) {
      denomination = this.getDenomination(coins[i]);
      if (denomination == 1) {
        if (exps[0]-- > 0) {
          coinsPicked.push(coins[i])
          collected += denomination
        }
      } else if (denomination == 5) {
        if (exps[1]-- > 0) {
          coinsPicked.push(coins[i])
          collected += denomination
        }
      } else if (denomination == 25) {
        if (exps[2]-- > 0) {
          coinsPicked.push(coins[i])
          collected += denomination
        }
      } else if (denomination == 100) {
        if (exps[3]-- > 0) {
          coinsPicked.push(coins[i])
          collected += denomination
        }
      } else if (denomination == 250) {
        if (exps[4]-- > 0) {
          coinsPicked.push(coins[i])
          collected += denomination
        }
      }
    }
    let isAdded;
    rest = amount - collected;
    let extraSN = 0

    if (rest == 0) {
      return {coins: coinsPicked, extra: 0};
    }

    for (let i = 0; i < coins.length; i++) {
      denomination = this.getDenomination(coins[i])
      extraSN = coins[i]

      if (rest > denomination)
        continue;

      isAdded = false;
      for (let j = 0; j < coinsPicked.length; j++) {
        if (coinsPicked[j] == coins[i]) {
          isAdded = true
          break
        }
      }

      if (isAdded) {
        continue;
      }

      break;
    }

    return {coins: coinsPicked, extra: extraSN};
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
    this.addBreadCrumbError("Returning Error To Client: " + msg)
    return {
      'status' : 'error',
      'errorText' : msg
    }
  }

  // Error Code Return
  _getErrorCode(code, msg) {
    this.addBreadCrumbError("Returning Error Code To Client: " + code + ": " + msg)
    return {
      // Legacy
      'status' : 'error',
      'errorText': msg,

      'code' : code,
      'text' : msg
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
    let base64  = ''
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
      c = (chunk & 4032) >>  6
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
  _parseINIString(data){
    var regex = {
      section: /^\s*\[\s*([^\]]*)\s*\]\s*$/,
      param: /^\s*([^=]+?)\s*=\s*(.*?)\s*$/,
      comment: /^\s*;.*$/
    }

    var value = {}
    var lines = data.split(/[\r\n]+/)
    var section = null

    lines.forEach(function(line) {
      if (regex.comment.test(line)){
        return;
      } else if(regex.param.test(line)){
        var match = line.match(regex.param);
        if(section){
          value[section][match[1]] = match[2];
        }else{
          value[match[1]] = match[2];
        }
      } else if (regex.section.test(line)){
        var match = line.match(regex.section);
        value[match[1]] = {};
        section = match[1];
      } else if (line.length == 0 && section){
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
        if (typeof(key) == 'undefined')
          continue

        if (!(key in hashData))
          hashData[key] = {}

        hashData[key][raidaIdx] = item
      } else if (level == 2) {
        for (let j = 0; j < serverResponse.data.length; j++) {
          let item = serverResponse.data[j]
          if (typeof(item) == 'undefined')
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
      this._launchRequests(fcall, lrqdata, 'GET', () => {}, servers)
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
      this._launchRequests(fcall, lrqdata, 'GET', () => {}, servers)
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
