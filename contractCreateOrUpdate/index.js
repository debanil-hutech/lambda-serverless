"use strict";
// Import the dependency.
const clientPromise = require('./mongo-client');
const obj = require('./validator.js');
const AWS = require("aws-sdk");
const sns = new AWS.SNS();
// Handler
module.exports.handler = async function (event) {
  try {
    var message = event.Records[0].Sns.Message;
    message = JSON.parse(message);
    console.table(message);
    console.log(JSON.stringify(message, null, '\t'));
    const validSchema = await obj.validateContractSchema(message);
    if (!validSchema) throw { schemaError: "Schema-Invalid ", table: "Contract" };
    console.warn("Schema is valid", validSchema);
    if (message?.messageInfo?.origin !== 'lams2.0') {
      throw "INFO : Origin invalid";
    }
    const contract = message;
    if (contract?.messageInfo?.documentStatus === 'ContractInitiated') {
      await updateActivation(contract)
    } else if (contract?.messageInfo?.documentStatus === 'ContractActivated') {  
      await updateVehicle(contract)
    } else {
      throw (`Invalid Document Status`);
    }

  } catch (err) {
    console.error(err)
  }

  return true;
};
/**
 * @description update vehicle
 * @param {object} message 
 */
const updateVehicle = async (message) => {
  const vehicleCollection = await getCollection('vehicles');
  let findVehicle;

  try {
    findVehicle = await vehicleCollection.findOne(
      {
      $and: [
        { champion_id: { $eq: message?.champion_id } },
        { vehicle_id: { $eq: message?.vehicle_id } }
      ]
    }
    );
    if (!findVehicle) {
      throw (`Vehicle for this contract not found`);
    }
    if(findVehicle?.documentStatus !== 'PickUpComplete'){
      throw (`Invalid Vehicle Status`);
    }
    const updatingVehicle = {
      contractStatus: 'ContractActivated'
    };
    if(message?.messageInfo?.documentStatus === "V1ContractCreated"){
      updatingVehicle['v1_contract_id'] = message?.contract_id;
    }
    await vehicleCollection.updateOne(
      { vehicle_id: message?.vehicle_id }
      , {
        $set: updatingVehicle
      });
    
    const updateVehicle = {
      messageInfo: {
        documentStatus: "ContractActivated",
        origin: 'vams2.0'
      },
      lastUpdateTime: new Date().toISOString(),
      messageType: "contract_info_updated",
    };
    var vehicleParam = {
      Message: JSON.stringify(updateVehicle),
      TopicArn: process.env.VEHICLE_SNS,
    };
    console.warn("Updated Vehicle", updateVehicle);
    await sns
      .publish(vehicleParam)
      .promise()
      .then((data) => {
        console.log("Message ID", data, "has been sent");
      })
      .catch((err) => {
        console.error(err, err.stack);
      });
    console.log("End of updateVehicle in contractCreateOrUpdate");
  } catch (e) {
    console.error({ ErrorMessage: "Could not complete find operation", Error: e });
  }
};

/**
 * @description update activation
 * @param {object} message 
 */
const updateActivation = async (message) => {
  const activationCollection = await getCollection("activations");
  let findActivation;
  try {
    findActivation = await activationCollection.findOne(
      {
        $and: [
          {
            $or: [
              { champion_id: { $eq: message?.champion_id } },
              { vehicle_id: { $eq: message?.vehicle_id } }
            ],
          },
          { documentStatus: { $eq: 'ActivatedButNotCheckedOut' } }
        ]
      }
    );
  } catch (e) {
    throw "Could not complete find operation";
  }

  if (!findActivation) {
    throw "No activation record found";
  }

  await activationCollection.updateOne({
    activation_id: findActivation?.activation_id
  }, {
    $set: {
      contractStatus: "ContractInitiated",
      contract_id: message?.contract_id,
    }
  });
};

/**
 *
 * @param {string} val
 * @returns
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