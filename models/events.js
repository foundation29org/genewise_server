// eventsdb schema
'use strict'

const mongoose = require ('mongoose');
const Schema = mongoose.Schema
const Patient = require('./patient')

const { conndbdata } = require('../db_connect')

const EventsSchema = Schema({
	type: String,
	main: {type: Boolean, default: false},
	subtype: {type: String, default: ''},
	name: {type: String, default: ''},
	date: {type: Date, default: null},
	endDate: {type: Date, default: null},
	checked: {type: Boolean, default: null},
	data: {type: Object, default: {}},
	dateInput: {type: Date, default: Date.now},
	notes: {type: String, default: ''},
	originText: {type: String, default: ''},
	documentId: {type: String, default: ''},
	createdBy: { type: Schema.Types.ObjectId, ref: "Patient"}
})

module.exports = conndbdata.model('Events',EventsSchema)
// we need to export the model so that it is accessible in the rest of the app
