'use strict'

const bookService = require("../../../services/books")
const insights = require('../../../services/insights')
const f29azureService = require("../../../services/f29azure")
const path = require('path');

async function uploadFile(req, res) {
	let containerName = 'data';
	if (req.files != null) {
		var data1 = await saveBlob('data', req.body.url, req.files.thumbnail);
		if (data1) {
			const filename = path.basename(req.body.url);
			console.log(req.body.docId)
			console.log(req.body.url)
			console.log(filename)
			var result = await bookService.form_recognizer(req.body.userId, req.body.docId, containerName, req.body.url)
			// var result = await bookService.createBook(req.body.docId, containerName, req.body.url, filename);
			res.status(200).send(result)
		}
	} else {
		insights.error('Error: no files');
		res.status(500).send({ message: `Error: no files` })
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
