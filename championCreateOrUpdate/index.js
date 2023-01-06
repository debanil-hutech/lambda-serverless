const clientPromise = require('./mongo-client');
const validator = require('./validator.js');
const AWS = require("aws-sdk");
const sns = new AWS.SNS();
AWS.config.update({ region: process.env.AWS_REGION_CUSTOM });
exports.handler = async (event) => {
  var message = event.Records[0].Sns.Message;
  try {
    message = JSON.parse(message);
  }
  catch (err) {
    console.error('Json is incorrect');
    return "Json incorrect";
  }
  console.table(message);
  console.log(JSON.stringify(message,null,'\t'));
  const validSchema = await validator.validateChampionSchema(message);
  if (!validSchema) throw { schemaError: "Schema-Invalid ", table: "Champion" };
  console.warn("Schema is valid", validSchema);
  const vehicleCollection = await getCollection("vehicles");
  const championCollection = await getCollection("champions");
  const activationCollection = await getCollection("activations");
  try {
    let findVehicle;
    try {
      findVehicle = await vehicleCollection.findOne({ vehicle_id: { $eq: message?.vehicle_id } });
    } catch (e) {
      throw "Activation record with given vehicle id not found";
    }
    let findActivation;
    try {
      findActivation = await activationCollection.findOne({ $and: [{ prospect_id: message?.prospect_id }, { vehicle_id: message?.vehicle_id }, {documentStatus : {$ne : "ActivationCancelled"}}] });
    } catch (e) {
      throw "Activation record with given prospect id and vehicle id is not found";
    }


    if (!findVehicle) {
      console.error('Champion is not assosiated with correct Vehicle');
      throw `Activation record with given vehicle id ${message?.vehicle_id} not found`;
    }
    if (!findActivation) {
      console.error('Champion is not assosiated with correct Activation');
      throw "Champion is not assosiated with correct Activation and activation not found";
    }

    if (message?.messageInfo?.origin !== 'cs') {
      throw "INFO : Origin invalid";
    }
    if (message?.messageInfo?.documentStatus !== 'Activated') {
      return "Not Activated";
    }
    message[`documentStatus`] = message?.messageInfo?.documentStatus;
    delete message['messageInfo'];
    let findChampion;
    try {
      findChampion = await championCollection.findOne({ champion_id: { $eq: message?.champion_id } });
      if (!findChampion) {
        await championCollection.insertOne(message);
      } else {
        await championCollection.updateOne(
          { champion_id: message?.champion_id }
          , { $set: message });
      }
    } catch (e) {
      console.error(e);
      throw `Activation record with given Champion id ${message?.champion_id}  is not found`;
    }
    await vehicleCollection.updateOne(
      { vehicle_id: findVehicle?.vehicle_id }
      , {
        $set: {
          champion_id: message?.champion_id
        }
      }
    );
    const championUpdate={
      champion_id: message?.champion_id,
      champion_uuid_id: message?.champion_uuid_id,
    };
    await activationCollection.updateOne(
      { activation_id: findActivation?.activation_id }
      , {
        $set: {
          ...championUpdate,
          lastUpdateTime: new Date().toISOString(),
        }
      }
    );
    const newVehicle = {
      ...findVehicle,
      ...championUpdate,
      messageInfo:{
        documentStatus:findVehicle?.documentStatus,
        origin:'vams2.0'
      },
      lastUpdateTime: new Date().toISOString(),
      messageType: "champion_info_updated",
    };
    delete newVehicle['_id'];
    delete newVehicle['documentStatus'];
    var vehicleParam = {
      Message: JSON.stringify(newVehicle),
      TopicArn: process.env.VEHICLE_SNS,
    };
    console.warn("New Vehicle",newVehicle);
    await sns
      .publish(vehicleParam)
      .promise()
      .then((data) => {
        console.log("Message ID", data, "has been sent");
      })
      .catch((err) => {
        console.error(err, err.stack);
      });
      console.log("End of championCreateOrUpdate");
  } catch (e) { console.error(e); return e; }




  return "Champion added";

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