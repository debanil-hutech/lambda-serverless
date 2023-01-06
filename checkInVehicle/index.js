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
const checkinProcess = async (document) => {
  const vehicleCollection = await getCollection("vehicles");
  const movementCollection = await getCollection("movements");
  const session = (await clientPromise).startSession();
  if (typeof document?._id == 'string') {
    document._id = new ObjectId(document?._id);
    console.log('Object New', document);
  }
  // for (const document of movementDocuments) {
  try {
    const isVehicle = await vehicleCollection.findOne({
      vehicle_id: { $eq: document?.vehicle_id },
    });
    if (document?.champion_id && isVehicle?.champion_id !== document?.champion_id) {
      console.error(`Champion ${isVehicle?.champion_id} of Vehicle is not matching with ${document?.champion_id} Champion came for Check In  `);
      return;
    }
    //Vehicle Collection Modification
    if (
      isVehicle?.vehicleStatus === "Active"
    ) {
      session.startTransaction({
        readConcern: { level: "local" },
        writeConcern: { w: "majority" },
      });
      const vehicleUpdate = {
        vehicleStatus: "Inactive",
        documentStatus: "CheckinComplete",
        lastUpdateTime: new Date().toISOString(),
        messageType: "Checkin"
      };
      await vehicleCollection.updateOne(
        { vehicle_id: isVehicle.vehicle_id },
        {
          $set: {
            ...vehicleUpdate
          },
        }
      );
      const newVehicle = {
        ...isVehicle,
        ...vehicleUpdate
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


      await movementCollection.updateOne(
        {
          _id: document?._id,
        },
        {
          $set: {
            lastUpdateTime: new Date().toISOString(),
            documentStatus: "CheckinComplete",
          },
        }
      );
      console.log("Checkin Completed Successfully");
      await sendReminderEmail(isVehicle, document);
      await session.commitTransaction();
    } else {
      await movementCollection.updateOne(
        {
          _id: document?._id,
        },
        {
          $set: {
            documentStatus: "CheckInException",
          },
        }
      );
      console.error(`Checkin-Conflict`, "Movements-Table");
    }
  } catch (err) {
    session.abortTransaction();
    console.error("Session Aborted :", err);
  } finally {
    session.endSession();
  }
  // }
};

async function sendReminderEmail(vehicleData, document) {
  const message = `
  Hello ${document?.nameOfFleetOfficer || ''}, A vehicle with Plate number ${vehicleData?.plateNumber || ''} has been checked out with VnubanNumber is ${vehicleData?.VnubanNumber || ''}.
   Kindly  check it out . Checkin Team
  `;
  const conflictParam = {
    Message: message,
    TopicArn: "arn:aws:sns:eu-west-2:048464312507:ReminderEmail",
    Subject: "Checkin Successful",
  };
  await sns
    .publish(conflictParam)
    .promise()
    .then((data) => {
      console.log("Checkin Success Email Message ID", data, "has been sent");
      return;
    })
    .catch((err) => {
      console.error(err, err.stack);
      return;
    });
}

// Set region
AWS.config.update({ region: "eu-west-2" });

exports.handler = async (event) => {
  await checkinProcess(event);
  return "Checkin Complete";
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

