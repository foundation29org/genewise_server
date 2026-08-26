'use strict'

const mongoose = require ('mongoose')
const config = require('./config')

mongoose.set('strictQuery', false)

const conndbaccounts = mongoose.createConnection(config.dbaccounts)

module.exports = {
	conndbaccounts
}
