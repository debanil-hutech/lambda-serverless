const AWS = require("aws-sdk");
const { ObjectId, Collection } = require("mongodb");
const sns = new AWS.SNS();
const clientPromise = require("./mongo-client");
AWS.config.update({ region: process.env.AWS_REGION_CUSTOM });
const validate = require('./validator.js');

exports.handler = (event) => {
  registerVehicleProcess();
};

function MongoError(message) {
  this.data = message;
  Error.captureStackTrace(this, MongoError);
}
/**
 *
 * @param {string} key
 * @param {string} updateDoc
 * @returns {void}
 */
const registerVehicleProcess = async () => {
  const vehicleCollection = await getCollection("vehicles");
  const registrationCollection = await getCollection("registrations");
  const uniqueIdentifierCounterCollection = await getCollection(
    "uniqueIdentifierCounter"
  );
  const registrationDocuments = await registrationCollection
    .find({ documentStatus: { $eq: "SubmittedForRegistration" } })
    .sort({ lastUpdateTime: 1 })
    .toArray();
  const session = (await clientPromise).startSession();

  for (const registration of registrationDocuments) {
    try {
      session.startTransaction({
        readConcern: { level: "local" },
        writeConcern: { w: "majority" },
      });
      if(registration?.vehicle_id != "new"){
        throw("Vehicle does not have indication to generate new record");
      }
      let vehicleId = await generateVehicleId(
        registration?.platformInfo,
        registration?.vehicleType,
        registration?.vehicleLocation,
        uniqueIdentifierCounterCollection
      );
      let iteration = 0;
      let findVehicle = await vehicleCollection.findOne({
        vehicle_id: { $eq: vehicleId },
      });
      
      const topicVehicle = {
        ...registration,
        vehicle_id: vehicleId,
        lastUpdateTime: new Date().toISOString(),
        messageInfo:{
          documentStatus: "ReadyForActivation",
          origin:'vams2.0'
        },
      };
      const validSchema = await validate.validateVehicleSchema(topicVehicle);
      console.log(`Valid Schema`, validSchema);
      if (!validSchema) throw { schemaError: "Schema-Invalid ", vehicleId: vehicleId, table: " Vehicle" };
      const updateVehicleDB = {
        ...registration,
        vehicle_id: vehicleId,
        lastUpdateTime: new Date().toISOString(),
        messageType: "activated",
        documentStatus:"ReadyForActivation"
      };
      const statCode =await registrationVehicleDB(updateVehicleDB,registrationCollection,vehicleCollection,registration);
      console.log('statCode: ', statCode);
      submitVehicleTopic(topicVehicle);
      if(statCode !== "RE"){
        await registrationCollection.updateOne(
          {
            _id: registration?._id,
          },
          {
            $set: {
              documentStatus: "RegistrationComplete",
            },
          }
        );
      }
      await session.commitTransaction();
    } catch (err) {
      session.abortTransaction();
      console.error("Session Aborted :", err);
    } finally {
      session.endSession();
    }
  }
};


function titleCase(str) {
  if(!str) return "";
  return str.toLowerCase().split(' ').map(function(word) {
      return word.replace(word[0], word[0].toUpperCase());
  }).join(' ');
}
/**
 * @description Generate Vehicle Id
 * @param {string} platformInfo
 * @param {string} vehicleType
 * @param {string} location
 * @param {Collection} uniqueIdentifierCounterCollection
 */
const generateVehicleId = async (
  platformInfo,
  vehicleType,
  location,
  uniqueIdentifierCounterCollection
) => {
  const locationMapCollection = await getCollection("locations");
  const vehicleTypeCollection = await getCollection("vehicleTypes");
  const locationCode = await locationMapCollection.findOne({
    location: { $eq: titleCase(location) },
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
 * @param {Document} newData
 * @returns {void}
 */
const submitVehicleTopic = async (newData) => {
  var vehicleParam = {
    Message: JSON.stringify(newData),
    TopicArn: process.env.VEHICLE_SNS,
  };
  await sns
    .publish(vehicleParam)
    .promise()
    .then((data) => {
      console.log("Message ID", data, "has been sent");
    })
    .catch((err) => {
      console.error(err, err.stack);
    });
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

/**
 * 
 * @param {any} updateVehicleDB 
 * @param {Collection} registrationCollection 
 * @returns 
 */
const registrationVehicleDB = async (
  updateVehicleDB,
  registrationCollection,
  vehicleCollection,
  registration
) => {
    return vehicleCollection.insertOne(updateVehicleDB).catch(async (err)=>{
      const mongoErr = new MongoError(err);
      const data = mongoErr.data;
      if (data?.code === 11000) {
        if (data?.keyPattern?.hasOwnProperty("plateNumber")) {
          await registrationCollection.updateOne(
            {
              _id: registration?._id,
            },
            {
              $set: {
                documentStatus: "RegistrationException",
              },
            }
          );
          console.error("Registration Exception");
          return 'RE';//Registration Exception
        }
        if (data?.keyPattern?.hasOwnProperty("vehicle_id")) {
          const id = (data?.keyValue?.vehicle_id).split("-");
          const number = Number(id[id.length - 1]) || 0;
          id.pop();
          id.push((number + 1).toString().padStart(5, "0"));
          let vehicleId = id.join("-");
          updateVehicleDB.vehicle_id = vehicleId;
          const val = registrationVehicleDB(
            updateVehicleDB,
            registrationCollection,
            vehicleCollection,
            registration
          );
          return 'VE';//Vehicle Exception
        }
      }
    });
  
};

