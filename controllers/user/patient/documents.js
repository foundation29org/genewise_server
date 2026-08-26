'use strict'

const recognizerService = require("../../../services/recognizer")
const insights = require('../../../services/insights')
const f29azureService = require("../../../services/f29azure")
const path = require('path');

async function uploadFile(req, res) {
	let containerName = 'data';
	try {
		if (req.files == null) {
			insights.error('Error: no files');
			return res.status(400).send({ message: 'Error: no files' });
		}
		const saved = await saveBlob('data', req.body.url, req.files.thumbnail);
		if (!saved) {
			return res.status(500).send({ message: 'Error saving file to storage' });
		}
		const filename = path.basename(req.body.url);
		console.log(req.body.docId)
		console.log(req.body.url)
		console.log(filename)
		const result = await recognizerService.form_recognizer(req.body.userId, req.body.docId, containerName, req.body.url)
		return res.status(200).send(result)
	} catch (error) {
		insights.error(error);
		const status = error.status || 500;
		const message = error.error || error.message || 'Upload failed';
		return res.status(status).send({
			message,
			details: error.details || null
		});
	}
}






async function saveBlob(containerName, url, thumbnail) {
	return new Promise(async function (resolve, reject) {
		// Save file to Blob
		var result = await f29azureService.createBlob(containerName, url, thumbnail.data);
		if (result) {
			resolve(true);
		} else {
			resolve(false);
		}
	});
}

module.exports = {
	uploadFile
}
