"use strict";
// Import the dependency.
const clientPromise = require('./mongo-client');
const obj = require('./validator.js');

// Handler
module.exports.handler = async function (event, context, callback) {
  const client = await clientPromise;

  var message = event.Records[0].Sns.Message;
  message = JSON.parse(message);
  console.table(message);
  console.log(JSON.stringify(message, null, '\t'));
  const collections = await getCollection('prospects');
  console.log("Collection Gotten ",collections);
  var table;
  if (!collections) {
    const response = {
      statusCode: 404,
      message: 'Prospects is not found'
    }
    return response;
  }
  else {
    table = collections;
  }
  //    
  try {
    const validSchema = await obj.validateProspectSchema(message);

    if (!validSchema) throw { schemaError: "Schema-Invalid ", prospectId: message?.prospect_id, table: " Prospect" };
    const record = await table.findOne({ prospect_id: { $eq: message?.prospect_id } });
    const isprospectId = record;

    if (message?.messageInfo?.origin !== 'pams') {
      throw "INFO : Origin invalid";;
    }
    message[`documentStatus`] = message?.messageInfo?.documentStatus;
    delete message['messageInfo'];
    if (!isprospectId && table) {
      table.insertOne(message);
    } else {
      if (Date.parse(isprospectId.lastUpdateTime) < Date.parse(message.lastUpdateTime)) {
        if (isprospectId?.documentStatus === "ActivatedButNotCheckedOut" || isprospectId?.documentStatus === "PickUpComplete") {
          throw "Prospect already "+isprospectId?.documentStatus;
        }
        table.updateOne(
          { prospect_id: isprospectId.prospect_id }
          , { $set: message })
      } else {
        const response = {
          statusCode: 400,
          message: 'Topic came before the latest'
        }
        return response;
      }
    }
  }
  catch (err) {
    if (err?.schemaError) {
      console.error("Schema-Invalid", err);
    } else {
      console.error(err);
    }
    const response = {
      statusCode: 400,
      message: err
    };
    return response;
  }


  return client.db().databaseName;
}

/**
 *
 * @param {string} val
 * @returns
 */
const getCollection = function (val) {
  return new Promise(async (resolve, reject) => {
    const db = await clientPromise.connectToDB("vams");
    const collections = await db.collection(val);
    if (!collections) {
      console.error(`Collection ${val} is not found`);
      reject(`Collection ${val} is not found`)
    }
    resolve(collections);
  });
};
