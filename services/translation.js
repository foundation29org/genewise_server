'use strict'

const config = require('../config')
const axios = require('axios')
const deepl = require('deepl-node');
const insights = require('../services/insights')
const deeplApiKey = config.DEEPL_API_KEY;
const langchain = require('../services/langchain')

async function microsoftTranslatorPost(url, body) {
  const response = await axios.post(url, body, {
    headers: {
      'Ocp-Apim-Subscription-Key': config.translationKey,
      'Ocp-Apim-Subscription-Region': 'northeurope',
      'Content-Type': 'application/json'
    }
  });
  return response.data;
}

function sendTranslatorError(res, error) {
  console.error(error);
  insights.error(error);
  const payload = error.response?.data || error.message || error;
  const status = error.response?.status || 500;
  res.status(status).send(payload);
}

function sendTranslatorBody(res, body) {
  if (body == 'Missing authentication token.') {
    res.status(401).send(body);
  } else {
    res.status(200).send(body);
  }
}

async function getDetectLanguage(req, res) {
  try {
    const body = await microsoftTranslatorPost(
      'https://api.cognitive.microsofttranslator.com/detect?api-version=3.0',
      req.body
    );
    sendTranslatorBody(res, body);
  } catch (error) {
    sendTranslatorError(res, error);
  }
}

async function getTranslationDictionary (req, res){
  try {
    const body = await microsoftTranslatorPost(
      'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&&from='+req.body.lang+'&to=en',
      req.body.info
    );
    sendTranslatorBody(res, body);
  } catch (error) {
    sendTranslatorError(res, error);
  }
}

async function getTranslationDictionary2 (text, source_lang){
  return microsoftTranslatorPost(
    'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&&from='+source_lang+'&to=en',
    text
  );
}

async function getTranslationDictionaryInvert (req, res){
  try {
    const body = await microsoftTranslatorPost(
      'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&&from=en&to='+req.body.lang,
      req.body.info
    );
    sendTranslatorBody(res, body);
  } catch (error) {
    sendTranslatorError(res, error);
  }
}

async function getdeeplTranslationDictionaryInvert (req, res){
  var lang = req.body.lang;
  var info = req.body.info;
  var deepl_code = await getDeeplCode(lang);
  if (deepl_code == null) {
    const inverseTranslatedText = await getTranslationDictionaryInvertMicrosoft2(info, lang);
    let source_text = inverseTranslatedText[0].translations[0].text
    res.status(200).send({text: source_text})
  } else {
    if(info[0].Text == null || info[0].Text == undefined || info[0].Text == ''){
      res.status(200).send({text: ''})
    }else{
      let source_text = await deepLtranslate(info[0].Text, deepl_code);
      res.status(200).send({text: source_text})
    }
    
  }
}

async function getTranslationDictionaryInvert2 (req, res){
  var lang = req.body.lang;
  var info = req.body.info;
  var deepl_code = await getDeeplCode(lang);
  if (deepl_code == null) {
    const inverseTranslatedText = await getTranslationDictionaryInvertMicrosoft2(info, lang);
    let source_text = inverseTranslatedText[0].translations[0].text
    res.status(200).send({text: source_text})
  } else {
     // Realiza una traducción para cada fragmento de texto
    let translatedLines = [];
    for(let item of info){
      if(item.Text == null || item.Text == undefined || item.Text == ''){
        translatedLines.push('');
      }else{
        let source_text = await deepLtranslate2(item.Text, deepl_code);
        translatedLines.push(source_text);
      }
      
    }
    res.status(200).send(translatedLines);
  }
}

async function getTranslationDictionaryInvertMicrosoft2 (text, source_lang){
  return microsoftTranslatorPost(
    'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&&from=en&to='+source_lang,
    text
  );
}

async function getTranslationSegments(req, res){
  try {
    const body = await microsoftTranslatorPost(
      'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&&from='+req.body.originlang+'&to='+req.body.lang+'&textType=html',
      req.body.segments
    );
    if (body == 'Missing authentication token.') {
      insights.error(body);
      res.status(401).send(body);
    } else {
      res.status(200).send(body);
    }
  } catch (error) {
    sendTranslatorError(res, error);
  }
}


  const langDict = {
    "af": null,
    "sq": null,
    "am": null,
    "ar": null,
    "hy": null,
    "as": null,
    "az": null,
    "bn": null,
    "ba": null,
    "eu": null,
    "bs": null,
    "bg": "BG",
    "yue": null,
    "ca": null,
    "lzh": null,
    "zh-Hans": "ZH",
    "zh-Hant": "ZH",
    "hr": null,
    "cs": "CS",
    "da": "DA",
    "prs": null,
    "dv": null,
    "nl": "NL",
    "en": "EN-US",
    "et": "ET",
    "fo": null,
    "fj": null,
    "fil": null,
    "fi": "FI",
    "fr": "FR",
    "fr-ca": null,
    "gl": null,
    "ka": null,
    "de": "DE",
    "el": "EL",
    "gu": null,
    "ht": null,
    "he": null,
    "hi": null,
    "mww": null,
    "hu": "HU",
    "is": null,
    "id": "ID",
    "ikt": null,
    "iu": null,
    "iu-Latn": null,
    "ga": null,
    "it": "IT",
    "ja": "JA",
    "kn": null,
    "kk": null,
    "km": null,
    "tlh-Latn": null,
    "tlh-Piqd": null,
    "ko": "KO",
    "ku": null,
    "kmr": null,
    "ky": null,
    "lo": null,
    "lv": "LV",
    "lt": "LT",
    "mk": null,
    "mg": null,
    "ms": null,
    "ml": null,
    "mt": null,
    "mi": null,
    "mr": null,
    "mn-Cyrl": null,
    "mn-Mong": null,
    "my": null,
    "ne": null,
    "nb": "NB",
    "or": null,
    "ps": null,
    "fa": null,
    "pl": "PL",
    "pt": "pt-PT",
    "pt-pt": null,
    "pa": null,
    "otq": null,
    "ro": "RO",
    "ru": "RU",
    "sm": null,
    "sr-Cyrl": null,
    "sr-Latn": null,
    "sk": "SK",
    "sl": "SL",
    "so": null,
    "es": "ES",
    "sw": null,
    "sv": "SV",
    "ty": null,
    "ta": null,
    "tt": null,
    "te": null,
    "th": null,
    "bo": null,
    "ti": null,
    "to": null,
    "tr": "TR",
    "tk": null,
    "uk": "UK",
    "hsb": null,
    "ur": null,
    "ug": null,
    "uz": null,
    "vi": null,
    "cy": null,
    "yua": null,
    "zu": null
};

async function getDeeplCode(msCode) {
    return langDict[msCode] || null;
}

async function deepLtranslate(text, target) {
  if(text == null || text == undefined || text == ''){
    return '';
  }else{
    const translator = new deepl.Translator(deeplApiKey);
    const result = await translator.translateText(text, null, target, { tagHandling: 'html' });
    return result.text;
  }
    
}

async function deepLtranslate2(text, target) {
  if(text == null || text == undefined || text == ''){
    return '';
  }else{
    const translator = new deepl.Translator(deeplApiKey);
    const result = await translator.translateText(text, null, target, {
      tagHandling: 'html',
    });
    return result.text;
  }
 
}

async function getTranslationIA(req, res){
  try {
    var result = await langchain.translateText(req.body.lang, req.body.text);
    res.status(200).json({ text: result });
  } catch (error) {
    insights.error(error);
    res.status(500).send({ error: error.message || error });
  }
}

module.exports = {
  getDetectLanguage,
  getTranslationDictionary,
  getTranslationDictionary2,
  getTranslationDictionaryInvert,
  getTranslationDictionaryInvertMicrosoft2,
  getTranslationSegments,
  getDeeplCode,
  deepLtranslate,
  getdeeplTranslationDictionaryInvert,
  getTranslationDictionaryInvert2,
  getTranslationIA
}
