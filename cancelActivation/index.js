const AWS = require("aws-sdk");
const { ObjectId } = require("mongodb");
const sns = new AWS.SNS();
const clientPromise = require("./mongo-client");


// Set the parameters
/**
 *
 * @param {string} key
 * @param {string} updateDoc
 */
const vehiclePropectProcess = async () => {
  const activationCollection = await getCollection("activations");
  const uniqueIdentifierCounterCollection = await getCollection(
    "uniqueIdentifierCounter"
  );
  const activationDocuments = await activationCollection
    .find({ documentStatus: { $eq: "SubmittedForCancellation" } })
    .sort({ lastUpdateTime: 1 })
    .toArray();
  const session = (await clientPromise).startSession();
  for (const document of activationDocuments) {
    try {
      const getParentActivation = await activationCollection.findOne({
        activation_id: { $eq: document?.parent_activation_id },
      });

      const inc = 1;
      const collection =
        await uniqueIdentifierCounterCollection.findOneAndUpdate(
          { _id: "activation_id" },
          {
            $inc: { count: inc },
          },
          { returnDocument: 'after' }
        );
      const incrementedValue = collection?.value?.count;
      if (
        getParentActivation?.documentStatus !== "ActivatedButNotCheckedOut" &&
        getParentActivation?.documentStatus !== "ActivationCancelled" &&
        getParentActivation?.documentStatus !== "PickUpComplete" &&
        getParentActivation?.documentStatus !== "CheckInComplete"
      ) {
        session.startTransaction({
          readConcern: { level: "local" },
          writeConcern: { w: "majority" },
        });

        await activationCollection.updateOne(
          {
            _id: getParentActivation?._id,
          },
          {
            $set: {
              lastUpdateTime: new Date().toISOString(),
              documentStatus: "ActivationCancelled",
            },
          }
        );
        await activationCollection.updateOne(
          {
            _id: document?._id,
          },
          {
            $set: {
              activation_id: incrementedValue.toString(),
              lastUpdateTime: new Date().toISOString(),
              documentStatus: "CancellationComplete",
            },
          }
        );
        console.log("Activation Cancelled Successfully");

        await session.commitTransaction();
      } else {
        await activationCollection.updateOne(
          {
            _id: document?._id,
          },
          {
            $set: {
              activation_id: incrementedValue.toString(),
              documentStatus: "CancellationException",
            },
          }
        );
        console.error("Cancellation Exception");
      }
    } catch (err) {
      session.abortTransaction();
      console.error("Session Aborted :", err);
    } finally {
      session.endSession();
    }
  }
};


async function sendReminderEmail(vehicleData, document) {
  const message = `
  Hello ${document?.nameOfFleetOfficer || ''}, A vehicle with Plate number ${vehicleData?.plateNumber || ''} has been activated but not yet checked out.
   Kindly proceed to check it out immediately. Activation Team
  `;
  const conflictParam = {
    Message: message,
    TopicArn: process.env.REMINDEREMAIL_SNS,
    Subject: `Activation Successful-${vehicleData?.vehicle_id || ''}`,
  };
  await sns
    .publish(conflictParam)
    .promise()
    .then((data) => {
      console.log("Activation Success Email Message ID", data, "has been sent");
      return;
    })
    .catch((err) => {
      console.error(err, err.stack);
      return;
    });
}
// Set region
AWS.config.update({ region: process.env.AWS_REGION_CUSTOM });

exports.handler = (event) => {
  vehiclePropectProcess();
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
