const AWS = require("aws-sdk");
const sns = new AWS.SNS();
const { ObjectId } = require('mongodb');
const clientPromise = require("./mongo-client");

// Set the parameters
/**
 *
 * @param {string} key
 * @param {string} updateDoc
 */
const pickUpProcess = async (movementDocument) => {
  const vehicleCollection = await getCollection("vehicles");
  const prospectCollection = await getCollection("prospects");
  const movementCollection = await getCollection("movements");
  const activationCollection = await getCollection("activations");
  const session = (await clientPromise).startSession();
  console.log(JSON.stringify(movementDocument, null, '\t'));
  try {
    const findActivation = await activationCollection.findOne({
      activation_id: { $eq: movementDocument?.pickUpInfo?.activation_id },
    });
    if (!findActivation) {
      throw "activation not available";
    }
    const findVehicle = await vehicleCollection.findOne({
      vehicle_id: { $eq: findActivation?.vehicle_id },
    });
    const findProspect = await prospectCollection.findOne({
      prospect_id: { $eq: findActivation?.prospect_id },
    });
    //Vehicle Collection Modification
    const checkMaintainenceStatus = !!findVehicle?.lastMovementInfo?.maintenanceStatus === false || (!!findVehicle?.lastMovementInfo?.maintenanceStatus && findVehicle?.lastMovementInfo?.maintenanceStatus === "Complete")
    if (
      findVehicle?.documentStatus === "ActivatedButNotCheckedOut" &&
      findProspect?.documentStatus === "ActivatedButNotCheckedOut" &&
      findActivation?.contractStatus === "ContractInitiated" &&
      checkMaintainenceStatus
    ) {
      session.startTransaction({
        readConcern: { level: "local" },
        writeConcern: { w: "majority" },
      });
      const vehicleUpdate = {
        prospect_id: findActivation?.prospect_id,
        contract_id: findActivation?.contract_id,
        lastUpdateTime: new Date().toISOString(),
      };
      await vehicleCollection.updateOne(
        { vehicle_id: findVehicle.vehicle_id },
        {
          $set: {
            vehicleStatus: "Active",
            documentStatus: "PickUpComplete",
            ...vehicleUpdate,
            lastMovementInfo: Object.assign(movementDocument, {
              documentStatus: 'PickUpComplete',
              lastUpdateTime: new Date().toISOString(),
            }),
          },
        }
      );
      const newVehicle = {
        ...findVehicle,
        vehicleStatus: "Active",
        messageInfo: {
          documentStatus: "PickUpComplete",
          origin: 'vams2.0'
        },
        ...vehicleUpdate,
        messageType: "pickup",
      };
      var vehicleParam = {
        Message: JSON.stringify(newVehicle),
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
      const prospectUpdate = {
        lastUpdateTime: new Date().toISOString(),
      };
      //Prospect Collection Modification
      await prospectCollection.updateOne(
        {
          prospect_id: findActivation?.prospect_id,
        },
        {
          $set: {
            ...prospectUpdate,
            documentStatus: "PickUpComplete",
          },
        }
      );
      const prospectActivate = {
        ...findProspect,
        ...prospectUpdate,
        messageInfo: {
          documentStatus: "PickUpComplete",
          origin: 'vams2.0'
        },
        messageType: "pickup",
      };
      var prospectParam = {
        Message: JSON.stringify(prospectActivate),
        TopicArn: process.env.PROSPECT_SNS,
      };

      await sns
        .publish(prospectParam)
        .promise()
        .then((data) => {
          console.log("Message ID", data, "has been sent");
        })
        .catch((err) => {
          console.error(err, err.stack);
        });

      await movementCollection.updateOne(
        {
          movement_id: movementDocument?.movement_id,
        },
        {
          $set: {
            lastUpdateTime: new Date().toISOString(),
            documentStatus: "PickUpComplete",
          },
        }
      );
      await activationCollection.updateOne(
        {
          _id: findActivation?._id,
        },
        {
          $set: {
            lastUpdateTime: new Date().toISOString(),
            documentStatus: "PickUpComplete",
          },
        }
      );
      console.log("Pick-Up Completed Successfully");
      await sendReminderEmail(findVehicle, movementDocument);
      await session.commitTransaction();
      return "Success";
    } else {
      await movementCollection.updateOne(
        {
          movement_id: movementDocument?.movement_id,
        },
        {
          $set: {
            documentStatus: "pickupException",
          },
        }
      );
      console.error(`Pick-Up Conflict`);
      return "Error";
    }
  } catch (err) {
    session.abortTransaction();
    console.error("Session Aborted :", err);
    return "Error";
  } finally {
    session.endSession();
  }
  // }
};

async function sendReminderEmail(vehicleData, movementDocument) {
  const message = `
  Hello ${movementDocument?.nameOfFleetOfficer || ''}, A vehicle with Plate number ${vehicleData?.plateNumber || ''} has been checked out with VnubanNumber is ${vehicleData?.VnubanNumber || ''}.
   Kindly check it out. - Pick-Up Team
  `;
  const conflictParam = {
    Message: message,
    TopicArn: process.env.REMINDEREMAIL_SNS,
    Subject: "Pick-Up Successful",
  };
  await sns
    .publish(conflictParam)
    .promise()
    .then((data) => {
      console.log("Pick-Up Success Email Message ID", data, "has been sent");
      return;
    })
    .catch((err) => {
      console.error(err, err.stack);
      return;
    });
}

// Set region
AWS.config.update({ region: process.env.AWS_REGION_CUSTOM });

exports.handler = async (event, context, callback) => {
  await pickUpProcess(event);
  return event;
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
