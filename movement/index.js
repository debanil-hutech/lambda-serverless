const AWS = require("aws-sdk");
const clientPromise = require("./mongo-client");
const { ObjectId, Collection } = require("mongodb");
const { MOVEMENT_TYPES } = require('./constants')
// Set region
AWS.config.update({ region: process.env.AWS_REGION_CUSTOM });


exports.handler = async (event) => {
  const checkArray = MOVEMENT_TYPES;
  const movementCollection = await getCollection("movements");
  const uniqueIdentifierCounterCollection = await getCollection(
    "uniqueIdentifierCounter"
  );
  const movementDocuments = await movementCollection
    .find({ documentStatus: { $in: checkArray } })
    .sort({ lastUpdateTime: 1 })
    .toArray();
  console.warn("Number of movement documents",movementDocuments?.length);
  const session = (await clientPromise).startSession();
    const processMovementDocuments = [];
    for (const document of movementDocuments) {
      try {
        session.startTransaction({
          readConcern: { level: "local" },
          writeConcern: { w: "majority" },
        });
        const inc = 1;
        const collection =
          await uniqueIdentifierCounterCollection.findOneAndUpdate(
            { _id: "movement_id" },
            {
              $inc: { count: inc },
            },
            { returnDocument: 'after' }
          );
        const incrementedValue = collection?.value?.count;
        await movementCollection.updateOne(
          {
            _id: ObjectId(document?._id),
          },
          {
            $set: {
              lastUpdateTime: new Date().toISOString(),
              movement_id: incrementedValue,
            },
          }
        );
        document.movement_id = incrementedValue;
        await session.commitTransaction();
        processMovementDocuments.push(document);
      } catch (err) {
        session.abortTransaction();
        console.error("Could not process document", document);
        console.error("Session Aborted :", err);
      }
    }
    console.table(processMovementDocuments);
    session.endSession();
    return { allDocument: { array: [...processMovementDocuments] } };

  
  
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
