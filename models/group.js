// Group schema
'use strict'

const mongoose = require ('mongoose');
const Schema = mongoose.Schema

const { conndbaccounts } = require('../db_connect')

const drugSchema = Schema({
	name: {type: String, default: ''},
	translations: {type: Object, default: []},
	snomed: {type: String, default: ''},
	drugsSideEffects: {type: Object, default: []}
})

const medicationSchema = Schema({
	adverseEffects: {type: Object, default: []},
	sideEffects: {type: Object, default: []},
	drugs: [drugSchema]
})

const GroupSchema = Schema({
	name: {
		type: String
  },
	subscription: String,
	email: String,
	order: Number,
	allowShare: {type: Boolean, default: true},
	defaultLang: {type: String, default: 'en'},
	phenotype: {type: Object, default: []},
	questionnaires: {type: Object, default: []},
	medications: {
		type: medicationSchema, default:{
			adverseEffects:[],
			sideEffects:[],
			drugs:[]
		}
	}
})

module.exports = conndbaccounts.model('Group',GroupSchema)
// we need to export the model so that it is accessible in the rest of the app
