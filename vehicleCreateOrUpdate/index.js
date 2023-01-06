"use strict";
// Import the dependency.
const clientPromise = require('./mongo-client');
const obj = require('./validator.js');
// Handler
module.exports.handler = async function (event, context, callback) {
  const client = await clientPromise;
  try {
    var message = event.Records[0].Sns.Message;
    message = JSON.parse(message);
    const db = client.db();
    const collections = await db.collection('vehicles');
    //                 
    var table;
    //   
    if (!collections) {
      throw "Collection Vehicle not Found";
    }
    else {
      table = collections;
    }
    console.log("Message", message, obj);
    if (message?.messageInfo?.origin !== 'vams1.0') {
      throw "INFO : Origin invalid";
    }
    if(message?.vehicle_id === ''){
      const uniqueIdentifierCounterCollection = await getCollection(
        "uniqueIdentifierCounter"
      );
      message.vehicle_id = await generateVehicleId(message?.platformInfo, message?.vehicleType,message?.vehicleLocation,uniqueIdentifierCounterCollection);
    }
    const validSchema = await obj.validateVehicleSchema(message);
    console.log(`Valid Schema`, validSchema);
    if (!validSchema) throw { schemaError: "Schema-Invalid ", vehicleId: message?.vehicle_id, table: " Vehicle" };
   
    message[`documentStatus`] = message?.messageInfo?.documentStatus;
    delete message['messageInfo'];
    const record = await table.findOne({ vehicle_id: { $eq: message?.vehicle_id } });
    const isvehicleId = record;

    if (!isvehicleId && table) {
      table.insertOne(message);
    } else {
      if (Date.parse(isvehicleId.lastUpdateTime) < Date.parse(message.lastUpdateTime)) {
        if(isvehicleId?.documentStatus === "ActivatedButNotCheckedOut"){
          throw "Vehicle already activated";
        }
        table.updateOne(
          { vehicle_id: isvehicleId.vehicle_id }
          , { $set: message });
      } else {
        const response = {
          statusCode: 400,
          message: 'Topic came before the latest'
        };
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


const generateVehicleId = async (
  platformInfo,
  vehicleType,
  location,
  uniqueIdentifierCounterCollection
) => {
  const locationMapCollection = await getCollection("locations");
  const vehicleTypeCollection = await getCollection("vehicleTypes");
  const locationCode = await locationMapCollection.findOne({
    location: { $eq: location },
  });
  const typeCode = await vehicleTypeCollection.findOne({
    type: { $eq: vehicleType },
  });
  let vehicleCode = [platformInfo, locationCode?.code, typeCode?.code];
  const inc=1;
  const collection = await uniqueIdentifierCounterCollection.findOneAndUpdate(
    { _id: "vehicle_id" },
    {
      $inc: { count: inc },
    },
    { returnDocument: "after" }
  );
  const value = collection?.value?.count;
  vehicleCode.push(value.toString().padStart(5, "0"));
  return vehicleCode.join("-");
};


/**
 *
 * @param {string} val
 * @returns {Collection}
 */
 const getCollection = function (val) {
  return new Promise(async (resolve, reject) => {
    const client = await clientPromise;
    const db = client.db();
    const collections = await db.collection(val);
    if (!collections) {
      console.error(`Collection ${val} is not found`);
      reject(`Collection ${val} is not found`)
    } 
    resolve(collections);
  });
};