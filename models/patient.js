// Patient schema
'use strict'

const mongoose = require ('mongoose')
const Schema = mongoose.Schema
const User = require('./user')

const { conndbaccounts } = require('../db_connect')

const checksSchema = Schema({
	check1: {type: Boolean, default: false},
	check2: {type: Boolean, default: false},
	check3: {type: Boolean, default: false},
	check4: {type: Boolean, default: false}
})

const generalShareSchema = Schema({
	data:{},
	notes: {type: String, default: ''},
	date: {type: Date, default: Date.now},
	token: {type: String, default: ''}
})

const individualShareSchema = Schema({
	data:{},
	notes: {type: String, default: ''},
	date: {type: Date, default: Date.now},
	token: {type: String, default: ''},
	idUser: {type: String, default: null},
	status: {type: String, default: 'Pending'},
	verified: {type: String, default: ''}
})

const PatientSchema = Schema({
	patientName: {type: String, default: ''},
	surname: {type: String, default: ''},
	birthDate: Date,
	citybirth: String,
	provincebirth: String,
	countrybirth: String,
	street: {type: String, default: null},
	postalCode: {type: String, default: null},
	city: {type: String, default: null},
	province: {type: String, default: null},
	country: {type: String, default: null},
	phone: String,
	gender: {type: String, default: null},
	createdBy: { type: Schema.Types.ObjectId, ref: "User"},
	death: Date,
	sharing: {type: Object, default: []},
	status: {type: String, default: null},
	lastAccess: {type: Date, default: Date.now},
	creationDate: {type: Date, default: Date.now},
	group: { type: String, default: null},
	consentgroup: {type: String, default: 'false'},
	donation: {type: Boolean, default: false},
	summary: {type: String, default: 'false'},
	summaryDate: {type: Date, default: null},
	checks: {type: checksSchema, default: {
		check1: false,
		check2: false,
		check3: false,
		check4: false
	}},
	generalShare:{
		type: generalShareSchema, default:{
			data:{},
			notes: '',
			date: null,
			token: ''
		}
	},
	customShare: [generalShareSchema],
	individualShare: [individualShareSchema]
})

module.exports = conndbaccounts.model('Patient',PatientSchema)
// we need to export the model so that it is accessible in the rest of the app
