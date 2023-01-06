const AWS = require("aws-sdk");
const { ObjectId } = require("mongodb");
const sns = new AWS.SNS();
const clientPromise = require("./mongo-client");

const cancelActivation = async (parent_id, activationCollection) => {
  const getParentActivation = await activationCollection.findOne({
    activation_id: { $eq: parent_id },
  });
  if (
    getParentActivation?.documentStatus === "ActivationConflict" ||
    getParentActivation?.documentStatus === "ActivationException"
  ) {
    await activationCollection.updateOne(
      { activation_id: parent_id },
      {
        $set: {
          documentStatus: "ActivationCancelled",
        },
      }
    );
  } else {
    console.error("Activation cant be cancelled");
  }
  return;
};

// Set the parameters
/**
 *
 * @param {string} key
 * @param {string} updateDoc
 */
const vehiclePropectProcess = async () => {
  const vehicleCollection = await getCollection("vehicles");
  const prospectCollection = await getCollection("prospects");
  const activationCollection = await getCollection("activations");
  const uniqueIdentifierCounterCollection = await getCollection(
    "uniqueIdentifierCounter"
  );
  const activationDocuments = await activationCollection
    .find({ documentStatus: { $eq: "SubmittedForActivation" } })
    .sort({ lastUpdateTime: 1 })
    .toArray();
  const session = (await clientPromise).startSession();
  for (const document of activationDocuments) {
    try {
      session.startTransaction({
        readConcern: { level: "local" },
        writeConcern: { w: "majority" },
      });
      const findVehicle = await vehicleCollection.findOne({
        vehicle_id: { $eq: document?.vehicle_id },
      });
      const findProspect = await prospectCollection.findOne({
        prospect_id: { $eq: document?.prospect_id },
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
      console.log(`NEW COLLECTION INCREMENT`, collection, "Value ::-->", incrementedValue);
      const checkMaintainenceStatus = !!findVehicle?.lastMovementInfo?.maintenanceStatus === false || (!!findVehicle?.lastMovementInfo?.maintenanceStatus && findVehicle?.lastMovementInfo?.maintenanceStatus === "Complete")
      //Vehicle Collection Modification
      if (
        (findVehicle?.documentStatus === "ReadyForActivation" || findVehicle?.documentStatus === "UpdatedInfo") &&
        findProspect?.documentStatus === "NotActivated" &&
        checkMaintainenceStatus &&
        checkValidations(findVehicle,findProspect,document)

      ) {
        
        const vehicleUpdate = {
          vehicleStatus: "ActivatedButNotCheckedOut",
          contractPage: document?.contractPage,
          contractStatus: document?.contractStatus,
          drivingLicense: document?.drivingLicense,
          healthInsurance: document?.healthInsurance,
          helmetNumber: document?.helmetNumber,
          serviceType: document?.serviceType,
          financierInfo: document?.financierInfo,
          vehicleOptions: document?.vehicleOptions,
          platformInfo: document?.platformInfo,
        };
        await vehicleCollection.updateOne(
          { vehicle_id: findVehicle.vehicle_id },
          {
            $set: {
              documentStatus: "ActivatedButNotCheckedOut",
              ...vehicleUpdate,
              prospect_id: document?.prospect_id,
              lastUpdateTime: new Date().toISOString(),
            },
          }
        );
        const newVehicle = {
          ...findVehicle,
          ...vehicleUpdate,
          messageInfo: {
            documentStatus: "ActivatedButNotCheckedOut",
            origin: 'vams2.0'
          },
          prospect_id: document?.prospect_id,
          lastUpdateTime: new Date().toISOString(),
          messageType: "activated",
        };
        delete newVehicle['_id'];
        delete newVehicle['documentStatus'];
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
          assignedVehicleType: findVehicle?.vehicleType,
          assignedVehicle_vehicle_id: findVehicle?.vehicle_id,
          assignedVehiclePlateNo: findVehicle?.plateNumber,
          assignedVehicleTrim: findVehicle?.vehicleTrim,
          assignedHelmetNumber: document?.helmetNumber,
          contractPage: document?.contractPage,
          contractStatus: document?.contractStatus,
          drivingLicense: document?.drivingLicense,
          healthInsurance: document?.healthInsurance,
          serviceType: document?.serviceType,
          financierInfo: document?.financierInfo,
          vehicleOptions: document?.vehicleOptions,
          platformInfo: document?.platformInfo,
          contractor_id: "",
          pricingTemplate: findVehicle?.pricingTemplate,
          hpDays: findVehicle?.hpDays,
          lastUpdateTime: new Date().toISOString(),
        };
        //Prospect Collection Modification
        await prospectCollection.updateOne(
          {
            prospect_id: document?.prospect_id,
          },
          {
            $set: {
              ...prospectUpdate,
              documentStatus: "ActivatedButNotCheckedOut",
              prospect_id: document?.prospect_id,
            },
          }
        );
        const prospectActivate = {
          ...findProspect,
          ...prospectUpdate,
          messageInfo: {
            documentStatus: "ActivatedButNotCheckedOut",
            origin: 'vams2.0'
          },
          prospect_id: document?.prospect_id,
          messageType: "activated",
        };
        delete prospectActivate['_id'];
        delete prospectActivate['documentStatus'];
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
        await activationCollection.updateOne(
          {
            _id: document?._id,
          },
          {
            $set: {
              activation_id: incrementedValue.toString(),
              lastUpdateTime: new Date().toISOString(),
              documentStatus: "ActivatedButNotCheckedOut",
            },
          }
        );
        console.log("Activation Completed Successfully");
        //Call cancel Parent Activation method
        //If parent activation id is not null then call this method
        if (document?.parent_activation_id !== null) {
          await cancelActivation(
            document?.parent_activation_id,
            activationCollection
          );
        }
        await sendReminderEmail(findVehicle, document);
        await session.commitTransaction();
      } else {
        await activationCollection.updateOne(
          {
            _id: document?._id,
          },
          {
            $set: {
              activation_id: incrementedValue.toString(),
              documentStatus: "ActivationConflict",
            },
          }
        );
        await sendConflictEmail(findVehicle, findProspect, document);
        console.error("Activation-Conflict");
      }
    } catch (err) {
      session.abortTransaction();
      console.error("Session Aborted :", err);
    } finally {
      session.endSession();
    }
  }
};

async function sendConflictEmail(vehicleData, prospectData, document) {
  const message = `
  Hello, An activation has failed please check.\n
  Reason for failure :Activation Failed , time of failure ${new Date(
    document?.lastUpdateTime
  ).toUTCString()},
  Date of activation: \t${new Date(
    document?.lastUpdateTime
  ).toUTCString()},
  VehicleId: \t${vehicleData?.vehicle_id || ''},
  ProspectId: \t${prospectData?.prospect_id || ''},
  Location: \t${prospectData?.prospectLocation || ''},
  Name of Prospect: \t${prospectData?.prospectName || ''},
  Prospect Address: \t${prospectData?.prospectAddress || ''},
  Prospect Phone number: \t${prospectData?.prospectPhoneNumber || ''},
  Activation officers: \t${document?.nameOfFleetOfficer || ''} 
  vehicle type: \t${prospectData?.vehicleOfInterest || ''}, 
  Plate number: \t${vehicleData?.plateNumber || ''}.
  `;
  const conflictParam = {
    Message: message,
    TopicArn: process.env.EXCEPTION_SNS,
    Subject: `Activation Conflict`,
  };
  await sns
    .publish(conflictParam)
    .promise()
    .then((data) => {
      console.log("Activation Conflict Message ID", data, "has been sent");
      return;
    })
    .catch((err) => {
      console.error(err, err.stack);
      return;
    });
}
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
 * @param {object} findVehicle 
 * @param {object} findVehicle 
 * @returns 
 */
function checkValidations(findVehicle,findProspect,activationDocument){
  if(findVehicle?.pricingTemplate == "" || !findVehicle?.pricingTemplate){
    return false;
  }
  // if(!activationDocument?.prospect_id){
  //   return false;
  // }
  if(!activationDocument?.healthInsurance || !activationDocument?.drivingLicense || !activationDocument?.serviceType){
    return false;
  }
  // if(!activationDocument?.assignedVehicle_vehicle_id){
  //   return false;
  // }

  return true;
}
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
